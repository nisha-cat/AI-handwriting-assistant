import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config';

describe('loadConfig', () => {
  it('runs in development with no credentials at all', () => {
    const c = loadConfig({ NODE_ENV: 'development' } as NodeJS.ProcessEnv);
    expect(c.openaiApiKey).toBeNull();
    expect(c.databaseUrl).toBeNull();
    expect(c.corsOrigins).toEqual(['http://localhost:5173']);
  });

  it('treats blank values from an unfilled .env as unset', () => {
    const c = loadConfig({ OPENAI_API_KEY: '', DATABASE_URL: '  ' } as NodeJS.ProcessEnv);
    expect(c.openaiApiKey).toBeNull();
    expect(c.databaseUrl).toBeNull();
  });

  it('refuses to start in production without a database', () => {
    expect(() => loadConfig({ NODE_ENV: 'production' } as NodeJS.ProcessEnv)).toThrow(/DATABASE_URL/);
    expect(() => loadConfig({ NODE_ENV: 'production', DATABASE_URL: 'mysql://u:p@h/db' } as NodeJS.ProcessEnv)).not.toThrow();
  });

  it('allows a throw-away in-memory store in production only when explicitly requested', () => {
    const c = loadConfig({ NODE_ENV: 'production', ALLOW_MEMORY_STORE: 'true' } as NodeJS.ProcessEnv);
    expect(c.databaseUrl).toBeNull();
  });

  it('rejects invalid values with a readable message', () => {
    expect(() => loadConfig({ PORT: 'abc' } as NodeJS.ProcessEnv)).toThrow(/PORT/);
  });

  it('parses multiple CORS origins', () => {
    const c = loadConfig({ CORS_ORIGIN: 'https://a.example, https://b.example' } as NodeJS.ProcessEnv);
    expect(c.corsOrigins).toEqual(['https://a.example', 'https://b.example']);
  });
});
