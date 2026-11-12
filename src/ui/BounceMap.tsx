import { useMemo } from 'react';
import { NET_Y_M } from '../calibration/table';
import { TABLE_LENGTH_M, TABLE_WIDTH_M } from '../physics/constants';
import type { BounceEvent } from '../physics/bounce';
import { summarizeBounces } from '../physics/bounceStats';
import { formatKmh, summarizeSpeeds } from '../physics/speedStats';

const S = 78; // px por metro no desenho
const PAD = 14;
const W = TABLE_WIDTH_M * S + 2 * PAD;
const H = TABLE_LENGTH_M * S + 2 * PAD;

/** Mesa vista de cima, "perto" (cabeceira da câmera) embaixo. */
const toSvg = (p: { x: number; y: number }) => ({ x: PAD + p.x * S, y: PAD + (TABLE_LENGTH_M - p.y) * S });

/**
 * Mapa de calor dos quiques + resumo (lados, direções, confirmação por áudio).
 * O calor é a soma de manchas suaves (uma por quique) com mistura aditiva.
 */
export function BounceMap({ bounces, audio, onReset, compact = false }: { bounces: BounceEvent[]; audio: boolean; onReset?: () => void; compact?: boolean }) {
  const sum = useMemo(() => summarizeBounces(bounces), [bounces]);
  const sp = useMemo(() => summarizeSpeeds(bounces), [bounces]);
  const last = bounces[bounces.length - 1];
  const pct = (n: number, d: number) => (d ? `${Math.round((100 * n) / d)}%` : '—');
  const dirTotal = sum.directions.cruzada + sum.directions.paralela + sum.directions.meio;

  return (
    <div className={`bounce-map ${compact ? 'compact' : ''}`}>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Mapa de quiques: ${sum.total} quiques`}>
        <defs>
          <radialGradient id="heat">
            <stop offset="0%" stopColor="#ff5a1f" stopOpacity="0.85" />
            <stop offset="45%" stopColor="#ffb020" stopOpacity="0.45" />
            <stop offset="100%" stopColor="#ffb020" stopOpacity="0" />
          </radialGradient>
        </defs>
        <rect x={PAD} y={PAD} width={TABLE_WIDTH_M * S} height={TABLE_LENGTH_M * S} className="bm-table" />
        {/* terços (zonas) e linha central */}
        {[1, 2].map((k) => (
          <line key={`v${k}`} x1={PAD + (k * TABLE_WIDTH_M * S) / 3} x2={PAD + (k * TABLE_WIDTH_M * S) / 3} y1={PAD} y2={H - PAD} className="bm-zone" />
        ))}
        {[1 / 3, 2 / 3, 4 / 3, 5 / 3].map((k) => (
          <line key={`h${k}`} x1={PAD} x2={W - PAD} y1={PAD + k * NET_Y_M * S} y2={PAD + k * NET_Y_M * S} className="bm-zone" />
        ))}
        <line x1={W / 2} x2={W / 2} y1={PAD} y2={H - PAD} className="bm-center" />
        <line x1={PAD - 8} x2={W - PAD + 8} y1={H / 2} y2={H / 2} className="bm-net" />
        <g style={{ mixBlendMode: 'screen' }}>
          {bounces.map((b, i) => {
            const p = toSvg(b.table);
            return <circle key={i} cx={p.x} cy={p.y} r={0.16 * S} fill="url(#heat)" />;
          })}
        </g>
        {bounces.map((b, i) => {
          const p = toSvg(b.table);
          return <circle key={`d${i}`} cx={p.x} cy={p.y} r={2} className={b.audio === 'confirmado' ? 'bm-dot ok' : 'bm-dot'} />;
        })}
        {last && <circle cx={toSvg(last.table).x} cy={toSvg(last.table).y} r={7} className="bm-last" />}
        <text x={W / 2} y={H - 2} className="bm-label">
          perto
        </text>
        <text x={W / 2} y={10} className="bm-label">
          longe
        </text>
      </svg>
      <div className="bm-stats">
        <div>
          <strong>{sum.total}</strong> quiques · perto {sum.bySide.perto} · longe {sum.bySide.longe}
        </div>
        {dirTotal > 0 && (
          <div>
            cruzada {pct(sum.directions.cruzada, dirTotal)} · paralela {pct(sum.directions.paralela, dirTotal)} · meio{' '}
            {pct(sum.directions.meio, dirTotal)}
          </div>
        )}
        {sp.count > 0 && (
          <div title="Estimativa com 1 câmera, com margem de erro">
            velocidade* máx {formatKmh(sp.maxKmh, sp.maxErrKmh)}
            {!compact && <> · média {formatKmh(sp.avgKmh, sp.avgErrKmh)}</>}
          </div>
        )}
        {!compact && sp.byHitter.perto.count > 0 && sp.byHitter.longe.count > 0 && (
          <div className="small">
            jogador perto: média {formatKmh(sp.byHitter.perto.avgKmh)} · longe: {formatKmh(sp.byHitter.longe.avgKmh)}
          </div>
        )}
        {!compact && sum.serves > 0 && <div>saques vistos: {sum.serves}</div>}
        <div className="small muted">
          {audio
            ? `som confirmou ${sum.audioConfirmed} de ${sum.audioChecked}`
            : 'sem áudio: quiques só pela imagem'}
          {sp.count > 0 && ' · *estimativa'}
        </div>
        {onReset && (
          <button className="btn btn-small" onClick={onReset} disabled={!bounces.length}>
            Zerar
          </button>
        )}
      </div>
    </div>
  );
}
