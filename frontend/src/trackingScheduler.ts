import { isDocumentHidden } from './backgroundSession';

export type TrackingTick = () => void;

/**
 * Keeps hand-tracking alive when the tab is in the background.
 * Uses requestVideoFrameCallback when available; falls back to interval / rAF.
 */
export function attachTrackingScheduler(
  video: HTMLVideoElement,
  onTick: TrackingTick,
  isActive: () => boolean
): () => void {
  let cancelled = false;
  let intervalId: ReturnType<typeof setInterval> | null = null;
  let rvfcId = 0;
  let rafId = 0;

  const clearIntervalLoop = () => {
    if (intervalId !== null) {
      clearInterval(intervalId);
      intervalId = null;
    }
  };

  const tick = () => {
    if (cancelled || !isActive()) return;
    void video.play().catch(() => {});
    onTick();
  };

  const runRvfc = () => {
    if (cancelled || !isActive()) return;
    if ('requestVideoFrameCallback' in video) {
      rvfcId = (
        video as HTMLVideoElement & {
          requestVideoFrameCallback: (cb: () => void) => number;
        }
      ).requestVideoFrameCallback(() => {
        tick();
        runRvfc();
      });
    }
  };

  const startHiddenLoop = () => {
    clearIntervalLoop();
    if (cancelled || !isActive()) return;
    tick();
    intervalId = setInterval(tick, 33);
  };

  const startVisibleLoop = () => {
    clearIntervalLoop();
    if (cancelled || !isActive()) return;
    if ('requestVideoFrameCallback' in video) {
      runRvfc();
    } else {
      const loop = () => {
        if (cancelled || !isActive() || isDocumentHidden()) return;
        tick();
        rafId = requestAnimationFrame(loop);
      };
      rafId = requestAnimationFrame(loop);
    }
  };

  const syncMode = () => {
    if (cancelled || !isActive()) return;
    if (isDocumentHidden()) {
      startHiddenLoop();
    } else {
      startVisibleLoop();
    }
  };

  syncMode();

  const onVisibility = () => {
    if (cancelled || !isActive()) return;
    syncMode();
  };

  document.addEventListener('visibilitychange', onVisibility);

  return () => {
    cancelled = true;
    clearIntervalLoop();
    if (rafId) cancelAnimationFrame(rafId);
    if (rvfcId && 'cancelVideoFrameCallback' in video) {
      try {
        (
          video as HTMLVideoElement & {
            cancelVideoFrameCallback: (id: number) => void;
          }
        ).cancelVideoFrameCallback(rvfcId);
      } catch {
        /* ignore */
      }
    }
    document.removeEventListener('visibilitychange', onVisibility);
  };
}
