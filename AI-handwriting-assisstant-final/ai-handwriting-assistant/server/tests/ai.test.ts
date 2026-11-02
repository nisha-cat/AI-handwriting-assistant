import { describe, expect, it, vi } from 'vitest';
import { organizeRequestSchema } from '@hw/shared';
import { assessOutput, extractJson, organizeAnswer } from '../src/ai/organize';
import { LocalFallbackProvider, localOrganize, toSentences } from '../src/ai/localFallback';
import { mapProviderError } from '../src/ai/openaiProvider';
import { AppError } from '../src/errors';
import { buildApp, mockAi, request, validAnswer } from './helpers';

const req = (over: Record<string, unknown> = {}) => organizeRequestSchema.parse({ text: 'plants make food using light', ...over });

describe('organizeRequestSchema (text validation)', () => {
  it('rejects empty and whitespace-only text', () => {
    expect(organizeRequestSchema.safeParse({ text: '' }).success).toBe(false);
    expect(organizeRequestSchema.safeParse({ text: '   \n ' }).success).toBe(false);
  });
  it('rejects excessively long text', () => {
    expect(organizeRequestSchema.safeParse({ text: 'a'.repeat(20_001) }).success).toBe(false);
  });
  it('applies defaults', () => {
    const r = req();
    expect(r.mode).toBe('exam_answer');
    expect(r.language).toBe('English');
    expect(r.structure.conclusion).toBe(true);
  });
  it('rejects unknown task modes', () => {
    expect(organizeRequestSchema.safeParse({ text: 'x', mode: 'poem' }).success).toBe(false);
  });
});

describe('extractJson', () => {
  it('parses fenced and surrounded JSON', () => {
    expect(extractJson('```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(extractJson('Sure! {"a":2} hope that helps')).toEqual({ a: 2 });
  });
  it('throws on non-JSON', () => {
    expect(() => extractJson('no json here')).toThrow();
  });
});

describe('organizeAnswer (AI response schema validation)', () => {
  it('accepts a valid reply and renders editable markup', async () => {
    const out = await organizeAnswer(req(), { provider: mockAi() });
    expect(out.organized.title).toBe('Photosynthesis');
    expect(out.text).toBe('# Intro\nPlants make food using light.');
    expect(out.provider).toBe('openai');
    expect(out.promptVersion).toBe('organize.v1');
  });

  it('asks once for a corrected reply when the first one is malformed', async () => {
    const provider = mockAi(['{"title": "x"}', JSON.stringify(validAnswer)]);
    const out = await organizeAnswer(req(), { provider });
    expect(provider.organize).toHaveBeenCalledTimes(2);
    expect(provider.organize.mock.calls[1]![1]).toMatchObject({ issues: expect.stringContaining('sections') });
    expect(out.organized.sections).toHaveLength(1);
  });

  it('fails with AI_INVALID_RESPONSE after the single repair attempt (no endless retries)', async () => {
    const provider = mockAi(['not json', '{"sections": []}']);
    await expect(organizeAnswer(req(), { provider })).rejects.toMatchObject({ code: 'AI_INVALID_RESPONSE', status: 502 });
    expect(provider.organize).toHaveBeenCalledTimes(2);
  });

  it('does not retry on provider errors (they are mapped, not looped)', async () => {
    const provider = mockAi();
    provider.organize.mockRejectedValue(new AppError(429, 'AI_RATE_LIMITED', 'busy'));
    await expect(organizeAnswer(req(), { provider })).rejects.toMatchObject({ code: 'AI_RATE_LIMITED' });
    expect(provider.organize).toHaveBeenCalledTimes(1);
  });
});

describe('assessOutput (fabrication guards)', () => {
  const answer = (text: string, extra: Record<string, unknown> = {}) => ({
    title: '',
    sections: [{ heading: '', paragraphs: [text], points: [], ordered: false }],
    changeNotes: [],
    addedContent: false,
    ...extra,
  });

  it('flags numbers that were not in the original', () => {
    const w = assessOutput(req({ text: 'the war ended long ago' }), answer('The war ended in 1945.') as never);
    expect(w.join(' ')).toMatch(/1945/);
  });
  it('does not flag numbers the user said', () => {
    expect(assessOutput(req({ text: 'it happened in 1945' }), answer('It happened in 1945.') as never)).toEqual([]);
  });
  it('flags results that balloon in length', () => {
    const long = 'word '.repeat(200);
    expect(assessOutput(req({ text: 'short answer here' }), answer(long) as never).join(' ')).toMatch(/much longer/);
  });
  it('surfaces model-reported added content', () => {
    const w = assessOutput(req(), answer('Plants make food using light.', { addedContent: true }) as never);
    expect(w.join(' ')).toMatch(/added content/);
  });
});

describe('local fallback provider (no credentials)', () => {
  it('splits sentences and fixes capitalisation/punctuation without adding words', () => {
    expect(toSentences('plants need light  and water. they grow')).toEqual(['Plants need light and water.', 'They grow.']);
  });

  it('structures exam answers by position and never invents text', () => {
    const r = req({ text: 'Cells are basic units. They have a nucleus. They divide. That is all about cells.' });
    const out = localOrganize(r);
    expect(out.sections.map((s) => s.heading)).toEqual(['Introduction', 'Main points', 'Conclusion']);
    const original = new Set(r.text.toLowerCase().match(/[a-z]+/g));
    const produced = out.sections.flatMap((s) => [...s.paragraphs, ...s.points]).join(' ').toLowerCase().match(/[a-z]+/g)!;
    for (const w of produced) expect(original.has(w)).toBe(true);
    expect(out.addedContent).toBe(false);
  });

  it('removes speech filler words and says so', () => {
    const out = localOrganize(req({ text: 'um the heart uh pumps blood' }));
    expect(JSON.stringify(out.sections)).not.toMatch(/\bum\b|\buh\b/i);
    expect(out.changeNotes.some((n) => n.kind === 'removed')).toBe(true);
  });

  it('flags itself clearly as not-AI in the service response', async () => {
    const out = await organizeAnswer(req(), { provider: new LocalFallbackProvider() });
    expect(out.provider).toBe('local-fallback');
    expect(out.model).toBeNull();
    expect(out.warnings[0]).toMatch(/No AI service is configured/);
  });

  it('warns when a non-English language cannot be honoured', async () => {
    const out = await organizeAnswer(req({ language: 'Hindi' }), { provider: new LocalFallbackProvider() });
    expect(out.warnings.join(' ')).toMatch(/Hindi/);
  });

  it.each(['short_notes', 'summary', 'qa_format', 'detailed_explanation', 'bullet_revision', 'exam_answer'] as const)(
    'produces schema-valid output for mode %s',
    async (mode) => {
      const out = await organizeAnswer(req({ mode, question: 'What is a cell?', text: 'A cell is small. It has parts. It is alive.' }), {
        provider: new LocalFallbackProvider(),
      });
      expect(out.organized.sections.length).toBeGreaterThan(0);
      expect(out.text.length).toBeGreaterThan(0);
    },
  );
});

describe('mapProviderError (provider errors → safe messages)', () => {
  const err = (props: Record<string, unknown>) => Object.assign(new Error('secret upstream detail sk-test-123'), props);

  it('maps rate limits to 429 and preserves Retry-After', () => {
    const e = mapProviderError(err({ status: 429, headers: new Headers({ 'retry-after': '12' }) }));
    expect(e).toMatchObject({ status: 429, code: 'AI_RATE_LIMITED', headers: { 'Retry-After': '12' } });
  });
  it('maps timeouts to 504', () => {
    expect(mapProviderError(err({ name: 'APIConnectionTimeoutError' }))).toMatchObject({ status: 504, code: 'AI_TIMEOUT' });
  });
  it('maps network failures to 502 AI_UNREACHABLE', () => {
    expect(mapProviderError(err({ name: 'APIConnectionError' }))).toMatchObject({ code: 'AI_UNREACHABLE' });
  });
  it('hides credential problems behind a generic message', () => {
    const e = mapProviderError(err({ status: 401 }));
    expect(e.code).toBe('AI_AUTH_FAILED');
    expect(e.message).not.toMatch(/sk-test/);
  });
  it('never leaks the upstream message for unknown errors', () => {
    const e = mapProviderError(err({ status: 500 }));
    expect(e.message).not.toMatch(/secret|sk-test/);
  });
});

describe('POST /api/ai/organize-answer', () => {
  it('returns validated structured output', async () => {
    const { app } = buildApp();
    const res = await request(app).post('/api/ai/organize-answer').send({ text: 'plants make food', mode: 'short_notes' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ provider: 'openai', promptVersion: 'organize.v1' });
    expect(res.body.organized.sections[0].heading).toBe('Intro');
  });

  it('400s on empty text with a readable message', async () => {
    const { app } = buildApp();
    const res = await request(app).post('/api/ai/organize-answer').send({ text: '  ' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.message).toMatch(/Add some text/);
  });

  it('400s on invalid JSON bodies', async () => {
    const { app } = buildApp();
    const res = await request(app).post('/api/ai/organize-answer').set('Content-Type', 'application/json').send('{oops');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_JSON');
  });

  it('413s on oversized bodies', async () => {
    const { app } = buildApp();
    const res = await request(app).post('/api/ai/organize-answer').send({ text: 'a'.repeat(300_000) });
    expect(res.status).toBe(413);
  });

  it('works with the local fallback when no API key is configured', async () => {
    const { app } = buildApp({ ai: new LocalFallbackProvider() });
    const res = await request(app).post('/api/ai/organize-answer').send({ text: 'cells are small. they have a nucleus. they divide.' });
    expect(res.status).toBe(200);
    expect(res.body.provider).toBe('local-fallback');
    expect(res.body.warnings[0]).toMatch(/No AI service/);
  });

  it('returns a safe error (no stack, no upstream text) when the provider fails', async () => {
    const ai = mockAi();
    ai.organize.mockRejectedValue(Object.assign(new Error('Incorrect API key provided: sk-live-abc'), { status: 401 }));
    const { app } = buildApp({ ai });
    // The mock bypasses OpenAiProvider's own mapping, so unknown errors must still be sanitised:
    const res = await request(app).post('/api/ai/organize-answer').send({ text: 'x' });
    expect(res.status).toBe(500);
    expect(JSON.stringify(res.body)).not.toMatch(/sk-live|stack|at /);
  });

  it('propagates mapped provider errors with Retry-After', async () => {
    const ai = mockAi();
    ai.organize.mockRejectedValue(new AppError(429, 'AI_RATE_LIMITED', 'busy', undefined, { 'Retry-After': '5' }));
    const { app } = buildApp({ ai });
    const res = await request(app).post('/api/ai/organize-answer').send({ text: 'x' });
    expect(res.status).toBe(429);
    expect(res.headers['retry-after']).toBe('5');
  });

  it('rate limits the AI endpoint', async () => {
    const { app } = buildApp({ rateLimits: { generalPer15Min: 1000, aiPerMin: 2 } });
    const send = () => request(app).post('/api/ai/organize-answer').send({ text: 'x' });
    expect((await send()).status).toBe(200);
    expect((await send()).status).toBe(200);
    const limited = await send();
    expect(limited.status).toBe(429);
    expect(limited.body.error.code).toBe('RATE_LIMITED');
  });
});

describe('GET /api/health (capabilities)', () => {
  it('reports what is configured, honestly', async () => {
    const { app } = buildApp({ ai: new LocalFallbackProvider(), transcriber: null });
    const res = await request(app).get('/api/health');
    expect(res.body).toMatchObject({ status: 'ok', store: 'memory', ai: 'local-fallback', transcription: false });
  });
  it('returns 503 when the database is down', async () => {
    const { app, repo } = buildApp();
    vi.spyOn(repo, 'ping').mockRejectedValue(Object.assign(new Error('x'), { code: 'ECONNREFUSED' }));
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe('DB_UNAVAILABLE');
  });
});
