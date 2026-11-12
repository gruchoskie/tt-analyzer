import { detectOnsets } from './audioOnsets';

/**
 * "Tocs" da trilha de áudio de uma gravação, em ms de tempo de mídia (o mesmo
 * relógio do vídeo na reprodução). Devolve null se não houver áudio ou se o
 * navegador não conseguir decodificar o arquivo.
 */
export async function decodeRecordingOnsets(blob: Blob): Promise<{ onsets: number[]; durationMs: number } | null> {
  const Ctx = (window as unknown as { OfflineAudioContext?: typeof OfflineAudioContext }).OfflineAudioContext;
  if (!Ctx) return null;
  try {
    const ctx = new Ctx(1, 1, 48000);
    const buf = await ctx.decodeAudioData(await blob.arrayBuffer());
    if (!buf.numberOfChannels || !buf.length) return null;
    const onsets = detectOnsets(buf.getChannelData(0), buf.sampleRate).map((o) => o.t);
    return { onsets, durationMs: buf.duration * 1000 };
  } catch {
    return null;
  }
}
