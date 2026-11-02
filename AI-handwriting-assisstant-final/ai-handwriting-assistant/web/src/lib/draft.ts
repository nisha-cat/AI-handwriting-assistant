import {
  defaultHandwritingSettings,
  documentContentSchema,
  documentInputSchema,
  type DocumentContent,
  type DocumentInput,
  type DocumentRecord,
  type HandwritingSettings,
} from '@hw/shared';

export interface Draft {
  title: string;
  content: DocumentContent;
}

export const DEFAULT_TITLE = 'Untitled notes';

export function newDraft(mode: 'notes' | 'exam', settings?: HandwritingSettings): Draft {
  return {
    title: '',
    content: documentContentSchema.parse({
      mode,
      taskMode: mode === 'exam' ? 'exam_answer' : 'short_notes',
      settings: settings ?? defaultHandwritingSettings(),
    }),
  };
}

export function draftFromRecord(doc: DocumentRecord): Draft {
  return { title: doc.title, content: doc.content };
}

export function draftToInput(draft: Draft): DocumentInput {
  return documentInputSchema.parse({ title: draft.title.trim() || DEFAULT_TITLE, content: draft.content });
}

/** The text that is rendered as handwriting: the reviewed text, or the original until review. */
export function renderText(content: DocumentContent): string {
  return content.bodyText.trim() ? content.bodyText : content.rawText;
}

export const slugify = (s: string) =>
  s
    .normalize('NFKD')
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .toLowerCase()
    .slice(0, 60) || 'notes';
