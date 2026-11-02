import OpenAI from 'openai';
import type { OrganizeRequest } from '@hw/shared';
import { AppError } from '../errors';
import type { AiProvider, RepairContext } from './provider';
import { buildMessages, buildRepairMessages } from './prompts/organize.v1';

/**
 * Translates SDK/network failures into safe, user-facing errors. Matches on `status` and
 * `name` rather than classes so it is easy to unit test and tolerant of SDK upgrades.
 */
export function mapProviderError(err: unknown): AppError {
  if (err instanceof AppError) return err;
  const e = err as { status?: number; name?: string; code?: string; headers?: Record<string, string> | Headers };
  const name = e?.name ?? '';

  if (name === 'APIConnectionTimeoutError' || name === 'TimeoutError' || e?.code === 'ETIMEDOUT') {
    return new AppError(504, 'AI_TIMEOUT', 'The AI service took too long to respond. Your text is unchanged - please try again.');
  }
  if (name === 'AbortError') {
    return new AppError(499, 'AI_ABORTED', 'The request was cancelled.');
  }
  if (name === 'APIConnectionError' || e?.code === 'ECONNRESET' || e?.code === 'ENOTFOUND' || e?.code === 'ECONNREFUSED') {
    return new AppError(502, 'AI_UNREACHABLE', 'Could not reach the AI service. Check the server\'s network connection and try again.');
  }
  switch (e?.status) {
    case 429: {
      const retryAfter = e.headers && 'get' in e.headers ? (e.headers as Headers).get('retry-after') : null;
      return new AppError(
        429,
        'AI_RATE_LIMITED',
        'The AI service is busy or its quota is used up. Wait a moment and try again.',
        undefined,
        retryAfter ? { 'Retry-After': retryAfter } : undefined,
      );
    }
    case 401:
    case 403:
      // Do not reveal key details to the browser; operators see this in server logs.
      return new AppError(502, 'AI_AUTH_FAILED', 'The server\'s AI credentials were rejected. Ask the administrator to check OPENAI_API_KEY.');
    case 400:
    case 404:
    case 422:
      return new AppError(502, 'AI_REQUEST_REJECTED', 'The AI service rejected the request. Ask the administrator to check OPENAI_MODEL.');
    default:
      return new AppError(502, 'AI_PROVIDER_ERROR', 'The AI service returned an error. Please try again shortly.');
  }
}

export class OpenAiProvider implements AiProvider {
  readonly name = 'openai' as const;
  private readonly client: OpenAI;

  constructor(
    apiKey: string,
    readonly model: string,
    timeoutMs: number,
  ) {
    // The SDK retries 429/5xx/timeouts with exponential backoff; cap at 2 retries so a failing
    // upstream cannot hold a request open for long.
    this.client = new OpenAI({ apiKey, timeout: timeoutMs, maxRetries: 2 });
  }

  async organize(req: OrganizeRequest, repair?: RepairContext): Promise<string> {
    const base = buildMessages(req);
    const messages = repair ? buildRepairMessages(base, repair.previous, repair.issues) : base;
    try {
      const res = await this.client.chat.completions.create({
        model: this.model,
        messages,
        temperature: 0.2,
        max_completion_tokens: 4000,
        response_format: { type: 'json_object' },
      });
      const content = res.choices[0]?.message?.content;
      if (!content) throw new AppError(502, 'AI_EMPTY_RESPONSE', 'The AI service returned an empty reply. Please try again.');
      return content;
    } catch (err) {
      throw mapProviderError(err);
    }
  }
}
