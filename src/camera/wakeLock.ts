/**
 * Mantém a tela ligada (Screen Wake Lock). O navegador solta o bloqueio
 * quando a aba fica oculta; reativamos ao voltar.
 */
export class ScreenWakeLock {
  private sentinel: WakeLockSentinel | null = null;
  private wanted = false;
  private onVisibility = () => {
    if (this.wanted && document.visibilityState === 'visible') void this.acquire();
  };
  onChange?: (active: boolean) => void;

  static get supported(): boolean {
    return typeof navigator !== 'undefined' && 'wakeLock' in navigator;
  }

  get active(): boolean {
    return this.sentinel !== null && !this.sentinel.released;
  }

  async enable(): Promise<boolean> {
    this.wanted = true;
    document.addEventListener('visibilitychange', this.onVisibility);
    return this.acquire();
  }

  async disable(): Promise<void> {
    this.wanted = false;
    document.removeEventListener('visibilitychange', this.onVisibility);
    const s = this.sentinel;
    this.sentinel = null;
    await s?.release().catch(() => undefined);
    this.onChange?.(false);
  }

  private async acquire(): Promise<boolean> {
    if (!ScreenWakeLock.supported || this.active) return this.active;
    try {
      this.sentinel = await navigator.wakeLock.request('screen');
      this.sentinel.addEventListener('release', () => this.onChange?.(false));
      this.onChange?.(true);
      return true;
    } catch {
      this.onChange?.(false);
      return false;
    }
  }
}
