import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createApp } from '../src/app.js';

const app = createApp({
  database: { collection: () => { throw new Error('Unauthenticated request reached the database.'); } },
  config: { SESSION_SECRET: 'test-session-secret-that-is-long-enough', CORS_ORIGINS: ['http://localhost:5173'], MAX_IMPORT_BYTES: 1024 },
});

test('health endpoint is public and returns a request identifier', async () => {
  const response = await request(app).get('/health').expect(200);
  assert.equal(response.body.status, 'ok');
  assert.equal(response.headers['x-request-id'], response.body.requestId);
});

test('finance endpoints reject missing or malformed sessions before accessing data', async () => {
  await request(app).get('/api/v1/accounts').expect(401);
  await request(app).get('/api/v1/transactions').set('Authorization', 'Bearer invalid').expect(401);
});

test('unknown routes under the protected API namespace require authentication first', async () => {
  const response = await request(app).get('/api/v1/not-a-route').expect(401);
  assert.equal(response.body.error.code, 'authentication_required');
  assert.equal(typeof response.body.error.message, 'string');
});