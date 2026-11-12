import { describe, expect, it } from 'vitest';
import { BallTracker, DEFAULT_TRACKER_OPTIONS, type TrackCandidate } from './BallTracker';

const DT = 1000 / 60;

/** Ida e volta: a bola vai para a direita, quica (inverte vy) e segue. */
function ballAt(i: number) {
  const t = i / 60;
  const x = 200 + 900 * t;
  const yRaw = 300 - 400 * t + 0.5 * 1800 * t * t;
  const y = yRaw > 500 ? 1000 - yRaw : yRaw; // quique em y=500
  return { x, y };
}

function cand(x: number, y: number, score = 0.9): TrackCandidate {
  return { x, y, radius: 4, score };
}

describe('BallTracker', () => {
  it('inicia com 3 detecções coerentes e segue a bola', () => {
    const tr = new BallTracker();
    const s0 = tr.step(0, 0, [cand(ballAt(0).x, ballAt(0).y)]);
    expect(s0.state).toBe('tentative');
    const s1 = tr.step(DT, 1, [cand(ballAt(1).x, ballAt(1).y)]);
    expect(s1.state).toBe('tentative');
    const s2 = tr.step(2 * DT, 2, [cand(ballAt(2).x, ballAt(2).y)]);
    expect(s2.state).toBe('tracking');
    expect(tr.getTrail()).toHaveLength(3);
    for (let i = 3; i < 40; i++) {
      const b = ballAt(i);
      const s = tr.step(i * DT, i, [cand(b.x, b.y)]);
      expect(s.detection).not.toBeNull();
      expect(Math.hypot(s.point!.x - b.x, s.point!.y - b.y)).toBeLessThan(6);
    }
    expect(tr.getStats().trackedRate).toBe(1);
  });

  it('prefere a bola a um falso positivo distante', () => {
    const tr = new BallTracker();
    for (let i = 0; i < 30; i++) {
      const b = ballAt(i);
      const s = tr.step(i * DT, i, [cand(1100, 80, 0.95), cand(b.x, b.y, 0.6)]);
      if (i >= 2) expect(s.detection?.x).toBeCloseTo(b.x, 5);
    }
  });

  it('preenche falhas curtas com previsão e mantém o rastro', () => {
    const tr = new BallTracker();
    let predicted = 0;
    for (let i = 0; i < 30; i++) {
      const b = ballAt(i);
      const hidden = i >= 12 && i < 16; // 4 quadros sem detecção (oclusão pela rede)
      const s = tr.step(i * DT, i, hidden ? [] : [cand(b.x, b.y)]);
      if (hidden) {
        expect(s.state).toBe('coasting');
        expect(s.point?.kind).toBe('predicted');
        expect(Math.hypot(s.point!.x - b.x, s.point!.y - b.y)).toBeLessThan(25);
        predicted++;
      }
    }
    expect(predicted).toBe(4);
    expect(tr.state).toBe('tracking');
    const st = tr.getStats();
    expect(st.totalPredicted).toBe(4);
    expect(st.trackedRate).toBeCloseTo(26 / 30, 1);
  });

  it('desiste depois de muitas falhas e não inicia com ruído isolado', () => {
    const tr = new BallTracker();
    for (let i = 0; i < 10; i++) tr.step(i * DT, i, [cand(ballAt(i).x, ballAt(i).y)]);
    for (let i = 10; i < 20; i++) tr.step(i * DT, i, []);
    expect(tr.state).toBe('lost');
    // ruídos espalhados (saltos grandes) não iniciam rastro
    const noise = [cand(10, 10), cand(900, 600), cand(50, 650), cand(1200, 20)];
    noise.forEach((c, k) => tr.step((20 + k) * DT, 20 + k, [c]));
    expect(tr.state).not.toBe('tracking');
  });

  it('rastro guarda só os últimos ~700 ms', () => {
    const tr = new BallTracker();
    for (let i = 0; i < 90; i++) tr.step(i * DT, i, [cand(ballAt(i % 40).x, ballAt(i % 40).y)]);
    const trail = tr.getTrail();
    expect(trail[trail.length - 1].hubMs - trail[0].hubMs).toBeLessThanOrEqual(700);
  });

  it('rastro novo não se liga ao anterior (bola reaparece longe)', () => {
    const tr = new BallTracker();
    for (let i = 0; i < 10; i++) tr.step(i * DT, i, [cand(200 + i * 10, 300)]);
    for (let i = 10; i < 18; i++) tr.step(i * DT, i, []);
    tr.step(18 * DT, 18, [cand(900, 100)]);
    tr.step(19 * DT, 19, [cand(910, 102)]);
    tr.step(20 * DT, 20, [cand(920, 104)]);
    expect(tr.state).toBe('tracking');
    expect(tr.getTrail().every((p) => p.x >= 900)).toBe(true);
  });

  it('não inicia rastro com pares de ruído que não seguem em linha', () => {
    const tr = new BallTracker();
    // dois falsos positivos alternando (ex.: mão e reflexo): A, B, A, B...
    for (let i = 0; i < 20; i++) {
      const s = tr.step(i * DT, i, [i % 2 ? cand(400, 300) : cand(430, 310)]);
      expect(s.state).not.toBe('tracking');
    }
  });

  it('recusa associação fisicamente impossível (salto rápido demais)', () => {
    const tr = new BallTracker({ ...DEFAULT_TRACKER_OPTIONS, maxSpeedPx: 3000, minGatePx: 1000 });
    for (let i = 0; i < 6; i++) tr.step(i * DT, i, [cand(200 + i * 20, 300)]);
    // 150 px em 1/60 s = 9000 px/s > 3000
    const s = tr.step(6 * DT, 6, [cand(470, 300)]);
    expect(s.detection).toBeNull();
    expect(s.state).toBe('coasting');
  });

  it('acompanha o quique (inversão da velocidade vertical)', () => {
    const tr = new BallTracker();
    let maxErr = 0;
    for (let i = 0; i < 45; i++) {
      const b = ballAt(i);
      const s = tr.step(i * DT, i, [cand(b.x, b.y)]);
      if (i > 2 && s.point) maxErr = Math.max(maxErr, Math.hypot(s.point.x - b.x, s.point.y - b.y));
    }
    expect(tr.state).toBe('tracking');
    expect(maxErr).toBeLessThan(8);
  });

  it('não perde a bola num quique brusco em 30 fps (previsão erra feio)', () => {
    // V agudo: desce rápido e sobe rápido (quique visto de perto, 30 fps)
    const dt = 1000 / 30;
    const at = (i: number) => ({ x: 300 + 4 * i, y: i < 15 ? 100 + 17 * i : 100 + 17 * 15 - 17 * (i - 15) });
    const tr = new BallTracker();
    const states: string[] = [];
    for (let i = 0; i < 30; i++) {
      const b = at(i);
      states.push(tr.step(i * dt, i, [cand(b.x, b.y)]).state);
    }
    expect(states.slice(3)).toEqual(Array(27).fill('tracking'));
  });

  it('o anel do quique não pega uma distração longe', () => {
    const dt = 1000 / 30;
    const tr = new BallTracker();
    for (let i = 0; i < 10; i++) tr.step(i * dt, i, [cand(300 + 4 * i, 100 + 17 * i)]);
    // a bola some; aparece só algo a 150 px
    const s = tr.step(10 * dt, 10, [cand(500, 400)]);
    expect(s.detection).toBeNull();
  });
});
