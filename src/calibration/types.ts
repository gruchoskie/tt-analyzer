import type { CameraId, Point2 } from '../core/types';

/**
 * Calibração da mesa para uma câmera (preenchida na Fase 2).
 * Cantos na ordem: perto-esquerda, perto-direita, longe-direita, longe-esquerda
 * (do ponto de vista da câmera).
 */
export interface TableCalibration {
  cameraId: CameraId;
  /** Resolução da imagem em que os pontos foram marcados. */
  imageWidth: number;
  imageHeight: number;
  cornersPx: [Point2, Point2, Point2, Point2];
  /** Homografia imagem -> mesa (metros), matriz 3x3 em ordem de linhas. */
  homography: number[];
  /** Postes da rede (Fase 9, calibração 3D). */
  netPostsPx?: [Point2, Point2];
  createdAt: number;
}
