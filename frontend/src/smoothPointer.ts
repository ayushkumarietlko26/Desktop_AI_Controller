import { mapHandToScreen } from './gestureEngine';

/**
 * Stabilizes index-finger position: median filter + dead zone + adaptive smoothing.
 * Stops left-right micro-oscillation when the hand is held still.
 */
export class SmoothPointer {
  normX = 0.5;
  normY = 0.5;
  indexActive = false;
  lastActiveMs = 0;

  private readonly history: Array<{ x: number; y: number }> = [];
  private readonly historyLen = 5;
  private readonly coastMs = 150;
  private readonly deadZone = 0.003;
  private readonly stillSpeed = 0.008;

  update(
    indexX: number,
    indexY: number,
    width: number,
    height: number,
    indexExtended: boolean
  ): { x: number; y: number } | null {
    const now = performance.now();

    if (indexExtended) {
      this.indexActive = true;
      this.lastActiveMs = now;
    } else if (!indexExtended && indexY > 0) {
      this.indexActive = false;
    }

    const coasting =
      !this.indexActive && now - this.lastActiveMs < this.coastMs;
    if (!this.indexActive && !coasting) {
      return null;
    }

    if (this.indexActive) {
      const raw = mapHandToScreen(indexX, indexY, width, height);
      this.history.push(raw);
      if (this.history.length > this.historyLen) {
        this.history.shift();
      }

      const median = medianPosition(this.history);
      const dx = median.x - this.normX;
      const dy = median.y - this.normY;
      const dist = Math.hypot(dx, dy);

      if (dist < this.deadZone) {
        return { x: clamp01(this.normX), y: clamp01(this.normY) };
      }

      const speed =
        this.history.length >= 2
          ? Math.hypot(
              this.history[this.history.length - 1].x -
                this.history[this.history.length - 2].x,
              this.history[this.history.length - 1].y -
                this.history[this.history.length - 2].y
            )
          : dist;

      const alpha = speed < this.stillSpeed ? 0.22 : 0.52;
      this.normX += dx * alpha;
      this.normY += dy * alpha;
    }

    return {
      x: clamp01(this.normX),
      y: clamp01(this.normY),
    };
  }

  coastOnly(): { x: number; y: number } | null {
    if (performance.now() - this.lastActiveMs < this.coastMs) {
      return { x: this.normX, y: this.normY };
    }
    return null;
  }

  reset() {
    this.normX = 0.5;
    this.normY = 0.5;
    this.indexActive = false;
    this.lastActiveMs = 0;
    this.history.length = 0;
  }
}

function medianPosition(
  points: Array<{ x: number; y: number }>
): { x: number; y: number } {
  if (points.length === 0) return { x: 0.5, y: 0.5 };
  const xs = [...points].map((p) => p.x).sort((a, b) => a - b);
  const ys = [...points].map((p) => p.y).sort((a, b) => a - b);
  const mid = Math.floor(points.length / 2);
  return { x: xs[mid], y: ys[mid] };
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

export function indexTipPixels(
  landmarks: Array<{ x: number; y: number }>,
  width: number,
  height: number
): { x: number; y: number; extended: boolean } {
  const tip = landmarks[8];
  const pip = landmarks[6];
  const x = tip.x * width;
  const y = tip.y * height;
  const extended = y < pip.y * height - 4;
  return { x, y, extended };
}
