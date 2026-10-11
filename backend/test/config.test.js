import test from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig } from '../src/config.js';

const validEnvironment = {
  MONGODB_URI: 'mongodb://localhost:27017',
  SESSION_SECRET: 'test-session-secret-that-is-long-enough',
};

test('MongoDB server selection uses a configurable 30-second default', () => {
  assert.equal(loadConfig(validEnvironment).MONGODB_SERVER_SELECTION_TIMEOUT_MS, 30_000);
  assert.equal(loadConfig({ ...validEnvironment, MONGODB_SERVER_SELECTION_TIMEOUT_MS: '12000' }).MONGODB_SERVER_SELECTION_TIMEOUT_MS, 12_000);
});
