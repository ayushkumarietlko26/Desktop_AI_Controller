import sys
from PyQt5.QtGui import *
from PyQt5.QtWidgets import *
from PyQt5.QtCore import *

import cv2
import pyautogui
import numpy as np
import time
import os

import HandTrackingModule as htm  # import created hand tracking module
from utils import speech_to_text, play_power_toggle_sound, JarvisAssistant
from config import *


class MainWindow(QWidget):
    def __init__(self):
        super(MainWindow, self).__init__()
        self.setWindowFlags(Qt.WindowStaysOnTopHint)  # Uncomment to display window on top of all other open apps

        self.VBL = QVBoxLayout()

        self.FeedLabel = QLabel('Comp Vision Controller')
        self.VBL.addWidget(self.FeedLabel)

        self.video_feed = VideoFeedWindowWorker()

        self.video_feed.start()
        self.video_feed.ImageUpdate.connect(self.update_img_slot)
        self.setLayout(self.VBL)

    def update_img_slot(self, img):
        self.FeedLabel.setPixmap(QPixmap.fromImage(img))


class VideoFeedWindowWorker(QThread):
    ImageUpdate = pyqtSignal(QImage)

    def run(self):
        # Set up for video capture window
        cap = cv2.VideoCapture(WEBCAM, cv2.CAP_DSHOW)
        cap.set(3, CAP_WIDTH)  # id 3 => capture window width
        cap.set(4, CAP_HEIGHT)  # id 4 => capture window height
        detector = htm.HandDetector(max_num_hands=2, min_detection_confidence=0.8)

        prev_time = 0  # set initial time for fps tracking
        prev_mic_toggle_time = 0

        power_button_img = cv2.imread(r'images\power-button.png')
        if power_button_img is None:
            print("Error: power-button.png not found or could not be loaded. Using a placeholder.")
            power_button_img = np.zeros((POWER_BUTTON_Y2 - POWER_BUTTON_Y1, POWER_BUTTON_X2 - POWER_BUTTON_X1, 3), dtype=np.uint8) # Placeholder
        
        power_b_side_length = POWER_BUTTON_X2 - POWER_BUTTON_X1 - 3
        if power_b_side_length <= 0:
            print(f"Warning: power_b_side_length is non-positive ({power_b_side_length}). Setting to default size.")
            power_b_side_length = 50 # Default size to avoid error
        
        power_button_img = cv2.resize(power_button_img, dsize=(power_b_side_length, power_b_side_length))

        self.power_button_state = False  # When true the controls are "on", when False controls are "off"
        self.prev_power_toggle_time = 0
        self.mouse_down = False  # When True, left mouse button is held down
        self.prev_mouse_x, self.prev_mouse_y = 0, 0

        self.current_mode = 0 # 0: Mouse, 1: Presentation, 2: Media, 3: Jarvis
        self.modes = ["MOUSE", "PRESENTATION", "MEDIA", "JARVIS"]
        self.mode_colors = [(250, 0, 0), (0, 165, 255), (255, 255, 0), (0, 255, 255)] # Blue, Orange, Yellow, Cyan (BGR)
        self.mode_change_start_time = 0
        self.last_swipe_time = 0

        try:
            self.jarvis = JarvisAssistant()
        except Exception as e:
            print(f"Error initializing JarvisAssistant: {e}")
            self.jarvis = None  # Set to None if initialization fails

        self.last_voice_check_time = 0
        self.jarvis_flag_state = "inactive"
        self.last_flag_read_time = 0

        while True:
            success, img = cap.read()
            if not success:
                print("Failed to read frame from camera. Exiting...")
                break # Exit the loop if camera fails
            img = cv2.flip(img, 1)

            # Read jarvis_flag.txt periodically
            if time.time() - self.last_flag_read_time > 1: # Read every 1 second
                try:
                    with open("jarvis_flag.txt", "r") as f:
                        self.jarvis_flag_state = f.read().strip()
                except FileNotFoundError:
                    # If file not found, assume inactive and create it
                    with open("jarvis_flag.txt", "w") as f:
                        f.write("inactive")
                    self.jarvis_flag_state = "inactive"
                except Exception as e:
                    print(f"Error reading jarvis_flag.txt: {e}")
                self.last_flag_read_time = time.time()

            # Enforce Jarvis mode if flag is active
            if self.jarvis_flag_state == "active":
                self.current_mode = 3
            elif self.current_mode == 3: # If flag is inactive and we are in Jarvis mode, switch out
                self.current_mode = 0

            # Determine Jarvis mode activation based on current_mode
            jarvis_active_in_mode = (self.current_mode == 3)

            mode_color = self.mode_colors[self.current_mode]

            if self.power_button_state:
                cv2.rectangle(img, (POWER_BUTTON_X1, POWER_BUTTON_Y1), (POWER_BUTTON_X2, POWER_BUTTON_Y2),
                              (0, 255, 0), 3)
                detector.find_hands(img)
                hand1_landmarks, hand1_type = detector.find_positions(img, hand_num=0)
                hand2_landmarks, hand2_type = detector.find_positions(img, hand_num=1)

                # Force the mouse controlling hand to be the right hand when possible
                if hand1_type and hand2_type:
                    if hand1_type == "Left":
                        hand1_landmarks, hand2_landmarks = hand2_landmarks, hand1_landmarks
                        hand1_type, hand2_type = hand2_type, hand1_type

                vol_percent = volume.GetMasterVolumeLevelScalar()
                volume_bar_y = VOL_BAR_Y2 - round((VOL_BAR_Y2 - VOL_BAR_Y1) * vol_percent)

                if hand1_landmarks:
                    index_x, index_y = hand1_landmarks[8][1], hand1_landmarks[8][2]
                    fingers_up = htm.HandDetector.fingers_up(hand1_landmarks, hand1_type)

                    # Mode switching logic (3 fingers up for 1.5 seconds)
                    if fingers_up == [0, 1, 1, 1, 0]:
                        if self.mode_change_start_time == 0:
                            self.mode_change_start_time = time.time()
                        elif time.time() - self.mode_change_start_time >= 1.5:
                            # Only allow gesture-based mode switching if Jarvis flag is inactive
                            if self.jarvis_flag_state == "inactive":
                                next_mode = (self.current_mode + 1) % len(self.modes)
                                # Skip Jarvis mode (mode 3) if flag is inactive
                                if next_mode == 3:
                                    next_mode = (next_mode + 1) % len(self.modes) # Go to the next mode after 3 (which is 0)
                                self.current_mode = next_mode
                            
                            self.mode_change_start_time = 0
                            play_power_toggle_sound() # Use same sound for feedback
                            time.sleep(0.5)
                    else:
                        self.mode_change_start_time = 0

                    # Main control area
                    # Only process hand gestures if not in Jarvis mode
                    if not jarvis_active_in_mode:
                        if index_x in range(MOUSE_CTRL_WINDOW_X1, MOUSE_CTRL_WINDOW_X2) and \
                                index_y in range(MOUSE_CTRL_WINDOW_Y1, MOUSE_CTRL_WINDOW_Y2):
                            cv2.rectangle(img, (MOUSE_CTRL_WINDOW_X1, MOUSE_CTRL_WINDOW_Y1),
                                        (MOUSE_CTRL_WINDOW_X2, MOUSE_CTRL_WINDOW_Y2), (0, 255, 0), 3)

                            self.handle_gestures(img, detector, fingers_up, index_x, index_y, hand1_landmarks)

                        # Activating speech to text (still available outside Jarvis mode for typing)
                        if fingers_up == [1, 0, 0, 0, 1] and (time.time() - prev_mic_toggle_time) >= 1:
                            print("toggle speech to text")
                            speech_to_text()
                            prev_mic_toggle_time = time.time()

                        # Volume control area
                        if index_x in range(VOL_BAR_X1, VOL_BAR_X2) and \
                                index_y in range(VOL_BAR_Y1, VOL_BAR_Y2) and fingers_up[1]:
                            self.change_volume(img, index_y)

                    self.check_toggle_power_button(index_x, index_y)

                # Jarvis Mode Logic - only activate if current_mode is JARVIS
                if jarvis_active_in_mode:
                    # Draw Jarvis HUD
                    glow_val = int(127 + 127 * np.sin(time.time() * 5))
                    cv2.circle(img, (int(CAP_WIDTH/2), int(CAP_HEIGHT/2)), 40, (0, 255, 255), 2)
                    cv2.circle(img, (int(CAP_WIDTH/2), int(CAP_HEIGHT/2)), 45, (0, 255, 255), 1)
                    cv2.putText(img, "JARVIS LISTENING", (int(CAP_WIDTH/2) - 60, int(CAP_HEIGHT/2) + 70),
                                cv2.FONT_HERSHEY_SIMPLEX, 0.5, (0, 255, 255), 1)

                    # Background voice check every 2 seconds
                    if self.jarvis and time.time() - self.last_voice_check_time > 2 and not self.jarvis.is_listening:
                        self.last_voice_check_time = time.time()
                        def voice_task():
                            try:
                                cmd = None
                                if self.jarvis:
                                    cmd = self.jarvis.listen()
                                if cmd and self.jarvis:
                                    self.jarvis.execute_command(cmd)
                            except Exception as e:
                                print(f"Jarvis voice thread error: {e}")
                        import threading
                        threading.Thread(target=voice_task, daemon=True).start()

                # UI Elements
                cv2.putText(img, f"MODE: {self.modes[self.current_mode]}", (20, 50),
                            cv2.FONT_HERSHEY_DUPLEX, 1, mode_color, 2)

                # Vertical volume bar (always shown if power button is on, but only controllable outside Jarvis mode)
                cv2.rectangle(img, (VOL_BAR_X1, VOL_BAR_Y1), (VOL_BAR_X2, VOL_BAR_Y2), mode_color, 1)
                cv2.rectangle(img, (VOL_BAR_X1, volume_bar_y), (VOL_BAR_X2, VOL_BAR_Y2), mode_color, cv2.FILLED)

                # Mouse controller box (always shown if power button is on, but only controllable outside Jarvis mode)
                cv2.rectangle(img, (MOUSE_CTRL_WINDOW_X1, MOUSE_CTRL_WINDOW_Y1),
                              (MOUSE_CTRL_WINDOW_X2, MOUSE_CTRL_WINDOW_Y2), mode_color, 1)

                cur_time = time.time()
                fps = 1 / (cur_time - prev_time) if (cur_time - prev_time) > 0 else 0
                prev_time = cur_time
                cv2.putText(img, f"FPS: {int(fps)}", (MOUSE_CTRL_WINDOW_X2 - 100, int(CAP_HEIGHT * 4/5)),
                            cv2.FONT_HERSHEY_COMPLEX, CAP_HEIGHT / 600, mode_color, 1)
            else:
                cv2.rectangle(img, (POWER_BUTTON_X1, POWER_BUTTON_Y1), (POWER_BUTTON_X2, POWER_BUTTON_Y2),
                              (0, 0, 255), 3)
                cv2.putText(img, "CONTROLLER OFF", (20, 50), cv2.FONT_HERSHEY_DUPLEX, 1, (0,0,255), 2)
                detector.find_hands(img, draw=False)
                hand1_landmarks, _ = detector.find_positions(img)
                if hand1_landmarks:
                    index_x, index_y = hand1_landmarks[8][1], hand1_landmarks[8][2]
                    self.check_toggle_power_button(index_x, index_y)

            img[POWER_BUTTON_Y1 + 3:POWER_BUTTON_Y2, POWER_BUTTON_X1 + 3:POWER_BUTTON_X2] = power_button_img
            img_rgb = cv2.cvtColor(img, cv2.COLOR_BGR2RGB)
            img_qt_format = QImage(img_rgb.data, img_rgb.shape[1], img_rgb.shape[0], QImage.Format_RGB888).scaled(int(CAP_WIDTH), int(CAP_HEIGHT), Qt.KeepAspectRatio)
            self.ImageUpdate.emit(img_qt_format)
            time.sleep(0.01) # Small sleep to prevent high CPU usage and allow other threads to run

    def handle_gestures(self, img, detector, fingers_up, index_x, index_y, hand1_landmarks):
        current_mode = self.current_mode
        # Unpack screen resolution
        screen_w, screen_h = RESOLUTION_W, RESOLUTION_H

        if current_mode == 0:  # Mouse Mode
            # Map index finger position to screen coordinates
            x_mouse = int(np.interp(index_x, (MOUSE_CTRL_WINDOW_X1, MOUSE_CTRL_WINDOW_X2), (0, RESOLUTION_W)))
            y_mouse = int(np.interp(index_y, (MOUSE_CTRL_WINDOW_Y1, MOUSE_CTRL_WINDOW_Y2), (0, RESOLUTION_H)))

            # Smooth mouse movement
            self.prev_mouse_x = self.prev_mouse_x + (x_mouse - self.prev_mouse_x) / SMOOTHING
            self.prev_mouse_y = self.prev_mouse_y + (y_mouse - self.prev_mouse_y) / SMOOTHING
            pyautogui.moveTo(self.prev_mouse_x, self.prev_mouse_y)

            if fingers_up == [0, 1, 0, 0, 0]:  # Index finger up: Mouse move
                cv2.circle(img, (index_x, index_y), 15, (0, 255, 255), cv2.FILLED)
                if self.mouse_down:
                    pyautogui.mouseUp()
                    self.mouse_down = False
            elif fingers_up == [0, 1, 1, 0, 0]:  # Index and middle fingers up: Left click
                dist, img_draw, _ = htm.HandDetector.find_distance(img, hand1_landmarks, 1, 2)
                if dist < 30:
                    cv2.circle(img, (index_x, index_y), 15, (0, 0, 255), cv2.FILLED)
                    if not self.mouse_down:
                        pyautogui.mouseDown()
                        self.mouse_down = True
                else:
                    if self.mouse_down:
                        pyautogui.mouseUp()
                        self.mouse_down = False
            elif fingers_up == [1, 1, 0, 0, 0]:  # Index and thumb up: Right click
                dist, img_draw, _ = htm.HandDetector.find_distance(img, hand1_landmarks, 0, 1)
                if dist < 30:
                    cv2.circle(img, (index_x, index_y), 15, (255, 0, 0), cv2.FILLED)
                    pyautogui.click(button='right')
                    time.sleep(0.2)  # Debounce
            elif fingers_up == [0, 1, 0, 0, 1]:  # Index and pinky up: Drag & Drop (hold left click)
                dist, img_draw, _ = htm.HandDetector.find_distance(img, hand1_landmarks, 1, 4)
                if dist < 30:
                    cv2.circle(img, (index_x, index_y), 15, (0, 255, 0), cv2.FILLED)
                    if not self.mouse_down:
                        pyautogui.mouseDown()
                        self.mouse_down = True
                else:
                    if self.mouse_down:
                        pyautogui.mouseUp()
                        self.mouse_down = False

        elif current_mode == 1:  # Presentation Mode
            # Implement presentation control logic
            cv2.circle(img, (index_x, index_y), 15, (0, 255, 255), cv2.FILLED) # Laser pointer
            swipe = detector.get_swipe_direction()
            if swipe == 'Right':
                pyautogui.press('right') # Next slide
                time.sleep(0.5) # Debounce
            elif swipe == 'Left':
                pyautogui.press('left') # Previous slide
                time.sleep(0.5) # Debounce

        elif current_mode == 2:  # Media Mode
            # Implement media control logic
            swipe = detector.get_swipe_direction()
            if fingers_up == [1, 1, 1, 1, 1]: # Full palm: Play/Pause
                pyautogui.press('playpause')
                time.sleep(0.5) # Debounce
            elif swipe == 'Right':
                pyautogui.press('nexttrack')
                time.sleep(0.5) # Debounce
            elif swipe == 'Left':
                pyautogui.press('prevtrack')
                time.sleep(0.5) # Debounce

    def check_toggle_power_button(self, index_x, index_y):
        if index_x in range(POWER_BUTTON_X1, POWER_BUTTON_X2) and \
           index_y in range(POWER_BUTTON_Y1, POWER_BUTTON_Y2) and \
           (time.time() - self.prev_power_toggle_time) >= 1:
            print("toggle power button")
            # play_power_toggle_sound() # Temporarily commented out for debugging
            self.prev_power_toggle_time = time.time()
            self.power_button_state = not self.power_button_state

    def change_volume(self, img, volume_bar_y):
        cv2.rectangle(img, (VOL_BAR_X1, VOL_BAR_Y1), (VOL_BAR_X2, VOL_BAR_Y2), (0, 255, 0), 3)
        vol_percent = max(0, min(1, (VOL_BAR_Y2 - volume_bar_y) / (VOL_BAR_Y2 - VOL_BAR_Y1)))
        cv2.putText(img, f"{round(vol_percent * 100)}%", (VOL_BAR_X1, VOL_BAR_Y1 - 10),
                    cv2.FONT_HERSHEY_COMPLEX, CAP_HEIGHT / 540, (0, 255, 0), 2)
        volume.SetMasterVolumeLevelScalar(vol_percent, None)

    def stop(self):
        self.terminate()

if __name__ == "__main__":
    App = QApplication(sys.argv)
    root = MainWindow()
    root.show()
    sys.exit(App.exec_())
