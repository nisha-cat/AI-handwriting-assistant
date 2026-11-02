import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { Capabilities } from '@hw/shared';
import { api } from '../lib/api';

interface CapabilitiesState {
  status: 'loading' | 'ready' | 'error';
  caps: Capabilities | null;
  error: string | null;
  refresh: () => void;
}

const Ctx = createContext<CapabilitiesState | null>(null);

/** Asks the server what is configured (AI key, database, transcription) so the UI can be honest about it. */
export function CapabilitiesProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<Omit<CapabilitiesState, 'refresh'>>({ status: 'loading', caps: null, error: null });

  const refresh = useCallback(() => {
    setState((s) => ({ ...s, status: 'loading', error: null }));
    api
      .capabilities()
      .then((caps) => setState({ status: 'ready', caps, error: null }))
      .catch((err: Error) => setState({ status: 'error', caps: null, error: err.message }));
  }, []);

  useEffect(refresh, [refresh]);
  const value = useMemo(() => ({ ...state, refresh }), [state, refresh]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useCapabilities(): CapabilitiesState {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useCapabilities must be used inside <CapabilitiesProvider>');
  return ctx;
}
