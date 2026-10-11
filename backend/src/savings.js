import express from 'express';
import { requireAuth } from './auth.js';
import { buildGoalPlan, markPlannedContributions, nextScheduleDate, summarizeContributions } from './domain/savings.js';
import { goalInput } from './domain/schemas.js';
import { asyncRoute, HttpError, requiredRevision } from './http.js';

function stripId(goal) {
  const { _id, ...fields } = goal;
  return { id: _id, ...fields };
}

export function createSavingsRouter({ database }) {
  const router = express.Router();
  router.use(requireAuth(database));

  router.get('/', asyncRoute(async (request, response) => {
    const goals = await database.collection('savingsGoals').find({ userId: request.userId }).sort({ createdAt: -1 }).toArray();
    const now = new Date();
    const results = await Promise.all(goals.map(async (goal) => {
      const actuals = await database.collection('contributions').find({ userId: request.userId, goalId: goal._id, deletedAt: null }).toArray();
      const transactionIds = actuals.filter((item) => item.sourceType === 'transaction').map((item) => item.sourceId);
      const transferIds = actuals.filter((item) => item.sourceType === 'transfer').map((item) => item.sourceId);
      const [transactions, transfers] = await Promise.all([
        transactionIds.length ? database.collection('transactions').find({ _id: { $in: transactionIds }, userId: request.userId, deletedAt: null }).toArray() : [],
        transferIds.length ? database.collection('transfers').find({ _id: { $in: transferIds }, userId: request.userId, deletedAt: null }).toArray() : [],
      ]);
      const sources = new Map([
        ...transactions.map((item) => [`transaction:${item._id}`, item]),
        ...transfers.map((item) => [`transfer:${item._id}`, item]),
      ]);
      const validContributions = actuals.filter((item) => sources.has(`${item.sourceType}:${item.sourceId}`));
      const sourceRecords = validContributions.map((item) => sources.get(`${item.sourceType}:${item.sourceId}`));
      const planned = buildGoalPlan(goal, now);
      const plannedWithActuals = markPlannedContributions(planned, validContributions, goal.missedPeriodPolicy, now);
      return { ...stripId(goal), ...summarizeContributions(goal, plannedWithActuals, sourceRecords), plannedContributions: plannedWithActuals, actualContributions: validContributions.map(stripId) };
    }));
    response.json(results);
  }));

  router.post('/', asyncRoute(async (request, response) => {
    const input = goalInput.parse(request.body);
    const timestamp = new Date();
    const schedule = {
      version: 1, effectiveFrom: input.startDate, frequency: input.frequency, intervalDays: input.intervalDays,
      contributionFormula: input.contributionFormula, missedPeriodPolicy: input.missedPeriodPolicy,
      targetDate: input.targetDate ?? null,
    };
    const goal = { _id: input.id, userId: request.userId, ...input, scheduleVersions: [schedule], status: 'active', revision: 1, createdAt: timestamp, updatedAt: timestamp };
    await database.collection('savingsGoals').insertOne(goal);
    response.status(201).json(stripId(goal));
  }));

  router.patch('/:id', asyncRoute(async (request, response) => {
    const revision = requiredRevision(request);
    const patch = goalInput.omit({ id: true }).partial().strict().parse(request.body);
    if (Object.keys(patch).length === 0) throw new HttpError(400, 'empty_update', 'At least one goal field is required.');
    const existing = await database.collection('savingsGoals').findOne({ _id: request.params.id, userId: request.userId });
    if (!existing) throw new HttpError(404, 'goal_not_found', 'The savings goal was not found.');
    const scheduleFields = ['startDate', 'frequency', 'intervalDays', 'contributionFormula', 'missedPeriodPolicy', 'targetDate'];
    const scheduleChanged = scheduleFields.some((field) => Object.hasOwn(patch, field));
    let updated = { ...patch };
    if (scheduleChanged) {
      const latest = existing.scheduleVersions?.at(-1) ?? {
        version: 1, effectiveFrom: existing.startDate, frequency: existing.frequency, intervalDays: existing.intervalDays,
        contributionFormula: existing.contributionFormula, missedPeriodPolicy: existing.missedPeriodPolicy, targetDate: existing.targetDate ?? null,
      };
      const merged = goalInput.parse({
        id: existing._id, name: patch.name ?? existing.name, targetPesewas: patch.targetPesewas ?? existing.targetPesewas,
        accountId: patch.accountId ?? existing.accountId, targetDate: Object.hasOwn(patch, 'targetDate') ? patch.targetDate : latest.targetDate,
        startDate: patch.startDate ?? latest.effectiveFrom, frequency: patch.frequency ?? latest.frequency,
        intervalDays: patch.intervalDays ?? latest.intervalDays, contributionFormula: patch.contributionFormula ?? latest.contributionFormula,
        missedPeriodPolicy: patch.missedPeriodPolicy ?? latest.missedPeriodPolicy,
      });
      const requestedStart = merged.startDate > now ? merged.startDate : nextScheduleDate(latest, now);
      const schedule = {
        version: latest.version + 1, effectiveFrom: requestedStart, frequency: merged.frequency, intervalDays: merged.intervalDays,
        contributionFormula: merged.contributionFormula, missedPeriodPolicy: merged.missedPeriodPolicy,
        targetDate: merged.targetDate ?? null,
      };
      updated = { ...patch, scheduleVersions: [...(existing.scheduleVersions ?? [latest]), schedule] };
    }
    const result = await database.collection('savingsGoals').findOneAndUpdate(
      { _id: existing._id, userId: request.userId, revision },
      { $set: { ...updated, updatedAt: new Date() }, $inc: { revision: 1 } },
      { returnDocument: 'after' },
    );
    if (!result) throw new HttpError(409, 'revision_conflict', 'The savings goal changed since it was read.');
    response.json(stripId(result));
  }));

  router.post('/:id/status', asyncRoute(async (request, response) => {
    const { status } = request.body ?? {};
    if (!['active', 'paused', 'cancelled'].includes(status)) throw new HttpError(400, 'invalid_goal_status', 'Status must be active, paused, or cancelled.');
    const revision = requiredRevision(request);
    const result = await database.collection('savingsGoals').findOneAndUpdate(
      { _id: request.params.id, userId: request.userId, revision },
      { $set: { status, updatedAt: new Date() }, $inc: { revision: 1 } },
      { returnDocument: 'after' },
    );
    if (!result) throw new HttpError(409, 'revision_conflict', 'The savings goal changed or no longer exists.');
    response.json(stripId(result));
  }));

  router.post('/:id/contributions', asyncRoute(async (request, response) => {
    const { transactionId, transferId, id } = request.body ?? {};
    if (typeof id !== 'string' || !((typeof transactionId === 'string') !== (typeof transferId === 'string'))) throw new HttpError(400, 'invalid_contribution', 'Provide a stable contribution ID and exactly one transactionId or transferId.');
    const goal = await database.collection('savingsGoals').findOne({ _id: request.params.id, userId: request.userId, status: 'active' });
    if (!goal) throw new HttpError(404, 'active_goal_not_found', 'The active savings goal was not found.');
    let source;
    if (transactionId) {
      source = await database.collection('transactions').findOne({ _id: transactionId, userId: request.userId, deletedAt: null });
      if (!source || !['income', 'interest'].includes(source.type)) throw new HttpError(400, 'transaction_not_qualifying', 'A contribution transaction must be posted income or interest in a savings account.');
      const account = await database.collection('accounts').findOne({ _id: source.accountId, userId: request.userId });
      if (!account || account.type !== 'savings' || (goal.accountId && goal.accountId !== account._id)) throw new HttpError(400, 'transaction_not_qualifying', 'The transaction must credit the savings account linked to this goal.');
    } else {
      source = await database.collection('transfers').findOne({ _id: transferId, userId: request.userId, deletedAt: null });
      if (!source) throw new HttpError(400, 'transfer_not_qualifying', 'The savings transfer was not found.');
      const account = await database.collection('accounts').findOne({ _id: source.toAccountId, userId: request.userId });
      if (!account || account.type !== 'savings' || (goal.accountId && goal.accountId !== account._id)) throw new HttpError(400, 'transfer_not_qualifying', 'The transfer must credit the savings account linked to this goal.');
    }
    const existing = await database.collection('contributions').findOne({ userId: request.userId, sourceId: source._id, deletedAt: null });
    if (existing) throw new HttpError(409, 'transaction_already_linked', 'This transaction or transfer is already linked to a savings goal.');
    const contribution = {
      _id: id, userId: request.userId, goalId: goal._id, sourceId: source._id,
      ...(transactionId ? { transactionId, sourceType: 'transaction' } : { transferId, sourceType: 'transfer' }),
      amountPesewas: source.amountPesewas, occurredAt: source.occurredAt, revision: 1, createdAt: new Date(), deletedAt: null,
    };
    await database.collection('contributions').insertOne(contribution);
    response.status(201).json(stripId(contribution));
  }));

  router.delete('/:goalId/contributions/:contributionId', asyncRoute(async (request, response) => {
    const revision = Number(request.header('If-Match'));
    if (!Number.isInteger(revision) || revision < 1) throw new HttpError(428, 'revision_required', 'Send the current contribution revision in If-Match.');
    const result = await database.collection('contributions').updateOne(
      { _id: request.params.contributionId, goalId: request.params.goalId, userId: request.userId, revision, deletedAt: null },
      { $set: { deletedAt: new Date() }, $inc: { revision: 1 } },
    );
    if (!result.modifiedCount) throw new HttpError(409, 'revision_conflict', 'The contribution changed or no longer exists.');
    response.status(204).end();
  }));

  return router;
}