import { randomUUID } from 'node:crypto';
import express from 'express';
import multer from 'multer';
import { parse as parseCsv } from 'csv-parse/sync';
import ExcelJS from 'exceljs';
import { z } from 'zod';
import { requireAuth } from './auth.js';
import { accountEffect } from './domain/money.js';
import { transactionInput } from './domain/schemas.js';
import { asyncRoute, HttpError, parsePage } from './http.js';

const rowMapping = z.object({
  date: z.string().min(1),
  amount: z.string().optional(),
  debit: z.string().optional(),
  credit: z.string().optional(),
  description: z.string().optional(),
  reference: z.string().optional(),
  balance: z.string().optional(),
}).strict().superRefine((value, context) => {
  if (!value.amount && !(value.debit && value.credit)) context.addIssue({ code: z.ZodIssueCode.custom, message: 'Map an amount column or both debit and credit columns.' });
});

export function createImportRouter({ database, config }) {
  const router = express.Router();
  router.use(requireAuth(database));
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: config.MAX_IMPORT_BYTES, files: 1 } });

  router.post('/preview', upload.single('file'), asyncRoute(async (request, response) => {
    const accountId = z.string().uuid().parse(request.body?.accountId);
    let rawMapping;
    try {
      rawMapping = JSON.parse(request.body?.mapping ?? '{}');
    } catch {
      throw new HttpError(400, 'invalid_column_mapping', 'Column mapping must be valid JSON.');
    }
    const mapping = rowMapping.parse(rawMapping);
    const account = await database.collection('accounts').findOne({ _id: accountId, userId: request.userId, archivedAt: null });
    if (!account) throw new HttpError(404, 'account_not_found', 'The active account was not found.');
    const file = request.file;
    if (!file) throw new HttpError(400, 'file_required', 'Select a CSV or XLSX file.');
    const extension = file.originalname.toLowerCase().split('.').pop();
    if (!['csv', 'xlsx'].includes(extension)) throw new HttpError(415, 'unsupported_file_type', 'Only CSV and XLSX files are supported.');
    const rows = extension === 'csv' ? readCsv(file.buffer) : await readXlsx(file.buffer);
    if (rows.length > 20_000) throw new HttpError(413, 'too_many_rows', 'An import may contain at most 20,000 data rows.');
    if (rows.length === 0) throw new HttpError(400, 'empty_import', 'The file contains no data rows.');

    const importId = randomUUID();
    const stagedRows = rows.map((row, index) => parseImportRow(row, index + 1, mapping, accountId));
    if (Buffer.byteLength(JSON.stringify(stagedRows)) > 10_000_000) throw new HttpError(413, 'import_too_large', 'The expanded import exceeds the supported processing size.');
    const references = stagedRows.filter((row) => row.externalReference).map((row) => row.externalReference);
    const existing = references.length ? await database.collection('transactions').find({ userId: request.userId, accountId, externalReference: { $in: references }, deletedAt: null }, { projection: { externalReference: 1 } }).toArray() : [];
    const existingReferences = new Set(existing.map((item) => item.externalReference));
    for (const row of stagedRows) {
      if (row.valid && row.externalReference && existingReferences.has(row.externalReference)) {
        row.valid = false;
        row.status = 'duplicate';
        row.errors.push('This provider reference already exists for the selected account.');
      } else if (row.valid) {
        const sameAmountDateCandidates = await database.collection('transactions').countDocuments({
          userId: request.userId, accountId, amountPesewas: row.amountPesewas, occurredAt: row.occurredAt, deletedAt: null,
        });
        if (sameAmountDateCandidates > 0) row.possibleDuplicate = true;
      }
    }

    const document = {
      _id: importId, userId: request.userId, accountId, fileName: sanitizeFileName(file.originalname),
      fileSize: file.size, fileType: extension, createdAt: new Date(), status: 'preview',
      rows: stagedRows, rowCount: stagedRows.length, importedCount: 0, skippedCount: 0, rejectedCount: stagedRows.filter((row) => !row.valid).length,
    };
    await database.collection('imports').insertOne(document);
    response.status(201).json({ id: importId, status: document.status, counts: { total: document.rowCount, valid: stagedRows.filter((row) => row.valid).length, invalid: document.rejectedCount, possibleDuplicates: stagedRows.filter((row) => row.possibleDuplicate).length }, rows: stagedRows });
  }));

  router.post('/:id/confirm', asyncRoute(async (request, response) => {
    const acceptedRows = request.body?.acceptedRows;
    if (!Array.isArray(acceptedRows) || acceptedRows.length > 20_000 || acceptedRows.some((row) => !Number.isInteger(row) || row < 1)) {
      throw new HttpError(400, 'invalid_import_selection', 'acceptedRows must contain 1-based row numbers.');
    }
    const imports = database.collection('imports');
    const importJob = await imports.findOne({ _id: request.params.id, userId: request.userId });
    if (!importJob) throw new HttpError(404, 'import_not_found', 'The import was not found.');
    if (importJob.status === 'completed') return response.json(importResult(importJob));
    const account = await database.collection('accounts').findOne({ _id: importJob.accountId, userId: request.userId, archivedAt: null });
    if (!account) throw new HttpError(409, 'account_unavailable', 'The import account is no longer active.');
    const uniqueRows = [...new Set(acceptedRows)];
    const rowByNumber = new Map(importJob.rows.map((row) => [row.rowNumber, row]));
    const selected = uniqueRows.map((number) => rowByNumber.get(number));
    if (selected.some((row) => !row || !row.valid)) throw new HttpError(400, 'invalid_import_selection', 'Selected rows must exist and pass validation.');
    await imports.updateOne({ _id: importJob._id, userId: request.userId, status: 'preview' }, { $set: { status: 'processing', acceptedRows: uniqueRows, updatedAt: new Date() } });

    const failures = [];
    for (const row of selected) {
      const transaction = {
        id: row.transactionId, accountId: importJob.accountId, amountPesewas: row.amountPesewas,
        type: row.type, occurredAt: row.occurredAt, description: row.description, source: 'import',
        externalReference: row.externalReference, importId: importJob._id,
      };
      try {
        const parsed = transactionInput.parse(transaction);
        const existing = await database.collection('transactions').findOne({ _id: parsed.id, userId: request.userId });
        if (existing) {
          if (existing.importId === importJob._id) continue;
          else failures.push({ rowNumber: row.rowNumber, reason: 'Transaction ID already belongs to another record.' });
          continue;
        }
        await database.collection('transactions').insertOne({
          _id: parsed.id, userId: request.userId, ...parsed, revision: 1, operationKeys: [`import:${importJob._id}:${row.rowNumber}`],
          createdAt: new Date(), updatedAt: new Date(), deletedAt: null,
        });
      } catch (error) {
        if (error?.code === 11000) {
          const existing = await database.collection('transactions').findOne({ _id: row.transactionId, userId: request.userId });
          if (existing?.importId === importJob._id) continue;
          else failures.push({ rowNumber: row.rowNumber, reason: 'A transaction with this reference already exists.' });
        } else {
          failures.push({ rowNumber: row.rowNumber, reason: 'The row could not be committed.' });
        }
      }
    }
    const status = failures.length ? 'partial' : 'completed';
    const importedTotal = await database.collection('transactions').countDocuments({ userId: request.userId, importId: importJob._id, deletedAt: null });
    const duplicateRows = importJob.rows.filter((row) => row.status === 'duplicate').length;
    const omittedRows = importJob.rows.filter((row) => row.valid && !uniqueRows.includes(row.rowNumber)).length;
    const saved = {
      status, importedCount: importedTotal, skippedCount: duplicateRows + omittedRows,
      rejectedCount: importJob.rows.filter((row) => !row.valid && row.status !== 'duplicate').length + failures.length, failures,
      acceptedRows: uniqueRows, updatedAt: new Date(),
    };
    await imports.updateOne({ _id: importJob._id, userId: request.userId }, { $set: saved });
    response.json(importResult({ ...importJob, ...saved }));
  }));

  router.get('/', asyncRoute(async (request, response) => {
    const { page, limit, skip } = parsePage(request.query);
    const filter = { userId: request.userId };
    const [items, total] = await Promise.all([
      database.collection('imports').find(filter, { projection: { rows: 0 } }).sort({ createdAt: -1 }).skip(skip).limit(limit).toArray(),
      database.collection('imports').countDocuments(filter),
    ]);
    response.json({ items: items.map(({ _id, ...item }) => ({ id: _id, ...item })), page, limit, total });
  }));

  router.get('/:id', asyncRoute(async (request, response) => {
    const job = await database.collection('imports').findOne({ _id: request.params.id, userId: request.userId });
    if (!job) throw new HttpError(404, 'import_not_found', 'The import was not found.');
    const { _id, ...item } = job;
    response.json({ id: _id, ...item });
  }));

  router.post('/:id/reconcile', asyncRoute(async (request, response) => {
    const input = z.object({ openingBalancePesewas: z.number().int().safe().optional(), closingBalancePesewas: z.number().int().safe().optional() }).strict().refine((value) => value.openingBalancePesewas !== undefined || value.closingBalancePesewas !== undefined).parse(request.body);
    const job = await database.collection('imports').findOne({ _id: request.params.id, userId: request.userId });
    if (!job) throw new HttpError(404, 'import_not_found', 'The import was not found.');
    const account = await database.collection('accounts').findOne({ _id: job.accountId, userId: request.userId });
    if (!account) throw new HttpError(404, 'account_not_found', 'The account was not found.');
    const accepted = job.acceptedRows ?? [];
    const dates = job.rows.filter((row) => row.occurredAt).map((row) => new Date(row.occurredAt));
    const through = dates.length ? new Date(Math.max(...dates.map((date) => date.getTime()))) : new Date();
    const from = dates.length ? new Date(Math.min(...dates.map((date) => date.getTime()))) : null;
    const periodStart = input.openingBalancePesewas === undefined ? new Date(0) : from;
    if (!periodStart) throw new HttpError(400, 'statement_period_unknown', 'A statement period could not be inferred from the import rows.');
    const [transactions, transfers] = await Promise.all([
      database.collection('transactions').find({ userId: request.userId, accountId: account._id, deletedAt: null, occurredAt: { $gte: periodStart, $lte: through } }).toArray(),
      database.collection('transfers').find({ userId: request.userId, deletedAt: null, occurredAt: { $gte: periodStart, $lte: through }, $or: [{ fromAccountId: account._id }, { toAccountId: account._id }] }).toArray(),
    ]);
    const openingBalancePesewas = input.openingBalancePesewas ?? account.openingBalancePesewas;
    const transactionEffect = transactions.reduce((sum, item) => sum + accountEffect(item), 0);
    const transferEffect = transfers.reduce((sum, item) => sum + (item.fromAccountId === account._id ? -item.amountPesewas - item.feePesewas : item.amountPesewas), 0);
    const calculatedClosingBalancePesewas = openingBalancePesewas + transactionEffect + transferEffect;
    response.json({
      statement: input, period: { from: periodStart, through }, openingBalancePesewas, calculatedClosingBalancePesewas,
      differencePesewas: input.closingBalancePesewas === undefined ? null : input.closingBalancePesewas - calculatedClosingBalancePesewas,
      requiresReview: true, acceptedRowCount: accepted.length,
      contributingRecords: [
        ...transactions.map((item) => ({ id: item._id, kind: 'transaction', amountPesewas: item.amountPesewas, type: item.type, occurredAt: item.occurredAt })),
        ...transfers.map((item) => ({ id: item._id, kind: 'transfer', amountPesewas: item.amountPesewas, feePesewas: item.feePesewas, occurredAt: item.occurredAt })),
      ],
    });
  }));

  return router;
}

function readCsv(buffer) {
  try {
    return parseCsv(buffer, { bom: true, columns: true, skip_empty_lines: true, trim: true, relax_column_count: false, max_record_size: 16_384 });
  } catch {
    throw new HttpError(400, 'invalid_csv', 'The CSV could not be parsed. Check its header and row structure.');
  }
}

async function readXlsx(buffer) {
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(buffer);
  } catch {
    throw new HttpError(400, 'invalid_xlsx', 'The XLSX file could not be parsed.');
  }
  const sheet = workbook.worksheets[0];
  if (!sheet || sheet.rowCount < 2) throw new HttpError(400, 'empty_import', 'The workbook has no data rows.');
  const headers = sheet.getRow(1).values.slice(1).map((value) => String(value ?? '').trim());
  return sheet.getRows(2, sheet.rowCount - 1).map((row) => Object.fromEntries(headers.map((header, index) => [header, normalizeCell(row.getCell(index + 1).value)])));
}

function normalizeCell(value) {
  if (value && typeof value === 'object' && 'result' in value) return String(value.result ?? '');
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'object' && value !== null && 'text' in value) return String(value.text);
  return value === null || value === undefined ? '' : String(value);
}

export function parseImportRow(row, rowNumber, mapping, accountId) {
  const errors = [];
  const dateText = String(row[mapping.date] ?? '').trim();
  const occurredAt = parseStatementDate(dateText);
  if (!occurredAt) errors.push('Date is missing or invalid; use an ISO date or a supported spreadsheet date.');
  const debit = mapping.debit ? parseDecimal(row[mapping.debit]) : null;
  const credit = mapping.credit ? parseDecimal(row[mapping.credit]) : null;
  const amountValue = mapping.amount ? parseDecimal(row[mapping.amount]) : null;
  let amountPesewas;
  let type;
  if (amountValue !== null) {
    amountPesewas = Math.abs(amountValue);
    type = amountValue < 0 ? 'expense' : 'income';
  } else {
    if (debit !== null && debit < 0 || credit !== null && credit < 0) errors.push('Debit and credit columns must contain non-negative values.');
    const hasDebit = debit !== null && debit > 0;
    const hasCredit = credit !== null && credit > 0;
    if (hasDebit && hasCredit) errors.push('Both debit and credit are set; resolve this row manually.');
    else if (hasDebit) {
      amountPesewas = debit;
      type = 'expense';
    } else if (hasCredit) {
      amountPesewas = credit;
      type = 'income';
    }
  }
  if (!Number.isSafeInteger(amountPesewas) || amountPesewas <= 0) errors.push('Amount is missing, zero, invalid, or exceeds the supported range.');
  const description = mapping.description ? String(row[mapping.description] ?? '').trim().slice(0, 500) : '';
  const externalReference = mapping.reference ? String(row[mapping.reference] ?? '').trim().slice(0, 160) || undefined : undefined;
  const balancePesewas = mapping.balance ? parseDecimal(row[mapping.balance]) : null;
  if (mapping.balance && balancePesewas === null && String(row[mapping.balance] ?? '').trim()) errors.push('Balance value is invalid.');
  const valid = errors.length === 0;
  return {
    rowNumber, transactionId: randomUUID(), accountId, amountPesewas: Number.isSafeInteger(amountPesewas) ? amountPesewas : null,
    type: type ?? null, occurredAt, description, externalReference, balancePesewas,
    status: valid ? 'ready' : 'invalid', valid, possibleDuplicate: false, errors,
  };
}

export function parseDecimal(value) {
  if (value === undefined || value === null || String(value).trim() === '') return null;
  const text = String(value).trim();
  if (!/^-?(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d{1,2})?$/.test(text)) return null;
  const normalized = text.replace(/,/g, '');
  const [whole, fraction = ''] = normalized.replace('-', '').split('.');
  const amount = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  const result = normalized.startsWith('-') ? -amount : amount;
  return Number.isSafeInteger(result) ? result : null;
}

export function parseStatementDate(value) {
  if (!value) return null;
  if (/^\d+(?:\.\d+)?$/.test(value)) {
    const excelSerial = Number(value);
    if (excelSerial > 0 && excelSerial < 2_958_466) return new Date(Date.UTC(1899, 11, 30) + excelSerial * 86_400_000);
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function sanitizeFileName(name) {
  return name.replace(/[\\/\x00-\x1f]/g, '_').slice(0, 180);
}

function importResult(job) {
  return { id: job._id, status: job.status, importedCount: job.importedCount, skippedCount: job.skippedCount, rejectedCount: job.rejectedCount, failures: job.failures ?? [] };
}