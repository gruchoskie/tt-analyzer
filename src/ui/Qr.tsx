import { useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';

/** QR code de um texto (código de pareamento), com botão de copiar/compartilhar. */
export function QrCode({ text, label }: { text: string; label: string }) {
  const [url, setUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    let alive = true;
    QRCode.toDataURL(text, { errorCorrectionLevel: 'L', margin: 2, width: 320 })
      .then((u) => alive && setUrl(u))
      .catch(() => alive && setUrl(null));
    return () => {
      alive = false;
    };
  }, [text]);
  const share = async () => {
    try {
      if (navigator.share) await navigator.share({ text });
      else {
        await navigator.clipboard.writeText(text);
        setCopied(true);
      }
    } catch {
      try {
        await navigator.clipboard.writeText(text);
        setCopied(true);
      } catch {
        /* sem permissão */
      }
    }
  };
  return (
    <div className="qr">
      {url ? <img src={url} alt={label} width={260} height={260} /> : <p className="small muted">Gerando QR…</p>}
      <div className="row">
        <button className="btn btn-small" onClick={share}>
          {copied ? 'Copiado' : 'Copiar / enviar código'}
        </button>
      </div>
      <code className="qr-text">{text}</code>
    </div>
  );
}

type Detector = { detect(src: CanvasImageSource): Promise<{ rawValue: string }[]> };

/** Lê um código pela câmera (BarcodeDetector, Chrome/Android) ou colado à mão. */
export function CodeReader({ onCode, prompt }: { onCode: (code: string) => void; prompt: string }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [scanning, setScanning] = useState(false);
  const [text, setText] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const supported = typeof window !== 'undefined' && 'BarcodeDetector' in window;

  useEffect(() => {
    if (!scanning) return;
    let stream: MediaStream | null = null;
    let timer = 0;
    let stop = false;
    void (async () => {
      try {
        const Ctor = (window as unknown as { BarcodeDetector: new (o: { formats: string[] }) => Detector }).BarcodeDetector;
        const det = new Ctor({ formats: ['qr_code'] });
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
        const v = videoRef.current!;
        v.srcObject = stream;
        await v.play();
        const tick = async () => {
          if (stop) return;
          try {
            const r = await det.detect(v);
            const hit = r.find((x) => x.rawValue.startsWith('TT'));
            if (hit) {
              setScanning(false);
              onCode(hit.rawValue);
              return;
            }
          } catch {
            /* quadro ruim */
          }
          timer = window.setTimeout(tick, 250);
        };
        void tick();
      } catch (e) {
        setErr(`Não deu para abrir a câmera para ler o QR: ${(e as Error).message}`);
        setScanning(false);
      }
    })();
    return () => {
      stop = true;
      window.clearTimeout(timer);
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [scanning, onCode]);

  return (
    <div className="code-reader">
      <p className="small">{prompt}</p>
      {scanning && <video ref={videoRef} className="qr-video" playsInline muted />}
      <div className="row">
        {supported && (
          <button className="btn btn-primary" onClick={() => setScanning((s) => !s)}>
            {scanning ? 'Parar leitura' : 'Ler QR com a câmera'}
          </button>
        )}
      </div>
      <textarea className="code-input" placeholder="…ou cole o código aqui" value={text} onChange={(e) => setText(e.target.value)} rows={3} />
      <button className="btn" disabled={!text.trim()} onClick={() => onCode(text.trim())}>
        Usar código colado
      </button>
      {err && <p className="small error-text">{err}</p>}
    </div>
  );
}
