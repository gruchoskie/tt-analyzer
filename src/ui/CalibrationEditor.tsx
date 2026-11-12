import { useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { checkCorners, createCalibration, estimateCamera, orderCorners, OUTSIDE_MARGIN, rescaleCalibration, type Quad } from '../calibration/calibrate';
import { NET_POSTS_M } from '../calibration/table';
import { NET_HEIGHT_M } from '../physics/constants';
import { projectP } from '../fusion/geom3d';
import { rotateCorners } from '../fusion/cameraPose';
import { CORNER_NAMES } from '../calibration/table';
import { detectTable, isTableDetection, TABLE_DETECTION_MESSAGES } from '../calibration/autoDetect';
import { grabFrame } from './frameGrab';
import type { TableCalibration } from '../calibration/types';
import { elementToVideo, videoToElement } from '../calibration/viewport';
import type { CameraId, Point2 } from '../core/types';
import { TableOverlay } from './TableOverlay';
import type { VideoBox } from './useVideoBox';

const LOUPE_SIZE = 132;
const LOUPE_ZOOM = 3;
const HANDLE_HIT_PX = 44;

interface Drag {
  index: number;
  pointerId: number;
  startPointer: Point2;
  startPoint: Point2;
}

/**
 * Marcação dos 4 cantos da mesa sobre o vídeo (ao vivo ou pausado).
 * Toque para marcar cada canto; depois arraste para ajustar com a lupa.
 */
export function CalibrationEditor({
  videoRef,
  box,
  cameraId,
  initial,
  onSave,
  onCancel,
}: {
  videoRef: RefObject<HTMLVideoElement>;
  box: VideoBox | null;
  cameraId: CameraId;
  initial: TableCalibration | null;
  onSave: (cal: TableCalibration) => void;
  onCancel: () => void;
}) {
  const [points, setPoints] = useState<Point2[]>([]);
  /** Fase 9: topo dos postes da rede (calibração 3D, opcional). */
  const [posts, setPosts] = useState<Point2[] | null>(null);
  const all = posts ? [...points, ...posts] : points;
  const [autoMsg, setAutoMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const prefilled = useRef(false);

  const autoDetect = () => {
    const v = videoRef.current;
    if (!v) return;
    const f = grabFrame(v, 400);
    if (!f) return;
    const r = detectTable(f.rgba, f.width, f.height);
    if (isTableDetection(r)) {
      setPoints(r.corners.map((p) => ({ x: p.x / f.scale, y: p.y / f.scale })));
      setAutoMsg({
        ok: true,
        text: r.outside.length
          ? 'Mesa encontrada, mas cortada: o canto fora do quadro foi estimado pelas bordas. Confira com a lupa; se puder, afaste o celular.'
          : 'Mesa encontrada. Confira os 4 pontos com a lupa e ajuste se precisar.',
      });
    } else {
      setAutoMsg({ ok: false, text: TABLE_DETECTION_MESSAGES[r.reason] });
    }
  };

  // Começa da calibração anterior (se houver e servir para esta resolução);
  // senão, tenta achar a mesa sozinho.
  useEffect(() => {
    if (prefilled.current || !box) return;
    prefilled.current = true;
    const cal = initial ? rescaleCalibration(initial, box.videoW, box.videoH) : null;
    if (cal) {
      setPoints([...cal.cornersPx]);
      if (cal.netPostsPx) setPosts([...cal.netPostsPx]);
    } else autoDetect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [box, initial]);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [loupeAt, setLoupeAt] = useState<Point2 | null>(null);
  const loupeRef = useRef<HTMLCanvasElement>(null);
  const layerRef = useRef<HTMLDivElement>(null);

  const complete = points.length === 4;
  const check = useMemo(
    () => (complete && box ? checkCorners(points as Quad, box.videoW, box.videoH) : null),
    [complete, points, box],
  );
  const preview = useMemo(() => {
    if (!complete || !box || !check?.ok) return null;
    try {
      const cal = createCalibration(cameraId, points as Quad, box.videoW, box.videoH);
      return posts ? { ...cal, netPostsPx: [posts[0], posts[1]] as [Point2, Point2] } : cal;
    } catch {
      return null;
    }
  }, [complete, box, check, cameraId, points, posts]);

  /** Postes: chute inicial pela câmera estimada (topo a 15,25 cm do tampo); o usuário ajusta. */
  const addPosts = () => {
    if (!complete || !box) return;
    const est = estimateCamera(points as Quad, box.videoW, box.videoH);
    if (!est) return;
    setPosts(NET_POSTS_M.map((p) => projectP(est.P, { x: p.x, y: p.y, z: NET_HEIGHT_M })));
  };

  // Lupa: recorte ampliado do vídeo ao redor do ponto sendo marcado.
  useEffect(() => {
    const c = loupeRef.current;
    const v = videoRef.current;
    if (!c || !v || !loupeAt) return;
    let raf = 0;
    const draw = () => {
      const ctx = c.getContext('2d');
      if (ctx) {
        const dpr = window.devicePixelRatio || 1;
        c.width = LOUPE_SIZE * dpr;
        c.height = LOUPE_SIZE * dpr;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        const src = LOUPE_SIZE / LOUPE_ZOOM / (box?.t.scale ?? 1);
        ctx.imageSmoothingEnabled = false;
        ctx.fillStyle = '#000';
        ctx.fillRect(0, 0, LOUPE_SIZE, LOUPE_SIZE);
        try {
          ctx.drawImage(v, loupeAt.x - src / 2, loupeAt.y - src / 2, src, src, 0, 0, LOUPE_SIZE, LOUPE_SIZE);
        } catch {
          /* quadro ainda indisponível */
        }
        ctx.strokeStyle = '#ffb020';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(LOUPE_SIZE / 2, 0);
        ctx.lineTo(LOUPE_SIZE / 2, LOUPE_SIZE);
        ctx.moveTo(0, LOUPE_SIZE / 2);
        ctx.lineTo(LOUPE_SIZE, LOUPE_SIZE / 2);
        ctx.stroke();
      }
      raf = requestAnimationFrame(draw);
    };
    draw();
    return () => cancelAnimationFrame(raf);
  }, [loupeAt, videoRef, box]);

  if (!box) return null;

  const toVideo = (e: React.PointerEvent): Point2 => {
    const r = layerRef.current!.getBoundingClientRect();
    return elementToVideo(box.t, { x: e.clientX - r.left, y: e.clientY - r.top });
  };
  // um canto pode ficar um pouco fora do quadro (mesa cortada na borda)
  const clamp = (p: Point2): Point2 => ({
    x: Math.min(Math.max(p.x, -OUTSIDE_MARGIN * box.videoW), box.videoW * (1 + OUTSIDE_MARGIN)),
    y: Math.min(Math.max(p.y, -OUTSIDE_MARGIN * box.videoH), box.videoH * (1 + OUTSIDE_MARGIN)),
  });

  // Canto fora do quadro: a alça fica presa na borda da imagem (dá para pegar).
  const handlePos = (p: Point2): Point2 => {
    const q = videoToElement(box.t, p);
    return { x: Math.min(Math.max(q.x, 0), box.elW), y: Math.min(Math.max(q.y, 0), box.elH) };
  };

  const onPointerDown = (e: React.PointerEvent) => {
    const p = toVideo(e);
    const r = layerRef.current!.getBoundingClientRect();
    const pe = { x: e.clientX - r.left, y: e.clientY - r.top };
    // Perto de um canto já marcado: começa a arrastar.
    let best = -1;
    let bestD = Infinity;
    all.forEach((q, i) => {
      const h = handlePos(q);
      const d = Math.hypot(h.x - pe.x, h.y - pe.y);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    });
    if (best >= 0 && bestD <= HANDLE_HIT_PX) {
      layerRef.current?.setPointerCapture(e.pointerId);
      setDrag({ index: best, pointerId: e.pointerId, startPointer: p, startPoint: all[best] });
      setLoupeAt(all[best]);
      return;
    }
    if (points.length < 4) {
      const next = [...points, clamp(p)];
      setPoints(next.length === 4 ? orderCorners(next, box.videoW, box.videoH) : next);
    }
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!drag || e.pointerId !== drag.pointerId) return;
    const p = toVideo(e);
    // Move pelo deslocamento (o dedo não cobre o ponto).
    const moved = clamp({ x: drag.startPoint.x + (p.x - drag.startPointer.x), y: drag.startPoint.y + (p.y - drag.startPointer.y) });
    if (drag.index >= 4) setPosts((prev) => prev && prev.map((q, i) => (i === drag.index - 4 ? moved : q)));
    else setPoints((prev) => prev.map((q, i) => (i === drag.index ? moved : q)));
    setLoupeAt(moved);
  };

  const endDrag = () => {
    setDrag(null);
    setLoupeAt(null);
  };

  const loupePos = loupeAt ? videoToElement(box.t, loupeAt) : null;
  const nextName = points.length < 4 ? CORNER_NAMES[points.length] : null;

  return (
    <div className="calib">
      <TableOverlay box={box} calibration={preview} />
      <div
        ref={layerRef}
        className="calib-layer"
        style={{ left: box.left, top: box.top, width: box.elW, height: box.elH }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      >
        {complete && (
          <svg className="calib-quad" width={box.elW} height={box.elH} aria-hidden>
            <polygon
              points={points
                .map((p) => videoToElement(box.t, p))
                .map((p) => `${p.x},${p.y}`)
                .join(' ')}
            />
          </svg>
        )}
        {points.map((p, i) => {
          const q = handlePos(p);
          const off = p.x < 0 || p.y < 0 || p.x > box.videoW || p.y > box.videoH;
          return (
            <div
              key={i}
              className={`calib-handle ${drag?.index === i ? 'active' : ''} ${off ? 'off' : ''}`}
              style={{ left: q.x, top: q.y }}
              title={off ? 'Canto fora da imagem (estimado)' : undefined}
            >
              <span>{i + 1}</span>
            </div>
          );
        })}
        {posts?.map((p, i) => {
          const q = handlePos(p);
          return (
            <div key={`post${i}`} className={`calib-handle post ${drag?.index === 4 + i ? 'active' : ''}`} style={{ left: q.x, top: q.y }} title="Topo do poste da rede">
              <span>R</span>
            </div>
          );
        })}
        {loupePos && (
          <canvas
            ref={loupeRef}
            className="calib-loupe"
            style={{
              width: LOUPE_SIZE,
              height: LOUPE_SIZE,
              left: Math.min(Math.max(loupePos.x - LOUPE_SIZE / 2, 4), box.elW - LOUPE_SIZE - 4),
              top: loupePos.y - LOUPE_SIZE - 40 < 4 ? loupePos.y + 40 : loupePos.y - LOUPE_SIZE - 40,
            }}
          />
        )}
      </div>

      <div className="calib-panel">
        {nextName ? (
          <p className="calib-step">
            Toque no canto <strong>{points.length + 1}</strong>: <strong>{nextName}</strong> da mesa
          </p>
        ) : (
          <p className="calib-step">Arraste os pontos para ajustar. A lupa ajuda a acertar a quina.</p>
        )}
        {autoMsg && <p className={`small ${autoMsg.ok ? 'ok-text' : 'warn-text'}`}>{autoMsg.text}</p>}
        {posts && <p className="small">Arraste os pontos "R" até o <strong>topo de cada poste da rede</strong> (usados na calibração 3D com 2+ celulares).</p>}
        {check?.errors.map((m) => (
          <p key={m} className="error-text small">
            {m}
          </p>
        ))}
        {check?.warnings.map((m) => (
          <p key={m} className="warn-text small">
            {m}
          </p>
        ))}
        <div className="row">
          <button className="btn" onClick={onCancel}>
            Cancelar
          </button>
          <button
            className="btn"
            onClick={() => {
              setPoints([]);
              setAutoMsg(null);
            }}
            disabled={points.length === 0}
          >
            Refazer
          </button>
          <button className="btn" onClick={autoDetect}>
            Detectar mesa
          </button>
          {complete && (
            <button className="btn" onClick={() => (posts ? setPosts(null) : addPosts())}>
              {posts ? 'Sem postes' : 'Postes da rede (3D)'}
            </button>
          )}
          {complete && (
            <button className="btn" onClick={() => setPoints((p) => rotateCorners(p as Quad, 1))} title="Com 2+ celulares, todos precisam chamar de 'perto' a mesma cabeceira (a do hub)">
              Girar rótulos
            </button>
          )}
          <button className="btn btn-primary" disabled={!preview} onClick={() => preview && onSave(preview)}>
            Salvar
          </button>
        </div>
      </div>
    </div>
  );
}
