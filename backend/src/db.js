import { MongoClient } from 'mongodb';

export async function connectDatabase(config) {
  const client = new MongoClient(config.MONGODB_URI, {
    appName: 'finance-tracker-api',
    serverSelectionTimeoutMS: 5000,
  });
  await client.connect();
  const database = client.db(config.MONGODB_DATABASE);
  await ensureIndexes(database);
  return { client, database };
}

export async function ensureIndexes(database) {
  await Promise.all([
    database.collection('sessions').createIndex({ tokenHash: 1 }, { unique: true }),
    database.collection('sessions').createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
    database.collection('authChallenges').createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
    database.collection('identities').createIndex({ provider: 1, subject: 1 }, { unique: true }),
    database.collection('accounts').createIndex({ userId: 1, archivedAt: 1, name: 1 }),
    database.collection('transactions').createIndex({ userId: 1, accountId: 1, occurredAt: -1 }),
    database.collection('transactions').createIndex({ userId: 1, type: 1, occurredAt: -1 }),
    database.collection('transactions').createIndex(
      { userId: 1, accountId: 1, externalReference: 1 },
      { unique: true, partialFilterExpression: { externalReference: { $type: 'string' } } },
    ),
    database.collection('transfers').createIndex({ userId: 1, occurredAt: -1 }),
    database.collection('categories').createIndex({ userId: 1, archivedAt: 1, name: 1 }),
    database.collection('categories').createIndex({ userId: 1, name: 1 }, { unique: true, partialFilterExpression: { archivedAt: null } }),
    database.collection('imports').createIndex({ userId: 1, createdAt: -1 }),
    database.collection('savingsGoals').createIndex({ userId: 1, status: 1, createdAt: -1 }),
    database.collection('contributions').createIndex({ userId: 1, transactionId: 1 }, { unique: true, partialFilterExpression: { transactionId: { $type: 'string' }, deletedAt: null } }),
    database.collection('contributions').createIndex({ userId: 1, transferId: 1 }, { unique: true, partialFilterExpression: { transferId: { $type: 'string' }, deletedAt: null } }),
    database.collection('contributions').createIndex({ userId: 1, sourceId: 1 }, { unique: true, partialFilterExpression: { sourceId: { $type: 'string' }, deletedAt: null } }),
  ]);
}