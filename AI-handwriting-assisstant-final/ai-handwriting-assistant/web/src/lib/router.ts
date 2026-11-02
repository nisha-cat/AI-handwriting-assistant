import { useEffect, useState } from 'react';

/** Tiny hash router: "#/" dashboard, "#/new" and "#/new?mode=exam", "#/doc/<id>". */
export type Route =
  | { name: 'dashboard' }
  | { name: 'new'; mode: 'notes' | 'exam' }
  | { name: 'doc'; id: string }
  | { name: 'notFound' };

export function parseRoute(hash: string): Route {
  const [path, query = ''] = hash.replace(/^#/, '').split('?');
  const segments = (path || '/').split('/').filter(Boolean);
  if (segments.length === 0) return { name: 'dashboard' };
  if (segments[0] === 'new' && segments.length === 1) {
    const mode = new URLSearchParams(query).get('mode') === 'exam' ? 'exam' : 'notes';
    return { name: 'new', mode };
  }
  if (segments[0] === 'doc' && segments.length === 2 && /^[0-9a-f-]{36}$/i.test(segments[1]!)) {
    return { name: 'doc', id: segments[1]! };
  }
  return { name: 'notFound' };
}

export function navigate(to: string, opts: { replace?: boolean } = {}): void {
  const hash = to.startsWith('#') ? to : `#${to}`;
  if (opts.replace) {
    history.replaceState(null, '', hash);
    window.dispatchEvent(new HashChangeEvent('hashchange'));
  } else {
    window.location.hash = hash;
  }
}

export function useRoute(): Route {
  const [route, setRoute] = useState<Route>(() => parseRoute(window.location.hash));
  useEffect(() => {
    const onChange = () => setRoute(parseRoute(window.location.hash));
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);
  return route;
}
