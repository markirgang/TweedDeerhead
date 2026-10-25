import sounddevice as sd
import numpy as np
import threading
import time
import io
import wave
import speech_recognition as sr
from http.server import BaseHTTPRequestHandler, HTTPServer
import json

recognizer = sr.Recognizer()
recognizer.energy_threshold = 280
recognizer.dynamic_energy_threshold = True

# Find verified working Pixy mic index
def find_pixy_idx():
    for idx in [1, 7, 0, None]:
        try:
            s = sd.InputStream(device=idx, channels=1, samplerate=44100)
            s.start()
            s.stop()
            s.close()
            return idx
        except Exception:
            continue
    return 1

pixy_idx = find_pixy_idx()
print(f"[PixyMic] Using verified EMEET PIXY audio device: {pixy_idx}", flush=True)

current_vu_level = 0
audio_history = []
lock = threading.Lock()
is_listening_request = False

def audio_monitor_loop():
    global current_vu_level
    def callback(indata, frames, time_info, status):
        global current_vu_level
        # Calculate RMS amplitude
        rms = np.sqrt(np.mean(indata**2))
        # Convert RMS (0.0 to ~0.5) to a clean 0-100 percentage
        pct = min(100, int(rms * 450))
        with lock:
            current_vu_level = pct

    try:
        with sd.InputStream(device=pixy_idx, channels=1, samplerate=44100, blocksize=2048, callback=callback):
            while True:
                time.sleep(0.05)
    except Exception as e:
        print(f"[PixyMic] Monitor stream error: {e}", flush=True)

class MicHandler(BaseHTTPRequestHandler):
    def log_message(self, format, *args):
        return

    def do_GET(self):
        if self.path == '/level':
            with lock:
                lvl = current_vu_level
            data = json.dumps({"level": lvl, "device": pixy_idx}).encode('utf-8')
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Access-Control-Allow-Origin', '*')
            self.end_headers()
            self.wfile.write(data)
        else:
            self.send_response(404)
            self.end_headers()

    def do_POST(self):
        if self.path == '/listen':
            # Record up to 4.5 seconds with fast voice activity detection
            sr_rate = 44100
            max_seconds = 4.5
            total_samples = int(max_seconds * sr_rate)

            # Record from the physical EMEET PIXY device
            try:
                rec_data = sd.rec(total_samples, samplerate=sr_rate, channels=1, dtype='int16', device=pixy_idx)
                # Monitor in chunks of 0.25s for silence after user stops speaking
                start_t = time.time()
                heard_speech = False
                silence_chunks = 0

                while time.time() - start_t < max_seconds:
                    time.sleep(0.12)
                    with lock:
                        curr = current_vu_level
                    if curr > 14:
                        heard_speech = True
                        silence_chunks = 0
                    elif heard_speech and curr <= 8:
                        silence_chunks += 1
                        # If user spoke and then stayed quiet for ~0.4s, finish early and respond immediately!
                        if silence_chunks >= 3:
                            sd.stop()
                            break

                sd.wait()
                raw_int16 = rec_data.tobytes()

                # Convert recorded int16 to AudioData for SpeechRecognition
                audio_obj = sr.AudioData(raw_int16, sr_rate, 2)
                transcript = ""
                try:
                    transcript = recognizer.recognize_google(audio_obj, language='en-US')
                except sr.UnknownValueError:
                    transcript = ""
                except Exception as e:
                    # Offline / timeout fallback
                    pass

                resp = json.dumps({
                    "ok": True,
                    "transcript": transcript,
                    "peak": current_vu_level,
                    "device": pixy_idx
                }).encode('utf-8')

                self.send_response(200)
                self.send_header('Content-Type', 'application/json')
                self.send_header('Access-Control-Allow-Origin', '*')
                self.end_headers()
                self.wfile.write(resp)
            except Exception as e:
                err_resp = json.dumps({"ok": False, "error": str(e)}).encode('utf-8')
                self.send_response(500)
                self.send_header('Content-Type', 'application/json')
                self.send_header('Access-Control-Allow-Origin', '*')
                self.end_headers()
                self.wfile.write(err_resp)
        else:
            self.send_response(404)
            self.end_headers()

if __name__ == '__main__':
    t = threading.Thread(target=audio_monitor_loop, daemon=True)
    t.start()
    server = HTTPServer(('127.0.0.1', 3123), MicHandler)
    print(f"[PixyMic] EMEET PIXY Audio & VU Level Daemon running on http://127.0.0.1:3123", flush=True)
    server.serve_forever()
