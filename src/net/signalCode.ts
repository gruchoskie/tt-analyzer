/**
 * Códigos de pareamento (sinalização manual do WebRTC, sem servidor).
 * A oferta (hub → câmera) e a resposta (câmera → hub) viajam como texto curto
 * ou QR code: SDP sem linhas dispensáveis, comprimido (deflate) e em base64url.
 */
export type SignalKind = 'oferta' | 'resposta';

const PREFIX: Record<SignalKind, string> = { oferta: 'TTO1.', resposta: 'TTR1.' };

/** Remove linhas que o navegador não precisa para conectar no canal de dados. */
export function slimSdp(sdp: string): string {
  return sdp
    .split(/\r?\n/)
    .filter((l) => l && !/^a=(extmap|rtcp-fb|ssrc|msid-semantic|ice-options)/.test(l))
    .join('\r\n') + '\r\n';
}

const b64url = (u8: Uint8Array) => {
  let s = '';
  for (let i = 0; i < u8.length; i++) s += String.fromCharCode(u8[i]);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};
const unb64url = (s: string) => {
  const b = atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4));
  const u = new Uint8Array(b.length);
  for (let i = 0; i < b.length; i++) u[i] = b.charCodeAt(i);
  return u;
};

async function pipe(data: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const out = new Response(new Blob([data]).stream().pipeThrough(stream));
  return new Uint8Array(await out.arrayBuffer());
}

export async function encodeSignal(kind: SignalKind, sdp: string): Promise<string> {
  const raw = new TextEncoder().encode(slimSdp(sdp));
  const z = await pipe(raw, new CompressionStream('deflate-raw'));
  return PREFIX[kind] + b64url(z);
}

export async function decodeSignal(code: string): Promise<{ kind: SignalKind; sdp: string }> {
  const c = code.trim().replace(/\s+/g, '');
  const kind = (Object.keys(PREFIX) as SignalKind[]).find((k) => c.startsWith(PREFIX[k]));
  if (!kind) throw new Error('Código inválido: não parece um código do TT Analyzer.');
  try {
    const raw = await pipe(unb64url(c.slice(PREFIX[kind].length)), new DecompressionStream('deflate-raw'));
    const sdp = new TextDecoder().decode(raw);
    if (!sdp.startsWith('v=0')) throw new Error();
    return { kind, sdp };
  } catch {
    throw new Error('Código incompleto ou corrompido. Copie de novo.');
  }
}
