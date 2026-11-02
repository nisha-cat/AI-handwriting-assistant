import { vi } from 'vitest';
import request from 'supertest';
import { defaultHandwritingSettings, documentContentSchema, type DocumentInput, type OrganizeRequest } from '@hw/shared';
import { createApp, type AppDeps } from '../src/app';
import type { AiProvider } from '../src/ai/provider';
import { loadConfig, type Config } from '../src/config';
import { MemoryRepository } from '../src/db/memoryRepo';
import type { Transcriber } from '../src/transcription/transcriber';

export const testConfig = (overrides: Partial<Config> = {}): Config => ({
  ...loadConfig({ NODE_ENV: 'test' } as NodeJS.ProcessEnv),
  ...overrides,
});

export const validAnswer = {
  title: 'Photosynthesis',
  sections: [{ heading: 'Intro', paragraphs: ['Plants make food using light.'], points: [], ordered: false }],
  changeNotes: [{ kind: 'corrected', description: 'Fixed grammar.' }],
  addedContent: false,
};

export function mockAi(replies: string[] | (() => string) = [JSON.stringify(validAnswer)]): AiProvider & {
  organize: ReturnType<typeof vi.fn>;
} {
  let i = 0;
  const organize = vi.fn(async (_req: OrganizeRequest) => {
    if (typeof replies === 'function') return replies();
    return replies[Math.min(i++, replies.length - 1)]!;
  });
  return { name: 'openai', model: 'mock-model', organize } as never;
}

export function mockTranscriber(impl?: Transcriber['transcribe']): Transcriber & { transcribe: ReturnType<typeof vi.fn> } {
  return {
    name: 'mock',
    transcribe: vi.fn(impl ?? (async () => ({ text: 'hello from the recording' }))),
  } as never;
}

export function buildApp(overrides: Partial<AppDeps> = {}) {
  const repo = overrides.repo ?? new MemoryRepository();
  const ai = overrides.ai ?? mockAi();
  const deps: AppDeps = {
    config: testConfig(),
    repo,
    ai,
    transcriber: null,
    rateLimits: { generalPer15Min: 10_000, aiPerMin: 10_000 },
    log: () => undefined,
    ...overrides,
  };
  return { app: createApp(deps), repo, ai, deps };
}

export const sampleDocument = (title = 'Biology notes', body = '# Cells\nThe cell is the unit of life.'): DocumentInput => ({
  title,
  content: documentContentSchema.parse({
    mode: 'exam',
    question: 'What is a cell?',
    rawText: 'cell is unit of life',
    bodyText: body,
    settings: defaultHandwritingSettings(),
  }),
});

export { request };
