import {
  HandLandmarker,
  FilesetResolver,
  DrawingUtils,
} from '@mediapipe/tasks-vision';
import { TRACK_WIDTH, TRACK_HEIGHT } from './gestureEngine';

const WASM_CDN =
  'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm';
const MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';

export async function createHandLandmarker(): Promise<HandLandmarker> {
  const vision = await FilesetResolver.forVisionTasks(WASM_CDN);
  try {
    return await HandLandmarker.createFromOptions(vision, {
      baseOptions: { modelAssetPath: MODEL_URL, delegate: 'GPU' },
      runningMode: 'VIDEO',
      numHands: 1,
      minHandDetectionConfidence: 0.7,
      minHandPresenceConfidence: 0.5,
      minTrackingConfidence: 0.5,
    });
  } catch {
    return await HandLandmarker.createFromOptions(vision, {
      baseOptions: { modelAssetPath: MODEL_URL, delegate: 'CPU' },
      runningMode: 'VIDEO',
      numHands: 1,
      minHandDetectionConfidence: 0.7,
      minHandPresenceConfidence: 0.5,
      minTrackingConfidence: 0.5,
    });
  }
}

export function drawHandPreview(
  ctx: CanvasRenderingContext2D,
  video: HTMLVideoElement,
  landmarker: HandLandmarker,
  timestamp: number
) {
  ctx.save();
  ctx.clearRect(0, 0, TRACK_WIDTH, TRACK_HEIGHT);
  ctx.translate(TRACK_WIDTH, 0);
  ctx.scale(-1, 1);
  ctx.drawImage(video, 0, 0, TRACK_WIDTH, TRACK_HEIGHT);
  ctx.restore();

  const result = landmarker.detectForVideo(video, timestamp);
  if (!result.landmarks?.length) return result;

  ctx.save();
  ctx.translate(TRACK_WIDTH, 0);
  ctx.scale(-1, 1);

  const drawing = new DrawingUtils(ctx);
  for (const landmarks of result.landmarks) {
    drawing.drawConnectors(
      landmarks,
      HandLandmarker.HAND_CONNECTIONS,
      { color: '#00d2ff', lineWidth: 3 }
    );
    drawing.drawLandmarks(landmarks, {
      color: '#ff8c00',
      lineWidth: 1,
      radius: 3,
    });
  }
  ctx.restore();

  return result;
}
