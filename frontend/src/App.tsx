import React, { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { io, Socket } from 'socket.io-client';
import { 
  MousePointer2, 
  Presentation, 
  Music, 
  Mic, 
  Power, 
  ChevronRight, 
  Github, 
  Zap,
  Hand,
  Volume2,
  Video,
  Download,
  Server
} from 'lucide-react';

const App: React.FC = () => {
  const [activeMode, setActiveMode] = useState(0);
  const [jarvisActive, setJarvisActive] = useState(false);
  
  // Cloud Architecture States
  const [serverUrl, setServerUrl] = useState('http://localhost:5000');
  const [roomId, setRoomId] = useState(() => Math.random().toString(36).substring(2, 8).toUpperCase());
  const [isConnected, setIsConnected] = useState(false);
  const [isStreaming, setIsStreaming] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [processedImage, setProcessedImage] = useState<string | null>(null);

  const socketRef = useRef<Socket | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamIntervalRef = useRef<number | null>(null);
  const recognitionRef = useRef<any>(null);

  // Initialize Speech Recognition
  useEffect(() => {
    if ('webkitSpeechRecognition' in window) {
      const SpeechRecognition = (window as any).webkitSpeechRecognition;
      const recognition = new SpeechRecognition();
      recognition.continuous = true;
      recognition.interimResults = false;
      
      recognition.onresult = (event: any) => {
        const last = event.results.length - 1;
        const command = event.results[last][0].transcript;
        console.log("Heard:", command);
        if (socketRef.current && isConnected) {
          socketRef.current.emit('voice_command', { room: roomId, command });
        }
      };

      recognition.onend = () => {
        if (isListening) {
          recognition.start(); // Restart if it stops automatically while still "listening"
        }
      };

      recognitionRef.current = recognition;
    }
  }, [isConnected, roomId, isListening]);

  // Handle Socket Connection
  const connectToServer = () => {
    if (socketRef.current) socketRef.current.disconnect();
    
    const socket = io(serverUrl);
    
    socket.on('connect', () => {
      setIsConnected(true);
      socket.emit('join', { room: roomId, role: 'frontend' });
    });

    socket.on('disconnect', () => {
      setIsConnected(false);
      setIsStreaming(false);
    });

    socket.on('processed_frame', (data: { frame: string }) => {
      setProcessedImage(data.frame);
    });

    socketRef.current = socket;
  };

  useEffect(() => {
    return () => {
      if (socketRef.current) socketRef.current.disconnect();
      if (streamIntervalRef.current) clearInterval(streamIntervalRef.current);
      if (videoRef.current?.srcObject) {
        const tracks = (videoRef.current.srcObject as MediaStream).getTracks();
        tracks.forEach(track => track.stop());
      }
    };
  }, []);

  // Handle Webcam Streaming
  const toggleStreaming = async () => {
    if (isStreaming) {
      setIsStreaming(false);
      if (streamIntervalRef.current) clearInterval(streamIntervalRef.current);
      if (videoRef.current?.srcObject) {
        const tracks = (videoRef.current.srcObject as MediaStream).getTracks();
        tracks.forEach(track => track.stop());
        videoRef.current.srcObject = null;
      }
      setProcessedImage(null);
    } else {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480 } });
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          videoRef.current.play();
        }
        setIsStreaming(true);

        streamIntervalRef.current = window.setInterval(() => {
          if (videoRef.current && canvasRef.current && socketRef.current && isConnected) {
            const ctx = canvasRef.current.getContext('2d');
            if (ctx) {
              ctx.drawImage(videoRef.current, 0, 0, 640, 480);
              const dataUrl = canvasRef.current.toDataURL('image/jpeg', 0.5); // compress
              socketRef.current.emit('video_frame', { room: roomId, frame: dataUrl });
            }
          }
        }, 100); // 10 FPS to save bandwidth
      } catch (err) {
        alert("Could not access webcam.");
        console.error(err);
      }
    }
  };

  const toggleJarvis = () => {
    if (!recognitionRef.current) {
      alert("Speech recognition not supported in this browser.");
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
      name: "MOUSE MODE",
      description: "Intuitive cursor control and clicking using finger landmarks.",
      color: "#00d2ff",
      icon: <MousePointer2 size={32} />,
      gestures: ["Index finger: Move cursor", "Index + Middle: Left Click", "Index + Thumb: Right Click", "Index + Pinky: Drag & Drop"]
    },
    {
      id: 1,
      name: "PRESENTATION MODE",
      description: "Air-gestures to control slides with a virtual laser pointer.",
      color: "#ff8c00",
      icon: <Presentation size={32} />,
      gestures: ["Index finger: Laser Pointer", "Swipe Left: Next Slide", "Swipe Right: Previous Slide", "Three finger hold: Switch Mode"]
    },
    {
      id: 2,
      name: "MEDIA MODE",
      description: "Control music and videos with simple hand motions.",
      color: "#00ffcc",
      icon: <Music size={32} />,
      gestures: ["Full Palm: Play/Pause", "Swipe Left: Next Track", "Swipe Right: Previous Track", "Finger in Box: Volume Control"]
    },
    {
      id: 3,
      name: "JARVIS MODE",
      description: "Advanced voice-controlled assistant for system-wide commands.",
      color: "#eab308",
      icon: <Mic size={32} />,
      gestures: ["Say 'Open Chrome'", "Say 'Search [Topic]'", "Say 'Time' or 'Volume Up'", "Command: 'Close Application'"]
    }
  ];

  return (
    <div className="app-container">
      <div className="bg-glow" style={{ background: `radial-gradient(circle at 50% 50%, ${modes[activeMode].color}22 0%, transparent 70%)` }} />

      <nav className="navbar">
        <div className="logo"><Zap size={20} color={modes[activeMode].color} /> CLOUD CONTROLLER</div>
        <div className="nav-links">
          <a href="#features">Features</a>
          <a href="#setup">Agent Setup</a>
          <a href="https://github.com" className="github-link"><Github size={18} /></a>
        </div>
      </nav>

      <main className="hero">
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8 }}
          className="hero-content"
        >
          <span className="badge" style={{ borderColor: modes[activeMode].color, color: modes[activeMode].color }}>
            Now fully Cloud Hosted
          </span>
          <h1>Control Your PC from <span>Anywhere</span></h1>
          <p>Share this link, enter the Room ID on your local agent, and control your PC directly from this browser.</p>
          
          <div className="connection-panel" style={{ background: 'rgba(255,255,255,0.05)', padding: '15px', borderRadius: '10px', marginTop: '20px', marginBottom: '20px' }}>
            <div style={{ display: 'flex', gap: '10px', marginBottom: '10px' }}>
              <input 
                type="text" 
                value={serverUrl} 
                onChange={(e) => setServerUrl(e.target.value)} 
                placeholder="Server URL"
                style={{ flex: 1, background: 'rgba(0,0,0,0.3)', border: '1px solid #444', color: 'white', padding: '8px', borderRadius: '5px' }}
              />
              <input 
                type="text" 
                value={roomId} 
                onChange={(e) => setRoomId(e.target.value)} 
                placeholder="Room ID"
                style={{ width: '100px', background: 'rgba(0,0,0,0.3)', border: '1px solid #444', color: 'white', padding: '8px', borderRadius: '5px' }}
              />
              <button 
                onClick={connectToServer}
                style={{ background: isConnected ? '#00ff0033' : '#444', color: isConnected ? '#00ff00' : 'white', border: 'none', padding: '8px 15px', borderRadius: '5px', cursor: 'pointer' }}
              >
                {isConnected ? 'Connected' : 'Connect'}
              </button>
            </div>
          </div>

          <div className="hero-btns">
            <button 
              className="btn-primary" 
              onClick={toggleStreaming}
              disabled={!isConnected}
              style={{ backgroundColor: isStreaming ? '#ff4b2b' : modes[activeMode].color, opacity: isConnected ? 1 : 0.5 }}
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
                opacity: isConnected ? 1 : 0.5
              }}
            >
              <Mic size={18} /> {jarvisActive ? 'Stop Listening' : 'Start Voice Control'}
            </button>
          </div>
        </motion.div>

        <motion.div 
          initial={{ opacity: 0, scale: 0.8 }}
          animate={{ opacity: 1, scale: 1 }}
          className="hero-visual"
        >
          <div className="glass-card main-preview" style={{ position: 'relative', overflow: 'hidden' }}>
             <div className="mode-badge" style={{ backgroundColor: modes[activeMode].color, zIndex: 10 }}>
               {modes[activeMode].name}
               <span className="status-indicator" style={{ backgroundColor: isConnected ? '#00ff00' : '#ff0000' }}></span>
             </div>
             <div className="visual-display" style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                {processedImage ? (
                  <img src={processedImage} alt="Processed feed" style={{ width: '100%', height: '100%', objectFit: 'cover', transform: 'scaleX(-1)' }} />
                ) : (
                  <>
                    <Video size={100} strokeWidth={1} color={modes[activeMode].color} opacity={0.3} />
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

      {/* Hidden video and canvas elements for streaming */}
      <video ref={videoRef} style={{ display: 'none' }} />
      <canvas ref={canvasRef} width="640" height="480" style={{ display: 'none' }} />

      <section id="features" className="features-section">
        <div className="section-header">
          <h2>Seamless <span>Modes</span></h2>
          <p>Switch between specialized modes optimized for different tasks.</p>
        </div>

        <div className="modes-grid">
          {modes.map((mode) => (
            <motion.div 
              key={mode.id}
              className={`mode-card ${activeMode === mode.id ? 'active' : ''}`}
              onClick={() => setActiveMode(mode.id)}
              whileHover={{ y: -10 }}
              style={{ '--accent': mode.color } as any}
            >
              <div className="card-icon">{mode.icon}</div>
              <h3>{mode.name}</h3>
              <p>{mode.description}</p>
              <div className="gesture-list">
                {mode.gestures.slice(0, 2).map((g, i) => (
                  <div key={i} className="gesture-item"><ChevronRight size={14} /> {g}</div>
                ))}
              </div>
            </motion.div>
          ))}
        </div>
      </section>

      {/* Local Agent Setup */}
      <section id="setup" className="install-section" style={{ marginTop: '50px' }}>
        <div className="section-header">
          <h2>Local <span>Agent Setup</span></h2>
          <p>To execute actions on your PC, download and run the local agent script.</p>
        </div>
        
        <div className="modes-grid" style={{ marginTop: '30px' }}>
          <div className="mode-card active" style={{ '--accent': '#00ffcc' } as any}>
            <div className="card-icon"><Download size={32} /></div>
            <h3>1. Download Agent</h3>
            <p>You need two files: `local_agent.py` and `agent_requirements.txt`.</p>
            <div style={{ marginTop: '15px' }}>
               {/* Note: In a real environment, you'd provide real download links. For now, they copy manually. */}
               <a href="https://raw.githubusercontent.com/user/ai-controller/main/local_agent.py" target="_blank" className="gesture-item" style={{ color: '#00ffcc', textDecoration: 'none' }}>Download local_agent.py</a><br/>
               <a href="https://raw.githubusercontent.com/user/ai-controller/main/agent_requirements.txt" target="_blank" className="gesture-item" style={{ color: '#00ffcc', textDecoration: 'none' }}>Download agent_requirements.txt</a>
            </div>
          </div>
          
          <div className="mode-card active" style={{ '--accent': '#ff8c00' } as any}>
            <div className="card-icon"><Server size={32} /></div>
            <h3>2. Run the Agent</h3>
            <p>Open your terminal and run the following commands:</p>
            <div className="terminal-body" style={{ background: '#111', padding: '15px', borderRadius: '5px', marginTop: '10px' }}>
              <p style={{ fontFamily: 'monospace', color: '#ccc', fontSize: '14px' }}>pip install -r agent_requirements.txt</p>
              <p style={{ fontFamily: 'monospace', color: '#ccc', fontSize: '14px' }}>python local_agent.py</p>
            </div>
          </div>
          
          <div className="mode-card active" style={{ '--accent': '#00d2ff' } as any}>
            <div className="card-icon"><Zap size={32} /></div>
            <h3>3. Pair & Control</h3>
            <p>When the local agent asks, paste the Server URL and Room ID:</p>
            <ul style={{ color: '#ccc', fontSize: '14px', lineHeight: '1.6', marginTop: '10px', paddingLeft: '20px' }}>
              <li>Server URL: <strong>{serverUrl}</strong></li>
              <li>Room ID: <strong>{roomId}</strong></li>
            </ul>
            <p style={{ marginTop: '10px', fontSize: '14px' }}>Once connected, turn on the Camera Stream above!</p>
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
