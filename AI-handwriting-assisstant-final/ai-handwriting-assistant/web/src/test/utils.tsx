import type { ReactElement } from 'react';
import { render } from '@testing-library/react';
import { vi } from 'vitest';
import type { Capabilities } from '@hw/shared';
import { CapabilitiesProvider } from '../components/Capabilities';
import { ToastProvider } from '../components/Toasts';

export const jsonResponse = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } });

export const errorResponse = (status: number, code: string, message: string) => jsonResponse({ error: { code, message } }, status);

export const caps = (overrides: Partial<Capabilities> = {}): Capabilities => ({
  status: 'ok',
  store: 'memory',
  ai: 'local-fallback',
  transcription: false,
  maxAudioMb: 10,
  ...overrides,
});

type Handler = (call: { url: string; init: RequestInit }) => Response | Promise<Response>;

/** Routes keyed like "GET /api/health" (query strings ignored). Unrouted calls fail loudly. */
export function mockApi(routes: Record<string, Handler>) {
  const calls: Array<{ key: string; init: RequestInit }> = [];
  const fn = vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = String(input);
    const key = `${init.method ?? 'GET'} ${url.split('?')[0]}`;
    calls.push({ key, init });
    const handler = routes[key];
    if (!handler) throw new Error(`Unmocked request: ${key}`);
    return handler({ url, init });
  });
  vi.stubGlobal('fetch', fn);
  return { fn, calls };
}

export function renderWithProviders(ui: ReactElement) {
  return render(
    <ToastProvider>
      <CapabilitiesProvider>{ui}</CapabilitiesProvider>
    </ToastProvider>,
  );
}
