import type { CameraId, SessionId } from '../core/types';
import { openTTDb, type TTDb } from './db';
import type { SessionCamera, SessionRecord } from './types';

/** Acesso às sessões e aos vídeos salvos no IndexedDB. */
export class SessionStore {
  private constructor(private readonly db: TTDb) {}

  static async open(name?: string): Promise<SessionStore> {
    return new SessionStore(await openTTDb(name));
  }

  close(): void {
    this.db.close();
  }

  async create(rec: SessionRecord): Promise<void> {
    await this.db.add('sessions', rec);
  }

  async get(id: SessionId): Promise<SessionRecord | undefined> {
    return this.db.get('sessions', id);
  }

  /** Sessões da mais recente para a mais antiga. */
  async list(): Promise<SessionRecord[]> {
    const all = await this.db.getAllFromIndex('sessions', 'by-createdAt');
    return all.reverse();
  }

  async update(id: SessionId, patch: Partial<Omit<SessionRecord, 'id'>>): Promise<SessionRecord> {
    const tx = this.db.transaction('sessions', 'readwrite');
    const cur = await tx.store.get(id);
    if (!cur) throw new Error(`Sessão ${id} não encontrada`);
    const next: SessionRecord = { ...cur, ...patch, id, updatedAt: Date.now() };
    await tx.store.put(next);
    await tx.done;
    return next;
  }

  /** Atualiza (ou acrescenta) os dados de uma câmera da sessão. */
  async upsertCamera(id: SessionId, cam: SessionCamera): Promise<SessionRecord> {
    const tx = this.db.transaction('sessions', 'readwrite');
    const cur = await tx.store.get(id);
    if (!cur) throw new Error(`Sessão ${id} não encontrada`);
    const cameras = cur.cameras.filter((c) => c.cameraId !== cam.cameraId).concat(cam);
    const next: SessionRecord = { ...cur, cameras, updatedAt: Date.now() };
    await tx.store.put(next);
    await tx.done;
    return next;
  }

  async rename(id: SessionId, name: string): Promise<void> {
    await this.update(id, { name: name.trim() || 'Sessão sem nome' });
  }

  async appendChunk(sessionId: SessionId, cameraId: CameraId, seq: number, blob: Blob): Promise<void> {
    await this.db.put('chunks', { sessionId, cameraId, seq, blob });
  }

  private chunkRange(sessionId: SessionId, cameraId: CameraId): IDBKeyRange {
    return IDBKeyRange.bound([sessionId, cameraId, -Infinity], [sessionId, cameraId, Infinity]);
  }

  /** Vídeo completo de uma câmera da sessão (pedaços em ordem). */
  async getVideo(sessionId: SessionId, cameraId: CameraId, mimeType: string): Promise<Blob | null> {
    const chunks = await this.db.getAll('chunks', this.chunkRange(sessionId, cameraId));
    if (chunks.length === 0) return null;
    chunks.sort((a, b) => a.seq - b.seq);
    return new Blob(
      chunks.map((c) => c.blob),
      { type: mimeType || chunks[0].blob.type },
    );
  }

  /** Quantidade e tamanho dos pedaços já salvos de uma câmera. */
  async chunkStats(sessionId: SessionId, cameraId: CameraId): Promise<{ count: number; bytes: number }> {
    const chunks = await this.db.getAll('chunks', this.chunkRange(sessionId, cameraId));
    return { count: chunks.length, bytes: chunks.reduce((s, c) => s + c.blob.size, 0) };
  }

  async delete(id: SessionId): Promise<void> {
    const tx = this.db.transaction(['sessions', 'chunks'], 'readwrite');
    await tx.objectStore('sessions').delete(id);
    const idx = tx.objectStore('chunks').index('by-session');
    let cursor = await idx.openKeyCursor(IDBKeyRange.only(id));
    while (cursor) {
      await tx.objectStore('chunks').delete(cursor.primaryKey);
      cursor = await cursor.continue();
    }
    await tx.done;
  }

  /**
   * Sessões que ficaram como "gravando" (app fechado, bateria, aba descartada)
   * viram "interrompidas", com duração/tamanho recalculados a partir dos pedaços salvos.
   */
  async recoverInterrupted(): Promise<number> {
    const stuck = (await this.list()).filter((s) => s.status === 'recording');
    for (const s of stuck) {
      const cameras: SessionCamera[] = [];
      for (const c of s.cameras) {
        const st = await this.chunkStats(s.id, c.cameraId);
        // Pedaços de 1 s: a quantidade dá uma boa estimativa da duração.
        cameras.push({ ...c, chunkCount: st.count, sizeBytes: st.bytes, durationMs: c.durationMs || st.count * 1000 });
      }
      await this.update(s.id, { status: 'interrupted', cameras });
    }
    return stuck.length;
  }
}
