import { CapabilitiesProvider, useCapabilities } from './components/Capabilities';
import { ToastProvider } from './components/Toasts';
import { useRoute } from './lib/router';
import { Dashboard } from './pages/Dashboard';
import { Workspace } from './pages/Workspace';

function CapabilityBanner() {
  const { status, error, refresh } = useCapabilities();
  if (status !== 'error') return null;
  return (
    <div role="alert" className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-950">
      <span>Can't reach the server: {error} Typing still works, but AI, audio transcription, saving and PDF export need the server.</span>
      <button type="button" className="btn-secondary" onClick={refresh}>
        Retry
      </button>
    </div>
  );
}

function Shell() {
  const route = useRoute();
  return (
    <>
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-2 focus:top-2 focus:z-50 focus:rounded focus:bg-white focus:px-3 focus:py-2">
        Skip to content
      </a>
      <header className="border-b border-stone-200 bg-white">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 px-4 py-3">
          <a href="#/" className="flex items-center gap-2 text-lg font-semibold">
            <span aria-hidden="true" className="font-hand text-3xl leading-none text-brand-700">
              Aa
            </span>
            Handwriting Assistant
          </a>
          <nav aria-label="Main" className="flex gap-1">
            <a href="#/" className="btn-ghost min-h-9 px-3" aria-current={route.name === 'dashboard' ? 'page' : undefined}>
              Dashboard
            </a>
            <a href="#/new" className="btn-ghost min-h-9 px-3" aria-current={route.name === 'new' && route.mode === 'notes' ? 'page' : undefined}>
              New notes
            </a>
            <a href="#/new?mode=exam" className="btn-ghost min-h-9 px-3" aria-current={route.name === 'new' && route.mode === 'exam' ? 'page' : undefined}>
              Exam mode
            </a>
          </nav>
        </div>
      </header>
      <main id="main" tabIndex={-1} className="mx-auto max-w-7xl px-4 py-8">
        <CapabilityBanner />
        {route.name === 'dashboard' && <Dashboard />}
        {route.name === 'new' && <Workspace key={`new-${route.mode}`} docId={null} mode={route.mode} />}
        {route.name === 'doc' && <Workspace key={route.id} docId={route.id} mode="notes" />}
        {route.name === 'notFound' && (
          <div className="card mx-auto max-w-lg p-6 text-center">
            <p className="mb-4">That page doesn't exist.</p>
            <a href="#/" className="btn-primary">
              Back to dashboard
            </a>
          </div>
        )}
      </main>
      <footer className="mx-auto max-w-7xl px-4 pb-8 text-xs text-stone-600">
        Output is a handwriting-style rendering made with open-licensed fonts - not real handwriting. Fonts: Caveat, Kalam and Patrick Hand (SIL Open Font License 1.1).
      </footer>
    </>
  );
}

export function App() {
  return (
    <ToastProvider>
      <CapabilitiesProvider>
        <Shell />
      </CapabilitiesProvider>
    </ToastProvider>
  );
}
