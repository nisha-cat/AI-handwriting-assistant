import { useRef, useState } from 'react';
import {
  ANSWER_LENGTHS,
  DETAIL_LEVELS,
  TASK_MODES,
  TASK_MODE_LABELS,
  type DocumentContent,
  type OrganizeRequest,
} from '@hw/shared';
import { api, ApiError } from '../lib/api';
import { useCapabilities } from './Capabilities';
import { useToast } from './Toasts';

interface Props {
  content: DocumentContent;
  hasTitle: boolean;
  onContent: (patch: Partial<DocumentContent>) => void;
  onTitle: (t: string) => void;
  onDone: () => void;
  onBack: () => void;
}

const LENGTH_LABELS = { short: 'Short', medium: 'Medium', long: 'Long' } as const;
const DETAIL_LABELS = { concise: 'Concise', balanced: 'Balanced', thorough: 'Thorough' } as const;

export function StepOrganize({ content, hasTitle, onContent, onTitle, onDone, onBack }: Props) {
  const { caps } = useCapabilities();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ message: string; code: string } | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const local = caps?.ai === 'local-fallback';
  const showStructure = content.taskMode === 'exam_answer';

  async function run() {
    setError(null);
    setBusy(true);
    const controller = new AbortController();
    abortRef.current = controller;
    const body: Partial<OrganizeRequest> & { text: string } = {
      text: content.rawText,
      mode: content.taskMode,
      question: content.question,
      subject: content.subject,
      level: content.level,
      length: content.length,
      detail: content.detail,
      language: content.language,
      structure: content.structure,
    };
    try {
      const res = await api.organize(body, controller.signal);
      onContent({
        bodyText: res.text,
        changeNotes: res.organized.changeNotes,
        addedContent: res.organized.addedContent,
        aiProvider: res.provider,
      });
      if (!hasTitle && res.organized.title) onTitle(res.organized.title);
      res.warnings.forEach((w) => toast.info(w));
      onDone();
    } catch (err) {
      if (err instanceof ApiError && err.code === 'ABORTED') return;
      const e = err instanceof ApiError ? err : null;
      setError({ code: e?.code ?? 'UNKNOWN', message: err instanceof Error ? err.message : 'Something went wrong.' });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-5">
      {local ? (
        <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950" role="note">
          <strong>No AI key is configured on this server.</strong> “Organize” will use a basic local formatter (tidy spacing, capitalisation, simple structure). It does <em>not</em> rewrite or improve content. Set <code>OPENAI_API_KEY</code> to enable AI organisation.
        </div>
      ) : (
        <div className="rounded-lg border border-stone-200 bg-stone-50 p-3 text-sm text-stone-800" role="note">
          The AI reorganises and corrects your wording but must not invent facts. You'll review and edit the result before any handwriting is made, and your original text is always kept.
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="task-mode" className="label">
            Format
          </label>
          <select id="task-mode" className="field" value={content.taskMode} onChange={(e) => onContent({ taskMode: e.target.value as DocumentContent['taskMode'] })}>
            {TASK_MODES.map((m) => (
              <option key={m} value={m}>
                {TASK_MODE_LABELS[m]}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="language" className="label">
            Language
          </label>
          <input id="language" className="field" value={content.language} maxLength={40} onChange={(e) => onContent({ language: e.target.value })} />
          <p className="hint">Handwriting fonts cover Latin letters only.</p>
        </div>
        <div>
          <label htmlFor="subject" className="label">
            Subject <span className="font-normal text-stone-600">(optional)</span>
          </label>
          <input id="subject" className="field" value={content.subject} maxLength={120} onChange={(e) => onContent({ subject: e.target.value })} placeholder="e.g. Biology" />
        </div>
        <div>
          <label htmlFor="level" className="label">
            Grade / level <span className="font-normal text-stone-600">(optional)</span>
          </label>
          <input id="level" className="field" value={content.level} maxLength={120} onChange={(e) => onContent({ level: e.target.value })} placeholder="e.g. Grade 10, undergraduate" />
        </div>
        <div>
          <label htmlFor="length" className="label">
            Answer length
          </label>
          <select id="length" className="field" value={content.length} onChange={(e) => onContent({ length: e.target.value as DocumentContent['length'] })}>
            {ANSWER_LENGTHS.map((l) => (
              <option key={l} value={l}>
                {LENGTH_LABELS[l]}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="detail" className="label">
            Level of detail
          </label>
          <select id="detail" className="field" value={content.detail} onChange={(e) => onContent({ detail: e.target.value as DocumentContent['detail'] })}>
            {DETAIL_LEVELS.map((d) => (
              <option key={d} value={d}>
                {DETAIL_LABELS[d]}
              </option>
            ))}
          </select>
          <p className="hint">“Thorough” lets the AI add clearly-marked explanation; other levels stay close to your words.</p>
        </div>
      </div>

      {showStructure && (
        <fieldset>
          <legend className="label">Answer structure</legend>
          <div className="flex flex-wrap gap-x-5 gap-y-2">
            {(
              [
                ['introduction', 'Introduction'],
                ['mainPoints', 'Main points'],
                ['examples', 'Examples'],
                ['conclusion', 'Conclusion'],
              ] as const
            ).map(([key, label]) => (
              <label key={key} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  className="size-4 accent-brand-700"
                  checked={content.structure[key]}
                  onChange={(e) => onContent({ structure: { ...content.structure, [key]: e.target.checked } })}
                />
                {label}
              </label>
            ))}
          </div>
        </fieldset>
      )}

      {error && (
        <div role="alert" className="rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-950">
          <p className="font-semibold">{error.message}</p>
          <p className="mt-1">Your original text is unchanged. You can retry, or skip AI and use your own text.</p>
        </div>
      )}

      <div className="flex flex-wrap gap-3">
        <button type="button" className="btn-secondary" onClick={onBack} disabled={busy}>
          ← Back
        </button>
        <button type="button" className="btn-primary" onClick={() => void run()} disabled={busy}>
          {busy ? 'Organizing…' : local ? 'Format my text' : 'Organize with AI'}
        </button>
        {busy && (
          <button type="button" className="btn-secondary" onClick={() => abortRef.current?.abort()}>
            Cancel
          </button>
        )}
        {!busy && (
          <button
            type="button"
            className="btn-ghost"
            onClick={() => {
              onContent({ bodyText: content.rawText, changeNotes: [], addedContent: false, aiProvider: null });
              onDone();
            }}
          >
            Skip - use my text as written
          </button>
        )}
      </div>
    </div>
  );
}
