import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { createAuthRouter } from './auth.js';
import { createFinanceRouter } from './finance.js';
import { createImportRouter } from './imports.js';
import { createSavingsRouter } from './savings.js';
import { createSyncRouter } from './sync.js';
import { requestId, sendError } from './http.js';

export function createApp({ database, config }) {
  const app = express();
  app.locals.config = config;
  app.disable('x-powered-by');
  app.use(helmet());
  app.use(cors({ origin: config.CORS_ORIGINS, credentials: false, allowedHeaders: ['Authorization', 'Content-Type', 'If-Match', 'Idempotency-Key', 'X-Record-Id'] }));
  app.use(requestId);
  app.use(express.json({ limit: '64kb' }));
  app.get('/health', (request, response) => response.json({ status: 'ok', requestId: request.id }));
  app.use('/api/v1/auth', rateLimit({ windowMs: 60_000, limit: 20, standardHeaders: true, legacyHeaders: false }), createAuthRouter({ database, config }));
  app.use('/api/v1', createFinanceRouter({ database }));
  app.use('/api/v1/imports', createImportRouter({ database, config }));
  app.use('/api/v1/savings-goals', createSavingsRouter({ database }));
  app.use('/api/v1/sync', createSyncRouter({ database }));
  app.use((request, response) => response.status(404).json({ error: { code: 'not_found', message: 'The requested API route was not found.' } }));
  app.use(sendError);
  return app;
}