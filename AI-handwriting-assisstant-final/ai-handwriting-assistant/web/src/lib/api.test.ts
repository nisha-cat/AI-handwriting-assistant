import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api, ApiError } from './api';

const json = (body: unknown, init: ResponseInit = {}) =>
  new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' }, ...init });

describe('api client', () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock);
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });
  afterEach(() => {
    fetchMock.mockReset();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('turns a structured server error into an ApiError with code and retry-after', async () => {
    fetchMock.mockResolvedValueOnce(
      json({ error: { code: 'AI_RATE_LIMITED', message: 'The AI service is busy.' } }, { status: 429, headers: { 'Content-Type': 'application/json', 'Retry-After': '12' } }),
    );
    const err = await api.organize({ text: 'hi' }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ status: 429, code: 'AI_RATE_LIMITED', message: 'The AI service is busy.', retryAfterSec: 12 });
  });

  it('does not leak raw HTML error pages from proxies', async () => {
    fetchMock.mockResolvedValueOnce(new Response('<html>502 Bad Gateway</html>', { status: 502 }));
    const err = (await api.organize({ text: 'hi' }).catch((e: unknown) => e)) as ApiError;
    expect(err.code).toBe('HTTP_ERROR');
    expect(err.message).not.toContain('<html>');
  });

  it('reports a network failure with a recovery hint and does NOT retry a POST', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
    const err = (await api.organize({ text: 'hi' }).catch((e: unknown) => e)) as ApiError;
    expect(err.code).toBe('NETWORK');
    expect(err.message).toMatch(/still on this page/i);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('retries idempotent GETs with backoff, then succeeds', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('down')).mockResolvedValueOnce(json({ status: 'ok', store: 'memory', ai: 'local-fallback', transcription: false, maxAudioMb: 10 }));
    const p = api.capabilities();
    await vi.advanceTimersByTimeAsync(1000);
    await expect(p).resolves.toMatchObject({ status: 'ok' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('sends an Idempotency-Key when creating documents', async () => {
    fetchMock.mockResolvedValueOnce(json({ document: { id: 'x' } }, { status: 201 }));
    await api.createDocument({ title: 't', content: {} as never }, 'key-123');
    const init = fetchMock.mock.calls[0]![1] as RequestInit;
    expect((init.headers as Record<string, string>)['Idempotency-Key']).toBe('key-123');
    expect(init.credentials).toBe('include');
  });

  it('rejects an export response that is not a PDF', async () => {
    fetchMock.mockResolvedValueOnce(new Response('oops', { status: 200, headers: { 'Content-Type': 'text/plain' } }));
    await expect(api.exportPdf({ title: 't', layout: {} as never })).rejects.toMatchObject({ code: 'BAD_EXPORT' });
  });

  it('accepts a real PDF blob', async () => {
    const bytes = new Uint8Array(200).fill(37);
    fetchMock.mockResolvedValueOnce(new Response(bytes, { status: 200, headers: { 'Content-Type': 'application/pdf' } }));
    const blob = await api.exportPdf({ title: 't', layout: {} as never });
    expect(blob.size).toBe(200);
  });
});
