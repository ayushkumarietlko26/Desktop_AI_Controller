/**
 * Background session + small Picture-in-Picture window.
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

type DocPip = {
  requestWindow: (options?: { width?: number; height?: number }) => Promise<Window>;
  window: Window | null;
};

let docPipWindow: Window | null = null;
let docPipVideo: HTMLVideoElement | null = null;

function getDocPip(): DocPip | undefined {
  return (window as unknown as { documentPictureInPicture?: DocPip })
    .documentPictureInPicture;
}

export function isPipActive(): boolean {
  if (docPipWindow && !docPipWindow.closed) return true;
  return Boolean(document.pictureInPictureElement);
}

export async function enterSmallPictureInPicture(
  stream: MediaStream | null,
  sourceVideo: HTMLVideoElement | null
): Promise<{ ok: boolean; message?: string }> {
  if (!stream) {
    return { ok: false, message: 'Start the camera first.' };
  }

  const docPip = getDocPip();
  if (docPip) {
    try {
      if (docPip.window && !docPip.window.closed) {
        await leavePictureInPicture();
      }
      docPipWindow = await docPip.requestWindow({ width: 200, height: 150 });
      const doc = docPipWindow.document;
      doc.body.style.margin = '0';
      doc.body.style.overflow = 'hidden';
      doc.body.style.background = '#0a0a0a';

      const style = doc.createElement('style');
      style.textContent = `
        video { width:100%; height:100%; object-fit:cover; transform:scaleX(-1); }
        .bar { position:absolute; top:0; left:0; right:0; padding:4px 6px;
          font:11px sans-serif; color:#0f0; background:rgba(0,0,0,0.55); }
      `;
      doc.head.appendChild(style);

      const bar = doc.createElement('div');
      bar.className = 'bar';
      bar.textContent = 'Hand control active';
      doc.body.appendChild(bar);

      docPipVideo = doc.createElement('video');
      docPipVideo.muted = true;
      docPipVideo.playsInline = true;
      docPipVideo.autoplay = true;
      docPipVideo.srcObject = stream;
      doc.body.appendChild(docPipVideo);
      await docPipVideo.play();

      docPipWindow.addEventListener('pagehide', () => {
        docPipWindow = null;
        docPipVideo = null;
      });

      return { ok: true };
    } catch (err) {
      docPipWindow = null;
      docPipVideo = null;
      console.warn('Document PiP failed', err);
    }
  }

  if (sourceVideo && document.pictureInPictureEnabled) {
    try {
      sourceVideo.disablePictureInPicture = false;
      if (document.pictureInPictureElement !== sourceVideo) {
        await sourceVideo.requestPictureInPicture();
      }
      return { ok: true };
    } catch (err) {
      return {
        ok: false,
        message:
          err instanceof Error ? err.message : 'Could not open pop-out video.',
      };
    }
  }

  return {
    ok: false,
    message:
      'Pop-out not supported here. Use Chrome/Edge and try the Mini Window button.',
  };
}

export async function leavePictureInPicture(): Promise<void> {
  try {
    if (docPipWindow && !docPipWindow.closed) {
      docPipWindow.close();
    }
  } catch {
    /* ignore */
  }
  docPipWindow = null;
  docPipVideo = null;

  try {
    if (document.pictureInPictureElement) {
      await document.exitPictureInPicture();
    }
  } catch {
    /* ignore */
  }
}

/** Video must stay in DOM (not display:none) for PiP */
export const hiddenVideoStyle: Record<string, string | number> = {
  position: 'fixed',
  left: 0,
  top: 0,
  width: '2px',
  height: '2px',
  opacity: 0.01,
  pointerEvents: 'none',
  zIndex: -1,
};
