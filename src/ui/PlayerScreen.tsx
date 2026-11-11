import { useEffect, useRef, useState } from 'react';
import { extensionForMime } from '../camera/mime';
import { formatBytes, formatDuration } from '../physics/units';
import { getStore } from '../storage/storeSingleton';
import type { SessionRecord } from '../storage/types';
import { navigate } from './route';

export function PlayerScreen({ id }: { id: string }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [session, setSession] = useState<SessionRecord | null | undefined>(undefined);
  const [cameraId, setCameraId] = useState<string | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState('');

  useEffect(() => {
    let alive = true;
    void (async () => {
      const s = await (await getStore()).get(id);
      if (!alive) return;
      setSession(s ?? null);
      setName(s?.name ?? '');
      setCameraId(s?.cameras[0]?.cameraId ?? null);
    })();
    return () => {
      alive = false;
    };
  }, [id]);

  const cam = session?.cameras.find((c) => c.cameraId === cameraId);

  useEffect(() => {
    if (!session || !cam) return;
    let objectUrl: string | null = null;
    let alive = true;
    void (async () => {
      const blob = await (await getStore()).getVideo(session.id, cam.cameraId, cam.mimeType);
      if (!alive) return;
      if (!blob) {
        setError('O vídeo desta sessão não foi encontrado.');
        return;
      }
      objectUrl = URL.createObjectURL(blob);
      setUrl(objectUrl);
    })();
    return () => {
      alive = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      setUrl(null);
    };
  }, [session, cam]);

  // Vídeos webm gravados pelo Chrome não têm duração no cabeçalho: força o cálculo.
  const onLoadedMetadata = () => {
    const v = videoRef.current;
    if (!v || Number.isFinite(v.duration)) return;
    const reset = () => {
      v.removeEventListener('durationchange', reset);
      v.currentTime = 0;
    };
    v.addEventListener('durationchange', reset);
    v.currentTime = 1e7;
  };

  const saveName = async () => {
    if (!session || name === session.name) return;
    await (await getStore()).rename(session.id, name);
    setSession({ ...session, name: name.trim() || 'Sessão sem nome' });
  };

  if (session === undefined) return <div className="page muted">Carregando…</div>;
  if (session === null)
    return (
      <div className="page">
        <p>Sessão não encontrada.</p>
        <button className="btn" onClick={() => navigate({ name: 'sessions' })}>
          ← Sessões
        </button>
      </div>
    );

  return (
    <div className="page player">
      <header className="page-header">
        <button className="btn" onClick={() => navigate({ name: 'sessions' })}>
          ← Sessões
        </button>
        <input
          className="title-input"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={saveName}
          onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
          aria-label="Nome da sessão"
        />
      </header>

      {session.cameras.length > 1 && (
        <div className="row">
          {session.cameras.map((c) => (
            <button key={c.cameraId} className={`btn ${c.cameraId === cameraId ? 'btn-primary' : ''}`} onClick={() => setCameraId(c.cameraId)}>
              {c.label || c.cameraId}
            </button>
          ))}
        </div>
      )}

      {error ? (
        <p className="error-text">{error}</p>
      ) : (
        <video ref={videoRef} className="player-video" src={url ?? undefined} controls playsInline onLoadedMetadata={onLoadedMetadata} />
      )}

      {cam && (
        <dl className="facts">
          <div>
            <dt>Data</dt>
            <dd>{new Date(session.createdAt).toLocaleString('pt-BR')}</dd>
          </div>
          <div>
            <dt>Duração</dt>
            <dd>{formatDuration(cam.durationMs)}</dd>
          </div>
          <div>
            <dt>Resolução</dt>
            <dd>
              {cam.width}×{cam.height}
            </dd>
          </div>
          <div>
            <dt>fps medido</dt>
            <dd>{cam.measuredFps.toFixed(1)}</dd>
          </div>
          <div>
            <dt>Tamanho</dt>
            <dd>{formatBytes(cam.sizeBytes)}</dd>
          </div>
          <div>
            <dt>Áudio</dt>
            <dd>{cam.hasAudio ? 'Sim' : 'Não'}</dd>
          </div>
          <div>
            <dt>Modo</dt>
            <dd>{session.mode === '2d' ? '2D (1 câmera)' : `3D (${session.cameras.length} câmeras)`}</dd>
          </div>
          <div>
            <dt>Calibração</dt>
            <dd>{Object.keys(session.calibrations).length ? 'Feita' : 'Não feita (Fase 2)'}</dd>
          </div>
        </dl>
      )}

      {session.status === 'interrupted' && (
        <p className="muted small">Esta gravação foi interrompida (app fechado ou bateria). O que foi salvo até ali está disponível.</p>
      )}

      {url && cam && (
        <div className="row">
          <a className="btn" href={url} download={`${session.name.replace(/[^\w\- ]+/g, '_')}.${extensionForMime(cam.mimeType)}`}>
            Baixar vídeo
          </a>
        </div>
      )}
    </div>
  );
}
