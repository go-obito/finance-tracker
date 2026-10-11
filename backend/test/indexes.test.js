import test from 'node:test';
import assert from 'node:assert/strict';
import { ensureIndexes } from '../src/db.js';

test('contributions have one canonical unique source index and obsolete indexes are removed', async () => {
  const created = [];
  const dropped = [];
  const database = {
    collection(collectionName) {
      return {
        async createIndex(keys, options = {}) {
          created.push({ collection: collectionName, keys, options });
        },
        async dropIndex(name) {
          dropped.push({ collection: collectionName, name });
        },
      };
    },
  };

  await ensureIndexes(database);
  const contributionIndexes = created.filter((index) => index.collection === 'contributions');
  assert.equal(contributionIndexes.length, 1);
  assert.deepEqual(contributionIndexes[0].keys, { userId: 1, sourceId: 1 });
  assert.equal(contributionIndexes[0].options.unique, true);
  assert.deepEqual(dropped, [
    { collection: 'contributions', name: 'userId_1_transactionId_1' },
    { collection: 'contributions', name: 'userId_1_transferId_1' },
  ]);
});
