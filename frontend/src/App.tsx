import React, { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { io, Socket } from 'socket.io-client';
import type { HandLandmarker } from '@mediapipe/tasks-vision';
import {
  MousePointer2,
  Presentation,
  Music,
  Mic,
  ChevronRight,
  Github,
  Zap,
  Video,
  Download,
  Server,
  PictureInPicture,
} from 'lucide-react';
import { createHandLandmarker, drawHandPreview, detectHandsFromVideo } from './handTracker';
import {
  BackgroundSession,
  enterSmallPictureInPicture,
  isDocumentHidden,
  leavePictureInPicture,
  hiddenVideoStyle,
} from './backgroundSession';
import { openCompanionWindow } from './companionWindow';
import {
  TRACK_WIDTH,
  TRACK_HEIGHT,
  GestureState,
  toPixelLandmarks,
  processGestures,
  readHandedness,
} from './gestureEngine';
import { SmoothPointer, indexTipPixels } from './smoothPointer';

const DEFAULT_SERVER_URL =
  import.meta.env.VITE_SERVER_URL || 'https://desktop-ai-controller-16.onrender.com';

const App: React.FC = () => {
  const [activeMode, setActiveMode] = useState(0);
  const [jarvisActive, setJarvisActive] = useState(false);

  const [serverUrl, setServerUrl] = useState(DEFAULT_SERVER_URL);
  const [roomId, setRoomId] = useState(() =>
    Math.random().toString(36).substring(2, 8).toUpperCase()
  );
  const [isConnected, setIsConnected] = useState(false);
  const [isStreaming, setIsStreaming] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [trackerReady, setTrackerReady] = useState(false);
  const [fps, setFps] = useState(0);
  const [cmdCount, setCmdCount] = useState(0);
  const [agentPaired, setAgentPaired] = useState(false);
  const [runningInBackground, setRunningInBackground] = useState(false);
  const [pipActive, setPipActive] = useState(false);
  const [miniWindowActive, setMiniWindowActive] = useState(false);

  const socketRef = useRef<Socket | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const previewRef = useRef<HTMLCanvasElement | null>(null);
  const recognitionRef = useRef<any>(null);
  const landmarkerRef = useRef<HandLandmarker | null>(null);
  const gestureStateRef = useRef(new GestureState());
  const smoothPointerRef = useRef(new SmoothPointer());
  const lastEmitRef = useRef({ x: 0.5, y: 0.5, t: 0 });
  const MOVE_EMIT_MIN_DIST = 0.002;
  const MOVE_EMIT_MAX_MS = 45;
  const rafRef = useRef<number | null>(null);
  const roomIdRef = useRef(roomId);
  const activeModeRef = useRef(activeMode);
  const lastFrameTimeRef = useRef(0);
  const frameCountRef = useRef(0);
  const lastClickActionRef = useRef('');
  const isStreamingRef = useRef(false);
  const bgIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const backgroundSessionRef = useRef(new BackgroundSession());
  const companionWindowRef = useRef<Window | null>(null);
  const miniWindowActiveRef = useRef(false);

  useEffect(() => {
    roomIdRef.current = roomId;
  }, [roomId]);

  useEffect(() => {
    activeModeRef.current = activeMode;
  }, [activeMode]);

  useEffect(() => {
    let cancelled = false;
    createHandLandmarker()
      .then((lm) => {
        if (!cancelled) {
          landmarkerRef.current = lm;
          setTrackerReady(true);
        }
      })
      .catch((err) => {
        console.error(err);
        if (!cancelled) {
          setConnectionError('Failed to load MediaPipe in browser.');
        }
      });
    return () => {
      cancelled = true;
      landmarkerRef.current?.close();
      landmarkerRef.current = null;
    };
  }, []);

  useEffect(() => {
    if ('webkitSpeechRecognition' in window) {
      const SpeechRecognition = (window as any).webkitSpeechRecognition;
      const recognition = new SpeechRecognition();
      recognition.continuous = true;
      recognition.interimResults = false;

      recognition.onresult = (event: any) => {
        const last = event.results.length - 1;
        const command = event.results[last][0].transcript;
        if (socketRef.current?.connected) {
          socketRef.current.emit('voice_command', {
            room: roomIdRef.current,
            command,
          });
        }
      };

      recognition.onend = () => {
        if (isListening) recognition.start();
      };

      recognitionRef.current = recognition;
    }
  }, [isListening]);

  const emitCommand = useCallback((action: string, x?: number, y?: number) => {
    if (!socketRef.current?.connected) return;

    if (action === 'MOUSE_MOVE' && x !== undefined && y !== undefined) {
      const now = performance.now();
      const dx = x - lastEmitRef.current.x;
      const dy = y - lastEmitRef.current.y;
      const dist = Math.hypot(dx, dy);
      const elapsed = now - lastEmitRef.current.t;
      if (dist < MOVE_EMIT_MIN_DIST && elapsed < MOVE_EMIT_MAX_MS) {
        return;
      }
      lastEmitRef.current = { x, y, t: now };
    }

    const payload: Record<string, unknown> = {
      room: roomIdRef.current,
      action,
    };
    if (x !== undefined) payload.x = Math.round(x * 10000) / 10000;
    if (y !== undefined) payload.y = Math.round(y * 10000) / 10000;
    socketRef.current.emit('relay_command', payload);
    setCmdCount((c) => c + 1);
  }, []);

  const runTrackingFrame = useCallback(() => {
    const video = videoRef.current;
    const canvas = previewRef.current;
    const landmarker = landmarkerRef.current;

    if (!video || !landmarker || video.readyState < 2) {
      return;
    }

    const timestamp = performance.now();
    const hidden = isDocumentHidden();

    let result;
    if (hidden || !canvas) {
      result = detectHandsFromVideo(video, landmarker, timestamp);
    } else {
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      result = drawHandPreview(ctx, video, landmarker, timestamp);
    }

    frameCountRef.current += 1;
    const now = performance.now();
    if (now - lastFrameTimeRef.current >= 1000) {
      setFps(frameCountRef.current);
      frameCountRef.current = 0;
      lastFrameTimeRef.current = now;
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
        activeModeRef.current = modeChange;
        setActiveMode(modeChange);
        socketRef.current?.emit('change_mode', {
          room: roomIdRef.current,
          mode: modeChange,
        });
      }

      if (command) {
        const isClick =
          command.action.includes('CLICK') || command.action === 'MOUSE_DRAG';
        if (isClick) {
          if (lastClickActionRef.current !== command.action) {
            emitCommand(command.action, command.x, command.y);
            lastClickActionRef.current = command.action;
          }
        } else {
          emitCommand(command.action, command.x, command.y);
          lastClickActionRef.current = '';
        }
      } else {
        lastClickActionRef.current = '';
      }
    } else if (activeModeRef.current === 0) {
      const coast = smoothPointerRef.current.coastOnly();
      if (coast) {
        emitCommand('MOUSE_MOVE', coast.x, coast.y);
      }
    }
  }, [emitCommand]);

  const scheduleVisibleLoop = useCallback(() => {
    if (!isStreamingRef.current || isDocumentHidden()) return;
    rafRef.current = requestAnimationFrame(() => {
      runTrackingFrame();
      scheduleVisibleLoop();
    });
  }, [runTrackingFrame]);

  const stopBackgroundInterval = useCallback(() => {
    if (bgIntervalRef.current !== null) {
      clearInterval(bgIntervalRef.current);
      bgIntervalRef.current = null;
    }
    setRunningInBackground(false);
  }, []);

  const startBackgroundInterval = useCallback(() => {
    if (bgIntervalRef.current !== null) return;
    setRunningInBackground(true);
    bgIntervalRef.current = setInterval(() => {
      if (!isStreamingRef.current) return;
      void videoRef.current?.play().catch(() => {});
      runTrackingFrame();
    }, 33);
  }, [runTrackingFrame]);

  const startTrackingScheduler = useCallback(() => {
    if (isDocumentHidden()) {
      startBackgroundInterval();
    } else {
      stopBackgroundInterval();
      scheduleVisibleLoop();
    }
  }, [scheduleVisibleLoop, startBackgroundInterval, stopBackgroundInterval]);

  const stopTrackingScheduler = useCallback(() => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    stopBackgroundInterval();
  }, [stopBackgroundInterval]);

  const connectToServer = () => {
    if (socketRef.current) socketRef.current.disconnect();

    setConnectionError(null);
    const isSecure = serverUrl.startsWith('https://');

    const socket = io(serverUrl, {
      transports: ['websocket', 'polling'],
      upgrade: true,
      secure: isSecure,
      reconnection: true,
      reconnectionAttempts: 10,
      reconnectionDelay: 1000,
      timeout: 20000,
    });

    socket.on('connect', () => {
      setIsConnected(true);
      setConnectionError(null);
      const room = roomIdRef.current.trim().toUpperCase();
      roomIdRef.current = room;
      socket.emit('join', {
        room,
        role: 'frontend',
        client_tracking: true,
      });
      socket.emit('change_mode', { room, mode: activeModeRef.current });
    });

    socket.on('agent_joined', () => {
      setAgentPaired(true);
    });

    socket.on('connect_error', (err) => {
      setConnectionError(err.message || 'Could not connect to server');
      setIsConnected(false);
    });

    socket.on('disconnect', () => {
      setIsConnected(false);
      setIsStreaming(false);
    });

    socket.on('join_error', (data: { error: string }) => {
      setConnectionError(`Join failed: ${data.error}`);
    });

    socket.on('mode_changed', (data: { mode: number }) => {
      activeModeRef.current = data.mode;
      setActiveMode(data.mode);
    });

    socketRef.current = socket;
  };

  const stopStreaming = useCallback(() => {
    isStreamingRef.current = false;
    stopTrackingScheduler();
    void backgroundSessionRef.current.stop();
    void leavePictureInPicture();
    setPipActive(false);
    if (companionWindowRef.current && !companionWindowRef.current.closed) {
      companionWindowRef.current.close();
    }
    companionWindowRef.current = null;
    miniWindowActiveRef.current = false;
    setMiniWindowActive(false);
    if (videoRef.current?.srcObject) {
      const tracks = (videoRef.current.srcObject as MediaStream).getTracks();
      tracks.forEach((t) => t.stop());
      videoRef.current.srcObject = null;
    }
    gestureStateRef.current = new GestureState();
    smoothPointerRef.current.reset();
    lastEmitRef.current = { x: 0.5, y: 0.5, t: 0 };
    setIsStreaming(false);
    setFps(0);
    setRunningInBackground(false);
  }, [stopTrackingScheduler]);

  const toggleStreaming = async () => {
    if (isStreaming) {
      stopStreaming();
      return;
    }
    if (!trackerReady || !landmarkerRef.current) {
      alert('MediaPipe is still loading. Wait a moment and try again.');
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          width: { ideal: TRACK_WIDTH },
          height: { ideal: TRACK_HEIGHT },
          frameRate: { ideal: 30, max: 30 },
          facingMode: 'user',
        },
        audio: false,
      });
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      isStreamingRef.current = true;
      await backgroundSessionRef.current.start();
      setIsStreaming(true);
      setCmdCount(0);
      const room = roomIdRef.current.trim().toUpperCase();
      roomIdRef.current = room;
      socketRef.current?.emit('join', {
        room,
        role: 'frontend',
        client_tracking: true,
      });
      lastFrameTimeRef.current = performance.now();
      frameCountRef.current = 0;
      startTrackingScheduler();
    } catch (err) {
      alert('Could not access webcam.');
      console.error(err);
    }
  };

  useEffect(() => {
    return () => {
      stopStreaming();
      socketRef.current?.disconnect();
    };
  }, [stopStreaming]);

  useEffect(() => {
    const onVisibility = async () => {
      if (!isStreamingRef.current) return;

      if (document.visibilityState === 'hidden') {
        if (rafRef.current !== null) {
          cancelAnimationFrame(rafRef.current);
          rafRef.current = null;
        }
        await videoRef.current?.play().catch(() => {});
        startBackgroundInterval();
        const stream = videoRef.current?.srcObject as MediaStream | null;
        const pip = await enterSmallPictureInPicture(
          stream,
          videoRef.current
        );
        setPipActive(pip.ok);
      } else {
        stopBackgroundInterval();
        await leavePictureInPicture();
        setPipActive(false);
        scheduleVisibleLoop();
      }
    };

    const onPipLeave = () => setPipActive(false);

    document.addEventListener('visibilitychange', onVisibility);
    videoRef.current?.addEventListener('leavepictureinpicture', onPipLeave);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      videoRef.current?.removeEventListener('leavepictureinpicture', onPipLeave);
    };
  }, [scheduleVisibleLoop, startBackgroundInterval, stopBackgroundInterval]);

  const togglePictureInPicture = async () => {
    const video = videoRef.current;
    const stream = video?.srcObject as MediaStream | null;
    if (!isStreaming || !stream) {
      alert('Start the camera first.');
      return;
    }
    if (pipActive) {
      await leavePictureInPicture();
      setPipActive(false);
      return;
    }
    const result = await enterSmallPictureInPicture(stream, video);
    if (result.ok) {
      setPipActive(true);
    } else {
      alert(
        result.message ||
          'Small pop-out failed. Use Chrome/Edge, or click Mini Window instead.'
      );
    }
  };

  const openMiniWindow = () => {
    if (!isStreaming || !videoRef.current?.srcObject) {
      alert('Start the camera first.');
      return;
    }
    if (companionWindowRef.current && !companionWindowRef.current.closed) {
      companionWindowRef.current.focus();
      return;
    }

    const w = openCompanionWindow({
      roomId: roomIdRef.current,
      serverUrl,
      mode: activeModeRef.current,
    });
    if (!w) {
      alert(
        'Pop-up was blocked. In your browser address bar, allow pop-ups for this site, then try again.'
      );
      return;
    }
    companionWindowRef.current = w;

    const onCompanionMessage = (e: MessageEvent) => {
      if (e.source !== w || e.data?.type !== 'companion-ready') return;
      w.postMessage(
        {
          type: 'init-stream',
          stream: videoRef.current?.srcObject,
          mode: activeModeRef.current,
        },
        window.location.origin
      );
      stopTrackingScheduler();
      miniWindowActiveRef.current = true;
      setMiniWindowActive(true);
    };
    window.addEventListener('message', onCompanionMessage);

    const closeCheck = window.setInterval(() => {
      if (!w.closed) return;
      window.clearInterval(closeCheck);
      window.removeEventListener('message', onCompanionMessage);
      companionWindowRef.current = null;
      miniWindowActiveRef.current = false;
      setMiniWindowActive(false);
      if (isStreamingRef.current) {
        startTrackingScheduler();
      }
    }, 400);
  };

  const toggleJarvis = () => {
    if (!recognitionRef.current) {
      alert('Speech recognition not supported in this browser.');
      return;
    }
    if (isListening) {
      recognitionRef.current.stop();
      setIsListening(false);
      setJarvisActive(false);
    } else {
      try {
        recognitionRef.current.start();
        setIsListening(true);
        setJarvisActive(true);
      } catch (e) {
        console.error(e);
      }
    }
  };

  const modes = [
    {
      id: 0,
      name: 'MOUSE MODE',
      description: 'Intuitive cursor control and clicking using finger landmarks.',
      color: '#00d2ff',
      icon: <MousePointer2 size={32} />,
      gestures: [
        'Index finger: Move cursor',
        'Index + Middle: Left Click',
        'Index + Thumb: Right Click',
        'Index + Pinky: Drag & Drop',
      ],
    },
    {
      id: 1,
      name: 'PRESENTATION MODE',
      description: 'Air-gestures to control slides with a virtual laser pointer.',
      color: '#ff8c00',
      icon: <Presentation size={32} />,
      gestures: [
        '1 finger (index): Previous slide',
        '2 fingers (index + middle): Next slide',
        'Three finger hold: Switch Mode',
      ],
    },
    {
      id: 2,
      name: 'MEDIA MODE',
      description: 'Control music and videos with simple hand motions.',
      color: '#00ffcc',
      icon: <Music size={32} />,
      gestures: [
        'Full Palm: Play/Pause',
        'Swipe Left: Next Track',
        'Swipe Right: Previous Track',
        'Finger in Box: Volume Control',
      ],
    },
    {
      id: 3,
      name: 'JARVIS MODE',
      description: 'Advanced voice-controlled assistant for system-wide commands.',
      color: '#eab308',
      icon: <Mic size={32} />,
      gestures: [
        "Say 'Open Chrome'",
        "Say 'Search [Topic]'",
        "Say 'Time' or 'Volume Up'",
        "Command: 'Close Application'",
      ],
    },
  ];

  const statusText = connectionError
    ? connectionError
    : !trackerReady
      ? 'Loading MediaPipe...'
      : isStreaming
        ? miniWindowActive
          ? `Mini window active · minimize this tab freely`
          : runningInBackground || pipActive
            ? `Background / pop-out · ${fps} fps · hand control on`
            : agentPaired
              ? `Tracking ${fps} fps · ${cmdCount} sent · use Mini Window to minimize`
              : `Tracking ${fps} fps · start local_agent.py (Room: ${roomId})`
        : 'Connect & start camera. Use Mini Window (best) or Small Pop-out, then minimize.';

  return (
    <div className="app-container">
      <div
        className="bg-glow"
        style={{
          background: `radial-gradient(circle at 50% 50%, ${modes[activeMode].color}22 0%, transparent 70%)`,
        }}
      />

      <nav className="navbar">
        <div className="logo">
          <Zap size={20} color={modes[activeMode].color} /> CLOUD CONTROLLER
        </div>
        <div className="nav-links">
          <a href="#features">Features</a>
          <a href="#setup">Agent Setup</a>
          <a href="https://github.com" className="github-link">
            <Github size={18} />
          </a>
        </div>
      </nav>

      <main className="hero">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8 }}
          className="hero-content"
        >
          <span
            className="badge"
            style={{
              borderColor: modes[activeMode].color,
              color: modes[activeMode].color,
            }}
          >
            Zero-lag local tracking
          </span>
          <h1>
            Control Your PC from <span>Anywhere</span>
          </h1>
          <p>
            MediaPipe runs in your browser. Only tiny mouse commands go through
            the cloud — hand to cursor feels instant.
          </p>

          <div
            className="connection-panel"
            style={{
              background: 'rgba(255,255,255,0.05)',
              padding: '15px',
              borderRadius: '10px',
              marginTop: '20px',
              marginBottom: '20px',
            }}
          >
            <div style={{ display: 'flex', gap: '10px', marginBottom: '10px' }}>
              <input
                type="text"
                value={serverUrl}
                onChange={(e) => setServerUrl(e.target.value)}
                placeholder="Server URL"
                style={{
                  flex: 1,
                  background: 'rgba(0,0,0,0.3)',
                  border: '1px solid #444',
                  color: 'white',
                  padding: '8px',
                  borderRadius: '5px',
                }}
              />
              <input
                type="text"
                value={roomId}
                onChange={(e) => setRoomId(e.target.value)}
                placeholder="Room ID"
                style={{
                  width: '100px',
                  background: 'rgba(0,0,0,0.3)',
                  border: '1px solid #444',
                  color: 'white',
                  padding: '8px',
                  borderRadius: '5px',
                }}
              />
              <button
                onClick={connectToServer}
                style={{
                  background: isConnected ? '#00ff0033' : '#444',
                  color: isConnected ? '#00ff00' : 'white',
                  border: 'none',
                  padding: '8px 15px',
                  borderRadius: '5px',
                  cursor: 'pointer',
                }}
              >
                {isConnected ? 'Connected' : 'Connect'}
              </button>
            </div>
            <p
              style={{
                fontSize: '0.85rem',
                color: connectionError ? '#ff6b6b' : '#888',
                marginTop: '8px',
                textAlign: 'left',
              }}
            >
              {statusText}
            </p>
          </div>

          <div className="hero-btns">
            <button
              className="btn-primary"
              onClick={toggleStreaming}
              disabled={!isConnected || !trackerReady}
              style={{
                backgroundColor: isStreaming ? '#ff4b2b' : modes[activeMode].color,
                opacity: isConnected && trackerReady ? 1 : 0.5,
              }}
            >
              {isStreaming ? 'Stop Camera' : 'Start Camera Stream'}
            </button>
            <button
              className={`btn-jarvis ${jarvisActive ? 'active' : ''}`}
              onClick={toggleJarvis}
              disabled={!isConnected}
              style={{
                border: `1px solid ${modes[3].color}`,
                color: jarvisActive ? '#000' : modes[3].color,
                backgroundColor: jarvisActive ? modes[3].color : 'transparent',
                opacity: isConnected ? 1 : 0.5,
              }}
            >
              <Mic size={18} />{' '}
              {jarvisActive ? 'Stop Listening' : 'Start Voice Control'}
            </button>
            <button
              type="button"
              onClick={openMiniWindow}
              disabled={!isStreaming}
              title="Opens a tiny window — keeps control when browser is minimized"
              style={{
                border: '1px solid #00ffcc',
                color: miniWindowActive ? '#000' : '#00ffcc',
                backgroundColor: miniWindowActive ? '#00ffcc' : 'transparent',
                padding: '10px 14px',
                borderRadius: '8px',
                cursor: isStreaming ? 'pointer' : 'not-allowed',
                opacity: isStreaming ? 1 : 0.45,
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
              }}
            >
              <PictureInPicture size={18} />
              {miniWindowActive ? 'Mini Window On' : 'Mini Window'}
            </button>
            <button
              type="button"
              onClick={togglePictureInPicture}
              disabled={!isStreaming}
              title="Small floating camera (Chrome/Edge)"
              style={{
                border: '1px solid #888',
                color: pipActive ? '#000' : '#ccc',
                backgroundColor: pipActive ? '#ccc' : 'transparent',
                padding: '10px 14px',
                borderRadius: '8px',
                cursor: isStreaming ? 'pointer' : 'not-allowed',
                opacity: isStreaming ? 1 : 0.45,
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                fontSize: '13px',
              }}
            >
              Small Pop-out
            </button>
          </div>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, scale: 0.8 }}
          animate={{ opacity: 1, scale: 1 }}
          className="hero-visual"
        >
          <div
            className="glass-card main-preview"
            style={{ position: 'relative', overflow: 'hidden' }}
          >
            <div
              className="mode-badge"
              style={{ backgroundColor: modes[activeMode].color, zIndex: 10 }}
            >
              {modes[activeMode].name}
              <span
                className="status-indicator"
                style={{
                  backgroundColor: isConnected ? '#00ff00' : '#ff0000',
                }}
              ></span>
            </div>
            <div
              className="visual-display"
              style={{
                width: '100%',
                height: '100%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                position: 'relative',
                overflow: 'hidden',
              }}
            >
              <canvas
                ref={previewRef}
                width={TRACK_WIDTH}
                height={TRACK_HEIGHT}
                style={{
                  width: '100%',
                  height: '100%',
                  objectFit: 'cover',
                  display: isStreaming ? 'block' : 'none',
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  zIndex: 2,
                }}
              />

              <video
                ref={videoRef}
                autoPlay
                playsInline
                muted
                disablePictureInPicture={false}
                style={hiddenVideoStyle}
              />

              {!isStreaming && (
                <>
                  <Video
                    size={100}
                    strokeWidth={1}
                    color={modes[activeMode].color}
                    opacity={0.3}
                  />
                  <AnimatePresence mode="wait">
                    <motion.div
                      key={activeMode}
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      className="gesture-icon-large"
                      style={{ position: 'absolute' }}
                    >
                      {modes[activeMode].icon}
                    </motion.div>
                  </AnimatePresence>
                </>
              )}
            </div>
          </div>
        </motion.div>
      </main>

      <section id="features" className="features-section">
        <div className="section-header">
          <h2>
            Seamless <span>Modes</span>
          </h2>
          <p>Switch between specialized modes optimized for different tasks.</p>
        </div>

        <div className="modes-grid">
          {modes.map((mode) => (
            <motion.div
              key={mode.id}
              className={`mode-card ${activeMode === mode.id ? 'active' : ''}`}
              onClick={() => {
                setActiveMode(mode.id);
                activeModeRef.current = mode.id;
                if (socketRef.current?.connected) {
                  socketRef.current.emit('change_mode', {
                    room: roomId,
                    mode: mode.id,
                  });
                }
              }}
              whileHover={{ y: -10 }}
              style={{ '--accent': mode.color } as React.CSSProperties}
            >
              <div className="card-icon">{mode.icon}</div>
              <h3>{mode.name}</h3>
              <p>{mode.description}</p>
              <div className="gesture-list">
                {mode.gestures.slice(0, 2).map((g, i) => (
                  <div key={i} className="gesture-item">
                    <ChevronRight size={14} /> {g}
                  </div>
                ))}
              </div>
            </motion.div>
          ))}
        </div>
      </section>

      <section id="setup" className="install-section" style={{ marginTop: '50px' }}>
        <div className="section-header">
          <h2>
            Local <span>Agent Setup</span>
          </h2>
          <p>To execute actions on your PC, download and run the local agent script.</p>
        </div>

        <div className="modes-grid" style={{ marginTop: '30px' }}>
          <div className="mode-card active" style={{ '--accent': '#00ffcc' } as React.CSSProperties}>
            <div className="card-icon">
              <Download size={32} />
            </div>
            <h3>1. Download Agent</h3>
            <p>You need `local_agent.py` and `agent_requirements.txt`.</p>
          </div>

          <div className="mode-card active" style={{ '--accent': '#ff8c00' } as React.CSSProperties}>
            <div className="card-icon">
              <Server size={32} />
            </div>
            <h3>2. Run the Agent</h3>
            <div
              className="terminal-body"
              style={{
                background: '#111',
                padding: '15px',
                borderRadius: '5px',
                marginTop: '10px',
              }}
            >
              <p style={{ fontFamily: 'monospace', color: '#ccc', fontSize: '14px' }}>
                pip install -r agent_requirements.txt
              </p>
              <p style={{ fontFamily: 'monospace', color: '#ccc', fontSize: '14px' }}>
                python local_agent.py
              </p>
            </div>
          </div>

          <div className="mode-card active" style={{ '--accent': '#00d2ff' } as React.CSSProperties}>
            <div className="card-icon">
              <Zap size={32} />
            </div>
            <h3>3. Pair & Control</h3>
            <ul
              style={{
                color: '#ccc',
                fontSize: '14px',
                lineHeight: '1.6',
                marginTop: '10px',
                paddingLeft: '20px',
              }}
            >
              <li>
                Server URL: <strong>{serverUrl}</strong>
              </li>
              <li>
                Room ID: <strong>{roomId}</strong>
              </li>
            </ul>
          </div>
        </div>
      </section>

      <footer className="footer" style={{ marginTop: '50px' }}>
        <p>© 2026 Cloud-Based Desktop Controller. Built with Computer Vision.</p>
      </footer>
    </div>
  );
};

export default App;
