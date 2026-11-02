import { createApp } from './app';
import { LocalFallbackProvider } from './ai/localFallback';
import { OpenAiProvider } from './ai/openaiProvider';
import { loadConfig } from './config';
import { MemoryRepository } from './db/memoryRepo';
import { MysqlRepository } from './db/mysqlRepo';
import { createPool } from './db/pool';
import { OpenAiTranscriber } from './transcription/transcriber';

async function main() {
  const config = loadConfig();

  const repo = config.databaseUrl ? new MysqlRepository(createPool(config.databaseUrl)) : new MemoryRepository();
  if (repo.kind === 'memory') {
    console.warn('[store] DATABASE_URL not set - using the in-memory store. Documents are lost when the server restarts.');
  } else {
    try {
      await repo.ping();
      console.log('[db] MySQL connection OK');
    } catch (err) {
      // Stay up: /api/health and document routes report DB_UNAVAILABLE until the database returns.
      console.error(`[db] Cannot reach MySQL at startup (${(err as { code?: string }).code ?? 'unknown'}). Run "npm run migrate" once it is available.`);
    }
  }

  const ai = config.openaiApiKey
    ? new OpenAiProvider(config.openaiApiKey, config.openaiModel, config.aiTimeoutMs)
    : new LocalFallbackProvider();
  const transcriber = config.openaiApiKey
    ? new OpenAiTranscriber(config.openaiApiKey, config.transcriptionModel, config.aiTimeoutMs)
    : null;
  if (!config.openaiApiKey) {
    console.warn('[dev] OPENAI_API_KEY not set - using the basic local formatter; audio-file transcription is disabled.');
  }

  const app = createApp({ config, repo, ai, transcriber });
  const server = app.listen(config.port, () => {
    console.log(`API listening on http://localhost:${config.port} (${config.env})${config.webDist ? ' - also serving the web app' : ''}`);
  });
  server.requestTimeout = 60_000;
  server.headersTimeout = 30_000;

  const shutdown = () => {
    server.close(() => {
      void repo.close().finally(() => process.exit(0));
    });
    setTimeout(() => process.exit(1), 10_000).unref();
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  console.error('Failed to start:', (err as Error).message);
  process.exit(1);
});
