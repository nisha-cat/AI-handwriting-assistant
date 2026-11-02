import { randomUUID } from 'node:crypto';
import path from 'node:path';
import cors from 'cors';
import express, { type Express } from 'express';
import helmet from 'helmet';
import type { Capabilities } from '@hw/shared';
import type { AiProvider } from './ai/provider';
import type { Config } from './config';
import type { Repository } from './db/types';
import { errorHandler, notFoundHandler } from './middleware/errorHandler';
import { aiLimiter, defaultRateLimits, generalLimiter, type RateLimitOptions } from './middleware/rateLimit';
import { sessionMiddleware } from './middleware/session';
import { aiRouter } from './routes/ai';
import { documentsRouter, preferencesRouter } from './routes/documents';
import { exportRouter } from './routes/export';
import { transcriptionRouter } from './routes/transcription';
import type { Transcriber } from './transcription/transcriber';

export interface AppDeps {
  config: Config;
  repo: Repository;
  ai: AiProvider;
  transcriber: Transcriber | null;
  rateLimits?: RateLimitOptions;
  log?: (message: string) => void;
}

/** Builds the Express app. Everything external is injected so tests can use mocks. */
export function createApp({ config, repo, ai, transcriber, rateLimits = defaultRateLimits, log = console.error }: AppDeps): Express {
  const app = express();
  app.disable('x-powered-by');
  if (config.trustProxy > 0) app.set('trust proxy', config.trustProxy);

  app.use(helmet());
  app.use(cors({ origin: config.corsOrigins, credentials: true, methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] }));

  // Request id + metadata-only access log (never bodies, never audio).
  app.use((req, res, next) => {
    const id = randomUUID();
    res.set('X-Request-Id', id);
    if (config.env !== 'test') {
      const started = Date.now();
      res.on('finish', () => console.log(`${id} ${req.method} ${req.path} ${res.statusCode} ${Date.now() - started}ms`));
    }
    next();
  });

  app.use('/api', generalLimiter(rateLimits));

  // Health/capabilities: lets the UI explain what is (not) configured.
  app.get('/api/health', async (_req, res) => {
    await repo.ping();
    const body: Capabilities = {
      status: 'ok',
      store: repo.kind,
      ai: ai.name,
      transcription: transcriber !== null,
      maxAudioMb: config.maxAudioMb,
    };
    res.json(body);
  });

  // Larger JSON limit only where needed (page layouts); everything else is small.
  app.use('/api/export', express.json({ limit: '2mb' }), exportRouter());
  app.use('/api/transcription', aiLimiter(rateLimits), transcriptionRouter(transcriber, config));

  app.use(express.json({ limit: '256kb' }));
  app.use('/api/ai', aiLimiter(rateLimits), aiRouter(ai));

  const session = sessionMiddleware(repo, config);
  app.use('/api/documents', session, documentsRouter(repo));
  app.use('/api/preferences', session, preferencesRouter(repo));

  // Optional single-service hosting: serve the built web app from the same origin as the API
  // (which also keeps the session cookie first-party). API paths never fall through to it.
  if (config.webDist) {
    const dist = config.webDist;
    app.use(express.static(dist, { index: 'index.html', maxAge: '1h' }));
    app.use((req, res, next) => {
      if (req.method !== 'GET' || req.path.startsWith('/api')) return next();
      res.sendFile(path.join(dist, 'index.html'));
    });
  }
  app.use(notFoundHandler);
  app.use(errorHandler(log));
  return app;
}
