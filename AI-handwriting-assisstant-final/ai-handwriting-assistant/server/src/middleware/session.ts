import { createHash, randomBytes } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import type { Config } from '../config';
import type { Repository } from '../db/types';

export const SESSION_COOKIE = 'hw_sid';
const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;

declare module 'express-serve-static-core' {
  interface Request {
    userId?: string;
  }
}

export const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');

function readCookie(header: string | undefined, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx > 0 && part.slice(0, idx).trim() === name) return part.slice(idx + 1).trim();
  }
  return undefined;
}

/**
 * Anonymous per-browser identity. A random token lives in an httpOnly cookie; only its
 * SHA-256 hash is stored. Every document query is scoped to the resulting user id.
 * (This is deliberately not an account system - see README "Limitations".)
 */
export function sessionMiddleware(repo: Repository, config: Config) {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      let token = readCookie(req.headers.cookie, SESSION_COOKIE);
      if (!token || !TOKEN_RE.test(token)) {
        token = randomBytes(32).toString('base64url');
        res.cookie(SESSION_COOKIE, token, {
          httpOnly: true,
          sameSite: 'lax',
          secure: config.env === 'production',
          maxAge: 365 * 24 * 60 * 60 * 1000,
          path: '/',
        });
      }
      req.userId = await repo.ensureUser(hashToken(token));
      next();
    } catch (err) {
      next(err);
    }
  };
}
