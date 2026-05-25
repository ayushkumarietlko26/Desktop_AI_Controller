/**
 * Background session: wake lock + silent audio keep camera/tracking alive when tab is hidden.
 * Landmark preview over other apps uses Document Picture-in-Picture (documentPipPreview.ts).
 */

export class BackgroundSession {
  private wakeLock: WakeLockSentinel | null = null;
  private audioCtx: AudioContext | null = null;
  private oscillator: OscillatorNode | null = null;
  private gain: GainNode | null = null;
  private onVisibility: (() => void) | null = null;

  async start(): Promise<void> {
    await this.acquireWakeLock();
    this.startSilentAudio();
    this.onVisibility = () => {
      if (document.visibilityState === 'visible') {
        void this.acquireWakeLock();
        void this.audioCtx?.resume();
      }
    };
    document.addEventListener('visibilitychange', this.onVisibility);
  }

  async stop(): Promise<void> {
    if (this.onVisibility) {
      document.removeEventListener('visibilitychange', this.onVisibility);
      this.onVisibility = null;
    }
    this.releaseWakeLock();
    this.stopSilentAudio();
  }

  private async acquireWakeLock(): Promise<void> {
    try {
      if ('wakeLock' in navigator) {
        this.wakeLock = await navigator.wakeLock.request('screen');
        this.wakeLock.addEventListener('release', () => {
          this.wakeLock = null;
        });
      }
    } catch {
      /* ignore */
    }
  }

  private releaseWakeLock(): void {
    try {
      this.wakeLock?.release();
    } catch {
      /* ignore */
    }
    this.wakeLock = null;
  }

  private startSilentAudio(): void {
    try {
      const Ctx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext })
          .webkitAudioContext;
      if (!Ctx) return;
      this.audioCtx = new Ctx();
      this.oscillator = this.audioCtx.createOscillator();
      this.gain = this.audioCtx.createGain();
      this.gain.gain.value = 0.0001;
      this.oscillator.connect(this.gain);
      this.gain.connect(this.audioCtx.destination);
      this.oscillator.start();
      if (this.audioCtx.state === 'suspended') {
        void this.audioCtx.resume();
      }
    } catch {
      /* ignore */
    }
  }

  private stopSilentAudio(): void {
    try {
      this.oscillator?.stop();
      this.oscillator?.disconnect();
      this.gain?.disconnect();
      void this.audioCtx?.close();
    } catch {
      /* ignore */
    }
    this.oscillator = null;
    this.gain = null;
    this.audioCtx = null;
  }
}

export function isDocumentHidden(): boolean {
  return document.visibilityState === 'hidden';
}

/**
 * Video must stay in DOM with real dimensions (not display:none).
 * Off-screen + low opacity keeps capture alive when the tab is minimized.
 */
export const hiddenVideoStyle: Record<string, string | number> = {
  position: 'fixed',
  left: '-9999px',
  top: 0,
  width: 480,
  height: 360,
  opacity: 0.01,
  pointerEvents: 'none',
  zIndex: -1,
  visibility: 'visible',
};
