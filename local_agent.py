import socketio
import pyautogui
import webbrowser
import os
import datetime
import time

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

# Disable pyautogui failsafe so mouse can reach corners
pyautogui.FAILSAFE = False

# Mouse smoothing
SMOOTHING = 5
prev_mouse_x, prev_mouse_y = pyautogui.position()
mouse_down = False

# Prompt for connection details
print()
SERVER_URL = input("Enter Cloud Server URL (e.g. https://your-app.onrender.com): ").strip()
ROOM_ID = input("Enter Room ID shown on the frontend page: ").strip()
print()

# Create Socket.IO client - force websocket transport to avoid polling issues
sio = socketio.Client(
    reconnection=True,
    reconnection_attempts=5,
    reconnection_delay=2,
    logger=True
)

@sio.event
def connect():
    print("[CONNECTED] Successfully connected to server!")
    sio.emit('join', {'room': ROOM_ID, 'role': 'agent'})
    print(f"[JOINED] Room: {ROOM_ID}")

@sio.on('joined')
def on_joined(data):
    print(f"[ACK] Server confirmed join: {data}")

@sio.on('join_error')
def on_join_error(data):
    print(f"[ERROR] Server reported join error: {data.get('error')}")

@sio.event
def connect_error(data):
    print(f"[ERROR] Connection failed: {data}")

@sio.event
def disconnect():
    print("[DISCONNECTED] Lost connection to server.")

@sio.on('agent_command')
def on_agent_command(data):
    global prev_mouse_x, prev_mouse_y, mouse_down

    action = data.get('action')
    print(f"[CMD] {action}")

    # --- MOUSE ACTIONS ---
    if action in ["MOUSE_MOVE", "MOUSE_CLICK_LEFT", "MOUSE_CLICK_RIGHT", "MOUSE_DRAG"]:
        norm_x = data.get('x', 0.5)
        norm_y = data.get('y', 0.5)

        target_x = int(norm_x * SCREEN_W)
        target_y = int(norm_y * SCREEN_H)

        # Smooth the movement
        prev_mouse_x = prev_mouse_x + (target_x - prev_mouse_x) / SMOOTHING
        prev_mouse_y = prev_mouse_y + (target_y - prev_mouse_y) / SMOOTHING

        try:
            pyautogui.moveTo(int(prev_mouse_x), int(prev_mouse_y))
        except Exception:
            pass

        if action == "MOUSE_MOVE":
            if mouse_down:
                pyautogui.mouseUp()
                mouse_down = False

        elif action == "MOUSE_CLICK_LEFT":
            pyautogui.click()
            time.sleep(0.2)

        elif action == "MOUSE_CLICK_RIGHT":
            pyautogui.click(button='right')
            time.sleep(0.2)

        elif action == "MOUSE_DRAG":
            if not mouse_down:
                pyautogui.mouseDown()
                mouse_down = True

    # --- SWIPE / MEDIA GESTURES ---
    elif action == "SWIPE_RIGHT":
        pyautogui.press('right')
        time.sleep(0.5)

    elif action == "SWIPE_LEFT":
        pyautogui.press('left')
        time.sleep(0.5)

    elif action == "MEDIA_NEXT":
        pyautogui.press('nexttrack')
        time.sleep(0.5)

    elif action == "MEDIA_PREV":
        pyautogui.press('prevtrack')
        time.sleep(0.5)

    elif action == "MEDIA_PLAY_PAUSE":
        pyautogui.press('playpause')
        time.sleep(0.5)

    # --- VOICE COMMANDS ---
    elif action == "VOICE_COMMAND":
        command = data.get('command', '')
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
            pyautogui.hotkey('alt', 'f4')
        else:
            print(f"[JARVIS] Command not recognized: {command}")

if __name__ == '__main__':
    try:
        print(f"Connecting to {SERVER_URL} ...")
        # Use websocket transport explicitly for gevent-based servers
        sio.connect(SERVER_URL, transports=['websocket'])
        sio.wait()
    except KeyboardInterrupt:
        print("\n[EXIT] Stopped by user.")
    except Exception as e:
        print(f"[ERROR] {e}")
    finally:
        input("\nPress Enter to exit...")
