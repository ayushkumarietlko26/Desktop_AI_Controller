/** Gesture logic mirrored from server.py / HandTrackingModule.py */

export const TRACK_WIDTH = 480;
export const TRACK_HEIGHT = 360;

const FINGER_TIP_IDS = [4, 8, 12, 16, 20];
const MOUSE_MARGIN = 0.1;
const MOUSE_SENSITIVITY = 0.8;

export type PixelLandmark = [id: number, x: number, y: number];
export type AgentCommand = {
  action: string;
  x?: number;
  y?: number;
};

export class GestureState {
  positionHistory: Array<[number, number]> = [];
  modeHoldStart: number | null = null;
  lastMediaPlayPause = 0;
}

export function toPixelLandmarks(
  landmarks: Array<{ x: number; y: number }>,
  width: number,
  height: number
): PixelLandmark[] {
  return landmarks.map((lm, id) => [
    id,
    Math.round(lm.x * width),
    Math.round(lm.y * height),
  ]);
}

export function fingersUp(
  lm: PixelLandmark[],
  handedness: string
): number[] {
  const result: number[] = [];
  const thumb = lm[4];
  const thumbBase = lm[3];
  if (handedness === 'Left') {
    result.push(thumb[1] > thumbBase[1] ? 1 : 0);
  } else {
    result.push(thumb[1] < thumbBase[1] ? 1 : 0);
  }
  for (const id of FINGER_TIP_IDS.slice(1)) {
    const tip = lm[id];
    const joint = lm[id - 2];
    result.push(tip[2] < joint[2] ? 1 : 0);
  }
  return result;
}

export function fingerDistance(
  lm: PixelLandmark[],
  finger1: number,
  finger2: number
): number {
  const id1 = FINGER_TIP_IDS[finger1];
  const id2 = FINGER_TIP_IDS[finger2];
  const x1 = lm[id1][1];
  const y1 = lm[id1][2];
  const x2 = lm[id2][1];
  const y2 = lm[id2][2];
  return Math.hypot(x1 - x2, y1 - y2);
}

const clickThreshold = (width: number) => (30 * width) / 320;
const swipeThreshold = (width: number) => (100 * width) / 320;

export function mapHandToScreen(
  indexX: number,
  indexY: number,
  width: number,
  height: number
): { x: number; y: number } {
  const marginX = width * MOUSE_MARGIN;
  const marginY = height * MOUSE_MARGIN;
  const spanX = (width - 2 * marginX) * MOUSE_SENSITIVITY;
  const spanY = (height - 2 * marginY) * MOUSE_SENSITIVITY;
  const centerX = width / 2;
  const centerY = height / 2;
  const effectiveX1 = centerX - spanX / 2;
  const effectiveX2 = centerX + spanX / 2;
  const effectiveY1 = centerY - spanY / 2;
  const effectiveY2 = centerY + spanY / 2;

  const lerp = (v: number, inMin: number, inMax: number, outMin: number, outMax: number) => {
    if (inMax === inMin) return outMin;
    const t = (v - inMin) / (inMax - inMin);
    return outMin + t * (outMax - outMin);
  };

  const normX = 1 - lerp(indexX, effectiveX1, effectiveX2, 0, 1);
  const normY = lerp(indexY, effectiveY1, effectiveY2, 0, 1);
  return {
    x: Math.max(0, Math.min(1, normX)),
    y: Math.max(0, Math.min(1, normY)),
  };
}

function resolveMouseAction(
  fingers: number[],
  lm: PixelLandmark[],
  width: number
): string | null {
  if (fingers[1] !== 1) return null;
  const clickDist = clickThreshold(width);

  if (fingers.join('') === '01000') return 'MOUSE_MOVE';
  if (fingers.join('') === '01100') {
    return fingerDistance(lm, 1, 2) < clickDist
      ? 'MOUSE_CLICK_LEFT'
      : 'MOUSE_MOVE';
  }
  if (fingers.join('') === '11000') {
    return fingerDistance(lm, 0, 1) < clickDist
      ? 'MOUSE_CLICK_RIGHT'
      : 'MOUSE_MOVE';
  }
  if (fingers.join('') === '01001') {
    return fingerDistance(lm, 1, 4) < clickDist ? 'MOUSE_DRAG' : 'MOUSE_MOVE';
  }
  return 'MOUSE_MOVE';
}

function getSwipeDirection(
  state: GestureState,
  width: number
): 'Left' | 'Right' | 'Up' | 'Down' | null {
  if (state.positionHistory.length < 10) return null;
  const first = state.positionHistory[0];
  const last = state.positionHistory[state.positionHistory.length - 1];
  const dx = last[0] - first[0];
  const dy = last[1] - first[1];
  const threshold = swipeThreshold(width);

  if (Math.abs(dx) > Math.abs(dy)) {
    if (Math.abs(dx) > threshold) {
      state.positionHistory = [];
      return dx > 0 ? 'Right' : 'Left';
    }
  } else if (Math.abs(dy) > threshold) {
    state.positionHistory = [];
    return dy > 0 ? 'Down' : 'Up';
  }
  return null;
}

export interface GestureResult {
  command: AgentCommand | null;
  modeChange: number | null;
}

export function processGestures(
  lm: PixelLandmark[],
  handedness: string,
  mode: number,
  state: GestureState,
  width: number,
  height: number
): GestureResult {
  const indexX = lm[8][1];
  const indexY = lm[8][2];
  const fingers = fingersUp(lm, handedness);

  state.positionHistory.push([indexX, indexY]);
  if (state.positionHistory.length > 10) {
    state.positionHistory.shift();
  }

  let modeChange: number | null = null;
  let currentMode = mode;

  if (fingers.join('') === '01110') {
    if (state.modeHoldStart === null) {
      state.modeHoldStart = Date.now();
    } else if (Date.now() - state.modeHoldStart >= 1500) {
      currentMode = (mode + 1) % 4;
      modeChange = currentMode;
      state.modeHoldStart = Date.now() + 500;
    }
  } else {
    state.modeHoldStart = null;
  }

  let command: AgentCommand | null = null;

  if (currentMode === 0) {
    const { x, y } = mapHandToScreen(indexX, indexY, width, height);
    const action = resolveMouseAction(fingers, lm, width);
    if (action) {
      command = { action, x, y };
    }
  } else if (currentMode === 1) {
    const swipe = getSwipeDirection(state, width);
    if (swipe === 'Right') command = { action: 'SWIPE_RIGHT' };
    else if (swipe === 'Left') command = { action: 'SWIPE_LEFT' };
  } else if (currentMode === 2) {
    const swipe = getSwipeDirection(state, width);
    if (fingers.join('') === '11111') {
      if (swipe === 'Right') command = { action: 'MEDIA_NEXT' };
      else if (swipe === 'Left') command = { action: 'MEDIA_PREV' };
      else {
        const now = Date.now();
        if (now - state.lastMediaPlayPause >= 1500) {
          command = { action: 'MEDIA_PLAY_PAUSE' };
          state.lastMediaPlayPause = now;
        }
      }
    } else if (swipe === 'Right') {
      command = { action: 'MEDIA_NEXT' };
    } else if (swipe === 'Left') {
      command = { action: 'MEDIA_PREV' };
    }
  }

  return { command, modeChange };
}
