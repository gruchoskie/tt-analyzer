import { useEffect, useMemo, useRef, useState } from 'react';
import type { SessionRecord } from '../storage/types';
import { getStore } from '../storage/storeSingleton';

/**
 * Fase 9: as outras câmeras da sessão, lado a lado e presas ao vídeo principal.
 * Tempo da outra = tempo do principal + (início do principal − início da outra),
 * com os inícios já no relógio do hub. Corrige a deriva quando passa de 40 ms.
 */
export function SyncedVideos({ session, masterId, masterRef }: { session: SessionRecord; masterId: string; masterRef: React.RefObject<HTMLVideoElement> }) {
  const key = session.cameras.map((c) => `${c.cameraId}:${c.sizeBytes}:${c.startedAtHubMs}`).join('|');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const others = useMemo(() => session.cameras.filter((c) => c.cameraId !== masterId), [key, masterId]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const master = useMemo(() => session.cameras.find((c) => c.cameraId === masterId), [key, masterId]);
  const [urls, setUrls] = useState<Record<string, string>>({});
  const refs = useRef<Record<string, HTMLVideoElement | null>>({});

  useEffect(() => {
    let alive = true;
    const made: string[] = [];
    void (async () => {
      const store = await getStore();
      const out: Record<string, string> = {};
      for (const c of others) {
        const b = await store.getVideo(session.id, c.cameraId, c.mimeType);
        if (b && b.size) {
          out[c.cameraId] = URL.createObjectURL(b);
          made.push(out[c.cameraId]);
        }
      }
      if (alive) setUrls(out);
    })();
    return () => {
      alive = false;
      made.forEach((u) => URL.revokeObjectURL(u));
    };
  }, [session.id, others]);

  useEffect(() => {
    const m = masterRef.current;
    if (!m || !master) return;
    const target = (startedAt: number) => m.currentTime + (master.startedAtHubMs - startedAt) / 1000;
    const align = (force: boolean) => {
      for (const c of others) {
        const v = refs.current[c.cameraId];
        if (!v || !v.readyState) continue;
        const t = target(c.startedAtHubMs);
        if (t < 0 || (Number.isFinite(v.duration) && t > v.duration)) {
          if (!v.paused) v.pause();
          continue;
        }
        if (force || Math.abs(v.currentTime - t) > 0.04) v.currentTime = t;
        if (m.paused && !v.paused) v.pause();
        if (!m.paused && v.paused) void v.play().catch(() => {});
        v.playbackRate = m.playbackRate;
      }
    };
    const onSeek = () => align(true);
    const onTick = () => align(false);
    m.addEventListener('seeked', onSeek);
    m.addEventListener('play', onTick);
    m.addEventListener('pause', onTick);
    m.addEventListener('ratechange', onTick);
    const id = window.setInterval(onTick, 500);
    align(true);
    return () => {
      m.removeEventListener('seeked', onSeek);
      m.removeEventListener('play', onTick);
      m.removeEventListener('pause', onTick);
      m.removeEventListener('ratechange', onTick);
      window.clearInterval(id);
    };
  }, [masterRef, master, others, urls]);

  if (!others.length) return null;
  return (
    <div className="synced-videos">
      {others.map((c) => (
        <figure key={c.cameraId}>
          {urls[c.cameraId] ? (
            <video ref={(el) => (refs.current[c.cameraId] = el)} src={urls[c.cameraId]} muted playsInline preload="auto" />
          ) : (
            <div className="small muted synced-missing">vídeo ainda não chegou</div>
          )}
          <figcaption className="small muted">
            {c.label || c.cameraId} · {Math.round(c.clockOffsetMs ?? 0)} ms de ajuste
          </figcaption>
        </figure>
      ))}
    </div>
  );
}
