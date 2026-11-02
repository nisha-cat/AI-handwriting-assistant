import type {
  ApiErrorBody,
  Capabilities,
  DocumentInput,
  DocumentPatch,
  DocumentRecord,
  DocumentSummary,
  DocumentVersionSummary,
  ExportPdfRequest,
  HandwritingSettings,
  OrganizeRequest,
  OrganizeResponse,
} from '@hw/shared';

const BASE = ((import.meta.env.VITE_API_BASE_URL as string | undefined) ?? '').replace(/\/$/, '');

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly retryAfterSec?: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  json?: unknown;
  form?: FormData;
  headers?: Record<string, string>;
  timeoutMs?: number;
  /** Extra attempts after a network failure/timeout/503. Only set for idempotent requests. */
  retries?: number;
  signal?: AbortSignal;
  as?: 'json' | 'blob' | 'none';
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
export const backoffMs = (attempt: number) => 400 * 3 ** attempt; // 400ms, 1.2s, 3.6s

async function request<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const { method = 'GET', timeoutMs = 15_000, retries = method === 'GET' ? 2 : 0, as = 'json' } = opts;

  for (let attempt = 0; ; attempt++) {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      throw new ApiError(0, 'OFFLINE', 'You appear to be offline. Your work is kept in this browser - reconnect and try again.');
    }
    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);
    const onAbort = () => controller.abort();
    opts.signal?.addEventListener('abort', onAbort);

    let res: Response | null = null;
    let failure: ApiError | null = null;
    try {
      res = await fetch(`${BASE}${path}`, {
        method,
        credentials: 'include',
        signal: controller.signal,
        headers: { ...(opts.json !== undefined ? { 'Content-Type': 'application/json' } : {}), ...opts.headers },
        body: opts.form ?? (opts.json !== undefined ? JSON.stringify(opts.json) : undefined),
      });
    } catch {
      if (opts.signal?.aborted) throw new ApiError(0, 'ABORTED', 'The request was cancelled.');
      failure = timedOut
        ? new ApiError(0, 'TIMEOUT', 'The server took too long to respond. Please try again.')
        : new ApiError(0, 'NETWORK', "Can't reach the server. Check your connection and try again - your work is still on this page.");
    } finally {
      clearTimeout(timer);
      opts.signal?.removeEventListener('abort', onAbort);
    }

    const retryable = failure !== null || res?.status === 503;
    if (retryable && attempt < retries) {
      await sleep(backoffMs(attempt));
      continue;
    }
    if (failure) throw failure;

    const response = res!;
    if (!response.ok) {
      let body: Partial<ApiErrorBody> = {};
      try {
        body = (await response.json()) as Partial<ApiErrorBody>;
      } catch {
        /* non-JSON error page from a proxy */
      }
      const retryAfter = Number(response.headers.get('retry-after'));
      throw new ApiError(
        response.status,
        body.error?.code ?? 'HTTP_ERROR',
        body.error?.message ?? `The server responded with an error (${response.status}). Please try again.`,
        Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : undefined,
      );
    }
    if (as === 'none' || response.status === 204) return undefined as T;
    if (as === 'blob') return (await response.blob()) as T;
    try {
      return (await response.json()) as T;
    } catch {
      throw new ApiError(response.status, 'BAD_RESPONSE', 'The server sent a reply this app could not read.');
    }
  }
}

export const newIdempotencyKey = (): string => crypto.randomUUID().replace(/-/g, '');

export const api = {
  capabilities: () => request<Capabilities>('/api/health', { timeoutMs: 8_000 }),

  organize: (body: Partial<OrganizeRequest> & { text: string }, signal?: AbortSignal) =>
    request<OrganizeResponse>('/api/ai/organize-answer', { method: 'POST', json: body, timeoutMs: 60_000, signal }),

  transcribe: (audio: Blob, filename: string, language?: string, signal?: AbortSignal) => {
    const form = new FormData();
    form.append('audio', audio, filename);
    if (language) form.append('language', language);
    return request<{ text: string; provider: string }>('/api/transcription', {
      method: 'POST',
      form,
      timeoutMs: 120_000,
      signal,
    });
  },

  listDocuments: (limit = 12, offset = 0) =>
    request<{ items: DocumentSummary[]; total: number; limit: number; offset: number }>(
      `/api/documents?limit=${limit}&offset=${offset}`,
    ),
  getDocument: (id: string) => request<{ document: DocumentRecord }>(`/api/documents/${encodeURIComponent(id)}`),
  /** Safe to retry: the Idempotency-Key makes a repeated create return the first document. */
  createDocument: (input: DocumentInput, idempotencyKey: string) =>
    request<{ document: DocumentRecord }>('/api/documents', {
      method: 'POST',
      json: input,
      headers: { 'Idempotency-Key': idempotencyKey },
      retries: 2,
    }),
  updateDocument: (id: string, input: DocumentInput) =>
    request<{ document: DocumentRecord }>(`/api/documents/${encodeURIComponent(id)}`, { method: 'PUT', json: input }),
  patchDocument: (id: string, patch: DocumentPatch) =>
    request<{ document: DocumentRecord }>(`/api/documents/${encodeURIComponent(id)}`, { method: 'PATCH', json: patch }),
  duplicateDocument: (id: string) =>
    request<{ document: DocumentRecord }>(`/api/documents/${encodeURIComponent(id)}/duplicate`, { method: 'POST' }),
  deleteDocument: (id: string) => request<void>(`/api/documents/${encodeURIComponent(id)}`, { method: 'DELETE', as: 'none' }),
  listVersions: (id: string) =>
    request<{ versions: DocumentVersionSummary[] }>(`/api/documents/${encodeURIComponent(id)}/versions`),

  getPreferences: () => request<{ settings: HandwritingSettings }>('/api/preferences'),
  setPreferences: (settings: HandwritingSettings) =>
    request<{ settings: HandwritingSettings }>('/api/preferences', { method: 'PUT', json: { settings } }),

  exportPdf: async (body: ExportPdfRequest): Promise<Blob> => {
    const blob = await request<Blob>('/api/export/pdf', { method: 'POST', json: body, as: 'blob', timeoutMs: 60_000 });
    if (!blob.type.includes('pdf') || blob.size < 100) {
      throw new ApiError(500, 'BAD_EXPORT', 'The server returned something that is not a valid PDF. Try again, or export PNG pages instead.');
    }
    return blob;
  },
};
