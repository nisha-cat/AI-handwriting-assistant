import type { ErrorRequestHandler, RequestHandler } from 'express';
import { ZodError } from 'zod';
import multer from 'multer';
import type { ApiErrorBody } from '@hw/shared';
import { AppError } from '../errors';

const DB_CONNECTION_CODES = new Set([
  'ECONNREFUSED',
  'ECONNRESET',
  'ETIMEDOUT',
  'ENOTFOUND',
  'EHOSTUNREACH',
  'PROTOCOL_CONNECTION_LOST',
  'ER_ACCESS_DENIED_ERROR',
  'ER_BAD_DB_ERROR',
  'ER_CON_COUNT_ERROR',
  'POOL_CLOSED',
]);

export function isDbConnectionError(err: unknown): boolean {
  const code = (err as { code?: string } | null)?.code;
  return typeof code === 'string' && DB_CONNECTION_CODES.has(code);
}

export const notFoundHandler: RequestHandler = (_req, res) => {
  const body: ApiErrorBody = { error: { code: 'NOT_FOUND', message: 'Route not found.' } };
  res.status(404).json(body);
};

/**
 * Converts every failure into `{ error: { code, message } }`. Stack traces, SQL and
 * provider messages are logged server-side only (never request content) and never sent.
 */
export function errorHandler(log: (msg: string) => void): ErrorRequestHandler {
  return (err, req, res, _next) => {
    const send = (status: number, code: string, message: string, details?: unknown, headers?: Record<string, string>) => {
      if (headers) res.set(headers);
      const body: ApiErrorBody = { error: { code, message, ...(details !== undefined ? { details } : {}) } };
      res.status(status).json(body);
    };

    if (err instanceof AppError) return send(err.status, err.code, err.message, err.details, err.headers);

    if (err instanceof ZodError) {
      const details = err.issues.map((i) => ({ path: i.path.join('.'), message: i.message }));
      return send(400, 'VALIDATION_ERROR', details[0]?.message ?? 'Invalid request.', details);
    }

    if (err instanceof multer.MulterError) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return send(413, 'AUDIO_TOO_LARGE', 'That audio file is too large. Record a shorter clip or compress the file.');
      }
      return send(400, 'UPLOAD_ERROR', 'The audio upload was not understood. Send a single file in the "audio" field.');
    }

    const e = err as { type?: string; status?: number };
    if (e?.type === 'entity.too.large') return send(413, 'PAYLOAD_TOO_LARGE', 'The request is too large.');
    if (e?.type === 'entity.parse.failed') return send(400, 'INVALID_JSON', 'The request body is not valid JSON.');

    if (isDbConnectionError(err)) {
      log(`db unavailable: ${(err as { code?: string }).code} ${req.method} ${req.path}`);
      return send(503, 'DB_UNAVAILABLE', 'The database is not reachable right now. Your work is still in the browser - try saving again shortly.');
    }

    log(`unhandled error on ${req.method} ${req.path}: ${(err as Error)?.stack ?? String(err)}`);
    return send(500, 'INTERNAL_ERROR', 'Something went wrong on the server. Please try again.');
  };
}
