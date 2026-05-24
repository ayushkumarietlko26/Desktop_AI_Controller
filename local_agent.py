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

# Smooth cursor — only takes over when remote hand commands are active
MOUSE_TICK_HZ = 120
MOUSE_LERP = 0.48
TARGET_BLEND = 0.62
DEAD_ZONE_PX = 2
IDLE_RELEASE_SEC = 4.0
MOVE_STEP = 0.55

mouse_lock = threading.Lock()
target_x, target_y = 0.0, 0.0
cursor_x, cursor_y = 0.0, 0.0
target_updated_at = 0.0
last_command_at = 0.0
control_active = False
mouse_down = False
interpolator_running = False
interpolator_thread = None
move_log_counter = 0


def set_cursor(x, y):
    ix, iy = int(round(x)), int(round(y))
    if IS_WINDOWS:
        _user32.SetCursorPos(ix, iy)
    else:
        pyautogui.moveTo(ix, iy)


def sync_cursor_state():
    """Align internal state with the real cursor (does not move the mouse)."""
    global target_x, target_y, cursor_x, cursor_y
    px, py = pyautogui.position()
    with mouse_lock:
        target_x, target_y = float(px), float(py)
        cursor_x, cursor_y = float(px), float(py)


def activate_control():
    global control_active, last_command_at
    if not control_active:
        sync_cursor_state()
        control_active = True
        print("[CONTROL] Hand control active (cursor follows your gesture).")
    last_command_at = time.time()


def release_control():
    global control_active, mouse_down
    if not control_active:
        return
    control_active = False
    if mouse_down:
        pyautogui.mouseUp()
        mouse_down = False
    print("[CONTROL] Cursor released — your trackpad/mouse works normally again.")


def snap_cursor_to_target():
    global cursor_x, cursor_y
    with mouse_lock:
        cursor_x, cursor_y = target_x, target_y
    if control_active:
        set_cursor(cursor_x, cursor_y)


def update_mouse_target(norm_x, norm_y, *, is_move=False):
    global target_x, target_y, target_updated_at, last_command_at
    activate_control()
    new_x = max(0, min(SCREEN_W - 1, norm_x * SCREEN_W))
    new_y = max(0, min(SCREEN_H - 1, norm_y * SCREEN_H))

    with mouse_lock:
        if (
            not is_move
            and abs(new_x - target_x) < DEAD_ZONE_PX
            and abs(new_y - target_y) < DEAD_ZONE_PX
        ):
            last_command_at = time.time()
            return
        blend = TARGET_BLEND if is_move else TARGET_BLEND * 0.7
        target_x += (new_x - target_x) * blend
        target_y += (new_y - target_y) * blend
        target_updated_at = time.time()
        last_command_at = time.time()


def apply_move_step():
    """Immediate cursor step on each MOUSE_MOVE (clicks already snap)."""
    global cursor_x, cursor_y
    with mouse_lock:
        cursor_x += (target_x - cursor_x) * MOVE_STEP
        cursor_y += (target_y - cursor_y) * MOVE_STEP
        cx, cy = cursor_x, cursor_y
    if control_active:
        set_cursor(cx, cy)


def mouse_interpolator():
    global cursor_x, cursor_y
    tick = 1.0 / MOUSE_TICK_HZ
    while interpolator_running:
        if not control_active:
            time.sleep(0.05)
            continue

        if time.time() - last_command_at > IDLE_RELEASE_SEC:
            release_control()
            time.sleep(0.05)
            continue

        with mouse_lock:
            aim_x, aim_y = target_x, target_y

        cursor_x += (aim_x - cursor_x) * MOUSE_LERP
        cursor_y += (aim_y - cursor_y) * MOUSE_LERP
        set_cursor(cursor_x, cursor_y)
        time.sleep(tick)


def start_interpolator():
    global interpolator_running, interpolator_thread
    if interpolator_thread and interpolator_thread.is_alive():
        return
    interpolator_running = True
    interpolator_thread = threading.Thread(target=mouse_interpolator, daemon=True)
    interpolator_thread.start()


def stop_interpolator():
    global interpolator_running
    interpolator_running = False
    release_control()


print("[OK] Agent ready — your mouse stays free until the browser sends hand commands.")

# Prompt for connection details
print()
SERVER_URL = input("Enter Cloud Server URL (e.g. https://your-app.onrender.com): ").strip()
ROOM_ID = input("Enter Room ID shown on the frontend page: ").strip().upper()
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
    release_control()


@sio.on("agent_command")
def on_agent_command(data):
    global mouse_down, move_log_counter

    action = data.get("action")

    if action in ["MOUSE_MOVE", "MOUSE_CLICK_LEFT", "MOUSE_CLICK_RIGHT", "MOUSE_DRAG"]:
        norm_x = data.get("x", 0.5)
        norm_y = data.get("y", 0.5)
        is_move = action == "MOUSE_MOVE"
        update_mouse_target(norm_x, norm_y, is_move=is_move)

        if action == "MOUSE_MOVE":
            apply_move_step()
            move_log_counter += 1
            if move_log_counter % 60 == 0:
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
    start_interpolator()
    try:
        print(f"Connecting to {SERVER_URL} ...")
        print("(You can still use your mouse normally while waiting.)")
        sio.connect(SERVER_URL, transports=["websocket"])
        sio.wait()
    except KeyboardInterrupt:
        print("\n[EXIT] Stopped by user.")
    except Exception as e:
        print(f"[ERROR] {e}")
    finally:
        stop_interpolator()
        input("\nPress Enter to exit...")
