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

print("Initializing Local Agent...")

# Initialize volume controller
try:
    devices = AudioUtilities.GetSpeakers()
    interface = devices.Activate(IAudioEndpointVolume._iid_, CLSCTX_ALL, None)
    volume = cast(interface, POINTER(IAudioEndpointVolume))
except Exception as e:
    print(f"Warning: Could not initialize volume control: {e}")
    volume = None

# Screen resolution for normalized coordinates
SCREEN_W, SCREEN_H = pyautogui.size()
print(f"Detected screen resolution: {SCREEN_W}x{SCREEN_H}")

# Mouse smoothing logic
SMOOTHING = 5
prev_mouse_x, prev_mouse_y = pyautogui.position()
mouse_down = False

sio = socketio.Client()

SERVER_URL = input("Enter Cloud Server URL (e.g. https://your-render-app.onrender.com): ")
ROOM_ID = input("Enter Room ID to pair with Frontend: ")

@sio.event
def connect():
    print("Connected to Cloud Server!")
    sio.emit('join', {'room': ROOM_ID, 'role': 'agent'})
    print(f"Joined room: {ROOM_ID}")

@sio.event
def disconnect():
    print("Disconnected from server.")

@sio.on('agent_command')
def on_agent_command(data):
    global prev_mouse_x, prev_mouse_y, mouse_down
    
    action = data.get('action')
    
    # --- MOUSE LOGIC ---
    if action in ["MOUSE_MOVE", "MOUSE_CLICK_LEFT", "MOUSE_CLICK_RIGHT", "MOUSE_DRAG"]:
        # Frontend sends normalized coordinates (0.0 to 1.0)
        norm_x = data.get('x', 0.5)
        norm_y = data.get('y', 0.5)
        
        target_x = int(norm_x * SCREEN_W)
        target_y = int(norm_y * SCREEN_H)
        
        # Smooth movement
        prev_mouse_x = prev_mouse_x + (target_x - prev_mouse_x) / SMOOTHING
        prev_mouse_y = prev_mouse_y + (target_y - prev_mouse_y) / SMOOTHING
        
        try:
            pyautogui.moveTo(prev_mouse_x, prev_mouse_y)
        except Exception as e:
            pass # Fail silently if mouse goes out of bounds
            
        if action == "MOUSE_MOVE":
            if mouse_down:
                pyautogui.mouseUp()
                mouse_down = False
                
        elif action == "MOUSE_CLICK_LEFT":
            if not mouse_down:
                pyautogui.click()
                time.sleep(0.2) # Debounce
                
        elif action == "MOUSE_CLICK_RIGHT":
            pyautogui.click(button='right')
            time.sleep(0.2)
            
        elif action == "MOUSE_DRAG":
            if not mouse_down:
                pyautogui.mouseDown()
                mouse_down = True
                
    # --- GESTURE SWIPES ---
    elif action == "SWIPE_RIGHT":
        pyautogui.press('right')
        time.sleep(0.5)
    elif action == "SWIPE_LEFT":
        pyautogui.press('left')
        time.sleep(0.5)
        
    # --- VOICE COMMANDS ---
    elif action == "VOICE_COMMAND":
        command = data.get('command', '')
        print(f"Executing voice command: {command}")
        
        if "open chrome" in command or "open browser" in command:
            webbrowser.open("https://www.google.com")
        elif "open notepad" in command:
            os.system("notepad")
        elif "search" in command:
            search_query = command.replace("search", "").strip()
            webbrowser.open(f"https://www.google.com/search?q={search_query}")
        elif "time" in command:
            now = datetime.datetime.now().strftime("%H:%M")
            print(f"Current time is {now}")
        elif "volume up" in command:
            pyautogui.press("volumeup", presses=5)
        elif "volume down" in command:
            pyautogui.press("volumedown", presses=5)
        elif "mute" in command:
            pyautogui.press("volumemute")
        elif "close" in command:
            pyautogui.hotkey('alt', 'f4')
        else:
            print("Command not recognized.")

if __name__ == '__main__':
    try:
        sio.connect(SERVER_URL)
        sio.wait()
    except Exception as e:
        print(f"Connection failed: {e}")
        input("Press Enter to exit...")
