import { pickMimeType, pickVideoBitrate } from './mime';

export interface RecorderSink {
  /** Chamado a cada pedaço (≈1 s) — salvamos já, para não perder dados se o app fechar. */
  saveChunk(seq: number, blob: Blob): Promise<void>;
}

export interface RecordingResult {
  mimeType: string;
  durationMs: number;
  sizeBytes: number;
  chunkCount: number;
  /** Pedaços que falharam ao salvar (ex.: armazenamento cheio). */
  failedChunks: number;
}

export const CHUNK_MS = 1000;

/** Grava o MediaStream com MediaRecorder, salvando os pedaços conforme chegam. */
export class SessionRecorder {
  private recorder: MediaRecorder | null = null;
  private seq = 0;
  private bytes = 0;
  private failed = 0;
  private pending: Promise<void> = Promise.resolve();
  private startedAt = 0;
  private mimeType = '';
  onError?: (err: unknown) => void;

  get isRecording(): boolean {
    return this.recorder?.state === 'recording';
  }

  get elapsedMs(): number {
    return this.isRecording ? performance.now() - this.startedAt : 0;
  }

  get bytesSaved(): number {
    return this.bytes;
  }

  start(stream: MediaStream, sink: RecorderSink, fps: number): string {
    if (this.recorder) throw new Error('Gravação já em andamento');
    const hasAudio = stream.getAudioTracks().length > 0;
    const mime = pickMimeType((t) => MediaRecorder.isTypeSupported(t), hasAudio);
    const s = stream.getVideoTracks()[0]?.getSettings();
    const rec = new MediaRecorder(stream, {
      mimeType: mime,
      videoBitsPerSecond: pickVideoBitrate(s?.width ?? 1280, s?.height ?? 720, fps || s?.frameRate || 30),
      audioBitsPerSecond: hasAudio ? 128_000 : undefined,
    });
    this.recorder = rec;
    this.seq = 0;
    this.bytes = 0;
    this.failed = 0;
    this.pending = Promise.resolve();
    this.mimeType = rec.mimeType || mime || 'video/webm';

    rec.ondataavailable = (ev) => {
      if (!ev.data || ev.data.size === 0) return;
      const seq = this.seq++;
      const blob = ev.data;
      // Salva em ordem; um erro não interrompe a gravação.
      this.pending = this.pending.then(() =>
        sink.saveChunk(seq, blob).then(
          () => {
            this.bytes += blob.size;
          },
          (err) => {
            this.failed++;
            this.onError?.(err);
          },
        ),
      );
    };
    rec.onerror = (ev) => this.onError?.((ev as unknown as { error?: unknown }).error ?? ev);

    rec.start(CHUNK_MS);
    this.startedAt = performance.now();
    return this.mimeType;
  }

  /** Para e espera todos os pedaços serem salvos. */
  stop(): Promise<RecordingResult> {
    const rec = this.recorder;
    if (!rec) return Promise.reject(new Error('Nenhuma gravação em andamento'));
    const durationMs = performance.now() - this.startedAt;
    return new Promise<RecordingResult>((resolve) => {
      rec.onstop = async () => {
        // ondataavailable final dispara antes de onstop.
        await this.pending;
        this.recorder = null;
        resolve({
          mimeType: this.mimeType,
          durationMs,
          sizeBytes: this.bytes,
          chunkCount: this.seq - this.failed,
          failedChunks: this.failed,
        });
      };
      if (rec.state !== 'inactive') rec.stop();
      else rec.onstop(new Event('stop'));
    });
  }
}
