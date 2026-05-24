import base64
import cv2
import numpy as np
import os
import time
from flask import Flask, request
from flask_socketio import SocketIO, emit, join_room
from flask_cors import CORS
import HandTrackingModule as htm

# Match gunicorn GeventWebSocketWorker (Render deployment)
from gevent import monkey
monkey.patch_all()

app = Flask(__name__)
CORS(app, resources={r"/*": {"origins": "*"}})
socketio = SocketIO(
    app,
    cors_allowed_origins="*",
    async_mode="gevent",
    ping_timeout=60,
    ping_interval=25,
    max_http_buffer_size=5_000_000,
)

# State dictionaries to hold room-specific parameters
room_detectors = {}
room_modes = {}
mode_hold_times = {}
last_media_playpause_time = {}
room_processing = {}

# Process at lower resolution on cloud to keep latency low on Render free tier
PROCESS_WIDTH = 320
PROCESS_HEIGHT = 240


@app.route("/")
def index():
    return "Desktop AI Controller Cloud Server is running!"


@socketio.on("join")
def on_join(data):
    room = data.get("room")
    role = data.get("role")  # 'frontend' or 'agent'
    if room:
        try:
            join_room(room)
            if room not in room_detectors:
                print(f"[ROOM {room}] Initializing HandDetector...")
                room_detectors[room] = htm.HandDetector(
                    max_num_hands=1,
                    min_detection_confidence=0.7,
                    min_tracking_confidence=0.5,
                    model_complexity=0,
                )
                print(f"[ROOM {room}] HandDetector initialized successfully.")
            if room not in room_modes:
                room_modes[room] = 0  # Default to Mouse Mode (0)
            room_processing.setdefault(room, False)
            print(f"[ROOM {room}] {role} joined (sid={request.sid})")
            emit("joined", {"room": room, "role": role})
        except Exception as e:
            print(f"[ROOM {room}] ERROR during join/initialization: {e}")
            import traceback

            traceback.print_exc()
            emit("join_error", {"error": str(e)})


@socketio.on("change_mode")
def handle_change_mode(data):
    room = data.get("room")
    mode = data.get("mode", 0)
    if room:
        room_modes[room] = mode
        print(f"[ROOM {room}] Mode changed to {mode} via frontend")


@socketio.on("video_frame")
def handle_video_frame(data):
    room = data.get("room")
    if not room or room not in room_detectors:
        return

    # Drop frame if previous one is still being processed (prevents lag buildup)
    if room_processing.get(room):
        return

    frame_data = data.get("frame")
    if not frame_data:
        return

    if "base64," in frame_data:
        frame_data = frame_data.split("base64,")[1]

    room_processing[room] = True
    try:
        start_time = time.time()
        img_bytes = base64.b64decode(frame_data)
        np_arr = np.frombuffer(img_bytes, np.uint8)
        img = cv2.imdecode(np_arr, cv2.IMREAD_COLOR)

        if img is None:
            return

        height, width, _ = img.shape
        if width != PROCESS_WIDTH or height != PROCESS_HEIGHT:
            img = cv2.resize(img, (PROCESS_WIDTH, PROCESS_HEIGHT), interpolation=cv2.INTER_AREA)
            height, width = PROCESS_HEIGHT, PROCESS_WIDTH

        detector = room_detectors[room]

        detector.find_hands(img)
        hand1_landmarks, hand1_type = detector.find_positions(img, hand_num=0)

        current_mode = room_modes.get(room, 0)

        if hand1_landmarks:
            index_x, index_y = hand1_landmarks[8][1], hand1_landmarks[8][2]
            fingers_up = detector.fingers_up(hand1_landmarks, hand1_type)

            norm_x = 1.0 - (index_x / width)
            norm_y = index_y / height

            if fingers_up == [0, 1, 1, 1, 0]:
                hold_start = mode_hold_times.get(room)
                if not hold_start:
                    mode_hold_times[room] = time.time()
                elif time.time() - hold_start >= 1.5:
                    next_mode = (current_mode + 1) % 4
                    room_modes[room] = next_mode
                    current_mode = next_mode
                    mode_hold_times[room] = time.time() + 0.5
                    print(f"[ROOM {room}] Mode switched to {next_mode} via 3-finger gesture")
                    emit("mode_changed", {"mode": next_mode}, to=room)
            else:
                mode_hold_times[room] = None

            action = None

            if current_mode == 0:
                if fingers_up == [0, 1, 0, 0, 0]:
                    action = "MOUSE_MOVE"
                elif fingers_up == [0, 1, 1, 0, 0]:
                    dist, img, _ = detector.find_distance(img, hand1_landmarks, 1, 2, draw=True)
                    action = "MOUSE_CLICK_LEFT" if dist < 30 else "MOUSE_MOVE"
                elif fingers_up == [1, 1, 0, 0, 0]:
                    dist, img, _ = detector.find_distance(img, hand1_landmarks, 0, 1, draw=True)
                    if dist < 30:
                        action = "MOUSE_CLICK_RIGHT"
                elif fingers_up == [0, 1, 0, 0, 1]:
                    dist, img, _ = detector.find_distance(img, hand1_landmarks, 1, 4, draw=True)
                    action = "MOUSE_DRAG" if dist < 30 else "MOUSE_MOVE"

            elif current_mode == 1:
                swipe = detector.get_swipe_direction()
                if swipe == "Right":
                    action = "SWIPE_RIGHT"
                elif swipe == "Left":
                    action = "SWIPE_LEFT"

            elif current_mode == 2:
                swipe = detector.get_swipe_direction()
                if fingers_up == [1, 1, 1, 1, 1]:
                    if swipe == "Right":
                        action = "MEDIA_NEXT"
                    elif swipe == "Left":
                        action = "MEDIA_PREV"
                    else:
                        now = time.time()
                        last_time = last_media_playpause_time.get(room, 0)
                        if now - last_time >= 1.5:
                            action = "MEDIA_PLAY_PAUSE"
                            last_media_playpause_time[room] = now
                elif swipe == "Right":
                    action = "MEDIA_NEXT"
                elif swipe == "Left":
                    action = "MEDIA_PREV"

            if action:
                emit(
                    "agent_command",
                    {"action": action, "x": norm_x, "y": norm_y},
                    to=room,
                )

        _, buffer = cv2.imencode(".jpg", img, [cv2.IMWRITE_JPEG_QUALITY, 50])
        processed_base64 = base64.b64encode(buffer).decode("utf-8")
        emit(
            "processed_frame",
            {"frame": f"data:image/jpeg;base64,{processed_base64}"},
            to=room,
        )

        elapsed_ms = (time.time() - start_time) * 1000
        if elapsed_ms > 200:
            print(f"[ROOM {room}] Slow frame: {elapsed_ms:.0f} ms")

    except Exception as e:
        print(f"[ERROR] Processing frame: {e}")
        import traceback

        traceback.print_exc()
    finally:
        room_processing[room] = False


@socketio.on("voice_command")
def handle_voice_command(data):
    room = data.get("room")
    command = data.get("command", "")
    if room and command:
        print(f"[ROOM {room}] Voice command: {command}")
        emit(
            "agent_command",
            {"action": "VOICE_COMMAND", "command": command.lower()},
            to=room,
        )


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    socketio.run(app, host="0.0.0.0", port=port)
