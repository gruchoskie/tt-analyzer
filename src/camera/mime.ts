/** Escolha do formato de gravação suportado pelo navegador. */

export const MIME_CANDIDATES = [
  'video/webm;codecs=vp9,opus',
  'video/webm;codecs=vp8,opus',
  'video/webm;codecs=h264,opus',
  'video/webm',
  'video/mp4;codecs=avc1.42E01E,mp4a.40.2', // Safari/iOS
  'video/mp4',
] as const;

export const MIME_CANDIDATES_NO_AUDIO = [
  'video/webm;codecs=vp9',
  'video/webm;codecs=vp8',
  'video/webm',
  'video/mp4;codecs=avc1.42E01E',
  'video/mp4',
] as const;

export function pickMimeType(
  isTypeSupported: (t: string) => boolean,
  withAudio: boolean,
): string | undefined {
  const list = withAudio ? MIME_CANDIDATES : MIME_CANDIDATES_NO_AUDIO;
  return list.find((t) => {
    try {
      return isTypeSupported(t);
    } catch {
      return false;
    }
  });
}

export function extensionForMime(mime: string): 'webm' | 'mp4' {
  return mime.startsWith('video/mp4') ? 'mp4' : 'webm';
}

/** Bitrate de vídeo proporcional à resolução e ao fps (~0,1 bit/pixel), entre 2 e 12 Mbps. */
export function pickVideoBitrate(width: number, height: number, fps: number): number {
  const bps = width * height * Math.max(fps, 15) * 0.1;
  return Math.round(Math.min(12_000_000, Math.max(2_000_000, bps)));
}
