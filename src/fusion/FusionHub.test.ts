import { describe, expect, it } from 'vitest';
import { makeTimestamp } from '../core/clock';
import type { BallDetection2D } from '../core/types';
import { FusionHub } from './FusionHub';

function det(cameraId: string, hubMs: number, confidence = 0.9, x = 100): BallDetection2D {
  return {
    sessionId: 's1', cameraId, frameIndex: 0, timestamp: makeTimestamp(hubMs), x, y: 50, radiusPx: 4,
    confidence, source: 'classic',
  };
}

describe('FusionHub', () => {
  it('1 câmera: repassa cada detecção em ordem, modo 2D', () => {
    const hub = new FusionHub({ latencyMs: 50 });
    hub.addCamera('a');
    hub.ingest(det('a', 1033));
    hub.ingest(det('a', 1000));
    hub.ingest(det('a', 1016));
    const out = hub.flush(1100);
    expect(out.map((o) => o.hubMs)).toEqual([1000, 1016, 1033]);
    expect(out.every((o) => o.mode === '2d' && o.perCamera.length === 1)).toBe(true);
  });

  it('espera a janela de latência antes de liberar', () => {
    const hub = new FusionHub({ latencyMs: 50 });
    hub.addCamera('a');
    hub.ingest(det('a', 1000));
    expect(hub.flush(1040)).toHaveLength(0);
    expect(hub.flush(1050)).toHaveLength(1);
  });

  it('2 câmeras calibradas: agrupa detecções simultâneas e entra em 3D', () => {
    const hub = new FusionHub({ latencyMs: 50, groupToleranceMs: 8 });
    hub.addCamera('a', true);
    hub.addCamera('b', true);
    hub.ingest(det('a', 1000));
    hub.ingest(det('b', 1004));
    hub.ingest(det('a', 1016));
    hub.ingest(det('b', 1019));
    const out = hub.flush(1100);
    expect(out).toHaveLength(2);
    expect(out[0].mode).toBe('3d');
    expect(out[0].perCamera.map((d) => d.cameraId).sort()).toEqual(['a', 'b']);
    expect(out[0].hubMs).toBe(1002);
  });

  it('degrada para 2D quando uma câmera cai e aponta quem faltou', () => {
    const hub = new FusionHub({ latencyMs: 50, staleAfterMs: 500 });
    hub.addCamera('a', true);
    hub.addCamera('b', true);
    hub.ingest(det('a', 1000));
    hub.ingest(det('b', 1000));
    hub.ingest(det('a', 1200));
    const mid = hub.flush(1300);
    expect(mid[1].missing).toEqual(['b']);
    hub.ingest(det('a', 2000));
    const late = hub.flush(2100);
    expect(late[0].mode).toBe('2d');
  });

  it('fica com a detecção de maior confiança por câmera e descarta atrasadas', () => {
    const hub = new FusionHub({ latencyMs: 10 });
    hub.addCamera('a');
    hub.ingest(det('a', 1000, 0.3, 1));
    hub.ingest(det('a', 1002, 0.8, 2));
    const [o] = hub.flush(1100);
    expect(o.perCamera[0].x).toBe(2);
    hub.ingest(det('a', 990));
    expect(hub.flush(1200)).toHaveLength(0);
  });

  it('rejeita câmera desconhecida', () => {
    const hub = new FusionHub();
    expect(() => hub.ingest(det('x', 0))).toThrow(/desconhecida/);
  });
});
