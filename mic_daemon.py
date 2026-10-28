import sounddevice as sd
import numpy as np
import threading
import time
import io
import wave
import speech_recognition as sr
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json

recognizer = sr.Recognizer()
recognizer.energy_threshold = 140
recognizer.dynamic_energy_threshold = True


def transcribe_wav(raw):
    """Transcribes a 16-bit PCM WAV that arrived from a browser microphone.

    Browsers capture at whatever rate the sound card runs at (usually 48 kHz),
    so the rate comes from the WAV header rather than being assumed.
    """
    with wave.open(io.BytesIO(raw), 'rb') as wav:
        channels = wav.getnchannels()
        width = wav.getsampwidth()
        rate = wav.getframerate()
        frames = wav.readframes(wav.getnframes())

    if not frames:
        return ''
    if width != 2:
        raise ValueError(f'expected 16-bit PCM WAV, got {width * 8}-bit')
    if channels > 1:
        samples = np.frombuffer(frames, dtype='<i2').reshape(-1, channels)
        frames = samples.mean(axis=1).astype('<i2').tobytes()

    audio = sr.AudioData(frames, rate, 2)
    try:
        return recognizer.recognize_google(audio, language='en-US')
    except sr.UnknownValueError:
        return ''

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
print(f"[PixyMic] Verified EMEET PIXY audio input device index: {pixy_idx}", flush=True)

current_vu_level = 0
# Sensitivity multiplier: higher = more sensitive (lower thresholds)
# Range: 0.1 to 5.0, default 1.0
mic_sensitivity = 1.0
lock = threading.Lock()

def audio_monitor_loop():
    global current_vu_level
    def callback(indata, frames, time_info, status):
        global current_vu_level
        # RMS of actual sound waves
        rms = np.sqrt(np.mean(indata**2))
        pct = min(100, int(rms * 500))
        with lock:
            current_vu_level = pct

    try:
        with sd.InputStream(device=pixy_idx, channels=1, samplerate=44100, blocksize=2048, callback=callback):
            while True:
                time.sleep(0.04)
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
        elif self.path == '/sensitivity':
            with lock:
                sens = mic_sensitivity
            data = json.dumps({"sensitivity": sens}).encode('utf-8')
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Access-Control-Allow-Origin', '*')
            self.end_headers()
            self.wfile.write(data)
        else:
            self.send_response(404)
            self.end_headers()

    def _json(self, code, payload):
        body = json.dumps(payload).encode('utf-8')
        self.send_response(code)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Connection', 'close')
        self.end_headers()
        try:
            self.wfile.write(body)
        except Exception:
            pass

    def do_POST(self):
        # Audio recorded by a visitor's own browser is posted here as a WAV blob.
        if self.path == '/transcribe':
            self.handle_transcribe()
            return

        if self.path == '/sensitivity':
            self.handle_set_sensitivity()
            return

        if self.path == '/listen':
            sr_rate = 44100
            max_seconds = 4.0
            total_samples = int(max_seconds * sr_rate)

            # Apply sensitivity to VU thresholds
            with lock:
                sens = mic_sensitivity
            speech_threshold = max(1, 6 / sens)
            silence_threshold = max(0.5, 5 / sens)

            try:
                rec_data = sd.rec(total_samples, samplerate=sr_rate, channels=1, dtype='int16', device=pixy_idx)
                start_t = time.time()
                heard_speech = False
                silence_chunks = 0

                while time.time() - start_t < max_seconds:
                    time.sleep(0.1)
                    with lock:
                        curr = current_vu_level
                    if curr > speech_threshold:
                        heard_speech = True
                        silence_chunks = 0
                    elif heard_speech and curr <= silence_threshold:
                        silence_chunks += 1
                        # If user spoke and paused for ~0.4s, stop immediately and return!
                        if silence_chunks >= 4:
                            break

                sd.stop()
                raw_int16 = rec_data.tobytes()

                audio_obj = sr.AudioData(raw_int16, sr_rate, 2)
                transcript = ""
                try:
                    transcript = recognizer.recognize_google(audio_obj, language='en-US')
                except sr.UnknownValueError:
                    transcript = ""
                except Exception as e:
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

    def handle_set_sensitivity(self):
        global mic_sensitivity
        try:
            length = int(self.headers.get('Content-Length') or 0)
            if length <= 0:
                return self._json(400, {"ok": False, "error": "empty body"})
            raw = self.rfile.read(length)
            data = json.loads(raw.decode('utf-8'))
            sens = float(data.get('sensitivity', 1.0))
            # Clamp to reasonable range
            sens = max(0.1, min(5.0, sens))
            with lock:
                mic_sensitivity = sens
                # Also adjust recognizer's energy threshold
                recognizer.energy_threshold = 140 / sens
            print(f"[PixyMic] Mic sensitivity set to {sens:.2f} (energy_threshold={recognizer.energy_threshold:.1f})", flush=True)
            return self._json(200, {"ok": True, "sensitivity": sens})
        except Exception as e:
            return self._json(400, {"ok": False, "error": str(e)})

    def handle_transcribe(self):
        try:
            length = int(self.headers.get('Content-Length') or 0)
        except Exception:
            length = 0

        if length <= 0:
            return self._json(400, {"ok": False, "error": "empty audio body"})
        if length > 12 * 1024 * 1024:
            return self._json(413, {"ok": False, "error": "audio clip too large"})

        try:
            raw = self.rfile.read(length)
        except Exception as e:
            return self._json(400, {"ok": False, "error": f"could not read audio: {e}"})

        started = time.time()
        try:
            transcript = transcribe_wav(raw)
        except (ValueError, wave.Error, EOFError) as e:
            detail = str(e) or 'that audio clip is not a valid 16-bit WAV file'
            print(f"[PixyMic] Browser clip rejected: {detail}", flush=True)
            return self._json(400, {"ok": False, "error": detail})
        except Exception as e:
            print(f"[PixyMic] Browser clip failed: {e}", flush=True)
            return self._json(500, {"ok": False, "error": str(e) or 'speech recognition failed'})

        elapsed = int((time.time() - started) * 1000)
        print(f"[PixyMic] Browser mic clip ({len(raw)} bytes) -> "
              f"'{transcript}' in {elapsed} ms", flush=True)
        return self._json(200, {
            "ok": True,
            "transcript": transcript,
            "source": "browser",
            "elapsedMs": elapsed
        })

if __name__ == '__main__':
    t = threading.Thread(target=audio_monitor_loop, daemon=True)
    t.start()
    server = ThreadingHTTPServer(('127.0.0.1', 3123), MicHandler)
    server.daemon_threads = True
    print(f"[PixyMic] EMEET PIXY Audio & VU Level Daemon running on http://127.0.0.1:3123", flush=True)
    server.serve_forever()
