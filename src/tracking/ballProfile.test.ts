import { describe, expect, it } from 'vitest';
import { matchesProfile, sampleBall } from './ballProfile';
import { renderScene } from './synthetic';

describe('perfil da bola escolhida', () => {
  const frame = renderScene({
    width: 200,
    height: 120,
    background: [20, 60, 140],
    ball: { x: 100, y: 60, r: 6, color: [250, 150, 40] },
    noise: 4,
  });

  it('amostra a bola laranja tocando perto dela', () => {
    const p = sampleBall(frame, 200, 120, 104, 63)!;
    expect(p).not.toBeNull();
    expect(p.r).toBeGreaterThan(230);
    expect(p.b).toBeLessThan(70);
    expect(p.radiusPx).toBeGreaterThan(4.5);
    expect(p.radiusPx).toBeLessThan(7.5);
  });

  it('aceita a cor da bola (mesmo mais escura pelo borrão) e rejeita branco e azul', () => {
    const p = sampleBall(frame, 200, 120, 100, 60)!;
    expect(matchesProfile(250, 150, 40, p)).toBe(true);
    expect(matchesProfile(190, 115, 35, p)).toBe(true); // borrão: mais escura, mesma cor
    expect(matchesProfile(240, 240, 240, p)).toBe(false); // camisa branca
    expect(matchesProfile(20, 60, 140, p)).toBe(false); // mesa
    expect(matchesProfile(230, 190, 150, p)).toBe(false); // pele clara
  });

  it('não aceita tocar em área sem nada destacado', () => {
    expect(sampleBall(frame, 200, 120, 20, 20)).toBeNull();
  });

  it('não aceita objeto grande (camisa) como bola', () => {
    const big = renderScene({ width: 200, height: 120, background: [30, 30, 30], player: { x: 40, y: 10, w: 120, h: 100, color: [240, 240, 240] } });
    expect(sampleBall(big, 200, 120, 100, 60)).toBeNull();
  });
});
