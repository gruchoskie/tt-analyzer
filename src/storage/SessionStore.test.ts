import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SessionStore } from './SessionStore';
import type { SessionCamera, SessionRecord } from './types';

let store: SessionStore;
let dbn = 0;

function cam(over: Partial<SessionCamera> = {}): SessionCamera {
  return {
    cameraId: 'cam-a', label: 'Traseira', width: 1280, height: 720, measuredFps: 59.8, mimeType: 'video/webm',
    hasAudio: true, durationMs: 0, sizeBytes: 0, chunkCount: 0, clockOffsetMs: 0, startedAtHubMs: 0, ...over,
  };
}

function session(id: string, createdAt: number, over: Partial<SessionRecord> = {}): SessionRecord {
  return {
    id, name: `Sessão ${id}`, createdAt, updatedAt: createdAt, status: 'complete', mode: '2d', role: 'standalone',
    hubCameraId: 'cam-a', cameras: [cam()], calibrations: {}, ...over,
  };
}

beforeEach(async () => {
  store = await SessionStore.open(`test-${dbn++}`);
});
afterEach(() => store.close());

describe('SessionStore', () => {
  it('cria, lê e lista da mais recente para a mais antiga', async () => {
    await store.create(session('a', 1));
    await store.create(session('b', 3));
    await store.create(session('c', 2));
    expect((await store.get('a'))?.name).toBe('Sessão a');
    expect((await store.list()).map((s) => s.id)).toEqual(['b', 'c', 'a']);
  });

  it('salva pedaços de vídeo e remonta na ordem', async () => {
    await store.create(session('a', 1));
    await store.appendChunk('a', 'cam-a', 2, new Blob(['C']));
    await store.appendChunk('a', 'cam-a', 0, new Blob(['A']));
    await store.appendChunk('a', 'cam-a', 1, new Blob(['B']));
    await store.appendChunk('a', 'cam-b', 0, new Blob(['X']));
    const v = await store.getVideo('a', 'cam-a', 'video/webm');
    expect(v?.type).toBe('video/webm');
    expect(await v?.text()).toBe('ABC');
    expect(await (await store.getVideo('a', 'cam-b', 'video/webm'))?.text()).toBe('X');
    expect(await store.getVideo('a', 'cam-z', 'video/webm')).toBeNull();
    expect(await store.chunkStats('a', 'cam-a')).toEqual({ count: 3, bytes: 3 });
  });

  it('atualiza e acrescenta câmeras (multi-câmera)', async () => {
    await store.create(session('a', 1));
    await store.upsertCamera('a', cam({ durationMs: 5000 }));
    await store.upsertCamera('a', cam({ cameraId: 'cam-b' }));
    const s = await store.get('a');
    expect(s?.cameras.map((c) => c.cameraId)).toEqual(['cam-a', 'cam-b']);
    expect(s?.cameras[0].durationMs).toBe(5000);
    await store.rename('a', '  ');
    expect((await store.get('a'))?.name).toBe('Sessão sem nome');
  });

  it('apaga sessão e seus vídeos, sem tocar nas outras', async () => {
    await store.create(session('a', 1));
    await store.create(session('b', 2));
    await store.appendChunk('a', 'cam-a', 0, new Blob(['A']));
    await store.appendChunk('b', 'cam-a', 0, new Blob(['B']));
    await store.delete('a');
    expect(await store.get('a')).toBeUndefined();
    expect(await store.getVideo('a', 'cam-a', '')).toBeNull();
    expect(await (await store.getVideo('b', 'cam-a', ''))?.text()).toBe('B');
  });

  it('recupera sessões interrompidas durante a gravação', async () => {
    await store.create(session('a', 1, { status: 'recording' }));
    await store.appendChunk('a', 'cam-a', 0, new Blob(['12']));
    await store.appendChunk('a', 'cam-a', 1, new Blob(['345']));
    expect(await store.recoverInterrupted()).toBe(1);
    const s = await store.get('a');
    expect(s?.status).toBe('interrupted');
    expect(s?.cameras[0]).toMatchObject({ chunkCount: 2, sizeBytes: 5, durationMs: 2000 });
    expect(await store.recoverInterrupted()).toBe(0);
  });

  it('erro claro ao atualizar sessão inexistente', async () => {
    await expect(store.update('nada', { name: 'x' })).rejects.toThrow(/não encontrada/);
  });
});
