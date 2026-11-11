import { describe, expect, it } from 'vitest';
import { extensionForMime, pickMimeType, pickVideoBitrate } from './mime';

describe('formato de gravação', () => {
  it('prefere webm vp9 no Chrome', () => {
    expect(pickMimeType(() => true, true)).toBe('video/webm;codecs=vp9,opus');
  });

  it('cai para mp4 no Safari', () => {
    const safari = (t: string) => t.startsWith('video/mp4');
    expect(pickMimeType(safari, true)).toBe('video/mp4;codecs=avc1.42E01E,mp4a.40.2');
    expect(pickMimeType(safari, false)).toBe('video/mp4;codecs=avc1.42E01E');
  });

  it('retorna undefined se nada é suportado (o navegador escolhe)', () => {
    expect(pickMimeType(() => false, true)).toBeUndefined();
    expect(pickMimeType(() => { throw new Error('x'); }, true)).toBeUndefined();
  });

  it('extensão do arquivo', () => {
    expect(extensionForMime('video/mp4;codecs=avc1')).toBe('mp4');
    expect(extensionForMime('video/webm')).toBe('webm');
  });

  it('bitrate: 720p60 ≈ 5,5 Mbps, limitado entre 2 e 12', () => {
    expect(pickVideoBitrate(1280, 720, 60)).toBe(5_529_600);
    expect(pickVideoBitrate(320, 240, 30)).toBe(2_000_000);
    expect(pickVideoBitrate(3840, 2160, 60)).toBe(12_000_000);
  });
});
