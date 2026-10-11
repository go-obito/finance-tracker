import { randomUUID } from 'node:crypto';
import express from 'express';
import { z } from 'zod';
import { accountEffect, transactionCashFlow } from './domain/money.js';
import { accountInput, categoryInput, transactionInput, transactionUpdate, transferInput } from './domain/schemas.js';
import { asyncRoute, HttpError, parsePage, requiredRevision } from './http.js';
import { requireAuth } from './auth.js';

const now = () => new Date();
const amountFilter = z.coerce.number().int().safe().nonnegative().optional();

function requireOperationKey(request) {
  const key = request.header('Idempotency-Key');
  if (!key || key.length > 120 || !/^[A-Za-z0-9._:-]+$/.test(key)) {
    throw new HttpError(400, 'idempotency_key_required', 'Send a valid Idempotency-Key header for this operation.');
  }
  return key;
}

async function findActiveAccount(database, userId, accountId) {
  const account = await database.collection('accounts').findOne({ _id: accountId, userId, archivedAt: null });
  if (!account) throw new HttpError(404, 'account_not_found', 'The active account was not found.');
  return account;
}

function operationWasApplied(record, key) {
  return record.operationKeys?.includes(key) ?? false;
}

function withoutMongoId(document) {
  const { _id, ...rest } = document;
  return { id: _id, ...rest };
}

export function createFinanceRouter({ database }) {
  const router = express.Router();
  router.use(requireAuth(database));

  router.get('/accounts', asyncRoute(async (request, response) => {
    const accounts = await database.collection('accounts').find({ userId: request.userId, archivedAt: null }).sort({ name: 1 }).toArray();
    const transactionEffects = await database.collection('transactions').aggregate([
      { $match: { userId: request.userId, deletedAt: null } },
      { $group: { _id: '$accountId', effect: { $sum: { $cond: [{ $eq: ['$type', 'adjustment'] }, '$signedAmountPesewas', { $switch: { branches: [
        { case: { $in: ['$type', ['income', 'interest', 'refund']] }, then: '$amountPesewas' },
        { case: { $in: ['$type', ['expense', 'fee']] }, then: { $multiply: ['$amountPesewas', -1] } },
      ], default: 0 } }] } } } },
    ]).toArray();
    const transfers = await database.collection('transfers').find({ userId: request.userId, deletedAt: null }).toArray();
    const effects = new Map(transactionEffects.map((item) => [item._id, item.effect]));
    for (const transfer of transfers) {
      effects.set(transfer.fromAccountId, (effects.get(transfer.fromAccountId) ?? 0) - transfer.amountPesewas - transfer.feePesewas);
      effects.set(transfer.toAccountId, (effects.get(transfer.toAccountId) ?? 0) + transfer.amountPesewas);
    }
    response.json(accounts.map((account) => ({ ...withoutMongoId(account), balancePesewas: account.openingBalancePesewas + (effects.get(account._id) ?? 0), balanceStatus: 'recorded_not_provider_verified' })));
  }));

  router.post('/accounts', asyncRoute(async (request, response) => {
    const input = accountInput.parse(request.body);
    const key = requireOperationKey(request);
    const _id = request.header('X-Record-Id') ?? randomUUID();
    if (!z.string().uuid().safeParse(_id).success) throw new HttpError(400, 'invalid_record_id', 'X-Record-Id must be a UUID.');
    const timestamp = now();
    const account = { _id, userId: request.userId, ...input, revision: 1, operationKeys: [key], createdAt: timestamp, updatedAt: timestamp, archivedAt: null };
    try {
      await database.collection('accounts').insertOne(account);
    } catch (error) {
      if (error?.code !== 11000) throw error;
      const existing = await database.collection('accounts').findOne({ _id, userId: request.userId });
      if (operationWasApplied(existing, key)) return response.status(200).json(withoutMongoId(existing));
      throw error;
    }
    response.status(201).json(withoutMongoId(account));
  }));

  router.patch('/accounts/:id', asyncRoute(async (request, response) => {
    const patch = accountInput.partial().strict().parse(request.body);
    if (Object.keys(patch).length === 0) throw new HttpError(400, 'empty_update', 'At least one account field is required.');
    const revision = requiredRevision(request);
    const key = requireOperationKey(request);
    const result = await database.collection('accounts').findOneAndUpdate(
      { _id: request.params.id, userId: request.userId, archivedAt: null, revision, operationKeys: { $ne: key } },
      { $set: { ...patch, updatedAt: now() }, $inc: { revision: 1 }, $push: { operationKeys: key } },
      { returnDocument: 'after' },
    );
    if (result) return response.json(withoutMongoId(result));
    const current = await database.collection('accounts').findOne({ _id: request.params.id, userId: request.userId });
    if (!current) throw new HttpError(404, 'account_not_found', 'The account was not found.');
    if (operationWasApplied(current, key)) return response.json(withoutMongoId(current));
    throw new HttpError(409, 'revision_conflict', 'The account changed since it was read.', { currentRevision: current.revision });
  }));

  router.delete('/accounts/:id', asyncRoute(async (request, response) => {
    const revision = requiredRevision(request);
    const key = requireOperationKey(request);
    const account = await findActiveAccount(database, request.userId, request.params.id);
    const [transactions, transfers] = await Promise.all([
      database.collection('transactions').countDocuments({ userId: request.userId, accountId: account._id, deletedAt: null }),
      database.collection('transfers').countDocuments({ userId: request.userId, deletedAt: null, $or: [{ fromAccountId: account._id }, { toAccountId: account._id }] }),
    ]);
    if (transactions || transfers) throw new HttpError(409, 'account_not_empty', 'Accounts with posted records cannot be archived.');
    const result = await database.collection('accounts').updateOne(
      { _id: account._id, userId: request.userId, revision, archivedAt: null, operationKeys: { $ne: key } },
      { $set: { archivedAt: now(), updatedAt: now() }, $inc: { revision: 1 }, $push: { operationKeys: key } },
    );
    if (!result.modifiedCount && !operationWasApplied(account, key)) throw new HttpError(409, 'revision_conflict', 'The account changed since it was read.', { currentRevision: account.revision });
    response.status(204).end();
  }));

  router.get('/transactions', asyncRoute(async (request, response) => {
    const { page, limit, skip } = parsePage(request.query);
    const filter = { userId: request.userId, deletedAt: null };
    for (const field of ['accountId', 'categoryId', 'type']) if (request.query[field]) filter[field] = request.query[field];
    if (request.query.from || request.query.to) {
      filter.occurredAt = {};
      if (request.query.from) filter.occurredAt.$gte = new Date(request.query.from);
      if (request.query.to) filter.occurredAt.$lte = new Date(request.query.to);
      if (Object.values(filter.occurredAt).some((date) => Number.isNaN(date.getTime()))) throw new HttpError(400, 'invalid_date_filter', 'Date filters must be valid dates.');
    }
    const min = amountFilter.safeParse(request.query.minAmountPesewas);
    const max = amountFilter.safeParse(request.query.maxAmountPesewas);
    if (!min.success || !max.success) throw new HttpError(400, 'invalid_amount_filter', 'Amount filters must be non-negative integer pesewas.');
    if (min.data !== undefined || max.data !== undefined) {
      filter.amountPesewas = {};
      if (min.data !== undefined) filter.amountPesewas.$gte = min.data;
      if (max.data !== undefined) filter.amountPesewas.$lte = max.data;
    }
    if (request.query.search) filter.description = { $regex: escapeRegex(String(request.query.search).slice(0, 100)), $options: 'i' };
    const [items, total] = await Promise.all([
      database.collection('transactions').find(filter).sort({ occurredAt: -1, _id: 1 }).skip(skip).limit(limit).toArray(),
      database.collection('transactions').countDocuments(filter),
    ]);
    response.json({ items: items.map(withoutMongoId), page, limit, total });
  }));

  router.post('/transactions', asyncRoute(async (request, response) => {
    const input = transactionInput.parse(request.body);
    const key = requireOperationKey(request);
    await findActiveAccount(database, request.userId, input.accountId);
    if (input.categoryId) await requireCategory(database, request.userId, input.categoryId);
    const timestamp = now();
    const transaction = { _id: input.id, userId: request.userId, ...input, revision: 1, operationKeys: [key], createdAt: timestamp, updatedAt: timestamp, deletedAt: null };
    try {
      await database.collection('transactions').insertOne(transaction);
    } catch (error) {
      if (error?.code !== 11000) throw error;
      const existing = await database.collection('transactions').findOne({ _id: input.id, userId: request.userId });
      if (operationWasApplied(existing, key)) return response.status(200).json(withoutMongoId(existing));
      throw error;
    }
    response.status(201).json(withoutMongoId(transaction));
  }));

  router.patch('/transactions/:id', asyncRoute(async (request, response) => {
    const patch = transactionUpdate.parse(request.body);
    const revision = requiredRevision(request);
    const key = requireOperationKey(request);
    const existing = await database.collection('transactions').findOne({ _id: request.params.id, userId: request.userId, deletedAt: null });
    if (!existing) throw new HttpError(404, 'transaction_not_found', 'The transaction was not found.');
    if (patch.accountId) await findActiveAccount(database, request.userId, patch.accountId);
    if (patch.categoryId) await requireCategory(database, request.userId, patch.categoryId);
    const merged = {
      id: existing._id,
      accountId: patch.accountId ?? existing.accountId,
      amountPesewas: patch.amountPesewas ?? existing.amountPesewas,
      type: patch.type ?? existing.type,
      signedAmountPesewas: patch.signedAmountPesewas ?? existing.signedAmountPesewas,
      occurredAt: patch.occurredAt ?? existing.occurredAt,
      categoryId: patch.categoryId === undefined ? existing.categoryId : patch.categoryId,
      description: patch.description ?? existing.description,
      source: existing.source,
      externalReference: patch.externalReference === undefined ? existing.externalReference : patch.externalReference,
      importId: existing.importId,
    };
    transactionInput.parse(merged);
    const result = await database.collection('transactions').findOneAndUpdate(
      { _id: request.params.id, userId: request.userId, deletedAt: null, revision, operationKeys: { $ne: key } },
      { $set: { ...patch, updatedAt: now() }, $inc: { revision: 1 }, $push: { operationKeys: key } },
      { returnDocument: 'after' },
    );
    if (result) return response.json(withoutMongoId(result));
    const current = await database.collection('transactions').findOne({ _id: request.params.id, userId: request.userId });
    if (!current || current.deletedAt) throw new HttpError(404, 'transaction_not_found', 'The transaction was not found.');
    if (operationWasApplied(current, key)) return response.json(withoutMongoId(current));
    throw new HttpError(409, 'revision_conflict', 'The transaction changed since it was read.', { currentRevision: current.revision, current: withoutMongoId(current) });
  }));

  router.delete('/transactions/:id', asyncRoute(async (request, response) => {
    const revision = requiredRevision(request);
    const key = requireOperationKey(request);
    const result = await database.collection('transactions').findOneAndUpdate(
      { _id: request.params.id, userId: request.userId, deletedAt: null, revision, operationKeys: { $ne: key } },
      { $set: { deletedAt: now(), updatedAt: now() }, $inc: { revision: 1 }, $push: { operationKeys: key } },
      { returnDocument: 'after' },
    );
    if (result || (await database.collection('transactions').findOne({ _id: request.params.id, userId: request.userId, operationKeys: key }))) return response.status(204).end();
    const current = await database.collection('transactions').findOne({ _id: request.params.id, userId: request.userId });
    if (!current) throw new HttpError(404, 'transaction_not_found', 'The transaction was not found.');
    throw new HttpError(409, 'revision_conflict', 'The transaction changed since it was read.', { currentRevision: current.revision });
  }));

  router.post('/transfers', asyncRoute(async (request, response) => {
    const input = transferInput.parse(request.body);
    const key = requireOperationKey(request);
    await Promise.all([
      findActiveAccount(database, request.userId, input.fromAccountId),
      findActiveAccount(database, request.userId, input.toAccountId),
    ]);
    const timestamp = now();
    const transfer = { _id: input.id, userId: request.userId, ...input, revision: 1, operationKeys: [key], createdAt: timestamp, updatedAt: timestamp, deletedAt: null };
    try {
      await database.collection('transfers').insertOne(transfer);
    } catch (error) {
      if (error?.code !== 11000) throw error;
      const existing = await database.collection('transfers').findOne({ _id: input.id, userId: request.userId });
      if (operationWasApplied(existing, key)) return response.status(200).json(withoutMongoId(existing));
      throw error;
    }
    response.status(201).json(withoutMongoId(transfer));
  }));

  router.delete('/transfers/:id', asyncRoute(async (request, response) => {
    const revision = requiredRevision(request);
    const key = requireOperationKey(request);
    const result = await database.collection('transfers').findOneAndUpdate(
      { _id: request.params.id, userId: request.userId, deletedAt: null, revision, operationKeys: { $ne: key } },
      { $set: { deletedAt: now(), updatedAt: now() }, $inc: { revision: 1 }, $push: { operationKeys: key } },
      { returnDocument: 'after' },
    );
    if (result || (await database.collection('transfers').findOne({ _id: request.params.id, userId: request.userId, operationKeys: key }))) return response.status(204).end();
    const current = await database.collection('transfers').findOne({ _id: request.params.id, userId: request.userId });
    if (!current) throw new HttpError(404, 'transfer_not_found', 'The transfer was not found.');
    throw new HttpError(409, 'revision_conflict', 'The transfer changed since it was read.', { currentRevision: current.revision });
  }));

  router.get('/categories', asyncRoute(async (request, response) => {
    const items = await database.collection('categories').find({ userId: request.userId, archivedAt: null }).sort({ name: 1 }).toArray();
    response.json(items.map(withoutMongoId));
  }));

  router.post('/categories', asyncRoute(async (request, response) => {
    const input = categoryInput.parse(request.body);
    const key = requireOperationKey(request);
    const id = request.header('X-Record-Id') ?? randomUUID();
    if (!z.string().uuid().safeParse(id).success) throw new HttpError(400, 'invalid_record_id', 'X-Record-Id must be a UUID.');
    if (input.parentId) await requireCategory(database, request.userId, input.parentId);
    const timestamp = now();
    const category = { _id: id, userId: request.userId, ...input, revision: 1, operationKeys: [key], createdAt: timestamp, updatedAt: timestamp, archivedAt: null };
    await database.collection('categories').insertOne(category);
    response.status(201).json(withoutMongoId(category));
  }));

  router.patch('/categories/:id', asyncRoute(async (request, response) => {
    const patch = categoryInput.partial().strict().parse(request.body);
    if (Object.keys(patch).length === 0) throw new HttpError(400, 'empty_update', 'At least one category field is required.');
    const revision = requiredRevision(request);
    const key = requireOperationKey(request);
    if (patch.parentId) await requireCategory(database, request.userId, patch.parentId);
    const result = await database.collection('categories').findOneAndUpdate(
      { _id: request.params.id, userId: request.userId, archivedAt: null, revision, operationKeys: { $ne: key } },
      { $set: { ...patch, updatedAt: now() }, $inc: { revision: 1 }, $push: { operationKeys: key } },
      { returnDocument: 'after' },
    );
    if (!result) throw new HttpError(409, 'revision_conflict', 'The category changed or no longer exists.');
    response.json(withoutMongoId(result));
  }));

  router.delete('/categories/:id', asyncRoute(async (request, response) => {
    const revision = requiredRevision(request);
    const key = requireOperationKey(request);
    const result = await database.collection('categories').findOneAndUpdate(
      { _id: request.params.id, userId: request.userId, archivedAt: null, revision, operationKeys: { $ne: key } },
      { $set: { archivedAt: now(), updatedAt: now() }, $inc: { revision: 1 }, $push: { operationKeys: key } },
      { returnDocument: 'after' },
    );
    if (!result) throw new HttpError(409, 'revision_conflict', 'The category changed or no longer exists.');
    response.status(204).end();
  }));

  router.get('/dashboard', asyncRoute(async (request, response) => {
    const from = request.query.from ? new Date(request.query.from) : new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1));
    const to = request.query.to ? new Date(request.query.to) : new Date();
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || from > to) throw new HttpError(400, 'invalid_date_range', 'The date range is invalid.');
    const records = await database.collection('transactions').find({ userId: request.userId, deletedAt: null, occurredAt: { $gte: from, $lte: to } }).toArray();
    const summary = { incomePesewas: 0, expensesPesewas: 0, feesPesewas: 0, interestPesewas: 0, refundsPesewas: 0, netCashFlowPesewas: 0, byCategory: {} };
    for (const item of records) {
      if (item.type === 'income') summary.incomePesewas += item.amountPesewas;
      if (item.type === 'expense') summary.expensesPesewas += item.amountPesewas;
      if (item.type === 'fee') summary.feesPesewas += item.amountPesewas;
      if (item.type === 'interest') summary.interestPesewas += item.amountPesewas;
      if (item.type === 'refund') summary.refundsPesewas += item.amountPesewas;
      summary.netCashFlowPesewas += transactionCashFlow(item);
      if (item.type === 'expense' && item.categoryId) summary.byCategory[item.categoryId] = (summary.byCategory[item.categoryId] ?? 0) + item.amountPesewas;
    }
    const periodTransfers = await database.collection('transfers').find({ userId: request.userId, deletedAt: null, occurredAt: { $gte: from, $lte: to }, feePesewas: { $gt: 0 } }).toArray();
    for (const transfer of periodTransfers) {
      summary.feesPesewas += transfer.feePesewas;
      summary.netCashFlowPesewas -= transfer.feePesewas;
    }
    summary.expensesAfterRefundsPesewas = summary.expensesPesewas - summary.refundsPesewas;
    const accounts = await database.collection('accounts').find({ userId: request.userId, archivedAt: null }).toArray();
    const recent = await database.collection('transactions').find({ userId: request.userId, deletedAt: null }).sort({ occurredAt: -1 }).limit(10).toArray();
    response.json({ period: { from, to }, totals: summary, recentTransactions: recent.map(withoutMongoId), accountBalances: accounts.length ? (await getAccountBalances(database, request.userId, accounts)) : [] });
  }));

  return router;
}

async function requireCategory(database, userId, categoryId) {
  const category = await database.collection('categories').findOne({ _id: categoryId, userId, archivedAt: null });
  if (!category) throw new HttpError(404, 'category_not_found', 'The active category was not found.');
}

async function getAccountBalances(database, userId, accounts) {
  const transactions = await database.collection('transactions').find({ userId, deletedAt: null }).toArray();
  const transfers = await database.collection('transfers').find({ userId, deletedAt: null }).toArray();
  const balances = new Map(accounts.map((account) => [account._id, account.openingBalancePesewas]));
  for (const transaction of transactions) balances.set(transaction.accountId, (balances.get(transaction.accountId) ?? 0) + accountEffect(transaction));
  for (const transfer of transfers) {
    balances.set(transfer.fromAccountId, (balances.get(transfer.fromAccountId) ?? 0) - transfer.amountPesewas - transfer.feePesewas);
    balances.set(transfer.toAccountId, (balances.get(transfer.toAccountId) ?? 0) + transfer.amountPesewas);
  }
  return accounts.map((account) => ({ accountId: account._id, balancePesewas: balances.get(account._id), balanceStatus: 'recorded_not_provider_verified' }));
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}