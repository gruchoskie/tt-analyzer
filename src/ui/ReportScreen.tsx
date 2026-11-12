import { useEffect, useMemo, useState } from 'react';
import { formatKmh } from '../physics/speedStats';
import { formatDuration } from '../physics/units';
import { reportData } from '../report/analysis';
import { bouncesCsv, ralliesCsv, strokesCsv } from '../report/csv';
import { getStore } from '../storage/storeSingleton';
import type { SessionAnalysis, SessionRecord } from '../storage/types';
import { BounceMap } from './BounceMap';
import { RallyChart, SpeedChart } from './charts';
import { navigate } from './route';

type Data = ReturnType<typeof reportData>;

const safeName = (s: string) => s.replace(/[^\w\- ]+/g, '_').trim().replace(/\s+/g, '_');
const pct = (n: number, d: number) => (d ? `${Math.round((100 * n) / d)}%` : '—');

function summaryText(session: SessionRecord, d: Data): string {
  const s = d.score;
  const lines = [
    `TT Analyzer · ${session.name}`,
    `Placar estimado: perto ${s.points.perto} × ${s.points.longe} longe${s.games.perto + s.games.longe ? ` (games ${s.games.perto}–${s.games.longe})` : ''}`,
    `Rallies: ${d.rallySummary.count} · média ${d.rallySummary.avgShots.toFixed(1).replace('.', ',')} trocas · máx ${d.rallySummary.maxShots}`,
    `Quiques: ${d.bounces.total} (perto ${d.bounces.bySide.perto}, longe ${d.bounces.bySide.longe})`,
  ];
  if (d.speeds.count) lines.push(`Velocidade (estimativa): máx ${formatKmh(d.speeds.maxKmh, d.speeds.maxErrKmh)} · média ${formatKmh(d.speeds.avgKmh, d.speeds.avgErrKmh)}`);
  if (d.strokeSummary.total)
    lines.push(`Golpes: ${d.strokeSummary.byType.forehand} forehand, ${d.strokeSummary.byType.backhand} backhand, ${d.strokeSummary.byType.saque} saques · índice de potência máx ${d.strokeSummary.maxPower}`);
  lines.push('Medidas com 1 câmera (2D): velocidade, golpes e placar são estimativas.');
  return lines.join('\n');
}

function download(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/** Fase 8: resumo da sessão com gráficos, exportação em CSV e compartilhamento. */
export function ReportScreen({ id }: { id: string }) {
  const [session, setSession] = useState<SessionRecord | null | undefined>(undefined);
  const [analysis, setAnalysis] = useState<SessionAnalysis | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    void (async () => {
      const store = await getStore();
      const [s, a] = await Promise.all([store.get(id), store.getAnalysis(id)]);
      if (!alive) return;
      setSession(s ?? null);
      setAnalysis(a ?? null);
    })();
    return () => {
      alive = false;
    };
  }, [id]);

  const d = useMemo(() => (analysis ? reportData(analysis) : null), [analysis]);

  if (session === undefined) return <div className="page">Carregando…</div>;
  if (session === null)
    return (
      <div className="page">
        <p>Sessão não encontrada.</p>
        <button className="btn" onClick={() => navigate({ name: 'sessions' })}>
          Sessões
        </button>
      </div>
    );

  const cam = session.cameras[0];
  const files = analysis && d
    ? [
        { name: `${safeName(session.name)}_jogadas.csv`, text: bouncesCsv(analysis.bounces) },
        { name: `${safeName(session.name)}_rallies.csv`, text: ralliesCsv(analysis.rallies, analysis.winners) },
        ...(d.strokes.length ? [{ name: `${safeName(session.name)}_golpes.csv`, text: strokesCsv(d.strokes) }] : []),
      ]
    : [];

  const share = async () => {
    if (!d) return;
    const text = summaryText(session, d);
    const fileObjs = files.map((f) => new File([f.text], f.name, { type: 'text/csv' }));
    try {
      if (navigator.canShare?.({ files: fileObjs })) await navigator.share({ title: session.name, text, files: fileObjs });
      else if (navigator.share) await navigator.share({ title: session.name, text });
      else {
        await navigator.clipboard.writeText(text);
        setMsg('Resumo copiado. Use "Baixar CSV" para as tabelas.');
      }
    } catch (e) {
      if ((e as Error).name !== 'AbortError') {
        try {
          await navigator.clipboard.writeText(text);
          setMsg('Não deu para compartilhar daqui; o resumo foi copiado.');
        } catch {
          setMsg('Não deu para compartilhar neste navegador. Use "Baixar CSV".');
        }
      }
    }
  };

  return (
    <div className="page report">
      <header className="page-header">
        <button className="btn" onClick={() => navigate({ name: 'session', id })}>
          ← Vídeo
        </button>
        <div>
          <h1>Relatório · {session.name}</h1>
          <span className="small muted">
            {new Date(session.createdAt).toLocaleString('pt-BR')} · {formatDuration(cam?.durationMs ?? 0)} · {cam ? `${cam.height}p, ${cam.measuredFps.toFixed(0)} fps` : ''} · modo {session.mode.toUpperCase()}
          </span>
        </div>
      </header>

      {!analysis || !d ? (
        <section className="card">
          <p>Esta sessão ainda não tem análise.</p>
          <p className="small muted">
            A análise é salva quando você grava com a mesa calibrada e o rastreio ligado, ou quando toca o vídeo com a mesa calibrada e
            "Rastrear a bola" ligado (de preferência do começo ao fim).
          </p>
          <button className="btn btn-primary" onClick={() => navigate({ name: 'session', id })}>
            Abrir o vídeo
          </button>
        </section>
      ) : (
        <>
          <p className="small muted">
            Análise {analysis.source === 'ao-vivo' ? 'feita ao vivo, durante a gravação' : 'feita tocando o vídeo'} · trecho{' '}
            {formatDuration(analysis.coveredFromMs)}–{formatDuration(analysis.coveredToMs)} · atualizada em{' '}
            {new Date(analysis.updatedAt).toLocaleString('pt-BR')}
          </p>

          <div className="kpis">
            <div className="kpi">
              <span>Placar estimado</span>
              <strong>
                {d.score.points.perto} × {d.score.points.longe}
              </strong>
              <small>
                perto × longe{d.score.games.perto + d.score.games.longe > 0 ? ` · games ${d.score.games.perto}–${d.score.games.longe}` : ''}
              </small>
            </div>
            <div className="kpi">
              <span>Rallies</span>
              <strong>{d.rallySummary.count}</strong>
              <small>
                média {d.rallySummary.avgShots.toFixed(1).replace('.', ',')} trocas · máx {d.rallySummary.maxShots}
              </small>
            </div>
            <div className="kpi">
              <span>Velocidade máx*</span>
              <strong>{d.speeds.count ? `${Math.round(d.speeds.maxKmh)} km/h` : '—'}</strong>
              <small>{d.speeds.count ? `± ${Math.max(1, Math.round(d.speeds.maxErrKmh))} km/h · média ${formatKmh(d.speeds.avgKmh, d.speeds.avgErrKmh)}` : 'sem medida'}</small>
            </div>
            <div className="kpi">
              <span>Ritmo</span>
              <strong>{d.rallySummary.shotsPerMin !== null ? Math.round(d.rallySummary.shotsPerMin) : '—'}</strong>
              <small>jogadas/min · rally médio {(d.rallySummary.avgDurationMs / 1000).toFixed(1).replace('.', ',')} s</small>
            </div>
            {d.strokeSummary.total > 0 && (
              <div className="kpi">
                <span>Golpes (pose)</span>
                <strong>{d.strokeSummary.total}</strong>
                <small>
                  FH {d.strokeSummary.byType.forehand} · BH {d.strokeSummary.byType.backhand} · saque {d.strokeSummary.byType.saque} · potência máx{' '}
                  {d.strokeSummary.maxPower}
                </small>
              </div>
            )}
          </div>

          <div className="row">
            <button className="btn btn-primary" onClick={share}>
              Compartilhar
            </button>
            {files.map((f) => (
              <button key={f.name} className="btn" onClick={() => download(f.name, f.text)}>
                Baixar {f.name.replace(/^.*_(\w+)\.csv$/, '$1')}.csv
              </button>
            ))}
          </div>
          {msg && <p className="small">{msg}</p>}

          <section className="card">
            <SpeedChart points={d.speedSeries} />
          </section>
          <section className="card">
            <RallyChart rallies={analysis.rallies} winners={analysis.winners} />
          </section>
          <section className="card report-map">
            <h3>Mapa de calor dos quiques</h3>
            <BounceMap bounces={analysis.bounces} audio={analysis.bounces.some((b) => b.audio !== 'sem-audio')} />
          </section>
          <section className="card">
            <h3>Por lado</h3>
            <table className="shot-list">
              <thead>
                <tr>
                  <th>Lado</th>
                  <th>Pontos</th>
                  <th>Jogadas</th>
                  <th>Saques</th>
                  <th>Cruzada</th>
                  <th>Paralela</th>
                  <th>Meio</th>
                  <th>Vel. média / máx*</th>
                </tr>
              </thead>
              <tbody>
                {(['perto', 'longe'] as const).map((s) => {
                  const st = d.bySide[s];
                  const dir = st.directions.cruzada + st.directions.paralela + st.directions.meio;
                  return (
                    <tr key={s}>
                      <td>{s}</td>
                      <td>{st.pointsWon}</td>
                      <td>{st.shots}</td>
                      <td>{st.serves}</td>
                      <td>{pct(st.directions.cruzada, dir)}</td>
                      <td>{pct(st.directions.paralela, dir)}</td>
                      <td>{pct(st.directions.meio, dir)}</td>
                      <td>
                        {st.avgKmh !== null ? Math.round(st.avgKmh) : '—'} / {st.maxKmh !== null ? Math.round(st.maxKmh) : '—'} km/h
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </section>
          <p className="small muted">
            *Com 1 câmera (2D), a posição dos quiques é a medida mais confiável. Velocidade, golpes, índice de potência e placar são
            estimativas (veja "Sobre e limitações"). Os CSVs usam ";" e vírgula decimal, prontos para o Excel ou o Planilhas.
          </p>
        </>
      )}
    </div>
  );
}
