import { describe, expect, it } from 'vitest';
import { cmToMeters, formatBytes, formatDuration, frameIntervalMs, kmhToMps, metersToCm, mpsToKmh, speedMps } from './units';
import { BALL_RADIUS_M, NET_HEIGHT_M, TABLE_LENGTH_M, TABLE_WIDTH_M } from './constants';

describe('conversão de unidades', () => {
  it('m/s <-> km/h', () => {
    expect(mpsToKmh(10)).toBeCloseTo(36);
    expect(kmhToMps(36)).toBeCloseTo(10);
    expect(kmhToMps(mpsToKmh(17.3))).toBeCloseTo(17.3);
  });

  it('m <-> cm', () => {
    expect(metersToCm(NET_HEIGHT_M)).toBeCloseTo(15.25);
    expect(cmToMeters(274)).toBeCloseTo(TABLE_LENGTH_M);
  });

  it('velocidade média: mesa inteira em 0,2 s ≈ 49,3 km/h', () => {
    const v = speedMps(TABLE_LENGTH_M, 200);
    expect(v).toBeCloseTo(13.7);
    expect(mpsToKmh(v)).toBeCloseTo(49.32);
  });

  it('rejeita intervalos inválidos', () => {
    expect(() => speedMps(1, 0)).toThrow(RangeError);
    expect(() => frameIntervalMs(0)).toThrow(RangeError);
  });

  it('intervalo entre quadros', () => {
    expect(frameIntervalMs(60)).toBeCloseTo(16.667, 2);
    expect(frameIntervalMs(30)).toBeCloseTo(33.333, 2);
  });

  it('constantes da mesa', () => {
    expect(TABLE_WIDTH_M).toBe(1.525);
    expect(BALL_RADIUS_M).toBe(0.02);
  });
});

describe('formatação', () => {
  it('duração', () => {
    expect(formatDuration(0)).toBe('0:00');
    expect(formatDuration(65_400)).toBe('1:05');
    expect(formatDuration(3_725_000)).toBe('1:02:05');
    expect(formatDuration(-5)).toBe('0:00');
  });

  it('bytes', () => {
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(1536)).toBe('1,5 KB');
    expect(formatBytes(250 * 1024 * 1024)).toBe('250 MB');
    expect(formatBytes(-1)).toBe('—');
  });
});
