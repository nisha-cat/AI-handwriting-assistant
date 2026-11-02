import { CHANGE_KINDS, LIMITS, type DocumentContent } from '@hw/shared';
import { countWords } from '../lib/format';

interface Props {
  content: DocumentContent;
  onContent: (patch: Partial<DocumentContent>) => void;
  onBack: () => void;
  onNext: () => void;
  onReorganize: () => void;
}

const KIND_LABEL: Record<(typeof CHANGE_KINDS)[number], string> = {
  corrected: 'Corrected',
  reorganized: 'Reorganized',
  expanded: 'Expanded',
  removed: 'Removed',
};
const KIND_STYLE: Record<(typeof CHANGE_KINDS)[number], string> = {
  corrected: 'bg-sky-100 text-sky-950',
  reorganized: 'bg-stone-200 text-stone-900',
  expanded: 'bg-amber-200 text-amber-950',
  removed: 'bg-red-100 text-red-950',
};

export function StepReview({ content, onContent, onBack, onNext, onReorganize }: Props) {
  const ai = content.aiProvider;
  const tooLong = content.bodyText.length > LIMITS.maxBodyChars;

  return (
    <div className="space-y-5">
      {ai === 'openai' && (
        <div role="note" className="rounded-lg border border-indigo-200 bg-brand-50 p-3 text-sm text-indigo-950">
          <strong>AI-organized text - please review.</strong> The text below was rewritten by an AI model. Check that it still says what you meant.
        </div>
      )}
      {ai === 'local-fallback' && (
        <div role="note" className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">
          <strong>Basic formatting only.</strong> No AI model was used; only spacing and simple structure were adjusted.
        </div>
      )}
      {content.addedContent && (
        <div role="alert" className="rounded-lg border border-amber-400 bg-amber-100 p-3 text-sm text-amber-950">
          <strong>The AI added content that wasn't in your original.</strong> Read it carefully and delete anything you can't vouch for.
        </div>
      )}

      {content.changeNotes.length > 0 && (
        <section aria-labelledby="changes-heading">
          <h3 id="changes-heading" className="mb-2 text-sm font-semibold">
            What changed
          </h3>
          <ul className="space-y-1.5">
            {content.changeNotes.map((n, i) => (
              <li key={i} className="flex items-start gap-2 text-sm">
                <span className={`mt-0.5 shrink-0 rounded px-1.5 py-0.5 text-xs font-semibold ${KIND_STYLE[n.kind]}`}>{KIND_LABEL[n.kind]}</span>
                <span>{n.description}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <div>
        <label htmlFor="body-text" className="label">
          Text that will be written (editable)
        </label>
        <textarea
          id="body-text"
          className="field min-h-72 font-mono text-[13px] leading-relaxed"
          value={content.bodyText}
          aria-describedby="body-hint"
          onChange={(e) => onContent({ bodyText: e.target.value })}
        />
        <p id="body-hint" className={`hint ${tooLong ? 'font-semibold text-red-700' : ''}`}>
          Start a line with <code>#</code> for a heading, <code>-</code> for a bullet or <code>1.</code> for a numbered point. {countWords(content.bodyText)} words
          {tooLong && ` - over the ${LIMITS.maxBodyChars.toLocaleString()}-character limit.`}
        </p>
      </div>

      <details className="rounded-lg border border-stone-200 bg-white p-3">
        <summary className="cursor-pointer text-sm font-medium">Compare with my original words</summary>
        <p className="mt-2 whitespace-pre-wrap rounded bg-stone-50 p-3 text-sm text-stone-800" data-testid="original-text">
          {content.rawText || '(nothing was entered)'}
        </p>
        <button
          type="button"
          className="btn-secondary mt-3"
          onClick={() => onContent({ bodyText: content.rawText, changeNotes: [], addedContent: false, aiProvider: null })}
        >
          Restore my original text
        </button>
      </details>

      <div className="flex flex-wrap gap-3">
        <button type="button" className="btn-secondary" onClick={onBack}>
          ← Back
        </button>
        <button type="button" className="btn-secondary" onClick={onReorganize}>
          Re-organize
        </button>
        <button type="button" className="btn-primary" onClick={onNext} disabled={!content.bodyText.trim() || tooLong}>
          Looks good: choose a style →
        </button>
      </div>
    </div>
  );
}
