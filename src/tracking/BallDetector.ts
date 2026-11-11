import type { BallDetection2D, FrameMeta } from '../core/types';

/**
 * Interface do detector da bola (Fase 3). A primeira implementação será
 * visão clássica (diferença de quadros + cor + tamanho/circularidade)
 * rodando num Worker; depois pode ser trocada por um modelo
 * (ONNX Runtime Web / TF.js) sem mudar quem consome as detecções.
 */
export interface BallDetector {
  readonly name: string;
  readonly source: BallDetection2D['source'];
  /** Processa um quadro já reduzido para a resolução de análise. */
  detect(image: ImageBitmap | ImageData, frame: FrameMeta): Promise<BallDetection2D | null>;
  dispose(): void;
}
