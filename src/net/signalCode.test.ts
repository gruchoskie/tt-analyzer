import { describe, expect, it } from 'vitest';
import { decodeSignal, encodeSignal, slimSdp } from './signalCode';

const SDP = [
  'v=0',
  'o=- 4611731400430051336 2 IN IP4 127.0.0.1',
  's=-',
  't=0 0',
  'a=group:BUNDLE 0',
  'a=extmap-allow-mixed',
  'a=msid-semantic: WMS',
  'm=application 9 UDP/DTLS/SCTP webrtc-datachannel',
  'c=IN IP4 0.0.0.0',
  'a=candidate:1 1 udp 2113937151 3f2a1c9e-0e2b-4b0e-9a54-8f6f3b2f9a1c.local 54400 typ host generation 0 network-cost 999',
  'a=candidate:2 1 udp 1677729535 177.10.20.30 54400 typ srflx raddr 0.0.0.0 rport 0 generation 0 network-cost 999',
  'a=ice-ufrag:7hYb',
  'a=ice-pwd:Qy6m3aTq1aZb2Y0nR4vF8kLm',
  'a=ice-options:trickle',
  'a=fingerprint:sha-256 0A:1B:2C:3D:4E:5F:60:71:82:93:A4:B5:C6:D7:E8:F9:0A:1B:2C:3D:4E:5F:60:71:82:93:A4:B5:C6:D7:E8:F9',
  'a=setup:actpass',
  'a=mid:0',
  'a=sctp-port:5000',
  'a=max-message-size:262144',
  '',
].join('\r\n');

describe('códigos de pareamento', () => {
  it('ida e volta, e cabe folgado num QR', async () => {
    const code = await encodeSignal('oferta', SDP);
    expect(code.startsWith('TTO1.')).toBe(true);
    expect(code.length).toBeLessThan(900);
    const back = await decodeSignal(`  ${code}\n`);
    expect(back.kind).toBe('oferta');
    expect(back.sdp).toBe(slimSdp(SDP));
    expect(back.sdp).toContain('a=fingerprint:sha-256');
    expect(back.sdp).not.toContain('ice-options');
  });

  it('resposta e erros claros', async () => {
    expect((await decodeSignal(await encodeSignal('resposta', SDP))).kind).toBe('resposta');
    await expect(decodeSignal('qualquer coisa')).rejects.toThrow(/inválido/);
    const code = await encodeSignal('oferta', SDP);
    await expect(decodeSignal(code.slice(0, 40))).rejects.toThrow(/incompleto/);
  });
});
