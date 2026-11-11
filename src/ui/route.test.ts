import { describe, expect, it } from 'vitest';
import { parseHash, routeToHash } from './route';

describe('rotas', () => {
  it('ida e volta', () => {
    for (const r of [{ name: 'camera' }, { name: 'sessions' }, { name: 'about' }, { name: 'session', id: 'ses-a/b' }] as const) {
      expect(parseHash(routeToHash(r))).toEqual(r);
    }
  });
  it('desconhecido cai na câmera', () => {
    expect(parseHash('')).toEqual({ name: 'camera' });
    expect(parseHash('#/xyz')).toEqual({ name: 'camera' });
    expect(parseHash('#/sessao/')).toEqual({ name: 'camera' });
  });
});
