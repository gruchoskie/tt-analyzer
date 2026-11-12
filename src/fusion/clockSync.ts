/**
 * Sincronização de relógio entre uma câmera e o hub (Fase 9).
 *
 * 1) Pings estilo NTP pelo canal de dados: a câmera manda t0 (relógio dela),
 *    o hub carimba t1 (chegada) e t2 (resposta), a câmera anota t3. Então
 *      deslocamento θ = ((t1 − t0) + (t2 − t3)) / 2   (hub = câmera + θ)
 *      atraso      δ = (t3 − t0) − (t2 − t1)
 *    O erro de θ é no máximo δ/2 (rota assimétrica). Fica a mediana das
 *    medições de menor atraso, que são as mais confiáveis.
 * 2) Eventos vistos/ouvidos pelos dois aparelhos ao mesmo tempo (flash da
 *    tela do hub, palma, tocs dos quiques) refinam o deslocamento: o hub e a
 *    câmera registram o mesmo instante físico, a diferença é o erro restante.
 */

export interface PingSample {
  /** câmera envia */
  t0: number;
  /** hub recebe */
  t1: number;
  /** hub responde */
  t2: number;
  /** câmera recebe */
  t3: number;
}

export interface ClockEstimate {
  /** hub = local + offsetMs */
  offsetMs: number;
  /** Erro estimado (± ms). */
  uncertaintyMs: number;
  /** Atraso de ida e volta típico (ms). */
  rttMs: number;
  samples: number;
  source: 'ping' | 'eventos';
}

const median = (v: number[]) => {
  const s = [...v].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

export function offsetFromPing(p: PingSample): { offset: number; delay: number } {
  return { offset: (p.t1 - p.t0 + (p.t2 - p.t3)) / 2, delay: p.t3 - p.t0 - (p.t2 - p.t1) };
}

/** Estimativa com as medições de menor atraso (no mínimo 3, metade das amostras). */
export function estimateOffset(samples: PingSample[]): ClockEstimate | null {
  const ms = samples.map(offsetFromPing).filter((m) => Number.isFinite(m.offset) && m.delay >= 0);
  if (ms.length < 3) return null;
  ms.sort((a, b) => a.delay - b.delay);
  const best = ms.slice(0, Math.max(3, Math.ceil(ms.length / 2)));
  const offset = median(best.map((m) => m.offset));
  const mad = median(best.map((m) => Math.abs(m.offset - offset)));
  const minDelay = best[0].delay;
  return {
    offsetMs: offset,
    // metade do menor atraso limita a assimetria; o espalhamento (MAD×1,48 ≈ σ) soma
    uncertaintyMs: Math.hypot(minDelay / 2, 1.4826 * mad) + 0.5,
    rttMs: median(best.map((m) => m.delay)),
    samples: ms.length,
    source: 'ping',
  };
}

/**
 * Refina o deslocamento com eventos simultâneos. `hub` e `cam` são instantes
 * (ms) de eventos detectados em cada aparelho, `cam` já convertido para o
 * relógio do hub com o deslocamento atual. Casa cada evento da câmera com o
 * do hub mais próximo dentro de `windowMs` e devolve a correção (mediana das
 * diferenças) — ou null com menos de `minMatches` pares.
 */
export function refineWithEvents(hub: number[], cam: number[], windowMs = 40, minMatches = 3): { correctionMs: number; uncertaintyMs: number; matches: number } | null {
  if (!hub.length || !cam.length) return null;
  const h = [...hub].sort((a, b) => a - b);
  // 1ª passada: moda grosseira das diferenças (aguenta deslocamento inicial de até ±windowMs)
  const diffs: number[] = [];
  for (const c of cam) {
    let lo = 0, hi = h.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (h[mid] < c) lo = mid + 1;
      else hi = mid;
    }
    let best = Infinity;
    for (const k of [lo - 1, lo]) if (k >= 0 && k < h.length && Math.abs(h[k] - c) < Math.abs(best)) best = h[k] - c;
    if (Math.abs(best) <= windowMs) diffs.push(best);
  }
  if (diffs.length < minMatches) return null;
  // 2ª passada: só os pares perto da mediana (descarta casamentos errados)
  const m0 = median(diffs);
  const good = diffs.filter((d) => Math.abs(d - m0) <= Math.max(4, windowMs / 4));
  if (good.length < minMatches) return null;
  const corr = median(good);
  const mad = median(good.map((d) => Math.abs(d - corr)));
  return { correctionMs: corr, uncertaintyMs: (1.4826 * mad) / Math.sqrt(good.length) + 0.5, matches: good.length };
}
