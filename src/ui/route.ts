import { useEffect, useState } from 'react';

export type Route =
  | { name: 'camera' }
  | { name: 'sessions' }
  | { name: 'session'; id: string }
  | { name: 'report'; id: string }
  | { name: 'multicam' }
  | { name: 'about' };

export function parseHash(hash: string): Route {
  const path = hash.replace(/^#\/?/, '');
  const [head, ...rest] = path.split('/');
  if (head === 'sessoes') return { name: 'sessions' };
  if (head === 'sessao' && rest[0]) return { name: 'session', id: decodeURIComponent(rest[0]) };
  if (head === 'relatorio' && rest[0]) return { name: 'report', id: decodeURIComponent(rest[0]) };
  if (head === 'sobre') return { name: 'about' };
  if (head === 'multicam') return { name: 'multicam' };
  return { name: 'camera' };
}

export function routeToHash(r: Route): string {
  switch (r.name) {
    case 'camera':
      return '#/';
    case 'sessions':
      return '#/sessoes';
    case 'session':
      return `#/sessao/${encodeURIComponent(r.id)}`;
    case 'report':
      return `#/relatorio/${encodeURIComponent(r.id)}`;
    case 'multicam':
      return '#/multicam';
    case 'about':
      return '#/sobre';
  }
}

export function navigate(r: Route): void {
  window.location.hash = routeToHash(r);
}

export function useRoute(): Route {
  const [route, setRoute] = useState(() => parseHash(window.location.hash));
  useEffect(() => {
    const on = () => setRoute(parseHash(window.location.hash));
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return route;
}
