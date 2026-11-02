import type { ChangeNote, OrganizeRequest, OrganizedAnswer, OrganizedSection } from '@hw/shared';
import type { AiProvider } from './provider';

const FILLERS = /\b(?:um+|uh+|er+m*|ah+|hmm+)\b[,.]?\s*/gi;

/** Splits text into trimmed sentences, each ending in terminal punctuation. */
export function toSentences(text: string): string[] {
  const flat = text.replace(/\s+/g, ' ').trim();
  if (!flat) return [];
  return flat
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
    .map((s) => (/[.!?]$/.test(s) ? s : `${s}.`));
}

function titleFrom(req: OrganizeRequest, firstSentence: string): string {
  const source = req.question || firstSentence;
  const words = source.replace(/[?.!]+$/, '').split(/\s+/).slice(0, 10).join(' ');
  return words.slice(0, 80);
}

/**
 * Deterministic, rule-based formatter used when no OpenAI key is configured.
 * It only cleans and rearranges the user's OWN sentences - it never writes new content.
 */
export function localOrganize(req: OrganizeRequest): OrganizedAnswer {
  const notes: ChangeNote[] = [];
  const withoutFillers = req.text.replace(FILLERS, '');
  if (withoutFillers.length !== req.text.length) {
    notes.push({ kind: 'removed', description: 'Removed filler words such as "um" and "uh".' });
  }
  const sentences = toSentences(withoutFillers);
  notes.push({ kind: 'corrected', description: 'Normalised spacing, capital letters and sentence-ending punctuation.' });

  const section = (partial: Partial<OrganizedSection>): OrganizedSection => ({
    heading: '',
    paragraphs: [],
    points: [],
    ordered: false,
    ...partial,
  });
  let sections: OrganizedSection[];

  switch (req.mode) {
    case 'short_notes':
    case 'bullet_revision':
      sections = [section({ heading: req.subject, points: sentences })];
      notes.push({ kind: 'reorganized', description: 'Turned each sentence into a separate point.' });
      break;

    case 'summary': {
      const keep = { short: 2, medium: 4, long: 6 }[req.length];
      const kept = sentences.slice(0, keep);
      sections = [section({ paragraphs: [kept.join(' ')] })];
      if (kept.length < sentences.length) {
        notes.push({
          kind: 'removed',
          description: `Kept the first ${kept.length} of ${sentences.length} sentences (basic extractive summary).`,
        });
      }
      break;
    }

    case 'qa_format':
      sections = [
        section({ heading: req.question ? `Q: ${req.question}` : 'Question' }),
        section({ heading: 'Answer', paragraphs: [sentences.join(' ')] }),
      ];
      notes.push({ kind: 'reorganized', description: 'Placed the answer under a question heading.' });
      break;

    case 'detailed_explanation': {
      const paragraphs: string[] = [];
      for (let i = 0; i < sentences.length; i += 3) paragraphs.push(sentences.slice(i, i + 3).join(' '));
      sections = [section({ paragraphs })];
      notes.push({ kind: 'reorganized', description: 'Grouped sentences into short paragraphs.' });
      break;
    }

    case 'exam_answer':
    default: {
      const s = req.structure;
      if (sentences.length < 3 || (!s.introduction && !s.mainPoints && !s.conclusion)) {
        sections = [section({ paragraphs: [sentences.join(' ')] })];
        break;
      }
      sections = [];
      const middle = sentences.slice(s.introduction ? 1 : 0, s.conclusion ? -1 : undefined);
      if (s.introduction) sections.push(section({ heading: 'Introduction', paragraphs: [sentences[0]!] }));
      if (s.mainPoints) sections.push(section({ heading: 'Main points', points: middle, ordered: true }));
      else if (middle.length) sections.push(section({ paragraphs: [middle.join(' ')] }));
      if (s.conclusion) sections.push(section({ heading: 'Conclusion', paragraphs: [sentences[sentences.length - 1]!] }));
      notes.push({
        kind: 'reorganized',
        description: 'Split your sentences into introduction, main points and conclusion by position.',
      });
      if (s.examples) {
        notes.push({
          kind: 'reorganized',
          description: 'Examples were requested but not created: the basic formatter cannot write examples.',
        });
      }
    }
  }

  // Drop empty sections that came from empty input pieces.
  sections = sections.filter((x) => x.heading || x.paragraphs.length || x.points.length);
  if (!sections.length) sections = [section({ paragraphs: [req.text.trim()] })];

  return {
    title: titleFrom(req, sentences[0] ?? ''),
    sections,
    changeNotes: notes,
    addedContent: false,
  };
}

export class LocalFallbackProvider implements AiProvider {
  readonly name = 'local-fallback' as const;
  readonly model = null;
  async organize(req: OrganizeRequest): Promise<string> {
    return JSON.stringify(localOrganize(req));
  }
}
