import React, { useCallback, useEffect, useRef, useState } from 'react';
import { io, Socket } from 'socket.io-client';
import type { HandLandmarker } from '@mediapipe/tasks-vision';
import {
  createHandLandmarker,
  drawHandPreview,
  detectHandsFromVideo,
} from './handTracker';
import {
  TRACK_WIDTH,
  TRACK_HEIGHT,
  GestureState,
  MODE_NAMES,
  MODE_COLORS,
  toPixelLandmarks,
  processGestures,
  readHandedness,
} from './gestureEngine';
import { SmoothPointer, indexTipPixels } from './smoothPointer';
import { BackgroundSession, hiddenVideoStyle } from './backgroundSession';
import { attachTrackingScheduler } from './trackingScheduler';

const params = new URLSearchParams(window.location.search);
const ROOM_ID = (params.get('room') || '').toUpperCase();
const SERVER_URL = params.get('server') || '';
const INITIAL_MODE = Number(params.get('mode') || '0');

const CompanionApp: React.FC = () => {
  const [fps, setFps] = useState(0);
  const [status, setStatus] = useState('Starting...');
  const [activeMode, setActiveMode] = useState(INITIAL_MODE);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const landmarkerRef = useRef<HandLandmarker | null>(null);
  const socketRef = useRef<Socket | null>(null);
  const gestureStateRef = useRef(new GestureState());
  const smoothPointerRef = useRef(new SmoothPointer());
  const activeModeRef = useRef(INITIAL_MODE);
  const isRunningRef = useRef(false);
  const lastEmitRef = useRef({ x: 0.5, y: 0.5, t: 0 });
  const lastClickRef = useRef('');
  const frameCountRef = useRef(0);
  const lastFpsRef = useRef(0);
  const backgroundSessionRef = useRef(new BackgroundSession());
  const stopSchedulerRef = useRef<(() => void) | null>(null);

  const applyMode = useCallback((mode: number) => {
    const clamped = Math.max(0, Math.min(3, mode));
    activeModeRef.current = clamped;
    setActiveMode(clamped);
  }, []);

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
    if (!video || !landmarker || video.readyState < 2) return;

    const timestamp = performance.now();
    const hidden = document.visibilityState === 'hidden';

    const result =
      !hidden && canvas
        ? (() => {
            const ctx = canvas.getContext('2d');
            if (!ctx) return null;
            return drawHandPreview(ctx, video, landmarker, timestamp);
          })()
        : detectHandsFromVideo(video, landmarker, timestamp);

    if (!result) return;

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
      const { command, modeChange } = processGestures(
        lm,
        handedness,
        activeModeRef.current,
        gestureStateRef.current,
        TRACK_WIDTH,
        TRACK_HEIGHT,
        pointer
      );
      if (modeChange !== null) {
        applyMode(modeChange);
        socketRef.current?.emit('change_mode', { room: ROOM_ID, mode: modeChange });
      }
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
    } else if (activeModeRef.current === 0) {
      const coast = smoothPointerRef.current.coastOnly();
      if (coast) emitCommand('MOUSE_MOVE', coast.x, coast.y);
    }
  }, [applyMode, emitCommand]);

  const stopScheduler = useCallback(() => {
    stopSchedulerRef.current?.();
    stopSchedulerRef.current = null;
  }, []);

  const startScheduler = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    stopScheduler();
    stopSchedulerRef.current = attachTrackingScheduler(
      video,
      runFrame,
      () => isRunningRef.current
    );
  }, [runFrame, stopScheduler]);

  const requestCamera = useCallback(async () => {
    return navigator.mediaDevices.getUserMedia({
      video: {
        width: { ideal: TRACK_WIDTH },
        height: { ideal: TRACK_HEIGHT },
        frameRate: { ideal: 30, max: 30 },
        facingMode: 'user',
      },
      audio: false,
    });
  }, []);

  const startCamera = useCallback(
    async (stream: MediaStream) => {
      if (!videoRef.current) return;
      videoRef.current.srcObject = stream;
      await videoRef.current.play();
      isRunningRef.current = true;
      await backgroundSessionRef.current.start();
      setStatus(`Room ${ROOM_ID} · control active`);
      startScheduler();
    },
    [startScheduler]
  );

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
    socket.on('mode_changed', (data: { mode: number }) => {
      applyMode(data.mode);
    });
    socketRef.current = socket;
  }, [applyMode]);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        landmarkerRef.current = await createHandLandmarker();
        if (cancelled) return;
        connectSocket();

        if (window.opener) {
          setStatus('Waiting for camera…');
          window.opener.postMessage({ type: 'companion-ready' }, window.location.origin);
        } else {
          const stream = await requestCamera();
          await startCamera(stream);
        }
      } catch (e) {
        setStatus('Failed to start mini window.');
        console.error(e);
      }
    })();

    const onMessage = async (e: MessageEvent) => {
      if (e.origin !== window.location.origin) return;
      if (e.data?.type === 'start-own-camera') {
        try {
          const stream = await requestCamera();
          await startCamera(stream);
          if (typeof e.data.mode === 'number') {
            applyMode(e.data.mode);
          }
        } catch (err) {
          setStatus('Camera blocked — allow webcam for this window.');
          console.error(err);
        }
      }
      if (e.data?.type === 'init-stream' && e.data.stream) {
        await startCamera(e.data.stream as MediaStream);
        if (typeof e.data.mode === 'number') {
          applyMode(e.data.mode);
        }
      }
      if (e.data?.type === 'mode-update' && typeof e.data.mode === 'number') {
        applyMode(e.data.mode);
      }
    };
    window.addEventListener('message', onMessage);

    return () => {
      cancelled = true;
      isRunningRef.current = false;
      stopScheduler();
      socketRef.current?.disconnect();
      void backgroundSessionRef.current.stop();
      landmarkerRef.current?.close();
      const v = videoRef.current;
      if (v?.srcObject) {
        (v.srcObject as MediaStream).getTracks().forEach((t) => t.stop());
      }
      window.removeEventListener('message', onMessage);
    };
  }, [applyMode, connectSocket, requestCamera, startCamera, stopScheduler]);

  const modeColor = MODE_COLORS[activeMode] ?? '#0f0';
  const modeName = MODE_NAMES[activeMode] ?? 'MODE';
  const presentationHint = activeMode === 1 ? ' · 1↑ prev · 2↑ next' : '';

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
          background: 'rgba(0,0,0,0.85)',
          flexShrink: 0,
          display: 'flex',
          flexDirection: 'column',
          gap: '2px',
        }}
      >
        <span style={{ fontWeight: 700, color: modeColor, fontSize: '11px' }}>
          {modeName}
        </span>
        <span style={{ color: '#aaa' }}>
          {status} · {fps} fps{presentationHint}
        </span>
      </div>
      <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
        <canvas
          ref={canvasRef}
          width={TRACK_WIDTH}
          height={TRACK_HEIGHT}
          style={{ width: '100%', height: '100%', objectFit: 'cover' }}
        />
        <video ref={videoRef} autoPlay playsInline muted style={hiddenVideoStyle} />
      </div>
    </div>
  );
};

export default CompanionApp;
