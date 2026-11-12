import { useMemo } from 'react';
import type { Stroke } from '../pose/strokes';
import { summarizeStrokes } from '../pose/strokes';
import type { PlayerSide } from '../pose/types';
import type { PoseStatus } from './usePose';

const TYPE: Record<Stroke['type'], string> = { forehand: 'forehand', backhand: 'backhand', saque: 'saque' };
const kmh = (mps: number) => `${(mps * 3.6).toFixed(0)} km/h`;

/** Resumo dos golpes (pose) e, fora do modo compacto, a lista dos últimos. */
export function StrokePanel({ strokes, status, error, compact = false, onReset, inferMs = 0 }: { strokes: Stroke[]; status: PoseStatus; error?: string | null; compact?: boolean; onReset?: () => void; inferMs?: number }) {
  const by = useMemo(
    () => ({ perto: summarizeStrokes(strokes.filter((s) => s.side === 'perto')), longe: summarizeStrokes(strokes.filter((s) => s.side === 'longe')) }),
    [strokes],
  );
  if (status === 'carregando') return <div className="small muted">Carregando a pose (MediaPipe)… na 1ª vez baixa ~15 MB.</div>;
  if (status === 'erro') return <div className="small error-text">{error ?? 'A pose não carregou neste aparelho.'}</div>;
  const line = (side: PlayerSide) => {
    const s = by[side];
    if (!s.total) return null;
    return (
      <div key={side}>
        <strong>{side}</strong>: FH {s.byType.forehand} · BH {s.byType.backhand} · saque {s.byType.saque} · pulso máx {kmh(s.maxWristMps)} · potência máx {s.maxPower}
      </div>
    );
  };
  const rows = strokes.slice(-10).reverse();
  return (
    <div className="stroke-panel">
      {inferMs > 120 && <div className="small warn-text">Aparelho lento para a pose ({Math.round(inferMs)} ms por quadro): poucos quadros, golpes podem escapar.</div>}
      {strokes.length === 0 ? <div className="small muted">Nenhum golpe ainda (a pose procura picos de velocidade do pulso).</div> : (['perto', 'longe'] as const).map(line)}
      {!compact && rows.length > 0 && (
        <table className="shot-list">
          <thead>
            <tr>
              <th>Tempo</th>
              <th>Golpe</th>
              <th>Pulso / braço*</th>
              <th>Bola*</th>
              <th>Índice de potência</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((s) => (
              <tr key={`${s.side}-${s.t}`}>
                <td>{(s.t / 1000).toFixed(1).replace('.', ',')} s</td>
                <td>
                  {TYPE[s.type]} <span className="muted">({s.side}{s.type !== 'saque' && s.confidence < 0.4 ? ', incerto' : ''})</span>
                </td>
                <td>
                  {kmh(s.wristMps)} / {kmh(s.armMps)}
                </td>
                <td>{s.ballKmh !== null ? `${Math.round(s.ballKmh)} ± ${Math.max(1, Math.round(s.ballErrKmh ?? 0))} km/h` : '—'}</td>
                <td>
                  {s.powerIndex}
                  {s.wristOnly && <span className="muted"> (só pulso)</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {onReset && strokes.length > 0 && (
        <button className="btn btn-small" onClick={onReset}>
          Zerar golpes
        </button>
      )}
    </div>
  );
}
