import express from 'express';
import { z } from 'zod';
import { requireAuth } from './auth.js';
import { transactionInput, transactionUpdate, transferInput, transferUpdate } from './domain/schemas.js';
import { asyncRoute, HttpError, parsePage } from './http.js';

const operationSchema = z.object({
  operationId: z.string().min(1).max(120).regex(/^[A-Za-z0-9._:-]+$/),
  entity: z.enum(['transaction', 'transfer']),
  action: z.enum(['create', 'update', 'delete']),
  id: z.string().uuid(),
  expectedRevision: z.number().int().positive().optional(),
  data: z.record(z.unknown()).optional(),
}).strict().superRefine((operation, context) => {
  if (operation.action !== 'create' && operation.expectedRevision === undefined) context.addIssue({ code: z.ZodIssueCode.custom, path: ['expectedRevision'], message: 'Updates and deletes require expectedRevision.' });
  if (operation.action !== 'delete' && !operation.data) context.addIssue({ code: z.ZodIssueCode.custom, path: ['data'], message: 'Create and update operations require data.' });
});

export function createSyncRouter({ database }) {
  const router = express.Router();
  router.use(requireAuth(database));

  router.get('/changes', asyncRoute(async (request, response) => {
    const { limit } = parsePage(request.query);
    const cursor = decodeCursor(request.query.cursor, request.query.since);
    const collections = ['accounts', 'transactions', 'transfers', 'categories', 'savingsGoals'];
    const entries = await Promise.all(collections.map(async (name) => {
      if (cursor.complete.includes(name)) return [name, { items: [], complete: true }];
      const clauses = [{ updatedAt: { $gt: new Date(cursor.since), $lte: new Date(cursor.until) } }];
      const last = cursor.positions[name];
      if (last) clauses.push({ $or: [{ updatedAt: { $gt: new Date(last.updatedAt) } }, { updatedAt: new Date(last.updatedAt), _id: { $gt: last.id } }] });
      const items = await database.collection(name).find({ userId: request.userId, $and: clauses }).sort({ updatedAt: 1, _id: 1 }).limit(limit + 1).toArray();
      const hasMore = items.length > limit;
      const batch = hasMore ? items.slice(0, limit) : items;
      const lastItem = batch.at(-1);
      return [name, {
        items: batch.map(({ _id, userId, ...record }) => ({ id: _id, ...record })),
        hasMore,
        last: lastItem ? { updatedAt: lastItem.updatedAt, id: lastItem._id } : last,
        complete: !hasMore,
      }];
    }));
    const changes = Object.fromEntries(entries);
    const nextState = { ...cursor, positions: { ...cursor.positions }, complete: [...cursor.complete] };
    for (const [name, result] of entries) {
      if (result.hasMore) nextState.positions[name] = result.last;
      else if (!nextState.complete.includes(name)) nextState.complete.push(name);
    }
    const finished = nextState.complete.length === collections.length;
    const nextCursorState = finished
      ? { since: cursor.until, until: new Date().toISOString(), positions: {}, complete: [] }
      : nextState;
    const nextCursor = Buffer.from(JSON.stringify(nextCursorState)).toString('base64url');
    response.json({ changes, nextCursor, limit, hasMore: !finished, upperBound: new Date(cursor.until) });
  }));

  router.post('/operations', asyncRoute(async (request, response) => {
    const operations = z.array(operationSchema).min(1).max(100).parse(request.body?.operations);
    const uniqueIds = new Set(operations.map((operation) => operation.operationId));
    if (uniqueIds.size !== operations.length) throw new HttpError(400, 'duplicate_operation_ids', 'Each operation in a batch must have a unique operationId.');
    const results = [];
    for (const operation of operations) {
      const existing = await database.collection('syncOperations').findOne({ _id: `${request.userId}:${operation.operationId}` });
      if (existing?.status === 'complete') {
        results.push(existing.result);
        continue;
      }
      const result = await applyOperation(database, request.userId, operation);
      if (result.status !== 'failed') {
        const operationRecord = { _id: `${request.userId}:${operation.operationId}`, userId: request.userId, operationId: operation.operationId, status: 'complete', result, completedAt: new Date() };
        await database.collection('syncOperations').updateOne({ _id: operationRecord._id }, { $set: operationRecord }, { upsert: true });
      }
      results.push(result);
    }
    response.json({ results });
  }));

  return router;
}

async function applyOperation(database, userId, operation) {
  const collectionName = operation.entity === 'transaction' ? 'transactions' : 'transfers';
  const collection = database.collection(collectionName);
  const key = operation.operationId;
  if (operation.action === 'create') {
    const existing = await collection.findOne({ _id: operation.id, userId });
    if (existing) {
      if (existing.operationKeys?.includes(key)) return { operationId: key, status: 'synced', id: existing._id, revision: existing.revision };
      return { operationId: key, status: 'conflict', code: 'record_exists', id: existing._id, revision: existing.revision };
    }
    try {
      const input = operation.entity === 'transaction'
        ? transactionInput.parse({ ...operation.data, id: operation.id })
        : transferInput.parse({ ...operation.data, id: operation.id });
      if (operation.entity === 'transaction') {
        const account = await database.collection('accounts').findOne({ _id: input.accountId, userId, archivedAt: null });
        if (!account) return { operationId: key, status: 'failed', code: 'account_not_found' };
        if (input.categoryId && !(await database.collection('categories').findOne({ _id: input.categoryId, userId, archivedAt: null }))) return { operationId: key, status: 'failed', code: 'category_not_found' };
      } else {
        const accounts = await database.collection('accounts').find({ _id: { $in: [input.fromAccountId, input.toAccountId] }, userId, archivedAt: null }).toArray();
        if (accounts.length !== 2) return { operationId: key, status: 'failed', code: 'account_not_found' };
      }
      const document = {
        _id: operation.id, userId, ...input, revision: 1, operationKeys: [key],
        createdAt: new Date(), updatedAt: new Date(), deletedAt: null,
      };
      if (document.id !== undefined) delete document.id;
      await collection.insertOne(document);
      return { operationId: key, status: 'synced', id: operation.id, revision: 1 };
    } catch (error) {
      if (error?.code === 11000) {
        const duplicate = await collection.findOne({ _id: operation.id, userId });
        if (duplicate?.operationKeys?.includes(key)) return { operationId: key, status: 'synced', id: operation.id, revision: duplicate.revision };
        return { operationId: key, status: 'conflict', code: 'duplicate_record', id: operation.id };
      }
      throw error;
    }
  }

  const current = await collection.findOne({ _id: operation.id, userId, deletedAt: null });
  if (!current) return { operationId: key, status: 'failed', code: 'record_not_found' };
  if (current.operationKeys?.includes(key)) return { operationId: key, status: 'synced', id: current._id, revision: current.revision };
  if (current.revision !== operation.expectedRevision) return { operationId: key, status: 'conflict', code: 'revision_conflict', id: current._id, revision: current.revision };
  if (operation.action === 'update') {
    if (operation.entity === 'transaction') {
      const patch = transactionUpdate.parse(operation.data);
      const merged = {
        id: current._id, accountId: patch.accountId ?? current.accountId, amountPesewas: patch.amountPesewas ?? current.amountPesewas,
        type: patch.type ?? current.type, signedAmountPesewas: patch.signedAmountPesewas ?? current.signedAmountPesewas,
        occurredAt: patch.occurredAt ?? current.occurredAt, categoryId: patch.categoryId === undefined ? current.categoryId : patch.categoryId,
        description: patch.description ?? current.description, externalReference: patch.externalReference === undefined ? current.externalReference : patch.externalReference,
        source: current.source, importId: current.importId,
      };
      transactionInput.parse(merged);
      if (patch.accountId && !(await database.collection('accounts').findOne({ _id: patch.accountId, userId, archivedAt: null }))) return { operationId: key, status: 'failed', code: 'account_not_found' };
      if (patch.categoryId && !(await database.collection('categories').findOne({ _id: patch.categoryId, userId, archivedAt: null }))) return { operationId: key, status: 'failed', code: 'category_not_found' };
    } else {
      const patch = transferUpdate.parse(operation.data);
      const fromAccountId = patch.fromAccountId ?? current.fromAccountId;
      const toAccountId = patch.toAccountId ?? current.toAccountId;
      if (fromAccountId === toAccountId) throw new HttpError(400, 'invalid_transfer', 'Transfer accounts must be different.');
      if (patch.fromAccountId || patch.toAccountId) {
        const accounts = await database.collection('accounts').find({ _id: { $in: [fromAccountId, toAccountId] }, userId, archivedAt: null }).toArray();
        if (accounts.length !== 2) return { operationId: key, status: 'failed', code: 'account_not_found' };
      }
      operation.data = patch;
    }
  }
  const update = operation.action === 'delete'
    ? { $set: { deletedAt: new Date(), updatedAt: new Date() } }
    : { $set: { ...operation.data, updatedAt: new Date() } };
  if (operation.data) {
    delete update.$set.id;
    delete update.$set.userId;
    delete update.$set._id;
    delete update.$set.revision;
    delete update.$set.operationKeys;
    delete update.$set.createdAt;
    delete update.$set.deletedAt;
  }
  update.$inc = { revision: 1 };
  update.$addToSet = { operationKeys: key };
  const result = await collection.findOneAndUpdate(
    { _id: operation.id, userId, deletedAt: null, revision: operation.expectedRevision, operationKeys: { $ne: key } },
    update,
    { returnDocument: 'after' },
  );
  if (!result) {
    const latest = await collection.findOne({ _id: operation.id, userId });
    if (latest?.operationKeys?.includes(key)) return { operationId: key, status: 'synced', id: latest._id, revision: latest.revision };
    return { operationId: key, status: 'conflict', code: 'revision_conflict', id: current._id, revision: latest?.revision ?? current.revision };
  }
  return { operationId: key, status: 'synced', id: current._id, revision: result.revision };
}

function decodeCursor(value, sinceValue) {
  if (!value) {
    const since = sinceValue ? new Date(sinceValue) : new Date(0);
    if (Number.isNaN(since.getTime())) throw new HttpError(400, 'invalid_sync_cursor', 'since must be a valid timestamp.');
    return { since: since.toISOString(), until: new Date().toISOString(), positions: {}, complete: [] };
  }
  if (typeof value !== 'string' || value.length > 4_000) throw new HttpError(400, 'invalid_sync_cursor', 'The sync cursor is invalid.');
  try {
    const cursor = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
    if (typeof cursor.since !== 'string' || !Number.isFinite(new Date(cursor.since).getTime()) || typeof cursor.until !== 'string' || !Number.isFinite(new Date(cursor.until).getTime()) || typeof cursor.positions !== 'object' || !Array.isArray(cursor.complete)) throw new Error('invalid cursor');
    return cursor;
  } catch {
    throw new HttpError(400, 'invalid_sync_cursor', 'The sync cursor is invalid.');
  }
}