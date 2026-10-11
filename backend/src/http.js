import { randomUUID } from 'node:crypto';

export class HttpError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export function asyncRoute(handler) {
  return (request, response, next) => Promise.resolve(handler(request, response, next)).catch(next);
}

export function sendError(error, request, response, next) {
  if (response.headersSent) return next(error);
  if (error?.code === 11000) {
    return response.status(409).json({ error: { code: 'duplicate_record', message: 'A matching record already exists.' } });
  }
  if (error?.name === 'MulterError' || error?.status === 413) {
    return response.status(413).json({ error: { code: 'upload_too_large', message: 'The upload exceeds the configured size limit.' } });
  }
  if (error?.name === 'ZodError') {
    return response.status(400).json({ error: { code: 'validation_error', message: 'Request validation failed.', details: error.issues } });
  }
  if (error instanceof HttpError) {
    return response.status(error.status).json({ error: { code: error.code, message: error.message, ...(error.details ? { details: error.details } : {}) } });
  }
  request.log?.error({ requestId: request.id, error: error?.message }, 'Unhandled request error');
  return response.status(500).json({ error: { code: 'internal_error', message: 'An unexpected server error occurred.' } });
}

export function requestId(request, response, next) {
  request.id = randomUUID();
  response.setHeader('X-Request-Id', request.id);
  next();
}

export function parsePage(query) {
  const page = Number.parseInt(query.page ?? '1', 10);
  const limit = Number.parseInt(query.limit ?? '50', 10);
  if (!Number.isInteger(page) || page < 1 || !Number.isInteger(limit) || limit < 1 || limit > 100) {
    throw new HttpError(400, 'invalid_pagination', 'Page must be positive and limit must be between 1 and 100.');
  }
  return { page, limit, skip: (page - 1) * limit };
}

export function requiredRevision(request) {
  const revision = Number(request.header('If-Match'));
  if (!Number.isInteger(revision) || revision < 1) {
    throw new HttpError(428, 'revision_required', 'Send the current revision in the If-Match header.');
  }
  return revision;
}