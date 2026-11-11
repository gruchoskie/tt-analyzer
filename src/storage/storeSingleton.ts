import { SessionStore } from './SessionStore';

let storePromise: Promise<SessionStore> | null = null;

/** Abre o banco uma vez e recupera gravações interrompidas. */
export function getStore(): Promise<SessionStore> {
  if (!storePromise) {
    storePromise = SessionStore.open().then(async (s) => {
      await s.recoverInterrupted().catch(() => 0);
      return s;
    });
    storePromise.catch(() => {
      storePromise = null;
    });
  }
  return storePromise;
}

/** Pede ao navegador para não apagar os vídeos quando faltar espaço. */
export async function requestPersistentStorage(): Promise<boolean> {
  try {
    if (await navigator.storage?.persisted?.()) return true;
    return (await navigator.storage?.persist?.()) ?? false;
  } catch {
    return false;
  }
}

export async function storageEstimate(): Promise<{ usage: number; quota: number } | null> {
  try {
    const e = await navigator.storage?.estimate?.();
    if (!e || e.quota === undefined) return null;
    return { usage: e.usage ?? 0, quota: e.quota };
  } catch {
    return null;
  }
}
