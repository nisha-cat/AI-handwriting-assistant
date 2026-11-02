import {
  countWords,
  organizedAnswerSchema,
  organizedToMarkup,
  type OrganizeRequest,
  type OrganizeResponse,
  type OrganizedAnswer,
} from '@hw/shared';
import { AppError } from '../errors';
import type { AiProvider } from './provider';
import { PROMPT_VERSION } from './prompts/organize.v1';

/** Extracts a JSON object from a model reply, tolerating ```json fences. */
export function extractJson(raw: string): unknown {
  const trimmed = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  try {
    return JSON.parse(trimmed);
  } catch {
    // Last resort: take the outermost {...} span.
    const start = trimmed.indexOf('{');
    const end = trimmed.lastIndexOf('}');
    if (start >= 0 && end > start) return JSON.parse(trimmed.slice(start, end + 1));
    throw new Error('not JSON');
  }
}

function validate(raw: string): { ok: true; value: OrganizedAnswer } | { ok: false; issues: string } {
  let json: unknown;
  try {
    json = extractJson(raw);
  } catch {
    return { ok: false, issues: 'the reply was not valid JSON' };
  }
  const parsed = organizedAnswerSchema.safeParse(json);
  if (parsed.success) return { ok: true, value: parsed.data };
  const issues = parsed.error.issues
    .slice(0, 5)
    .map((i) => `${i.path.join('.') || 'root'}: ${i.message}`)
    .join('; ');
  return { ok: false, issues };
}

const NUMBER_RE = /\d+(?:[.,]\d+)?/g;

function numbersIn(text: string): Set<string> {
  return new Set((text.match(NUMBER_RE) ?? []).map((n) => n.replace(',', '.')));
}

/** Plain content of the organised answer (no list markers), used for sanity checks. */
function contentText(a: OrganizedAnswer): string {
  return a.sections.flatMap((s) => [s.heading, ...s.paragraphs, ...s.points]).join('\n');
}

/**
 * Cheap, provider-independent guards against invented content. They cannot prove a
 * fabrication, but they flag the common signs so the user reviews the result.
 */
export function assessOutput(req: OrganizeRequest, answer: OrganizedAnswer): string[] {
  const warnings: string[] = [];
  const output = contentText(answer);

  const allowed = numbersIn(`${req.text}\n${req.question}\n${req.subject}\n${req.level}`);
  const unknown = [...numbersIn(output)].filter((n) => !allowed.has(n));
  if (unknown.length) {
    warnings.push(
      `The organised text contains numbers that were not in your original: ${unknown.slice(0, 6).join(', ')}. Please check them.`,
    );
  }

  const wordsIn = countWords(req.text);
  const wordsOut = countWords(output);
  const factor = req.mode === 'detailed_explanation' || req.length === 'long' ? 3 : 1.6;
  if (wordsOut > wordsIn * factor + 25) {
    warnings.push(
      `The result (${wordsOut} words) is much longer than your original (${wordsIn} words). Review it for content you did not say.`,
    );
  }
  if (answer.addedContent || answer.changeNotes.some((n) => n.kind === 'expanded')) {
    warnings.push('The AI reports it added content that was not in your original. Review the highlighted changes before using it.');
  }
  return warnings;
}

export interface OrganizeDeps {
  provider: AiProvider;
}

/**
 * Runs the provider, validates its output against the schema and - if the output is
 * malformed - asks once for a corrected reply. Never returns unvalidated data.
 */
export async function organizeAnswer(req: OrganizeRequest, { provider }: OrganizeDeps): Promise<OrganizeResponse> {
  let raw = await provider.organize(req);
  let result = validate(raw);

  if (!result.ok) {
    // One bounded repair attempt; provider-level transient errors are retried inside the provider.
    raw = await provider.organize(req, { previous: raw, issues: result.issues });
    result = validate(raw);
  }
  if (!result.ok) {
    throw new AppError(
      502,
      'AI_INVALID_RESPONSE',
      'The AI service returned a reply in an unexpected format. Your text is unchanged - please try again.',
    );
  }

  const answer = result.value;
  const warnings = assessOutput(req, answer);
  if (provider.name === 'local-fallback') {
    warnings.unshift(
      'No AI service is configured, so only basic formatting was applied (no rewriting). Set OPENAI_API_KEY on the server for full AI organisation.',
    );
    if (!/^english$/i.test(req.language)) {
      warnings.push(`Output language "${req.language}" was ignored: translation needs the AI service.`);
    }
  }

  return {
    organized: answer,
    text: organizedToMarkup(answer),
    provider: provider.name,
    model: provider.model,
    promptVersion: PROMPT_VERSION,
    warnings,
  };
}
