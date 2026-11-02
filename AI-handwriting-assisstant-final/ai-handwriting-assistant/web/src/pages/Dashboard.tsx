import { useCallback, useEffect, useState } from 'react';
import type { DocumentSummary } from '@hw/shared';
import { useCapabilities } from '../components/Capabilities';
import { Dialog } from '../components/Dialog';
import { useToast } from '../components/Toasts';
import { api } from '../lib/api';
import { formatDateTime } from '../lib/format';
import { navigate } from '../lib/router';

type ListState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; items: DocumentSummary[]; total: number };

type Pending = { kind: 'rename' | 'delete'; doc: DocumentSummary } | null;

const PAGE_SIZE = 12;

export function Dashboard() {
  const toast = useToast();
  const { caps } = useCapabilities();
  const [state, setState] = useState<ListState>({ status: 'loading' });
  const [limit, setLimit] = useState(PAGE_SIZE);
  const [pending, setPending] = useState<Pending>(null);
  const [name, setName] = useState('');
  const [working, setWorking] = useState(false);

  const refresh = useCallback(() => {
    setState((s) => (s.status === 'ready' ? s : { status: 'loading' }));
    api
      .listDocuments(limit)
      .then(({ items, total }) => setState({ status: 'ready', items, total }))
      .catch((err: Error) => setState({ status: 'error', message: err.message }));
  }, [limit]);
  useEffect(refresh, [refresh]);

  async function run(label: string, fn: () => Promise<unknown>) {
    setWorking(true);
    try {
      await fn();
      toast.success(label);
      setPending(null);
      refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Something went wrong.');
    } finally {
      setWorking(false);
    }
  }

  return (
    <div className="space-y-8">
      <section className="rounded-2xl border border-stone-200 bg-white p-6 shadow-sm sm:p-8">
        <h1 className="text-3xl font-semibold tracking-tight">Speak or type. Get neat handwriting-style notes.</h1>
        <p className="mt-2 max-w-2xl text-stone-700">
          Dictate an answer, let AI tidy it up (you review every change), then export handwriting-style pages as PDF or PNG. Built for anyone who finds writing by hand difficult.
        </p>
        <div className="mt-5 flex flex-wrap gap-3">
          <button type="button" className="btn-primary px-5 py-3 text-base" onClick={() => navigate('/new')}>
            Create New Notes
          </button>
          <button type="button" className="btn-secondary px-5 py-3 text-base" onClick={() => navigate('/new?mode=exam')}>
            Start an exam answer
          </button>
        </div>
        {caps && (
          <ul className="mt-5 flex flex-wrap gap-2 text-xs" aria-label="Server configuration">
            <li className="rounded-full bg-stone-100 px-3 py-1 text-stone-800">
              {caps.ai === 'openai' ? 'AI organizer: OpenAI' : 'AI organizer: basic local formatter (no API key set)'}
            </li>
            <li className="rounded-full bg-stone-100 px-3 py-1 text-stone-800">
              {caps.transcription ? 'Audio transcription: available' : 'Audio transcription: not configured'}
            </li>
            <li className="rounded-full bg-stone-100 px-3 py-1 text-stone-800">
              {caps.store === 'mysql' ? 'Storage: MySQL' : 'Storage: temporary memory (lost on server restart)'}
            </li>
          </ul>
        )}
      </section>

      <section aria-labelledby="recent-heading">
        <h2 id="recent-heading" className="mb-3 text-xl font-semibold">
          Recent documents
        </h2>

        {state.status === 'loading' && (
          <p role="status" className="text-stone-700">
            Loading your documents…
          </p>
        )}
        {state.status === 'error' && (
          <div role="alert" className="rounded-lg border border-red-300 bg-red-50 p-4 text-sm text-red-950">
            <p className="mb-3">{state.message}</p>
            <button type="button" className="btn-secondary" onClick={refresh}>
              Try again
            </button>
          </div>
        )}
        {state.status === 'ready' && state.items.length === 0 && (
          <div className="rounded-xl border border-dashed border-stone-300 bg-white p-8 text-center">
            <p className="font-medium">No documents yet</p>
            <p className="mt-1 text-sm text-stone-700">Create your first notes - it only takes a minute.</p>
          </div>
        )}
        {state.status === 'ready' && state.items.length > 0 && (
          <>
            <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {state.items.map((doc) => (
                <li key={doc.id} className="card flex flex-col p-4">
                  <div className="mb-1 flex items-start justify-between gap-2">
                    <h3 className="font-semibold">
                      <a href={`#/doc/${doc.id}`} className="hover:underline">
                        {doc.title}
                      </a>
                    </h3>
                    <span className="shrink-0 rounded bg-stone-100 px-1.5 py-0.5 text-xs text-stone-800">{doc.mode === 'exam' ? 'Exam' : 'Notes'}</span>
                  </div>
                  <p className="mb-3 line-clamp-3 flex-1 text-sm text-stone-700">{doc.excerpt || 'No text yet.'}</p>
                  <dl className="mb-3 text-xs text-stone-600">
                    <div className="flex gap-1">
                      <dt>Created</dt>
                      <dd>{formatDateTime(doc.createdAt)}</dd>
                    </div>
                    <div className="flex gap-1">
                      <dt>Updated</dt>
                      <dd>{formatDateTime(doc.updatedAt)}</dd>
                    </div>
                  </dl>
                  <div className="flex flex-wrap gap-1">
                    <a href={`#/doc/${doc.id}`} className="btn-ghost min-h-9 px-3" aria-label={`Open ${doc.title}`}>
                      Open
                    </a>
                    <button
                      type="button"
                      className="btn-ghost min-h-9 px-3"
                      aria-label={`Rename ${doc.title}`}
                      onClick={() => {
                        setName(doc.title);
                        setPending({ kind: 'rename', doc });
                      }}
                    >
                      Rename
                    </button>
                    <button
                      type="button"
                      className="btn-ghost min-h-9 px-3"
                      aria-label={`Duplicate ${doc.title}`}
                      disabled={working}
                      onClick={() => void run('Document duplicated.', () => api.duplicateDocument(doc.id))}
                    >
                      Duplicate
                    </button>
                    <button type="button" className="btn-ghost min-h-9 px-3 text-red-800" aria-label={`Delete ${doc.title}`} onClick={() => setPending({ kind: 'delete', doc })}>
                      Delete
                    </button>
                  </div>
                </li>
              ))}
            </ul>
            {state.total > state.items.length && (
              <div className="mt-4 text-center">
                <button type="button" className="btn-secondary" onClick={() => setLimit((l) => Math.min(l + PAGE_SIZE, 50))} disabled={limit >= 50}>
                  Show more ({state.items.length} of {state.total})
                </button>
              </div>
            )}
          </>
        )}
      </section>

      {pending?.kind === 'rename' && (
        <Dialog title="Rename document" onClose={() => setPending(null)}>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const title = name.trim();
              if (!title) return;
              void run('Renamed.', () => api.patchDocument(pending.doc.id, { title }));
            }}
          >
            <label htmlFor="rename-input" className="label">
              Title
            </label>
            <input id="rename-input" data-autofocus className="field" value={name} maxLength={120} onChange={(e) => setName(e.target.value)} />
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" className="btn-secondary" onClick={() => setPending(null)}>
                Cancel
              </button>
              <button type="submit" className="btn-primary" disabled={working || !name.trim()}>
                {working ? 'Saving…' : 'Rename'}
              </button>
            </div>
          </form>
        </Dialog>
      )}
      {pending?.kind === 'delete' && (
        <Dialog title="Delete this document?" onClose={() => setPending(null)}>
          <p className="mb-4 text-sm text-stone-800">
            “{pending.doc.title}” will be permanently deleted. This can't be undone.
          </p>
          <div className="flex justify-end gap-2">
            <button type="button" className="btn-secondary" data-autofocus onClick={() => setPending(null)}>
              Cancel
            </button>
            <button type="button" className="btn-danger" disabled={working} onClick={() => void run('Document deleted.', () => api.deleteDocument(pending.doc.id))}>
              {working ? 'Deleting…' : 'Delete'}
            </button>
          </div>
        </Dialog>
      )}
    </div>
  );
}
