import type { Request, Response } from 'express';
import { rateLimit } from 'express-rate-limit';
import type { ApiErrorBody } from '@hw/shared';

export interface RateLimitOptions {
  /** Requests per 15 minutes per IP across the whole API. */
  generalPer15Min: number;
  /** Requests per minute per IP for the costly AI/transcription endpoints. */
  aiPerMin: number;
}

export const defaultRateLimits: RateLimitOptions = { generalPer15Min: 600, aiPerMin: 20 };

const handler = (message: string) => (_req: Request, res: Response) => {
  const body: ApiErrorBody = { error: { code: 'RATE_LIMITED', message } };
  res.status(429).json(body);
};

export function generalLimiter(opts: RateLimitOptions) {
  return rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: opts.generalPer15Min,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    handler: handler('Too many requests. Please wait a few minutes and try again.'),
  });
}

export function aiLimiter(opts: RateLimitOptions) {
  return rateLimit({
    windowMs: 60 * 1000,
    limit: opts.aiPerMin,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    handler: handler('You are sending AI requests too quickly. Wait a minute and try again.'),
  });
}
