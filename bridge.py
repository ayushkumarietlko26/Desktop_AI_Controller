from flask import Flask, jsonify
from flask_cors import CORS
import subprocess
import os
import signal
import sys

app = Flask(__name__)
CORS(app)

process = None

@app.route('/start', methods=['POST'])
def start_app():
    global process
    if process and process.poll() is None:
        return jsonify({"status": "already_running"}), 200
    
    # Path to your python executable in venv
    python_exe = os.path.join("venv", "Scripts", "python.exe")
    
    try:
        process = subprocess.Popen([python_exe, "mainGUI.py"])
        return jsonify({"status": "started"}), 200
    except Exception as e:
        return jsonify({"status": "error", "message": str(e)}), 500

@app.route('/stop', methods=['POST'])
def stop_app():
    global process
    if process and process.poll() is None:
        process.terminate()
        process = None
        return jsonify({"status": "stopped"}), 200
    return jsonify({"status": "not_running"}), 200



@app.route('/status', methods=['GET'])
def get_status():
    global process
    is_running = process is not None and process.poll() is None
    return jsonify({"status": "running" if is_running else "stopped"}), 200

@app.route('/jarvis/toggle', methods=['POST'])
def toggle_jarvis():
    try:
        with open("jarvis_flag.txt", "r") as f:
            current_state = f.read().strip()

        new_state = "active" if current_state == "inactive" else "inactive"

        with open("jarvis_flag.txt", "w") as f:
            f.write(new_state)
        
        return jsonify({"jarvis": new_state == "active"}), 200
    except Exception as e:
        return jsonify({"status": "error", "message": str(e)}), 500

if __name__ == '__main__':
    app.run(port=5000)
