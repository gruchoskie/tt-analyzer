import { useEffect, useRef, useState } from 'react';
import type { TableSide } from '../physics/bounce';
import type { StoredRally } from '../storage/types';
import type { SpeedPoint } from '../report/analysis';

/**
 * Gráficos do relatório (SVG puro). Cores por lado de quem bateu, validadas
 * para daltonismo no fundo escuro; a legenda e o texto do tooltip garantem que
 * a cor nunca é a única pista.
 */
export const SIDE_COLOR: Record<TableSide, string> = { perto: '#1aa3b2', longe: '#9b72f0' };
const NONE = '#5b6676';

function niceMax(v: number): number {
  const step = v > 60 ? 20 : v > 20 ? 10 : 5;
  return Math.max(step, Math.ceil(v / step) * step);
}

function Legend({ items }: { items: { color: string; label: string }[] }) {
  return (
    <div className="chart-legend">
      {items.map((i) => (
        <span key={i.label}>
          <i style={{ background: i.color }} />
          {i.label}
        </span>
      ))}
    </div>
  );
}

const H = 220, L = 34, R = 10, T = 14, B = 26;

/** Largura real do gráfico (texto do eixo fica legível no celular). */
function useWidth(): [React.RefObject<HTMLElement>, number] {
  const ref = useRef<HTMLElement>(null);
  const [w, setW] = useState(640);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(([e]) => setW(Math.max(280, Math.round(e.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, w];
}

/** Velocidade de cada jogada (ponto) com a margem de erro (barra vertical). */
export function SpeedChart({ points }: { points: SpeedPoint[] }) {
  const [ref, W] = useWidth();
  const [hover, setHover] = useState<SpeedPoint | null>(null);
  if (!points.length) return <p className="small muted">Nenhuma jogada com velocidade medida.</p>;
  const ymax = niceMax(Math.max(...points.map((p) => p.kmh + p.errKmh)));
  const n = points.length;
  const x = (i: number) => L + ((i + 0.5) * (W - L - R)) / n;
  const y = (v: number) => T + (1 - v / ymax) * (H - T - B);
  const ticks = [0, ymax / 2, ymax];
  const maxP = points.reduce((a, b) => (b.kmh > a.kmh ? b : a));
  return (
    <figure className="chart" ref={ref as React.RefObject<HTMLElement>}>
      <figcaption>Velocidade estimada por jogada (km/h, média do trecho ± margem)</figcaption>
      <Legend items={[{ color: SIDE_COLOR.perto, label: 'bateu perto' }, { color: SIDE_COLOR.longe, label: 'bateu longe' }]} />
      <div className="chart-tip">{hover ? `#${hover.n} · ${hover.label} (${hover.side}) · ${Math.round(hover.kmh)} ± ${Math.max(1, Math.round(hover.errKmh))} km/h · ${(hover.t / 1000).toFixed(1).replace('.', ',')} s` : ' '}</div>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Velocidade de ${n} jogadas, máxima ${Math.round(maxP.kmh)} km/h`} onMouseLeave={() => setHover(null)}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={L} x2={W - R} y1={y(t)} y2={y(t)} className="chart-grid" />
            <text x={L - 6} y={y(t) + 4} className="chart-axis" textAnchor="end">
              {t}
            </text>
          </g>
        ))}
        {points.map((p, i) => (
          <g key={p.n} onMouseEnter={() => setHover(p)} onPointerDown={() => setHover(p)}>
            <rect x={x(i) - (W - L - R) / n / 2} y={T} width={(W - L - R) / n} height={H - T - B} fill="transparent" />
            <line x1={x(i)} x2={x(i)} y1={y(Math.max(0, p.kmh - p.errKmh))} y2={y(p.kmh + p.errKmh)} stroke={SIDE_COLOR[p.side]} strokeWidth={2} strokeLinecap="round" opacity={0.6} />
            <circle cx={x(i)} cy={y(p.kmh)} r={hover === p ? 6 : 4.5} fill={SIDE_COLOR[p.side]} stroke="var(--surface)" strokeWidth={2} />
          </g>
        ))}
        <text x={x(points.indexOf(maxP))} y={y(maxP.kmh + maxP.errKmh) - 6} className="chart-label" textAnchor="middle">
          máx {Math.round(maxP.kmh)}
        </text>
        <text x={(L + W - R) / 2} y={H - 6} className="chart-axis" textAnchor="middle">
          jogadas, na ordem
        </text>
      </svg>
    </figure>
  );
}

/** Trocas por rally, barra na cor de quem ganhou o ponto. */
export function RallyChart({ rallies, winners }: { rallies: StoredRally[]; winners: (TableSide | null)[] }) {
  const [ref, W] = useWidth();
  const [hover, setHover] = useState<number | null>(null);
  if (!rallies.length) return <p className="small muted">Nenhum rally fechado.</p>;
  const ymax = niceMax(Math.max(...rallies.map((r) => r.shots)));
  const n = rallies.length;
  const slot = (W - L - R) / n;
  const bw = Math.max(2, Math.min(28, slot - 2));
  const y = (v: number) => T + (1 - v / ymax) * (H - T - B);
  const h = hover !== null ? rallies[hover] : null;
  return (
    <figure className="chart" ref={ref as React.RefObject<HTMLElement>}>
      <figcaption>Trocas por rally (cor = quem ganhou o ponto)</figcaption>
      <Legend items={[{ color: SIDE_COLOR.perto, label: 'ponto perto' }, { color: SIDE_COLOR.longe, label: 'ponto longe' }, { color: NONE, label: 'sem ponto' }]} />
      <div className="chart-tip">
        {h ? `Rally ${h.index} · ${h.shots} trocas · ${(h.durationMs / 1000).toFixed(1).replace('.', ',')} s · ponto ${winners[hover!] ?? '—'}` : ' '}
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${n} rallies`} onMouseLeave={() => setHover(null)}>
        {[0, ymax / 2, ymax].map((t) => (
          <g key={t}>
            <line x1={L} x2={W - R} y1={y(t)} y2={y(t)} className="chart-grid" />
            <text x={L - 6} y={y(t) + 4} className="chart-axis" textAnchor="end">
              {t}
            </text>
          </g>
        ))}
        {rallies.map((r, i) => {
          const cx = L + (i + 0.5) * slot;
          const top = y(r.shots);
          const base = y(0);
          const rr = Math.min(4, bw / 2, base - top);
          const w = winners[i];
          return (
            <g key={r.index} onMouseEnter={() => setHover(i)} onPointerDown={() => setHover(i)}>
              <rect x={cx - slot / 2} y={T} width={slot} height={H - T - B} fill="transparent" />
              <path
                d={`M${cx - bw / 2},${base} V${top + rr} Q${cx - bw / 2},${top} ${cx - bw / 2 + rr},${top} H${cx + bw / 2 - rr} Q${cx + bw / 2},${top} ${cx + bw / 2},${top + rr} V${base} Z`}
                fill={w ? SIDE_COLOR[w] : NONE}
                opacity={hover === null || hover === i ? 1 : 0.6}
              />
            </g>
          );
        })}
        <line x1={L} x2={W - R} y1={y(0)} y2={y(0)} className="chart-base" />
        <text x={(L + W - R) / 2} y={H - 6} className="chart-axis" textAnchor="middle">
          rallies, na ordem
        </text>
      </svg>
    </figure>
  );
}
