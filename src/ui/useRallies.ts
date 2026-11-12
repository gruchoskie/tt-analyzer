import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { BounceEvent, TableSide } from '../physics/bounce';
import { computeScore, RallyTracker, sideStats, summarizeRallies, type Rally } from '../physics/rally';
import type { FrameResult } from '../tracking/protocol';

/**
 * Rallies e placar estimado a partir dos quiques (useBounces) e da atividade
 * da bola (cada resultado do rastreio). O ganhador de cada ponto pode ser
 * corrigido tocando no rally; pontos manuais entram com "+1".
 */
export function useRallies(bounces: BounceEvent[], enabled: boolean) {
  const trRef = useRef(new RallyTracker());
  const fed = useRef(0);
  /** Fim pedido: fecha depois de receber os últimos quiques. */
  const flushPending = useRef(false);
  const [rallies, setRallies] = useState<Rally[]>([]);
  const [live, setLive] = useState<{ shots: number; startT: number } | null>(null);
  const [overrides, setOverrides] = useState<Record<number, TableSide | null>>({});
  const [manual, setManual] = useState<{ t: number; winner: TableSide }[]>([]);
  const [firstServer, setFirstServer] = useState<TableSide | null>(null);

  const reset = useCallback(() => {
    trRef.current = new RallyTracker();
    fed.current = 0;
    setRallies([]);
    setLive(null);
    setOverrides({});
    setManual([]);
    setFirstServer(null);
  }, []);

  const pushClosed = (r: Rally | null) => {
    if (r) setRallies((list) => [...list, r]);
  };

  // novos quiques entram no tracker (se a lista encolheu, foi zerada)
  useEffect(() => {
    if (!enabled) return;
    if (bounces.length < fed.current) {
      trRef.current = new RallyTracker();
      fed.current = 0;
      setRallies([]);
      setOverrides({});
      setLive(null);
    }
    for (; fed.current < bounces.length; fed.current++) pushClosed(trRef.current.bounce(bounces[fed.current]));
    if (flushPending.current) {
      flushPending.current = false;
      pushClosed(trRef.current.flush());
    }
    const l = trRef.current.live;
    setLive(l ? { shots: l.bounces.length, startT: l.startT } : null);
  }, [bounces, enabled]);

  const onFrame = useCallback((r: FrameResult) => {
    const closed = trRef.current.tick(r.meta.timestamp.hubMs, r.state === 'tracking' || r.state === 'coasting');
    if (closed) {
      setRallies((list) => [...list, closed]);
      setLive(null);
    }
  }, []);

  /** Fim do vídeo: fecha o rally em andamento (depois que os últimos quiques chegarem). */
  const flush = useCallback(() => {
    flushPending.current = true;
    const closed = trRef.current.flush();
    if (closed) setRallies((list) => [...list, closed]);
    setLive(null);
  }, []);

  /** Toque no rally: estimado → perto → longe → sem ponto → estimado. */
  const cycleWinner = useCallback((index: number) => {
    setOverrides((o) => {
      const cur = index in o ? o[index] : undefined;
      const next = { ...o };
      if (cur === undefined) next[index] = 'perto';
      else if (cur === 'perto') next[index] = 'longe';
      else if (cur === 'longe') next[index] = null;
      else delete next[index];
      return next;
    });
  }, []);

  const addPoint = useCallback((winner: TableSide, t: number) => setManual((m) => [...m, { t, winner }]), []);
  const undoPoint = useCallback(() => setManual((m) => m.slice(0, -1)), []);

  const winners = useMemo(() => rallies.map((r) => (r.index in overrides ? overrides[r.index] : r.winner)), [rallies, overrides]);
  const derived = useMemo(() => {
    const all = [...rallies.map((r, i) => ({ t: r.endT, w: winners[i] })), ...manual.map((m) => ({ t: m.t, w: m.winner as TableSide | null }))].sort((a, b) => a.t - b.t);
    const server = firstServer ?? rallies.find((r) => r.server)?.server ?? null;
    return {
      score: computeScore(all.map((x) => x.w), server),
      summary: summarizeRallies(rallies),
      bySide: sideStats(rallies, winners),
    };
  }, [rallies, winners, manual, firstServer]);

  return { rallies, winners, live, ...derived, manual, onFrame, flush, reset, cycleWinner, addPoint, undoPoint, overrides, setFirstServer };
}
