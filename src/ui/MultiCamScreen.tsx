import { useCallback, useMemo, useState, useSyncExternalStore } from 'react';
import { localNowMs } from '../core/clock';
import type { FlightMetrics } from '../fusion/metrics3d';
import { cameraLink } from '../net/cameraLink';
import { hub } from '../net/hub';
import { PeerLink } from '../net/PeerLink';
import { CodeReader, QrCode } from './Qr';
import { navigate } from './route';
import { Table3D } from './Table3D';

const fmt = (v: number, d = 0) => v.toFixed(d).replace('.', ',');

function SpinText({ f }: { f: FlightMetrics }) {
  const s = f.spin;
  if (s.kind === 'indefinido') return <>indefinido</>;
  if (s.kind === 'pouco efeito') return <>pouco efeito</>;
  return (
    <>
      {s.kind}
      {s.side ? ` para a ${s.side}` : ''} {s.strength}
    </>
  );
}

/** Fase 9: parear celulares (hub + câmeras), sincronia, calibração 3D e a mesa 3D. */
export function MultiCamScreen() {
  const [role, setRole] = useState<'escolher' | 'hub' | 'camera'>(() => (hub.active ? 'hub' : cameraLink.connected ? 'camera' : 'escolher'));
  if (!PeerLink.supported())
    return (
      <div className="page">
        <p>Este navegador não tem WebRTC/compressão: use o Chrome atualizado para o modo com vários celulares.</p>
        <button className="btn" onClick={() => navigate({ name: 'camera' })}>
          ← Câmera
        </button>
      </div>
    );
  return (
    <div className="page multicam">
      <header className="page-header">
        <button className="btn" onClick={() => navigate({ name: 'camera' })}>
          ← Câmera
        </button>
        <h1>Vários celulares (3D)</h1>
      </header>
      {role === 'escolher' && (
        <section className="card">
          <p>
            Um celular é o <strong>hub</strong> (junta tudo e mostra o 3D; ele também filma). Os outros são <strong>câmeras</strong>. Use a
            mesma rede Wi-Fi. Cada câmera precisa da mesa calibrada; para o 3D, marque também os postes da rede e use os mesmos rótulos
            de "perto" do hub (botão "Girar rótulos" na calibração).
          </p>
          <div className="row">
            <button className="btn btn-primary" onClick={() => setRole('hub')}>
              Este celular é o hub
            </button>
            <button className="btn" onClick={() => setRole('camera')}>
              Este celular é uma câmera
            </button>
          </div>
        </section>
      )}
      {role === 'hub' && <HubView />}
      {role === 'camera' && <CameraView />}
      <p className="small muted">
        Limitações: a sincronia entre celulares tem erro de alguns milissegundos (mostrado em cada câmera); a palma melhora. O efeito
        (spin) é só uma estimativa pela curva da trajetória 3D. Se uma câmera cair ou perder a bola, o hub segue com as outras e volta
        ao modo 2D com 1 câmera só.
      </p>
    </div>
  );
}

function HubView() {
  const s = useSyncExternalStore(hub.subscribe, hub.snapshot);
  const [pairing, setPairing] = useState<{ code: string; accept: (a: string) => Promise<void>; cancel: () => void } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const now = localNowMs();

  const add = async () => {
    setErr(null);
    setBusy(true);
    try {
      setPairing(await hub.addCamera());
    } catch (e) {
      setErr((e as Error).message);
    }
    setBusy(false);
  };
  const onAnswer = useCallback(
    async (code: string) => {
      if (!pairing) return;
      try {
        await pairing.accept(code);
        setPairing(null);
      } catch (e) {
        setErr((e as Error).message);
      }
    },
    [pairing],
  );

  const trail = useMemo(() => s.recent.map((x) => x.p), [s.recent]);
  const camMarks = useMemo(
    () =>
      [s.local.model, ...s.cams.map((c) => c.model)]
        .filter((m): m is NonNullable<typeof m> => !!m)
        .map((m, i) => ({ p: m.position, label: String(i) })),
    [s.local.model, s.cams],
  );
  const statusOf = (id: string | null) => s.status.find((x) => x.cameraId === id);
  const last = s.flights[s.flights.length - 1];
  const q = (x: string | null) => (x === 'boa' ? 'ok-text' : x === 'aceitável' ? 'warn-text' : 'error-text');

  return (
    <>
      <section className="card">
        <div className="row">
          <strong className={s.mode === '3d' ? 'ok-text' : 'warn-text'}>Modo {s.mode.toUpperCase()}</strong>
          <span className="small muted">{s.mode === '3d' ? 'triangulando com 2+ câmeras calibradas' : 'precisa de 2+ câmeras vivas e calibradas em 3D'}</span>
        </div>
        <table className="shot-list">
          <thead>
            <tr>
              <th>Câmera</th>
              <th>Conexão</th>
              <th>fps</th>
              <th>Sinal</th>
              <th>Sincronia</th>
              <th>Calibração 3D</th>
              <th>Bola</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Este celular (hub)</td>
              <td>{now - s.local.lastSeen < 1500 ? 'filmando' : 'abra a câmera'}</td>
              <td>—</td>
              <td>—</td>
              <td>referência</td>
              <td className={q(s.local.quality)}>{s.local.model ? `${s.local.quality} (${fmt(s.local.model.maxPx, 1)} px)` : 'calibre a mesa'}</td>
              <td>{statusOf(s.local.cameraId)?.detections ?? 0}</td>
            </tr>
            {s.cams.map((c) => {
              const st = statusOf(c.cameraId);
              return (
                <tr key={c.key}>
                  <td>{c.label}</td>
                  <td>{c.state}{c.video ? ` · recebendo vídeo ${Math.round((100 * c.video.got) / Math.max(1, c.video.size))}%` : ''}</td>
                  <td>{c.stats ? `${fmt(c.stats.fps)} (análise ${fmt(c.stats.analysisFps)})` : '—'}</td>
                  <td>{c.rttMs !== null ? `${fmt(c.rttMs)} ms ${c.rttMs < 30 ? 'bom' : c.rttMs < 80 ? 'ok' : 'fraco'}` : '—'}</td>
                  <td>{c.sync ? `± ${fmt(c.sync.uncertaintyMs, 1)} ms${c.sync.source === 'eventos' ? ' (palma)' : ''}` : 'medindo…'}</td>
                  <td className={q(c.quality)}>{c.model ? `${c.quality} (${fmt(c.model.maxPx, 1)} px)` : 'sem calibração'}</td>
                  <td>
                    {st ? `${st.detections}${st.rejected ? ` · ${st.rejected} descartadas` : ''}` : '—'}{' '}
                    <button className="btn btn-small" onClick={() => hub.remove(c.key)}>
                      Remover
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {s.cams.some((c) => c.quality === 'alta') && <p className="small error-text">Erro de reprojeção alto: refaça a calibração dessa câmera (cantos e postes da rede).</p>}
        {s.notice && <p className="small">{s.notice}</p>}
        <div className="row">
          <button className="btn btn-primary" onClick={add} disabled={busy || !!pairing}>
            {busy ? 'Gerando código…' : 'Adicionar câmera'}
          </button>
          <button className="btn" onClick={() => hub.startClap()} disabled={!s.cams.length}>
            Sincronizar com palma
          </button>
          <button className="btn" onClick={() => navigate({ name: 'camera' })}>
            Abrir a câmera do hub
          </button>
        </div>
        {s.clap && (s.clap.result ? <p className="small">{s.clap.result}</p> : <p className="small warn-text">Bata uma palma forte perto da mesa (2 ou 3 vezes, com 1 s entre elas)…</p>)}
        {err && <p className="small error-text">{err}</p>}
      </section>

      {pairing && (
        <section className="card pairing">
          <h3>1. Na câmera, leia este código</h3>
          <QrCode text={pairing.code} label="Código do hub" />
          <h3>2. Depois leia aqui o código que aparecer na câmera</h3>
          <CodeReader prompt="Código de resposta da câmera:" onCode={onAnswer} />
          <button
            className="btn"
            onClick={() => {
              pairing.cancel();
              setPairing(null);
            }}
          >
            Cancelar
          </button>
        </section>
      )}

      <section className="card">
        <h3>Trajetória 3D</h3>
        <Table3D trail={trail} cameras={camMarks} />
        {last ? (
          <div className="kpis">
            <div className="kpi">
              <span>Velocidade 3D</span>
              <strong>{fmt(last.startKmh)} km/h</strong>
              <small>saída · média {fmt(last.avgKmh)} · chegada {fmt(last.endKmh)}</small>
            </div>
            <div className="kpi">
              <span>Sobre a rede</span>
              <strong>{last.netClearanceM !== null ? `${fmt(last.netClearanceM * 100)} cm` : '—'}</strong>
              <small>ponto mais alto {fmt(last.apexM * 100)} cm</small>
            </div>
            <div className="kpi">
              <span>Ângulos de saída</span>
              <strong>{fmt(last.launchVertDeg)}°</strong>
              <small>vertical · horizontal {fmt(last.launchHorizDeg)}°</small>
            </div>
            <div className="kpi">
              <span>Efeito (estimativa)</span>
              <strong>
                <SpinText f={last} />
              </strong>
              <small>
                Magnus {fmt(last.spin.upG, 2)} g vertical, {fmt(last.spin.sideG, 2)} g lateral
              </small>
            </div>
          </div>
        ) : (
          <p className="small muted">Os voos aparecem aqui quando 2+ câmeras calibradas veem a bola ao mesmo tempo.</p>
        )}
        {s.flights.length > 1 && (
          <table className="shot-list">
            <thead>
              <tr>
                <th>Voo</th>
                <th>Saída / média (3D)</th>
                <th>Rede</th>
                <th>Altura máx</th>
                <th>Ângulo</th>
                <th>Efeito*</th>
              </tr>
            </thead>
            <tbody>
              {s.flights
                .slice()
                .reverse()
                .slice(0, 12)
                .map((f) => (
                  <tr key={f.t0}>
                    <td>{fmt(f.points)} pts</td>
                    <td>
                      {fmt(f.startKmh)} / {fmt(f.avgKmh)} km/h
                    </td>
                    <td>{f.netClearanceM !== null ? `${fmt(f.netClearanceM * 100)} cm` : '—'}</td>
                    <td>{fmt(f.apexM * 100)} cm</td>
                    <td>{fmt(f.launchVertDeg)}°</td>
                    <td>
                      <SpinText f={f} />
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        )}
        <p className="small muted">
          Comparação 2D × 3D: a velocidade média por jogada do modo 2D (painel da câmera) usa uma parábola vista por 1 câmera; aqui a
          posição vem da triangulação, então altura, rede e ângulos são medidos de verdade (com o erro de sincronia e calibração).
        </p>
      </section>
    </>
  );
}

function CameraView() {
  const s = useSyncExternalStore(cameraLink.subscribe, cameraLink.snapshot);
  const [answer, setAnswer] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const onOffer = useCallback(async (code: string) => {
    setErr(null);
    try {
      setAnswer(await cameraLink.join(code));
    } catch (e) {
      setErr((e as Error).message);
    }
  }, []);
  const connected = s.state === 'conectado';
  return (
    <section className="card">
      <div className="row">
        <strong className={connected ? 'ok-text' : 'warn-text'}>{connected ? 'Conectado ao hub' : s.state === 'desligado' ? 'Sem hub' : s.state}</strong>
        {s.clock && (
          <span className="small">
            sincronia ± {fmt(s.clock.uncertaintyMs, 1)} ms · ida e volta {fmt(s.clock.rttMs)} ms
          </span>
        )}
      </div>
      {!connected && !answer && <CodeReader prompt="Leia o QR que aparece no hub (Adicionar câmera):" onCode={onOffer} />}
      {!connected && answer && (
        <>
          <h3>Agora mostre este código para o hub</h3>
          <QrCode text={answer} label="Código de resposta" />
          <button className="btn" onClick={() => setAnswer(null)}>
            Ler outro código do hub
          </button>
        </>
      )}
      {connected && (
        <>
          <p className="small">
            Abra a câmera, calibre a mesa (com os postes da rede e o mesmo "perto" do hub) e deixe o celular no tripé. As detecções vão
            para o hub; quando o hub gravar, este celular grava junto e manda o vídeo no fim.
          </p>
          <div className="row">
            <button className="btn btn-primary" onClick={() => navigate({ name: 'camera' })}>
              Abrir a câmera
            </button>
            <button className="btn" onClick={() => cameraLink.leave()}>
              Desconectar
            </button>
          </div>
        </>
      )}
      {s.sending && <p className="small">Enviando vídeo ao hub: {Math.round((100 * s.sending.sent) / s.sending.size)}%</p>}
      {s.notice && <p className="small">{s.notice}</p>}
      {err && <p className="small error-text">{err}</p>}
    </section>
  );
}
