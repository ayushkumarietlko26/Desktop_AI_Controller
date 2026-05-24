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
} from 'lucide-react';
import { createHandLandmarker, drawHandPreview } from './handTracker';
import {
  TRACK_WIDTH,
  TRACK_HEIGHT,
  GestureState,
  toPixelLandmarks,
  processGestures,
} from './gestureEngine';

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

  const socketRef = useRef<Socket | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const previewRef = useRef<HTMLCanvasElement | null>(null);
  const recognitionRef = useRef<any>(null);
  const landmarkerRef = useRef<HandLandmarker | null>(null);
  const gestureStateRef = useRef(new GestureState());
  const rafRef = useRef<number | null>(null);
  const roomIdRef = useRef(roomId);
  const activeModeRef = useRef(activeMode);
  const lastFrameTimeRef = useRef(0);
  const frameCountRef = useRef(0);
  const lastClickActionRef = useRef('');

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
    const payload: Record<string, unknown> = {
      room: roomIdRef.current,
      action,
    };
    if (x !== undefined) payload.x = x;
    if (y !== undefined) payload.y = y;
    socketRef.current.emit('relay_command', payload);
  }, []);

  const trackingLoop = useCallback(() => {
    const video = videoRef.current;
    const canvas = previewRef.current;
    const landmarker = landmarkerRef.current;

    if (!video || !canvas || !landmarker || video.readyState < 2) {
      rafRef.current = requestAnimationFrame(trackingLoop);
      return;
    }

    const ctx = canvas.getContext('2d');
    if (!ctx) {
      rafRef.current = requestAnimationFrame(trackingLoop);
      return;
    }

    const timestamp = performance.now();
    const result = drawHandPreview(ctx, video, landmarker, timestamp);

    frameCountRef.current += 1;
    const now = performance.now();
    if (now - lastFrameTimeRef.current >= 1000) {
      setFps(frameCountRef.current);
      frameCountRef.current = 0;
      lastFrameTimeRef.current = now;
    }

    if (result.landmarks?.length && result.handednesses?.length) {
      const lm = toPixelLandmarks(
        result.landmarks[0],
        TRACK_WIDTH,
        TRACK_HEIGHT
      );
      const handedness =
        result.handednesses[0][0].categoryName || 'Right';
      const { command, modeChange } = processGestures(
        lm,
        handedness,
        activeModeRef.current,
        gestureStateRef.current,
        TRACK_WIDTH,
        TRACK_HEIGHT
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
        const isMove = command.action === 'MOUSE_MOVE';
        const isClick = command.action.includes('CLICK') || command.action === 'MOUSE_DRAG';
        if (isMove) {
          emitCommand(command.action, command.x, command.y);
        } else if (isClick) {
          if (lastClickActionRef.current !== command.action) {
            emitCommand(command.action, command.x, command.y);
            lastClickActionRef.current = command.action;
          }
        } else {
          emitCommand(command.action);
          lastClickActionRef.current = '';
        }
      } else {
        lastClickActionRef.current = '';
      }
    }

    rafRef.current = requestAnimationFrame(trackingLoop);
  }, [emitCommand]);

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
      socket.emit('join', {
        room: roomId,
        role: 'frontend',
        client_tracking: true,
      });
      socket.emit('change_mode', { room: roomId, mode: activeModeRef.current });
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
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    if (videoRef.current?.srcObject) {
      const tracks = (videoRef.current.srcObject as MediaStream).getTracks();
      tracks.forEach((t) => t.stop());
      videoRef.current.srcObject = null;
    }
    gestureStateRef.current = new GestureState();
    setIsStreaming(false);
    setFps(0);
  }, []);

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
      setIsStreaming(true);
      lastFrameTimeRef.current = performance.now();
      frameCountRef.current = 0;
      rafRef.current = requestAnimationFrame(trackingLoop);
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
        'Index finger: Laser Pointer',
        'Swipe Left: Next Slide',
        'Swipe Right: Previous Slide',
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
      ? 'Loading MediaPipe (runs in your browser for zero-lag control)...'
      : isStreaming
        ? `Live tracking ${fps} fps · instant mouse relay`
        : 'Connect, then start camera. Hand tracking runs locally — no video round-trip lag.';

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
                style={{ display: 'none' }}
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
