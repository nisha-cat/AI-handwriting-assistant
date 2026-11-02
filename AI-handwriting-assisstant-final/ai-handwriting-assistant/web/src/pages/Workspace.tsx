import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { type DocumentContent, type HandwritingSettings } from '@hw/shared';
import { PreviewPane } from '../components/PreviewPane';
import { StepExport } from '../components/StepExport';
import { StepInput } from '../components/StepInput';
import { StepOrganize } from '../components/StepOrganize';
import { StepReview } from '../components/StepReview';
import { StepStyle } from '../components/StepStyle';
import { useToast } from '../components/Toasts';
import { api, ApiError, newIdempotencyKey } from '../lib/api';
import { clearBackup, loadBackup, saveBackup } from '../lib/backup';
import { draftFromRecord, draftToInput, newDraft, renderText, type Draft } from '../lib/draft';
import { formatDateTime, todayText } from '../lib/format';
import { useHandwritingLayout } from '../lib/render';
import { navigate } from '../lib/router';

type StepId = 'input' | 'organize' | 'review' | 'style' | 'export';
const STEPS: { id: StepId; label: string }[] = [
  { id: 'input', label: 'Input' },
  { id: 'organize', label: 'Organize' },
  { id: 'review', label: 'Review' },
  { id: 'style', label: 'Style' },
  { id: 'export', label: 'Export' },
];

interface Props {
  /** Existing document to edit, or null for a new one. */
  docId: string | null;
  mode: 'notes' | 'exam';
}

type LoadState = { status: 'loading' } | { status: 'error'; message: string } | { status: 'ready' };

export function Workspace({ docId: initialId, mode }: Props) {
  const toast = useToast();
  const [docId, setDocId] = useState<string | null>(initialId);
  const [load, setLoad] = useState<LoadState>(initialId ? { status: 'loading' } : { status: 'ready' });
  const [draft, setDraft] = useState<Draft>(() => newDraft(mode));
  const [step, setStep] = useState<StepId>('input');
  const [mobileView, setMobileView] = useState<'edit' | 'preview'>('edit');
  const [dirty, setDirty] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [saving, setSaving] = useState(false);
  const [savingDefaults, setSavingDefaults] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [restorable, setRestorable] = useState<{ savedAt: number; draft: Draft } | null>(null);
  // One key per "create" so a retried request can never create a duplicate document.
  const idempotencyKey = useRef(newIdempotencyKey());
  const savingRef = useRef(false);

  // ---- load existing document -------------------------------------------------
  useEffect(() => {
    if (!initialId) return;
    let cancelled = false;
    setLoad({ status: 'loading' });
    api
      .getDocument(initialId)
      .then(({ document }) => {
        if (cancelled) return;
        setDraft(draftFromRecord(document));
        setSavedAt(document.updatedAt);
        setStep(document.content.bodyText.trim() ? 'style' : 'input');
        setLoad({ status: 'ready' });
        const backup = loadBackup(initialId);
        if (backup && backup.savedAt > new Date(document.updatedAt).getTime()) setRestorable(backup);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const message =
          err instanceof ApiError && err.status === 404 ? 'This document no longer exists (it may have been deleted).' : err instanceof Error ? err.message : 'Could not load the document.';
        setLoad({ status: 'error', message });
      });
    return () => {
      cancelled = true;
    };
  }, [initialId, reloadKey]);

  // ---- new document: apply saved defaults, offer to restore an unsaved draft ---
  useEffect(() => {
    if (initialId) return;
    let cancelled = false;
    api
      .getPreferences()
      .then(({ settings }) => {
        if (!cancelled) setDraft((d) => (d.content.rawText || d.content.bodyText ? d : { ...d, content: { ...d.content, settings } }));
      })
      .catch(() => {
        /* defaults are optional */
      });
    const backup = loadBackup(null);
    if (backup && backup.draft.content.rawText.trim()) setRestorable(backup);
    return () => {
      cancelled = true;
    };
  }, [initialId]);

  // ---- local backup + leave warning --------------------------------------------
  useEffect(() => {
    if (!dirty) return;
    const t = setTimeout(() => saveBackup(docId, draft), 500);
    return () => clearTimeout(t);
  }, [dirty, draft, docId]);

  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  const updateContent = useCallback((patch: Partial<DocumentContent>) => {
    setDraft((d) => ({ ...d, content: { ...d.content, ...patch } }));
    setDirty(true);
  }, []);
  const updateTitle = useCallback((title: string) => {
    setDraft((d) => ({ ...d, title }));
    setDirty(true);
  }, []);
  const updateSettings = useCallback((patch: Partial<HandwritingSettings>) => {
    setDraft((d) => ({ ...d, content: { ...d.content, settings: { ...d.content.settings, ...patch } } }));
    setDirty(true);
  }, []);

  // ---- save -------------------------------------------------------------------
  const save = useCallback(async (): Promise<boolean> => {
    if (savingRef.current) return false;
    let input;
    try {
      input = draftToInput(draft);
    } catch {
      toast.error('Some fields are invalid (for example the text is too long). Fix them and try again.');
      return false;
    }
    savingRef.current = true;
    setSaving(true);
    try {
      const { document } = docId
        ? await api.updateDocument(docId, input)
        : await api.createDocument(input, idempotencyKey.current);
      if (!docId) {
        setDocId(document.id);
        // Update the URL without remounting this page (the user keeps their place).
        history.replaceState(null, '', `#/doc/${document.id}`);
      }
      clearBackup(null);
      clearBackup(document.id);
      setDirty(false);
      setSavedAt(document.updatedAt);
      toast.success('Saved.');
      return true;
    } catch (err) {
      saveBackup(docId, draft);
      toast.error(`${err instanceof Error ? err.message : 'Could not save.'} Your work is kept in this browser - try saving again.`);
      return false;
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }, [draft, docId, toast]);

  async function saveDefaults() {
    setSavingDefaults(true);
    try {
      await api.setPreferences(draft.content.settings);
      toast.success('Saved as your default handwriting settings.');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not save your defaults.');
    } finally {
      setSavingDefaults(false);
    }
  }

  // ---- preview ------------------------------------------------------------------
  const text = renderText(draft.content);
  const { result, fontReady, fontFailed } = useHandwritingLayout({
    text,
    title: draft.title,
    settings: draft.content.settings,
    dateText: useMemo(() => todayText(), []),
  });

  const stepIndex = STEPS.findIndex((s) => s.id === step);

  if (load.status === 'loading') {
    return (
      <p role="status" className="py-16 text-center text-stone-700">
        Loading document…
      </p>
    );
  }
  if (load.status === 'error') {
    return (
      <div role="alert" className="card mx-auto max-w-lg p-6 text-center">
        <p className="mb-4 text-red-900">{load.message}</p>
        <div className="flex justify-center gap-3">
          <button type="button" className="btn-secondary" onClick={() => navigate('/')}>
            Back to dashboard
          </button>
          {initialId && (
            <button type="button" className="btn-primary" onClick={() => setReloadKey((k) => k + 1)}>
              Retry
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{draft.content.mode === 'exam' ? 'Exam answer' : 'Create notes'}</h1>
          <p className="text-sm text-stone-700" aria-live="polite">
            {dirty ? 'Unsaved changes' : savedAt ? `Saved ${formatDateTime(savedAt)}` : 'Not saved yet'}
          </p>
        </div>
        <button type="button" className="btn-secondary" onClick={() => void save()} disabled={saving}>
          {saving ? 'Saving…' : 'Save'}
        </button>
      </div>

      {restorable && (
        <div role="alert" className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">
          <span>An unsaved copy from {formatDateTime(new Date(restorable.savedAt).toISOString())} was found in this browser.</span>
          <span className="flex gap-2">
            <button
              type="button"
              className="btn-secondary"
              onClick={() => {
                setDraft(restorable.draft);
                setDirty(true);
                setRestorable(null);
                setStep(restorable.draft.content.bodyText.trim() ? 'review' : 'input');
              }}
            >
              Restore it
            </button>
            <button
              type="button"
              className="btn-ghost"
              onClick={() => {
                clearBackup(docId);
                setRestorable(null);
              }}
            >
              Discard
            </button>
          </span>
        </div>
      )}

      <nav aria-label="Steps" className="mb-5">
        <ol className="flex flex-wrap gap-2">
          {STEPS.map((s, i) => {
            const current = s.id === step;
            return (
              <li key={s.id}>
                <button
                  type="button"
                  aria-current={current ? 'step' : undefined}
                  onClick={() => setStep(s.id)}
                  className={`btn min-h-9 px-3 ${current ? 'bg-brand-700 text-white' : 'border border-stone-300 bg-white text-stone-800 hover:bg-stone-100'}`}
                >
                  <span aria-hidden="true" className="tabular-nums">
                    {i + 1}.
                  </span>
                  {s.label}
                </button>
              </li>
            );
          })}
        </ol>
      </nav>

      {/* Mobile: switch between editing and previewing. Desktop shows both side by side. */}
      <div className="mb-4 flex rounded-lg border border-stone-300 bg-white p-1 lg:hidden" role="group" aria-label="Mobile view">
        {(['edit', 'preview'] as const).map((v) => (
          <button
            key={v}
            type="button"
            aria-pressed={mobileView === v}
            onClick={() => setMobileView(v)}
            className={`btn min-h-9 flex-1 ${mobileView === v ? 'bg-brand-700 text-white' : 'text-stone-800'}`}
          >
            {v === 'edit' ? 'Edit' : 'Preview'}
          </button>
        ))}
      </div>

      <div className="grid gap-8 lg:grid-cols-2">
        <section aria-label={`Step ${stepIndex + 1}: ${STEPS[stepIndex]!.label}`} className={`card p-5 ${mobileView === 'preview' ? 'hidden lg:block' : ''}`}>
          {step === 'input' && (
            <StepInput
              title={draft.title}
              content={draft.content}
              onTitle={updateTitle}
              onContent={updateContent}
              onNext={() => setStep('organize')}
              onSkipAi={() => {
                updateContent({ bodyText: draft.content.rawText, changeNotes: [], addedContent: false, aiProvider: null });
                setStep('review');
              }}
            />
          )}
          {step === 'organize' && (
            <StepOrganize
              content={draft.content}
              hasTitle={draft.title.trim().length > 0}
              onContent={updateContent}
              onTitle={updateTitle}
              onDone={() => setStep('review')}
              onBack={() => setStep('input')}
            />
          )}
          {step === 'review' && (
            <StepReview
              content={draft.content}
              onContent={updateContent}
              onBack={() => setStep('organize')}
              onNext={() => setStep('style')}
              onReorganize={() => setStep('organize')}
            />
          )}
          {step === 'style' && (
            <StepStyle
              settings={draft.content.settings}
              onChange={updateSettings}
              onBack={() => setStep('review')}
              onNext={() => setStep('export')}
              onSaveDefaults={() => void saveDefaults()}
              savingDefaults={savingDefaults}
            />
          )}
          {step === 'export' && (
            <StepExport result={result} title={draft.title} onBack={() => setStep('style')} onSave={save} saving={saving} saved={!dirty && docId !== null} />
          )}
        </section>

        <section aria-label="Preview" className={`${mobileView === 'edit' ? 'hidden lg:block' : ''}`}>
          {/* Scrollable on desktop, so it must be reachable and labelled for keyboard users. */}
          <div
            role="region"
            aria-label="Handwriting preview pages"
            tabIndex={0}
            className="lg:sticky lg:top-4 lg:max-h-[calc(100vh-2rem)] lg:overflow-y-auto lg:pr-2"
          >
            <PreviewPane result={result} fontReady={fontReady} fontFailed={fontFailed} styleId={draft.content.settings.style} empty={text.trim().length === 0} />
          </div>
        </section>
      </div>
    </div>
  );
}
