import { useCallback, useEffect, useState } from 'react';
import { formatBytes, formatDuration } from '../physics/units';
import { getStore, storageEstimate } from '../storage/storeSingleton';
import type { SessionRecord } from '../storage/types';
import { navigate } from './route';

const STATUS_LABEL: Record<SessionRecord['status'], string> = {
  complete: 'Completa',
  recording: 'Gravando',
  interrupted: 'Interrompida',
};

export function SessionsScreen() {
  const [sessions, setSessions] = useState<SessionRecord[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [estimate, setEstimate] = useState<{ usage: number; quota: number } | null>(null);

  const load = useCallback(async () => {
    try {
      const store = await getStore();
      setSessions(await store.list());
      setEstimate(await storageEstimate());
    } catch (err) {
      setError(`Não foi possível abrir o banco de dados local: ${(err as Error).message ?? err}`);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const remove = async (s: SessionRecord) => {
    if (!confirm(`Apagar "${s.name}" e o vídeo? Isso não pode ser desfeito.`)) return;
    await (await getStore()).delete(s.id);
    await load();
  };

  return (
    <div className="page">
      <header className="page-header">
        <button className="btn" onClick={() => navigate({ name: 'camera' })}>
          ← Câmera
        </button>
        <h1>Sessões</h1>
        {estimate && (
          <span className="muted small">
            {formatBytes(estimate.usage)} usados de {formatBytes(estimate.quota)}
          </span>
        )}
      </header>

      {error && <p className="error-text">{error}</p>}
      {sessions === null && !error && <p className="muted">Carregando…</p>}
      {sessions?.length === 0 && (
        <div className="empty">
          <p>Nenhuma sessão gravada ainda.</p>
          <button className="btn btn-primary" onClick={() => navigate({ name: 'camera' })}>
            Gravar a primeira
          </button>
        </div>
      )}

      <ul className="session-list">
        {sessions?.map((s) => {
          const cam = s.cameras[0];
          const total = s.cameras.reduce((a, c) => a + c.sizeBytes, 0);
          return (
            <li key={s.id} className="session-card">
              <button className="session-main" onClick={() => navigate({ name: 'session', id: s.id })}>
                <strong>{s.name}</strong>
                <span className="muted small">
                  {new Date(s.createdAt).toLocaleString('pt-BR')} · {formatDuration(cam?.durationMs ?? 0)} · {formatBytes(total)}
                </span>
                <span className="small">
                  {cam ? `${cam.height}p · ${cam.measuredFps.toFixed(0)} fps` : '—'} · {s.cameras.length} câmera
                  {s.cameras.length > 1 ? 's' : ''} · modo {s.mode.toUpperCase()}
                  {s.status !== 'complete' && <span className={`tag tag-${s.status}`}>{STATUS_LABEL[s.status]}</span>}
                </span>
              </button>
              <button className="btn" onClick={() => navigate({ name: 'report', id: s.id })} aria-label={`Relatório de ${s.name}`}>
                Relatório
              </button>
              <button className="btn btn-danger" onClick={() => remove(s)} aria-label={`Apagar ${s.name}`}>
                Apagar
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
