import type { TableSide } from '../physics/bounce';
import type { useRallies } from './useRallies';
import { formatDuration } from '../physics/units';

type R = ReturnType<typeof useRallies>;
const sec = (ms: number) => `${(ms / 1000).toFixed(1).replace('.', ',')} s`;
const kmh = (v: number | null) => (v === null ? '—' : `${Math.round(v)} km/h`);

/** Placar estimado (com correção manual) e, fora do modo compacto, rallies e estatísticas por lado. */
export function RallyPanel({ r, compact = false, nowMs, onSeek }: { r: R; compact?: boolean; nowMs: () => number; onSeek?: (ms: number) => void }) {
  const { score, summary, bySide } = r;
  const serveMark = (s: TableSide) => (score.server === s ? ' •' : '');
  return (
    <div className="rally-panel">
      <div className="score" title="Placar estimado: quem deixou a bola quicar no próprio lado por último perde o ponto">
        <span className="score-side">perto{serveMark('perto')}</span>
        <strong>
          {score.points.perto} × {score.points.longe}
        </strong>
        <span className="score-side">{serveMark('longe') ? '• ' : ''}longe</span>
        {(score.games.perto > 0 || score.games.longe > 0) && (
          <span className="small muted">
            games {score.games.perto}–{score.games.longe}
          </span>
        )}
      </div>
      <div className="row score-buttons">
        <button className="btn btn-small" onClick={() => r.addPoint('perto', nowMs())}>
          +1 perto
        </button>
        <button className="btn btn-small" onClick={() => r.addPoint('longe', nowMs())}>
          +1 longe
        </button>
        {r.manual.length > 0 && (
          <button className="btn btn-small" onClick={r.undoPoint}>
            Desfazer
          </button>
        )}
      </div>
      <div className="small">
        {r.live ? `rally em jogo: ${r.live.shots} quique${r.live.shots > 1 ? 's' : ''}` : `${summary.count} rally${summary.count === 1 ? '' : 's'}`}
        {summary.count > 0 && ` · média ${summary.avgShots.toFixed(1).replace('.', ',')} trocas · máx ${summary.maxShots}`}
      </div>
      {!compact && summary.count > 0 && (
        <>
          <div className="small">
            duração média {sec(summary.avgDurationMs)} (máx {sec(summary.maxDurationMs)})
            {summary.shotsPerMin !== null && ` · ritmo ${Math.round(summary.shotsPerMin)} jogadas/min`}
          </div>
          <table className="shot-list">
            <thead>
              <tr>
                <th>Lado</th>
                <th>Pontos</th>
                <th>Jogadas</th>
                <th>Saques</th>
                <th>Cruzada / paralela / meio</th>
                <th>Velocidade* média / máx</th>
              </tr>
            </thead>
            <tbody>
              {(['perto', 'longe'] as const).map((s) => {
                const st = bySide[s];
                return (
                  <tr key={s}>
                    <td>{s}</td>
                    <td>{st.pointsWon}</td>
                    <td>{st.shots}</td>
                    <td>{st.serves}</td>
                    <td>
                      {st.directions.cruzada} / {st.directions.paralela} / {st.directions.meio}
                    </td>
                    <td>
                      {kmh(st.avgKmh)} / {kmh(st.maxKmh)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <table className="shot-list">
            <thead>
              <tr>
                <th>#</th>
                <th>Início</th>
                <th>Trocas</th>
                <th>Duração</th>
                <th>Ponto (toque para corrigir)</th>
              </tr>
            </thead>
            <tbody>
              {r.rallies
                .slice()
                .reverse()
                .slice(0, 30)
                .map((ra) => {
                  const i = r.rallies.indexOf(ra);
                  const w = r.winners[i];
                  const edited = ra.index in r.overrides;
                  return (
                    <tr key={ra.index}>
                      <td>{ra.index}</td>
                      <td className={onSeek ? 'clickable' : ''} onClick={onSeek ? () => onSeek(Math.max(0, ra.startT - 1000)) : undefined}>
                        {formatDuration(ra.startT)}
                      </td>
                      <td>{ra.shots}</td>
                      <td>{sec(ra.durationMs)}</td>
                      <td className="clickable" onClick={() => r.cycleWinner(ra.index)} title={ra.reason}>
                        {w ?? 'sem ponto'}
                        <span className="muted">{edited ? ' (corrigido)' : ' (estimado)'}</span>
                      </td>
                    </tr>
                  );
                })}
            </tbody>
          </table>
        </>
      )}
    </div>
  );
}
