import base64
import cv2
import numpy as np
import os
from flask import Flask, request
from flask_socketio import SocketIO, emit, join_room
from flask_cors import CORS
import HandTrackingModule as htm

app = Flask(__name__)
CORS(app, resources={r"/*": {"origins": "*"}})
socketio = SocketIO(app, cors_allowed_origins="*", async_mode="gevent", logger=True, engineio_logger=True)

# Dictionary to hold the detector for each room
room_detectors = {}

@app.route('/')
def index():
    return "Desktop AI Controller Cloud Server is running!"

@socketio.on('join')
def on_join(data):
    room = data.get('room')
    role = data.get('role')  # 'frontend' or 'agent'
    if room:
        join_room(room)
        if room not in room_detectors:
            room_detectors[room] = htm.HandDetector(max_num_hands=1, min_detection_confidence=0.8)
        print(f"[ROOM {room}] {role} joined (sid={request.sid})")
        emit('joined', {'room': room, 'role': role})

@socketio.on('video_frame')
def handle_video_frame(data):
    room = data.get('room')
    if not room or room not in room_detectors:
        return

    frame_data = data.get('frame')
    if not frame_data:
        return

    # Remove data URL header if present
    if "base64," in frame_data:
        frame_data = frame_data.split("base64,")[1]

    try:
        img_bytes = base64.b64decode(frame_data)
        np_arr = np.frombuffer(img_bytes, np.uint8)
        img = cv2.imdecode(np_arr, cv2.IMREAD_COLOR)

        if img is None:
            return

        height, width, _ = img.shape
        detector = room_detectors[room]

        detector.find_hands(img)
        hand1_landmarks, hand1_type = detector.find_positions(img, hand_num=0)

        if hand1_landmarks:
            index_x, index_y = hand1_landmarks[8][1], hand1_landmarks[8][2]
            fingers_up = detector.fingers_up(hand1_landmarks, hand1_type)

            # Normalize coordinates to 0.0 - 1.0
            norm_x = index_x / width
            norm_y = index_y / height

            action = None

            if fingers_up == [0, 1, 0, 0, 0]:
                action = "MOUSE_MOVE"
            elif fingers_up == [0, 1, 1, 0, 0]:
                dist, img, _ = detector.find_distance(img, hand1_landmarks, 1, 2, draw=True)
                if dist < 30:
                    action = "MOUSE_CLICK_LEFT"
                else:
                    action = "MOUSE_MOVE"
            elif fingers_up == [1, 1, 0, 0, 0]:
                dist, img, _ = detector.find_distance(img, hand1_landmarks, 0, 1, draw=True)
                if dist < 30:
                    action = "MOUSE_CLICK_RIGHT"
            elif fingers_up == [0, 1, 0, 0, 1]:
                dist, img, _ = detector.find_distance(img, hand1_landmarks, 1, 4, draw=True)
                if dist < 30:
                    action = "MOUSE_DRAG"
                else:
                    action = "MOUSE_MOVE"
            elif fingers_up == [1, 1, 1, 1, 1]:
                swipe = detector.get_swipe_direction()
                if swipe == 'Right':
                    action = "SWIPE_RIGHT"
                elif swipe == 'Left':
                    action = "SWIPE_LEFT"

            if action:
                print(f"[ROOM {room}] Action: {action} x={norm_x:.2f} y={norm_y:.2f}")
                emit('agent_command', {
                    'action': action,
                    'x': norm_x,
                    'y': norm_y
                }, to=room)

        # Send processed frame (with skeleton) back to the room
        _, buffer = cv2.imencode('.jpg', img, [cv2.IMWRITE_JPEG_QUALITY, 60])
        processed_base64 = base64.b64encode(buffer).decode('utf-8')
        emit('processed_frame', {
            'frame': f"data:image/jpeg;base64,{processed_base64}"
        }, to=room)

    except Exception as e:
        print(f"[ERROR] Processing frame: {e}")

@socketio.on('voice_command')
def handle_voice_command(data):
    room = data.get('room')
    command = data.get('command', '')
    if room and command:
        print(f"[ROOM {room}] Voice command: {command}")
        emit('agent_command', {
            'action': 'VOICE_COMMAND',
            'command': command.lower()
        }, to=room)

if __name__ == '__main__':
    port = int(os.environ.get('PORT', 5000))
    socketio.run(app, host='0.0.0.0', port=port)
