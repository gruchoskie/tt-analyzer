import { useCallback, useEffect, useRef, useState } from 'react';
import type { TableCalibration } from '../calibration/types';
import { BounceDetector, type BounceEvent } from '../physics/bounce';
import type { FrameResult } from '../tracking/protocol';

export interface BounceState {
  bounces: BounceEvent[];
  /** Áudio entrando (tocs confirmam os quiques). */
  audio: boolean;
}

/**
 * Liga o detector de quiques ao rastreio. `onResult` vai no useBallTracking;
 * `addOnsets` recebe os tocs do áudio (ao vivo ou da gravação).
 * Sem calibração não há quiques (a posição na mesa depende dela).
 */
export function useBounces(calibration: TableCalibration | null, enabled: boolean) {
  const detRef = useRef<BounceDetector | null>(null);
  const audioRef = useRef(false);
  const pendingOnsets = useRef<{ times: number[]; until: number } | null>(null);
  const [state, setState] = useState<BounceState>({ bounces: [], audio: false });

  const create = useCallback(() => {
    if (!calibration || !enabled) {
      detRef.current = null;
      return;
    }
    const d = new BounceDetector(calibration.homography, {}, { width: calibration.imageWidth, height: calibration.imageHeight });
    d.setAudioActive(audioRef.current);
    if (pendingOnsets.current) d.addOnsets(pendingOnsets.current.times, pendingOnsets.current.until);
    detRef.current = d;
  }, [calibration, enabled]);

  useEffect(() => {
    create();
    setState((s) => ({ ...s, bounces: [] }));
  }, [create]);

  const emit = (evs: BounceEvent[]) => {
    if (evs.length) setState((s) => ({ ...s, bounces: [...s.bounces, ...evs] }));
  };

  const onResult = useCallback((r: FrameResult) => {
    const d = detRef.current;
    if (!d) return;
    if (r.state === 'lost') {
      emit(d.breakTrack());
      return;
    }
    // posição medida (sem a suavização do Kalman, que arredonda a quebra do quique)
    if (r.state === 'tracking' && r.detection) {
      emit(d.push({ t: r.meta.timestamp.hubMs, frameIndex: r.meta.frameIndex, x: r.detection.x, y: r.detection.y }));
    }
  }, []);

  /** Tocs do áudio. Para uma gravação inteira, passe `keep` para valer também após zerar. */
  const addOnsets = useCallback((times: number[], until: number, keep = false) => {
    if (keep) pendingOnsets.current = { times, until };
    if (!audioRef.current) {
      audioRef.current = true;
      detRef.current?.setAudioActive(true);
      setState((s) => ({ ...s, audio: true }));
    }
    detRef.current?.addOnsets(times, until);
  }, []);

  const audioOff = useCallback(() => {
    audioRef.current = false;
    pendingOnsets.current = null;
    detRef.current?.setAudioActive(false);
    setState((s) => ({ ...s, audio: false }));
  }, []);

  const reset = useCallback(() => {
    create();
    setState((s) => ({ ...s, bounces: [] }));
  }, [create]);

  /** Fim do vídeo: decide o que ainda estava pendente. */
  const flush = useCallback(() => {
    const d = detRef.current;
    if (d) emit(d.flush());
  }, []);

  return { ...state, onResult, addOnsets, audioOff, reset, flush, active: !!calibration && enabled };
}
