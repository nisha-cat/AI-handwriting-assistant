import type { OrganizedAnswer } from './schemas';

/**
 * The editable body text uses a tiny, forgiving markup so users can edit it in a plain
 * textarea:
 *
 *   # Heading        (also ## and ###)
 *   - bullet         (also * and •)
 *   1. numbered      (also "1)")
 *   anything else    → a paragraph line
 *   blank line       → ignored (visual separation in the editor only)
 */
export type Block =
  | { type: 'heading'; text: string }
  | { type: 'paragraph'; text: string }
  | { type: 'bullet'; text: string }
  | { type: 'numbered'; text: string; marker: string };

export function parseMarkup(source: string): Block[] {
  const blocks: Block[] = [];
  for (const rawLine of source.replace(/\r\n?/g, '\n').split('\n')) {
    const line = rawLine.replace(/\s+$/g, '');
    if (!line.trim()) continue;
    const trimmed = line.trim();

    const heading = /^#{1,3}\s+(.*)$/.exec(trimmed);
    if (heading && heading[1]!.trim()) {
      blocks.push({ type: 'heading', text: heading[1]!.trim() });
      continue;
    }
    const bullet = /^[-*•]\s+(.*)$/.exec(trimmed);
    if (bullet && bullet[1]!.trim()) {
      blocks.push({ type: 'bullet', text: bullet[1]!.trim() });
      continue;
    }
    const numbered = /^(\d{1,3})[.)]\s+(.*)$/.exec(trimmed);
    if (numbered && numbered[2]!.trim()) {
      blocks.push({ type: 'numbered', marker: `${numbered[1]}.`, text: numbered[2]!.trim() });
      continue;
    }
    blocks.push({ type: 'paragraph', text: trimmed });
  }
  return blocks;
}

/** Renders structured AI output as editable markup text. */
export function organizedToMarkup(answer: OrganizedAnswer): string {
  const out: string[] = [];
  for (const section of answer.sections) {
    if (section.heading) out.push(`# ${section.heading}`);
    for (const p of section.paragraphs) out.push(p);
    section.points.forEach((point, i) => {
      out.push(section.ordered ? `${i + 1}. ${point}` : `- ${point}`);
    });
    out.push('');
  }
  return out.join('\n').trim();
}

/** Word count helper used for limits and AI-expansion warnings. */
export function countWords(text: string): number {
  const m = text.trim().match(/\S+/g);
  return m ? m.length : 0;
}

export function makeExcerpt(text: string, max = 160): string {
  const flat = text.replace(/[#*•-]+\s*/g, '').replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}
