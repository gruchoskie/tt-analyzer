import { useEffect, useRef, useState, type RefObject } from 'react';
import type { TableCalibration } from '../calibration/types';
import type { CameraId } from '../core/types';
import { roiFromTable } from '../tracking/analysisGeometry';
import { AnalysisPipeline, type PipelineStats } from '../tracking/AnalysisPipeline';
import type { BallColor } from '../tracking/classicDetector';
import type { FrameResult } from '../tracking/protocol';
import type { TrackOverlayHandle } from './TrackOverlay';
import type { BallProfile } from '../tracking/ballProfile';

export interface TrackingSnapshot {
  pipeline: PipelineStats;
  last: FrameResult | null;
}

/**
 * Liga o pipeline de rastreio a um <video>. Devolve o pipeline (para enviar
 * quadros) e um retrato das estatísticas atualizado 4x por segundo.
 */
export function useBallTracking(opts: {
  videoRef: RefObject<HTMLVideoElement>;
  overlayRef: RefObject<TrackOverlayHandle>;
  enabled: boolean;
  cameraId: CameraId;
  calibration: TableCalibration | null;
  ballColor: BallColor;
  analysisWidth: number;
  showCandidates: boolean;
  profile: BallProfile | null;
}) {
  const { videoRef, overlayRef, enabled, cameraId, calibration, ballColor, analysisWidth, showCandidates, profile } = opts;
  const pipelineRef = useRef<AnalysisPipeline | null>(null);
  const lastRef = useRef<FrameResult | null>(null);
  const showCandRef = useRef(showCandidates);
  showCandRef.current = showCandidates;
  const [snapshot, setSnapshot] = useState<TrackingSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Cria/destrói o Worker.
  useEffect(() => {
    const video = videoRef.current;
    if (!enabled || !video) return;
    let p: AnalysisPipeline;
    try {
      p = new AnalysisPipeline(video, { cameraId, analysisWidth });
    } catch (err) {
      setError(`Não foi possível iniciar o rastreio: ${(err as Error).message}`);
      return;
    }
    p.onResult = (r) => {
      lastRef.current = r;
      // ganchos para os testes automatizados (e2e)
      (window as unknown as { __ttTrack?: FrameResult[] }).__ttTrack?.push(r);
      overlayRef.current?.draw(r, { showCandidates: showCandRef.current });
    };
    p.onError = (m) => setError(m);
    pipelineRef.current = p;
    setError(null);
    const id = window.setInterval(() => setSnapshot({ pipeline: p.stats(), last: lastRef.current }), 250);
    return () => {
      window.clearInterval(id);
      p.dispose();
      pipelineRef.current = null;
      lastRef.current = null;
      overlayRef.current?.draw(null);
      setSnapshot(null);
    };
  }, [enabled, cameraId, analysisWidth, videoRef, overlayRef]);

  // ROI da mesa e cor da bola.
  useEffect(() => {
    pipelineRef.current?.update({
      roi: calibration ? roiFromTable(calibration.cornersPx, { width: calibration.imageWidth, height: calibration.imageHeight }) : null,
      detector: { color: ballColor },
      calibration,
      profile,
    });
  }, [calibration, ballColor, enabled, profile]);

  return { pipelineRef, snapshot, error };
}
