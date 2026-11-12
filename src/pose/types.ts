import type { CameraId } from '../core/types';

/** Ponto do MediaPipe Pose: normalizado na imagem (x, y em 0..1) ou em metros (mundo, centrado no quadril). */
export interface Landmark {
  x: number;
  y: number;
  z: number;
  visibility?: number;
}

export type PlayerSide = 'perto' | 'longe';
export type Hand = 'direita' | 'esquerda';
export type StrokeType = 'forehand' | 'backhand' | 'saque';

/** Pose de um jogador num quadro (Fase 6, MediaPipe Pose Landmarker). */
export interface PoseFrame {
  cameraId: CameraId;
  /** Instante (ms) no mesmo relógio dos quiques (hub ao vivo, tempo do vídeo na reprodução). */
  t: number;
  side: PlayerSide;
  /** 33 pontos normalizados (0..1) na imagem. */
  image: Landmark[];
  /** 33 pontos em metros (estimativa do MediaPipe, origem no meio do quadril). */
  world: Landmark[];
}

/** Índices do modelo de 33 pontos do MediaPipe. */
export const LM = {
  nose: 0,
  leftShoulder: 11,
  rightShoulder: 12,
  leftElbow: 13,
  rightElbow: 14,
  leftWrist: 15,
  rightWrist: 16,
  leftHip: 23,
  rightHip: 24,
  leftKnee: 25,
  rightKnee: 26,
  leftAnkle: 27,
  rightAnkle: 28,
} as const;

/** Ligações do esqueleto para desenhar. */
export const SKELETON: [number, number][] = [
  [11, 12], [11, 13], [13, 15], [12, 14], [14, 16],
  [11, 23], [12, 24], [23, 24], [23, 25], [25, 27], [24, 26], [26, 28],
];
