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
presentation_prev_pattern = {}
last_presentation_slide_time = {}
room_processing = {}
room_client_tracking = {}

PRESENTATION_COOLDOWN_SEC = 0.7

# MediaPipe runs on smaller frames; preview is upscaled for clearer video
DISPLAY_WIDTH = 480
DISPLAY_HEIGHT = 360
PROCESS_WIDTH = 320
PROCESS_HEIGHT = 240
OUTPUT_JPEG_QUALITY = 68

# Smaller margin / sensitivity = hand travels less distance for full screen sweep
MOUSE_MARGIN = 0.10
MOUSE_SENSITIVITY = 0.68


def map_hand_to_screen(index_x, index_y, width, height):
    """Map index-finger pixel coords to normalized screen position (0-1)."""
    margin_x = width * MOUSE_MARGIN
    margin_y = height * MOUSE_MARGIN
    span_x = (width - 2 * margin_x) * MOUSE_SENSITIVITY
    span_y = (height - 2 * margin_y) * MOUSE_SENSITIVITY
    center_x = width / 2
    center_y = height / 2

    effective_x1 = center_x - span_x / 2
    effective_x2 = center_x + span_x / 2
    effective_y1 = center_y - span_y / 2
    effective_y2 = center_y + span_y / 2

    norm_x = 1.0 - float(np.interp(index_x, (effective_x1, effective_x2), (0, 1)))
    norm_y = float(np.interp(index_y, (effective_y1, effective_y2), (0, 1)))
    return float(np.clip(norm_x, 0, 1)), float(np.clip(norm_y, 0, 1))


def resolve_mouse_action(fingers_up, detector, img, hand1_landmarks):
    """Return mouse action string or None. Position is always sent separately."""
    if fingers_up[1] != 1:
        return None

    if fingers_up == [0, 1, 0, 0, 0]:
        return "MOUSE_MOVE"

    if fingers_up == [0, 1, 1, 0, 0]:
        dist, img, _ = detector.find_distance(img, hand1_landmarks, 1, 2, draw=True)
        return "MOUSE_CLICK_LEFT" if dist < 30 else "MOUSE_MOVE"

    if fingers_up == [1, 1, 0, 0, 0]:
        dist, img, _ = detector.find_distance(img, hand1_landmarks, 0, 1, draw=True)
        return "MOUSE_CLICK_RIGHT" if dist < 30 else "MOUSE_MOVE"

    if fingers_up == [0, 1, 0, 0, 1]:
        dist, img, _ = detector.find_distance(img, hand1_landmarks, 1, 4, draw=True)
        return "MOUSE_DRAG" if dist < 30 else "MOUSE_MOVE"

    return "MOUSE_MOVE"


@app.route("/")
def index():
    return "Desktop AI Controller Cloud Server is running!"


def normalize_room(room):
    if not room:
        return None
    return str(room).strip().upper()


@socketio.on("join")
def on_join(data):
    room = normalize_room(data.get("room"))
    role = data.get("role")  # 'frontend' or 'agent'
    client_tracking = data.get("client_tracking", False)
    if room:
        try:
            join_room(room)
            if client_tracking and role == "frontend":
                room_client_tracking[room] = True
                room_modes.setdefault(room, 0)
                room_processing.setdefault(room, False)
                print(f"[ROOM {room}] frontend joined (client-side tracking, sid={request.sid})")
                emit("joined", {"room": room, "role": role, "client_tracking": True})
                return
            if role == "agent":
                print(f"[ROOM {room}] agent joined (sid={request.sid})")
                emit("joined", {"room": room, "role": role})
                emit("agent_joined", {"room": room}, to=room)
                return
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
    room = normalize_room(data.get("room"))
    mode = data.get("mode", 0)
    if room:
        room_modes[room] = mode
        print(f"[ROOM {room}] Mode changed to {mode} via frontend")
        emit("mode_changed", {"mode": mode}, to=room)


relay_log_counter = {}


@socketio.on("relay_command")
def relay_command(data):
    """Instant relay: browser MediaPipe -> agent (no video processing)."""
    room = normalize_room(data.get("room"))
    if not room:
        return
    payload = {k: v for k, v in data.items() if k != "room"}
    if not payload:
        return
    emit("agent_command", payload, to=room)
    relay_log_counter[room] = relay_log_counter.get(room, 0) + 1
    if relay_log_counter[room] % 120 == 1:
        print(f"[ROOM {room}] relay {payload.get('action')} x={payload.get('x')} y={payload.get('y')}")


@socketio.on("video_frame")
def handle_video_frame(data):
    room = normalize_room(data.get("room"))
    if room_client_tracking.get(room):
        return
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

        display_img = cv2.resize(
            img, (DISPLAY_WIDTH, DISPLAY_HEIGHT), interpolation=cv2.INTER_AREA
        )
        process_img = cv2.resize(
            display_img, (PROCESS_WIDTH, PROCESS_HEIGHT), interpolation=cv2.INTER_AREA
        )
        height, width = PROCESS_HEIGHT, PROCESS_WIDTH

        detector = room_detectors[room]

        detector.find_hands(process_img)
        hand1_landmarks, hand1_type = detector.find_positions(process_img, hand_num=0)

        current_mode = room_modes.get(room, 0)

        if hand1_landmarks:
            index_x, index_y = hand1_landmarks[8][1], hand1_landmarks[8][2]
            fingers_up = detector.fingers_up(hand1_landmarks, hand1_type)

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
                mouse_x, mouse_y = map_hand_to_screen(index_x, index_y, width, height)
                action = resolve_mouse_action(fingers_up, detector, process_img, hand1_landmarks)
                if action:
                    emit(
                        "agent_command",
                        {"action": action, "x": mouse_x, "y": mouse_y},
                        to=room,
                    )

            elif current_mode == 1:
                pattern = "".join(str(f) for f in fingers_up)
                prev = presentation_prev_pattern.get(room, "")
                presentation_prev_pattern[room] = pattern
                now = time.time()
                if now - last_presentation_slide_time.get(room, 0) >= PRESENTATION_COOLDOWN_SEC:
                    if pattern == "01000" and prev != "01000":
                        action = "SWIPE_LEFT"
                        last_presentation_slide_time[room] = now
                    elif pattern == "01100" and prev != "01100":
                        action = "SWIPE_RIGHT"
                        last_presentation_slide_time[room] = now

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

            if action and current_mode != 0:
                emit("agent_command", {"action": action}, to=room)

        preview = cv2.resize(
            process_img,
            (DISPLAY_WIDTH, DISPLAY_HEIGHT),
            interpolation=cv2.INTER_CUBIC,
        )
        _, buffer = cv2.imencode(
            ".jpg", preview, [cv2.IMWRITE_JPEG_QUALITY, OUTPUT_JPEG_QUALITY]
        )
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
    room = normalize_room(data.get("room"))
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
