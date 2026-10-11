import 'dotenv/config';
import { z } from 'zod';

const environmentSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  MONGODB_URI: z.string().min(1),
  MONGODB_DATABASE: z.string().min(1).default('finance_tracker'),
  MONGODB_SERVER_SELECTION_TIMEOUT_MS: z.coerce.number().int().min(1000).max(120_000).default(30_000),
  SESSION_SECRET: z.string().min(32),
  SESSION_TTL_DAYS: z.coerce.number().int().min(1).max(90).default(30),
  GOOGLE_CLIENT_ID: z.string().optional(),
  APPLE_CLIENT_ID: z.string().optional(),
  CORS_ORIGINS: z.string().default('http://localhost:5173'),
  MAX_IMPORT_BYTES: z.coerce.number().int().min(1024).max(10_485_760).default(5_242_880),
});

export function loadConfig(environment = process.env) {
  const parsed = environmentSchema.safeParse(environment);
  if (!parsed.success) {
    const details = parsed.error.issues.map(({ path, message }) => `${path.join('.')}: ${message}`).join('; ');
    throw new Error(`Invalid environment configuration: ${details}`);
  }

  return {
    ...parsed.data,
    CORS_ORIGINS: parsed.data.CORS_ORIGINS.split(',').map((origin) => origin.trim()).filter(Boolean),
  };
}