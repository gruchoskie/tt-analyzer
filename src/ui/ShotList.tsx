import type { BounceEvent } from '../physics/bounce';
import { formatKmh, hitterSide } from '../physics/speedStats';

/** Lista das jogadas (mais recentes em cima): instante, quem bateu, direção e velocidade estimada. */
export function ShotList({ bounces, max = 12, onSeek }: { bounces: BounceEvent[]; max?: number; onSeek?: (ms: number) => void }) {
  const rows = bounces.filter((b) => b.speed).slice(-max).reverse();
  if (!rows.length) return null;
  return (
    <table className="shot-list">
      <thead>
        <tr>
          <th>Tempo</th>
          <th>Jogada</th>
          <th>Velocidade*</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((b) => {
          const s = b.speed!;
          const what = s.kind === 'quique' ? '2º quique do saque' : b.shot.serve ? 'saque' : b.shot.direction ?? 'jogada';
          return (
            <tr key={b.t} onClick={onSeek ? () => onSeek(s.fromT) : undefined} className={onSeek ? 'clickable' : ''}>
              <td>{(b.t / 1000).toFixed(1).replace('.', ',')} s</td>
              <td>
                {what} <span className="muted">({hitterSide(b)})</span>
              </td>
              <td title={`saída ~${Math.round(s.startKmh)} km/h, chegada ~${Math.round(s.endKmh)} km/h`}>
                {formatKmh(s.avgKmh, s.errKmh)}
                {s.method === 'plano' && <span className="muted"> (na mesa)</span>}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
