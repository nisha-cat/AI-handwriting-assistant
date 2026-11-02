import { existsSync } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(8787),
  CORS_ORIGIN: z.string().default('http://localhost:5173'),
  DATABASE_URL: z.string().optional(),
  OPENAI_API_KEY: z.string().optional(),
  OPENAI_MODEL: z.string().default('gpt-4o-mini'),
  OPENAI_TRANSCRIPTION_MODEL: z.string().default('whisper-1'),
  AI_TIMEOUT_MS: z.coerce.number().int().min(1000).max(120_000).default(30_000),
  MAX_AUDIO_MB: z.coerce.number().min(1).max(25).default(10),
  /** Number of reverse-proxy hops to trust for client IPs (rate limiting). 0 = none. */
  /** Demo hosting only: allow NODE_ENV=production without MySQL (data is lost on restart). */
  ALLOW_MEMORY_STORE: z.enum(['true', 'false']).default('false'),
  /** Folder with the built web app to serve from the API (default: ../web/dist when it exists). */
  WEB_DIST_DIR: z.string().optional(),
  TRUST_PROXY: z.coerce.number().int().min(0).max(5).default(0),
});

export interface Config {
  env: 'development' | 'test' | 'production';
  port: number;
  corsOrigins: string[];
  databaseUrl: string | null;
  openaiApiKey: string | null;
  openaiModel: string;
  transcriptionModel: string;
  aiTimeoutMs: number;
  maxAudioBytes: number;
  maxAudioMb: number;
  trustProxy: number;
  /** Absolute path of the built web app to serve, or null to serve the API only. */
  webDist: string | null;
}

const blankToUndefined = (v: string | undefined) => (v && v.trim() ? v.trim() : undefined);

export function loadConfig(source: NodeJS.ProcessEnv = process.env): Config {
  const parsed = envSchema.safeParse({
    ...source,
    DATABASE_URL: blankToUndefined(source.DATABASE_URL),
    OPENAI_API_KEY: blankToUndefined(source.OPENAI_API_KEY),
    CORS_ORIGIN: blankToUndefined(source.CORS_ORIGIN),
  });
  if (!parsed.success) {
    const problems = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Invalid environment configuration - ${problems}`);
  }
  const e = parsed.data;
  if (e.NODE_ENV === 'production' && !e.DATABASE_URL && e.ALLOW_MEMORY_STORE !== 'true') {
    throw new Error('DATABASE_URL is required when NODE_ENV=production (the in-memory store is development-only; set ALLOW_MEMORY_STORE=true for a throw-away demo).');
  }
  return {
    env: e.NODE_ENV,
    port: e.PORT,
    corsOrigins: e.CORS_ORIGIN.split(',').map((s) => s.trim()).filter(Boolean),
    databaseUrl: e.DATABASE_URL ?? null,
    openaiApiKey: e.OPENAI_API_KEY ?? null,
    openaiModel: e.OPENAI_MODEL,
    transcriptionModel: e.OPENAI_TRANSCRIPTION_MODEL,
    aiTimeoutMs: e.AI_TIMEOUT_MS,
    maxAudioMb: e.MAX_AUDIO_MB,
    maxAudioBytes: Math.floor(e.MAX_AUDIO_MB * 1024 * 1024),
    trustProxy: e.TRUST_PROXY,
    webDist: resolveWebDist(e.WEB_DIST_DIR),
  };
}

function resolveWebDist(configured: string | undefined): string | null {
  const dir = path.resolve(configured ?? path.join(process.cwd(), '..', 'web', 'dist'));
  return existsSync(path.join(dir, 'index.html')) ? dir : null;
}
