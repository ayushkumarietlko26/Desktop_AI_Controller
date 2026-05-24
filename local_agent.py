import socketio
import pyautogui
import webbrowser
import os
import datetime
import time
import sys
import threading

# Pycaw for volume control
from ctypes import cast, POINTER
from comtypes import CLSCTX_ALL
from pycaw.pycaw import AudioUtilities, IAudioEndpointVolume

print("=" * 50)
print("  Desktop AI Controller - Local Agent")
print("=" * 50)

# Initialize volume controller
try:
    devices = AudioUtilities.GetSpeakers()
    interface = devices.Activate(IAudioEndpointVolume._iid_, CLSCTX_ALL, None)
    volume = cast(interface, POINTER(IAudioEndpointVolume))
    print("[OK] Volume controller initialized.")
except Exception as e:
    print(f"[WARN] Volume control unavailable: {e}")
    volume = None

# Screen resolution
SCREEN_W, SCREEN_H = pyautogui.size()
print(f"[OK] Screen resolution: {SCREEN_W}x{SCREEN_H}")

pyautogui.FAILSAFE = False
pyautogui.PAUSE = 0

IS_WINDOWS = sys.platform == "win32"
if IS_WINDOWS:
    import ctypes
    _user32 = ctypes.windll.user32

# High-frequency local cursor loop fills gaps between cloud updates (~10 fps)
MOUSE_TICK_HZ = 120
MOUSE_LERP = 0.88
PREDICT_MS = 0.14

mouse_lock = threading.Lock()
target_x, target_y = pyautogui.position()
cursor_x, cursor_y = float(target_x), float(target_y)
vel_x, vel_y = 0.0, 0.0
target_updated_at = time.time()
mouse_down = False
interpolator_running = True
move_log_counter = 0


def set_cursor(x, y):
    ix, iy = int(x), int(y)
    if IS_WINDOWS:
        _user32.SetCursorPos(ix, iy)
    else:
        pyautogui.moveTo(ix, iy)


def snap_cursor_to_target():
    global cursor_x, cursor_y
    with mouse_lock:
        cursor_x, cursor_y = target_x, target_y
    set_cursor(cursor_x, cursor_y)


def update_mouse_target(norm_x, norm_y):
    global target_x, target_y, vel_x, vel_y, target_updated_at
    new_x = max(0, min(SCREEN_W - 1, norm_x * SCREEN_W))
    new_y = max(0, min(SCREEN_H - 1, norm_y * SCREEN_H))
    now = time.time()

    with mouse_lock:
        dt = now - target_updated_at
        if 0 < dt < 0.35:
            vel_x = (new_x - target_x) / dt
            vel_y = (new_y - target_y) / dt
        target_x, target_y = new_x, new_y
        target_updated_at = now


def mouse_interpolator():
    global cursor_x, cursor_y
    tick = 1.0 / MOUSE_TICK_HZ
    while interpolator_running:
        with mouse_lock:
            elapsed = time.time() - target_updated_at
            aim_x, aim_y = target_x, target_y
            if elapsed < PREDICT_MS:
                aim_x += vel_x * elapsed
                aim_y += vel_y * elapsed
                aim_x = max(0, min(SCREEN_W - 1, aim_x))
                aim_y = max(0, min(SCREEN_H - 1, aim_y))

        cursor_x += (aim_x - cursor_x) * MOUSE_LERP
        cursor_y += (aim_y - cursor_y) * MOUSE_LERP

        if abs(aim_x - cursor_x) > 0.4 or abs(aim_y - cursor_y) > 0.4:
            set_cursor(cursor_x, cursor_y)

        time.sleep(tick)


threading.Thread(target=mouse_interpolator, daemon=True).start()
print(f"[OK] Mouse interpolator running at {MOUSE_TICK_HZ} Hz")

# Prompt for connection details
print()
SERVER_URL = input("Enter Cloud Server URL (e.g. https://your-app.onrender.com): ").strip()
ROOM_ID = input("Enter Room ID shown on the frontend page: ").strip()
print()

sio = socketio.Client(
    reconnection=True,
    reconnection_attempts=5,
    reconnection_delay=2,
    logger=False,
)


@sio.event
def connect():
    print("[CONNECTED] Successfully connected to server!")
    sio.emit("join", {"room": ROOM_ID, "role": "agent"})
    print(f"[JOINED] Room: {ROOM_ID}")


@sio.on("joined")
def on_joined(data):
    print(f"[ACK] Server confirmed join: {data}")


@sio.on("join_error")
def on_join_error(data):
    print(f"[ERROR] Server reported join error: {data.get('error')}")


@sio.event
def connect_error(data):
    print(f"[ERROR] Connection failed: {data}")


@sio.event
def disconnect():
    print("[DISCONNECTED] Lost connection to server.")


@sio.on("agent_command")
def on_agent_command(data):
    global mouse_down, move_log_counter

    action = data.get("action")

    if action in ["MOUSE_MOVE", "MOUSE_CLICK_LEFT", "MOUSE_CLICK_RIGHT", "MOUSE_DRAG"]:
        norm_x = data.get("x", 0.5)
        norm_y = data.get("y", 0.5)
        update_mouse_target(norm_x, norm_y)

        if action == "MOUSE_MOVE":
            move_log_counter += 1
            if move_log_counter % 40 == 0:
                print(f"[CMD] MOUSE_MOVE ({norm_x:.2f}, {norm_y:.2f})")
            if mouse_down:
                pyautogui.mouseUp()
                mouse_down = False
            return

        snap_cursor_to_target()
        print(f"[CMD] {action}")

        if action == "MOUSE_CLICK_LEFT":
            pyautogui.click()
        elif action == "MOUSE_CLICK_RIGHT":
            pyautogui.click(button="right")
        elif action == "MOUSE_DRAG":
            if not mouse_down:
                pyautogui.mouseDown()
                mouse_down = True
        return

    print(f"[CMD] {action}")

    if action == "SWIPE_RIGHT":
        pyautogui.press("right")
        time.sleep(0.35)
    elif action == "SWIPE_LEFT":
        pyautogui.press("left")
        time.sleep(0.35)
    elif action == "MEDIA_NEXT":
        pyautogui.press("nexttrack")
        time.sleep(0.35)
    elif action == "MEDIA_PREV":
        pyautogui.press("prevtrack")
        time.sleep(0.35)
    elif action == "MEDIA_PLAY_PAUSE":
        pyautogui.press("playpause")
        time.sleep(0.35)
    elif action == "VOICE_COMMAND":
        command = data.get("command", "")
        print(f"[VOICE] Executing: {command}")

        if "open chrome" in command or "open browser" in command:
            webbrowser.open("https://www.google.com")
        elif "open notepad" in command:
            os.system("notepad")
        elif "search" in command:
            query = command.replace("search", "").strip()
            webbrowser.open(f"https://www.google.com/search?q={query}")
        elif "time" in command:
            now = datetime.datetime.now().strftime("%H:%M")
            print(f"[JARVIS] Current time is {now}")
        elif "volume up" in command:
            pyautogui.press("volumeup", presses=5)
        elif "volume down" in command:
            pyautogui.press("volumedown", presses=5)
        elif "mute" in command:
            pyautogui.press("volumemute")
        elif "close" in command:
            pyautogui.hotkey("alt", "f4")
        else:
            print(f"[JARVIS] Command not recognized: {command}")


if __name__ == "__main__":
    try:
        print(f"Connecting to {SERVER_URL} ...")
        sio.connect(SERVER_URL, transports=["websocket"])
        sio.wait()
    except KeyboardInterrupt:
        print("\n[EXIT] Stopped by user.")
    except Exception as e:
        print(f"[ERROR] {e}")
    finally:
        interpolator_running = False
        input("\nPress Enter to exit...")
