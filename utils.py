import cv2
import pyautogui
import speech_recognition as sr
from concurrent.futures import ThreadPoolExecutor
from functools import wraps
from pydub import AudioSegment
from pydub.playback import play
import os
import webbrowser
import datetime

executor = ThreadPoolExecutor(max_workers=2)

def execute_in_thread(f):
    """
    Used to execute functions in threads
    (makes functions run in parallel with main program allowing for continuous video feed)
    """
    @wraps(f)  # to keep the name and docstring of f instead of changing it to execute_in_thread docstring
    def wrapper(*args, **kwargs):
        return executor.submit(f, *args, **kwargs)

    return wrapper


class JarvisAssistant:
    def __init__(self):
        self.recognizer = sr.Recognizer()
        self.is_listening = False
        try:
            with sr.Microphone() as source:
                self.recognizer.adjust_for_ambient_noise(source, duration=1.0)
        except Exception as e:
            print(f"Error adjusting for ambient noise during initialization: {e}")

    def listen(self):
        if self.is_listening:
            return None
        self.is_listening = True
        try:
            try: # Outer try-except for sr.Microphone() initialization
                with sr.Microphone() as source:
                    try:
                        print("Jarvis is listening...")
                        audio = self.recognizer.listen(source, timeout=5, phrase_time_limit=10)
                        command = self.recognizer.recognize_google(audio).lower()
                        print(f"Jarvis heard: {command}")
                        return command
                    except Exception as e:
                        print(f"Error during voice recognition: {e}")
                        return None
            except Exception as e: # Catch errors during sr.Microphone() setup
                print(f"Error setting up microphone: {e}")
                return None
        finally:
            self.is_listening = False

    def execute_command(self, command):
        if not command:
            return

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
            pyautogui.press("volumeup", clicks=5)
        elif "volume down" in command:
            pyautogui.press("volumedown", clicks=5)
        elif "mute" in command:
            pyautogui.press("volumemute")
        elif "close" in command:
            pyautogui.hotkey('alt', 'f4')
        else:
            print("Command not recognized by Jarvis.")


def check_webcam_resolution(desired_width, desired_height, webcam=0):
    """
    Checks if desired_width and desired_height are supported by webcam driver,
    if not, prints warning msg and returns closest dimensions supported by webcam
    """
    cap = cv2.VideoCapture(webcam, cv2.CAP_DSHOW)

    # Update capture window resolution
    cap.set(3, desired_width)  # id 3 => capture window width
    cap.set(4, desired_height)  # id 4 => capture window height

    # Check resulting resolution
    result_w, result_h = cap.get(3), cap.get(4)

    if result_w != desired_width or result_h != desired_height:
        msg = f"\nDesired capture image resolution not supported by chosen webcam driver." \
              f"\nSetting capture resolution to {result_w} x {result_h}.\n"
        print(msg)

    return result_w, result_h


@execute_in_thread
def speech_to_text(start_listen_timeout=5, listen_time_limit=10):
    """
    Listens to audio input from microphone and returns text string recognized
    by google's web speech recognition api
    """
    r = sr.Recognizer()

    with sr.Microphone() as source:
        try:
            print("listening")
            audio_text = r.listen(source, timeout=start_listen_timeout, phrase_time_limit=listen_time_limit)
            print("finished listening")
            result = r.recognize_google(audio_text)
        except Exception as err:
            print(err)
            return ""

        result = result.replace("space", " ")

        # Type the result
        if result:
            pyautogui.typewrite(result)


@execute_in_thread
def play_power_toggle_sound():
    """
    Uses pydub to play power-toggle.wav sound
    """
    sound = AudioSegment.from_wav('sounds/power-toggle.wav')
    play(sound)
