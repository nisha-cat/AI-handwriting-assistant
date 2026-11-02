import { documentContentSchema } from '@hw/shared';
import type { Draft } from './draft';

/**
 * Local safety net: a copy of the draft lives in localStorage so a failed save, a closed tab
 * or a dropped connection never costs the user their dictation. All access is guarded because
 * storage can be unavailable (private mode, blocked cookies, quota).
 */
const key = (docId: string | null) => `hw:draft:${docId ?? 'new'}`;

export function saveBackup(docId: string | null, draft: Draft): void {
  try {
    localStorage.setItem(key(docId), JSON.stringify({ savedAt: Date.now(), draft }));
  } catch {
    /* storage unavailable - nothing else to do */
  }
}

export function loadBackup(docId: string | null): { savedAt: number; draft: Draft } | null {
  try {
    const raw = localStorage.getItem(key(docId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { savedAt?: number; draft?: { title?: string; content?: unknown } };
    const content = documentContentSchema.safeParse(parsed.draft?.content);
    if (!content.success || typeof parsed.savedAt !== 'number') return null;
    return { savedAt: parsed.savedAt, draft: { title: String(parsed.draft?.title ?? ''), content: content.data } };
  } catch {
    return null;
  }
}

export function clearBackup(docId: string | null): void {
  try {
    localStorage.removeItem(key(docId));
  } catch {
    /* ignore */
  }
}
