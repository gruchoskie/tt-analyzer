import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { SessionAnalysis, SessionRecord, VideoChunk } from './types';

export const DB_NAME = 'tt-analyzer';
export const DB_VERSION = 2;

export interface TTSchema extends DBSchema {
  sessions: {
    key: string;
    value: SessionRecord;
    indexes: { 'by-createdAt': number };
  };
  chunks: {
    key: [string, string, number];
    value: VideoChunk;
    indexes: { 'by-session': string };
  };
  /** Fase 8: resultado da análise de cada sessão. */
  analysis: {
    key: string;
    value: SessionAnalysis;
  };
}

export type TTDb = IDBPDatabase<TTSchema>;

export function openTTDb(name = DB_NAME): Promise<TTDb> {
  return openDB<TTSchema>(name, DB_VERSION, {
    upgrade(db, oldVersion) {
      if (oldVersion < 1) {
        const sessions = db.createObjectStore('sessions', { keyPath: 'id' });
        sessions.createIndex('by-createdAt', 'createdAt');
        const chunks = db.createObjectStore('chunks', { keyPath: ['sessionId', 'cameraId', 'seq'] });
        chunks.createIndex('by-session', 'sessionId');
      }
      if (oldVersion < 2) db.createObjectStore('analysis', { keyPath: 'sessionId' });
    },
  });
}
