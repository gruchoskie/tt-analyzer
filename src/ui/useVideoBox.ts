import { useEffect, useState, type RefObject } from 'react';
import { containTransform, type ContainTransform } from '../calibration/viewport';

export interface VideoBox {
  videoW: number;
  videoH: number;
  elW: number;
  elH: number;
  /** Posição do elemento de vídeo dentro do container do overlay. */
  left: number;
  top: number;
  t: ContainTransform;
}

/**
 * Acompanha o tamanho intrínseco do vídeo e o tamanho/posição do elemento na tela.
 * `remountKey` deve mudar quando o <video> é (re)criado depois do primeiro render.
 */
export function useVideoBox(videoRef: RefObject<HTMLVideoElement>, remountKey?: unknown): VideoBox | null {
  const [box, setBox] = useState<VideoBox | null>(null);
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    const update = () => {
      const videoW = v.videoWidth;
      const videoH = v.videoHeight;
      const elW = v.clientWidth;
      const elH = v.clientHeight;
      if (!videoW || !videoH || !elW || !elH) {
        setBox(null);
        return;
      }
      setBox((prev) => {
        if (
          prev &&
          prev.videoW === videoW &&
          prev.videoH === videoH &&
          prev.elW === elW &&
          prev.elH === elH &&
          prev.left === v.offsetLeft &&
          prev.top === v.offsetTop
        )
          return prev;
        return { videoW, videoH, elW, elH, left: v.offsetLeft, top: v.offsetTop, t: containTransform(videoW, videoH, elW, elH) };
      });
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(v);
    v.addEventListener('loadedmetadata', update);
    v.addEventListener('resize', update);
    window.addEventListener('resize', update);
    const id = window.setInterval(update, 1000); // troca de câmera/orientação
    return () => {
      ro.disconnect();
      v.removeEventListener('loadedmetadata', update);
      v.removeEventListener('resize', update);
      window.removeEventListener('resize', update);
      window.clearInterval(id);
    };
  }, [videoRef, remountKey]);
  return box;
}
