import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
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
  Video
} from 'lucide-react';

const App: React.FC = () => {
  const [activeMode, setActiveMode] = useState(0);
  const [appStatus, setAppStatus] = useState('stopped');
  const [jarvisActive, setJarvisActive] = useState(false);

  React.useEffect(() => {
    const checkStatus = async () => {
      try {
        const res = await fetch('http://localhost:5000/status');
        const data = await res.json();
        setAppStatus(data.status);
      } catch (e) {
        setAppStatus('offline');
      }
    };
    const interval = setInterval(checkStatus, 2000);
    checkStatus();
    return () => clearInterval(interval);
  }, []);

  const toggleApp = async () => {
    const endpoint = appStatus === 'running' ? 'stop' : 'start';
    try {
      await fetch(`http://localhost:5000/${endpoint}`, { method: 'POST' });
    } catch (e) {
      alert('Bridge server is not running! Please start bridge.py first.');
    }
  };

  const toggleJarvis = async () => {
    try {
      const res = await fetch('http://localhost:5000/jarvis/toggle', { method: 'POST' });
      const data = await res.json();
      setJarvisActive(data.jarvis);
    } catch (e) {
      alert('Bridge server error!');
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
      {/* Background Glow */}
      <div className="bg-glow" style={{ background: `radial-gradient(circle at 50% 50%, ${modes[activeMode].color}22 0%, transparent 70%)` }} />

      {/* Hero Section */}
      <nav className="navbar">
        <div className="logo"><Zap size={20} color={modes[activeMode].color} /> AI CONTROLLER</div>
        <div className="nav-links">
          <a href="#features">Features</a>
          <a href="#gestures">Gestures</a>
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
            Now with Presentation Mode
          </span>
          <h1>Experience the Future of <span>Interaction</span></h1>
          <p>Control your desktop using advanced computer vision. No mouse, no keyboard, just your hands in the air.</p>
          <div className="hero-btns">
            <button 
              className="btn-primary" 
              onClick={toggleApp}
              style={{ backgroundColor: appStatus === 'running' ? '#ff4b2b' : modes[activeMode].color }}
            >
              {appStatus === 'running' ? 'Stop Controller' : 'Start Controller'}
            </button>
            <button 
              className={`btn-jarvis ${jarvisActive ? 'active' : ''}`}
              onClick={toggleJarvis}
              style={{ 
                border: `1px solid ${modes[3].color}`,
                color: jarvisActive ? '#000' : modes[3].color,
                backgroundColor: jarvisActive ? modes[3].color : 'transparent'
              }}
            >
              <Mic size={18} /> {jarvisActive ? 'Jarvis Active' : 'Activate Jarvis'}
            </button>
          </div>
        </motion.div>

        <motion.div 
          initial={{ opacity: 0, scale: 0.8 }}
          animate={{ opacity: 1, scale: 1 }}
          className="hero-visual"
        >
          <div className="glass-card main-preview">
             <div className="mode-badge" style={{ backgroundColor: modes[activeMode].color }}>
               {modes[activeMode].name}
               <span className="status-indicator" style={{ backgroundColor: appStatus === 'running' ? '#00ff00' : '#666' }}></span>
             </div>
             <div className="visual-display">
                <Video size={100} strokeWidth={1} color={modes[activeMode].color} opacity={0.3} />
                <AnimatePresence mode="wait">
                  <motion.div
                    key={activeMode}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="gesture-icon-large"
                  >
                    {modes[activeMode].icon}
                  </motion.div>
                </AnimatePresence>
             </div>
          </div>
        </motion.div>
      </main>

      {/* Features Grid */}
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

      {/* Gesture Simulator */}
      <section id="gestures" className="simulator-section">
        <div className="glass-card simulator-container">
           <div className="simulator-info">
             <h2>Interactive <span>Gesture</span> Guide</h2>
             <p>Select a mode to see the required hand positions.</p>
             <div className="gesture-detail-list">
                {modes[activeMode].gestures.map((g, i) => (
                  <motion.div 
                    initial={{ x: -20, opacity: 0 }}
                    whileInView={{ x: 0, opacity: 1 }}
                    transition={{ delay: i * 0.1 }}
                    key={i} 
                    className="detail-item"
                  >
                    <Hand size={18} color={modes[activeMode].color} />
                    <span>{g}</span>
                  </motion.div>
                ))}
             </div>
           </div>
           <div className="simulator-view">
             <div className="hand-visualizer">
                {/* SVG Hand Illustration placeholder */}
                <div className="glow-sphere" style={{ backgroundColor: modes[activeMode].color }} />
                <Hand size={150} strokeWidth={1} className="floating-hand" />
             </div>
           </div>
        </div>
      </section>

      {/* Installation */}
      <section className="install-section">
        <div className="install-card">
          <div className="terminal-header">
            <div className="dot red" />
            <div className="dot yellow" />
            <div className="dot green" />
            <span>Terminal</span>
          </div>
          <div className="terminal-body">
            <p><span className="cmd">git clone</span> https://github.com/user/ai-controller.git</p>
            <p><span className="cmd">pip install</span> -r requirements.txt</p>
            <p><span className="cmd">python</span> mainGUI.py</p>
          </div>
        </div>
      </section>

      <footer className="footer">
        <p>© 2026 AI-Based Desktop Controller. Built with Computer Vision.</p>
      </footer>
    </div>
  );
};

export default App;
