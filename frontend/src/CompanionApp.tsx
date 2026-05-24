import React, { useCallback, useEffect, useRef, useState } from 'react';
import { io, Socket } from 'socket.io-client';
import type { HandLandmarker } from '@mediapipe/tasks-vision';
import { createHandLandmarker, drawHandPreview } from './handTracker';
import {
  TRACK_WIDTH,
  TRACK_HEIGHT,
  GestureState,
  toPixelLandmarks,
  processGestures,
  readHandedness,
} from './gestureEngine';
import { SmoothPointer, indexTipPixels } from './smoothPointer';
import { BackgroundSession } from './backgroundSession';

const params = new URLSearchParams(window.location.search);
const ROOM_ID = (params.get('room') || '').toUpperCase();
const SERVER_URL = params.get('server') || '';
const INITIAL_MODE = Number(params.get('mode') || '0');

const CompanionApp: React.FC = () => {
  const [fps, setFps] = useState(0);
  const [status, setStatus] = useState('Starting...');

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const landmarkerRef = useRef<HandLandmarker | null>(null);
  const socketRef = useRef<Socket | null>(null);
  const gestureStateRef = useRef(new GestureState());
  const smoothPointerRef = useRef(new SmoothPointer());
  const activeModeRef = useRef(INITIAL_MODE);
  const rafRef = useRef<number | null>(null);
  const isRunningRef = useRef(false);
  const lastEmitRef = useRef({ x: 0.5, y: 0.5, t: 0 });
  const lastClickRef = useRef('');
  const frameCountRef = useRef(0);
  const lastFpsRef = useRef(0);
  const backgroundSessionRef = useRef(new BackgroundSession());

  const emitCommand = useCallback((action: string, x?: number, y?: number) => {
    if (!socketRef.current?.connected) return;
    if (action === 'MOUSE_MOVE' && x !== undefined && y !== undefined) {
      const now = performance.now();
      if (
        Math.hypot(x - lastEmitRef.current.x, y - lastEmitRef.current.y) < 0.002 &&
        now - lastEmitRef.current.t < 45
      ) {
        return;
      }
      lastEmitRef.current = { x, y, t: now };
    }
    const payload: Record<string, unknown> = { room: ROOM_ID, action };
    if (x !== undefined) payload.x = x;
    if (y !== undefined) payload.y = y;
    socketRef.current.emit('relay_command', payload);
  }, []);

  const runFrame = useCallback(() => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    const landmarker = landmarkerRef.current;
    if (!video || !canvas || !landmarker || video.readyState < 2) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const result = drawHandPreview(ctx, video, landmarker, performance.now());
    frameCountRef.current += 1;
    const now = performance.now();
    if (now - lastFpsRef.current >= 1000) {
      setFps(frameCountRef.current);
      frameCountRef.current = 0;
      lastFpsRef.current = now;
    }

    if (result.landmarks?.length) {
      const rawLm = result.landmarks[0];
      const lm = toPixelLandmarks(rawLm, TRACK_WIDTH, TRACK_HEIGHT);
      const handedness = readHandedness(result);
      const tip = indexTipPixels(rawLm, TRACK_WIDTH, TRACK_HEIGHT);
      const pointer =
        activeModeRef.current === 0
          ? smoothPointerRef.current.update(
              tip.x,
              tip.y,
              TRACK_WIDTH,
              TRACK_HEIGHT,
              tip.extended
            )
          : null;
      const { command } = processGestures(
        lm,
        handedness,
        activeModeRef.current,
        gestureStateRef.current,
        TRACK_WIDTH,
        TRACK_HEIGHT,
        pointer
      );
      if (command) {
        const isClick =
          command.action.includes('CLICK') || command.action === 'MOUSE_DRAG';
        if (isClick) {
          if (lastClickRef.current !== command.action) {
            emitCommand(command.action, command.x, command.y);
            lastClickRef.current = command.action;
          }
        } else {
          emitCommand(command.action, command.x, command.y);
          lastClickRef.current = '';
        }
      }
    }
  }, [emitCommand]);

  const loop = useCallback(() => {
    if (!isRunningRef.current) return;
    runFrame();
    rafRef.current = requestAnimationFrame(loop);
  }, [runFrame]);

  const startCamera = useCallback(async (stream: MediaStream) => {
    if (!videoRef.current) return;
    videoRef.current.srcObject = stream;
    await videoRef.current.play();
    isRunningRef.current = true;
    await backgroundSessionRef.current.start();
    setStatus(`Room ${ROOM_ID} · control active`);
    rafRef.current = requestAnimationFrame(loop);
  }, [loop]);

  const connectSocket = useCallback(() => {
    const socket = io(SERVER_URL, {
      transports: ['websocket', 'polling'],
      secure: SERVER_URL.startsWith('https://'),
    });
    socket.on('connect', () => {
      socket.emit('join', { room: ROOM_ID, role: 'frontend', client_tracking: true });
      socket.emit('change_mode', { room: ROOM_ID, mode: activeModeRef.current });
      setStatus(`Connected · ${ROOM_ID}`);
    });
    socketRef.current = socket;
  }, []);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        landmarkerRef.current = await createHandLandmarker();
        if (cancelled) return;
        connectSocket();

        if (window.opener) {
          setStatus('Waiting for camera from main window...');
          window.opener.postMessage({ type: 'companion-ready' }, window.location.origin);
        } else {
          const stream = await navigator.mediaDevices.getUserMedia({
            video: {
              width: { ideal: TRACK_WIDTH },
              height: { ideal: TRACK_HEIGHT },
              facingMode: 'user',
            },
            audio: false,
          });
          await startCamera(stream);
        }
      } catch (e) {
        setStatus('Failed to start mini window.');
        console.error(e);
      }
    })();

    const onMessage = async (e: MessageEvent) => {
      if (e.origin !== window.location.origin) return;
      if (e.data?.type === 'init-stream' && e.data.stream) {
        await startCamera(e.data.stream as MediaStream);
        if (typeof e.data.mode === 'number') {
          activeModeRef.current = e.data.mode;
        }
      }
    };
    window.addEventListener('message', onMessage);

    return () => {
      cancelled = true;
      isRunningRef.current = false;
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      socketRef.current?.disconnect();
      void backgroundSessionRef.current.stop();
      landmarkerRef.current?.close();
      window.removeEventListener('message', onMessage);
    };
  }, [connectSocket, startCamera]);

  return (
    <div
      style={{
        margin: 0,
        width: '100vw',
        height: '100vh',
        background: '#0a0a0a',
        display: 'flex',
        flexDirection: 'column',
        fontFamily: 'sans-serif',
      }}
    >
      <div
        style={{
          padding: '4px 8px',
          fontSize: '10px',
          color: '#0f0',
          background: 'rgba(0,0,0,0.8)',
          flexShrink: 0,
        }}
      >
        Mini · {status} · {fps} fps
      </div>
      <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
        <canvas
          ref={canvasRef}
          width={TRACK_WIDTH}
          height={TRACK_HEIGHT}
          style={{ width: '100%', height: '100%', objectFit: 'cover' }}
        />
        <video ref={videoRef} autoPlay playsInline muted style={{ display: 'none' }} />
      </div>
    </div>
  );
};

export default CompanionApp;
