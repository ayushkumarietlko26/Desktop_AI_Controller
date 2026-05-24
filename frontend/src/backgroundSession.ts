/**
 * Keeps the tab from being fully suspended when the browser is minimized.
 * Uses Wake Lock + near-silent audio (common pattern for background WebRTC apps).
 */
export class BackgroundSession {
  private wakeLock: WakeLockSentinel | null = null;
  private audioCtx: AudioContext | null = null;
  private oscillator: OscillatorNode | null = null;
  private gain: GainNode | null = null;

  async start(): Promise<void> {
    await this.acquireWakeLock();
    this.startSilentAudio();
  }

  async stop(): Promise<void> {
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
      /* unsupported or denied */
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

export async function enterPictureInPicture(
  video: HTMLVideoElement | null
): Promise<boolean> {
  if (!video || !document.pictureInPictureEnabled) return false;
  try {
    if (document.pictureInPictureElement !== video) {
      await video.requestPictureInPicture();
    }
    return true;
  } catch {
    return false;
  }
}

export async function leavePictureInPicture(): Promise<void> {
  try {
    if (document.pictureInPictureElement) {
      await document.exitPictureInPicture();
    }
  } catch {
    /* ignore */
  }
}
