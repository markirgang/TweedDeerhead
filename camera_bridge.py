import cv2
import time
import threading
import numpy as np
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, parse_qs

# ============================================================================
# EMEET PIXY DirectShow Camera Bridge
# Only cameras that actually deliver a lit image are ever used.
# Black/dead devices (e.g. the EMEET Virtual Camera) are rejected at startup.
# ============================================================================

CANDIDATE_INDICES = [0, 1]      # Fast startup scan (this machine has 2 video devices)
EXTRA_INDICES = [2, 3, 4]       # Scanned in the background after streaming starts
TARGET_W = 1280
TARGET_H = 720


def open_capture(idx):
    """Open a camera in MJPG 720p (avoids USB bandwidth black-frame issue)."""
    cap = cv2.VideoCapture(idx, cv2.CAP_DSHOW)
    if not cap.isOpened():
        cap.release()
        return None
    try:
        cap.set(cv2.CAP_PROP_FOURCC, cv2.VideoWriter_fourcc(*'MJPG'))
        cap.set(cv2.CAP_PROP_FRAME_WIDTH, TARGET_W)
        cap.set(cv2.CAP_PROP_FRAME_HEIGHT, TARGET_H)
        cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)
    except Exception:
        pass
    return cap


def probe_camera(idx, budget=2.5):
    """Return (brightness, cap) if the camera yields a real lit image, else (0, None).

    Uses a wall-clock budget (not a frame count) because a dead/virtual device can
    take ~1s per read, while a real camera answers instantly.
    """
    cap = open_capture(idx)
    if cap is None:
        print(f"[CameraBridge Scan] Index {idx}: could not open", flush=True)
        return 0.0, None

    best = 0.0
    got_frame = False
    lit_frames = 0
    deadline = time.time() + budget

    while time.time() < deadline:
        ret, frame = cap.read()
        if ret and frame is not None and frame.size > 0:
            got_frame = True
            b = float(np.mean(frame))
            if b > best:
                best = b
            if b > 6.0:
                lit_frames += 1
                if lit_frames >= 4:
                    break
        else:
            time.sleep(0.02)

    if not got_frame:
        print(f"[CameraBridge Scan] Index {idx}: opened but produced no frames", flush=True)
        cap.release()
        return 0.0, None

    if best < 6.0:
        print(f"[CameraBridge Scan] Index {idx}: BLACK feed (brightness {best:.2f}) - rejected", flush=True)
        cap.release()
        return 0.0, None

    print(f"[CameraBridge Scan] Index {idx}: OK (brightness {best:.2f}) - accepted", flush=True)
    return best, cap


def discover_cameras():
    """Probe indices in order and stop at the FIRST working camera.

    Camera 0 is the physical EMEET PIXY on this machine, so the common case
    resolves in a fraction of a second. Later indices are only probed if the
    earlier ones are dark/dead.

    Returns (working, best_cap) where best_cap is an ALREADY OPEN capture handle
    (so we never waste time reopening / re-warming the device).
    """
    working = []
    best_cap = None

    for idx in CANDIDATE_INDICES:
        brightness, cap = probe_camera(idx)
        if cap is not None:
            working.append((idx, brightness))
            best_cap = cap
            break
        time.sleep(0.05)

    return working, best_cap


# ---------------------------------------------------------------------------
# Startup discovery
# ---------------------------------------------------------------------------
_boot_started = time.time()
working_cameras, initial_cap = discover_cameras()
verified_indices = [idx for idx, _ in working_cameras]

if working_cameras:
    current_cam_index = working_cameras[0][0]
    print(f"[CameraBridge] Verified working cameras: {working_cameras} "
          f"(discovery took {time.time() - _boot_started:.1f}s)", flush=True)
    print(f"[CameraBridge] Active camera index = {current_cam_index}", flush=True)
else:
    current_cam_index = 0
    initial_cap = None
    print("[CameraBridge] WARNING: no lit camera found at startup. Will keep retrying index 0.", flush=True)

latest_jpeg = None
latest_lock = threading.Lock()
frame_counter = 0
running = True
needs_reset = False
last_frame_time = 0.0


def capture_loop():
    global latest_jpeg, current_cam_index, needs_reset, frame_counter, last_frame_time
    global working_cameras, verified_indices

    # Reuse the handle opened during discovery so the first frame appears instantly
    cap = initial_cap
    active_idx = current_cam_index if initial_cap is not None else None
    failures = 0

    while running:
        if needs_reset or cap is None or not cap.isOpened() or active_idx != current_cam_index:
            needs_reset = False
            if cap is not None:
                try:
                    cap.release()
                except Exception:
                    pass
                cap = None

            active_idx = current_cam_index
            cap = open_capture(active_idx)
            if cap is None:
                print(f"[CameraBridge] Cannot open index {active_idx}. Retrying shortly...", flush=True)
                time.sleep(1.0)
                continue

            # Discard warm-up frames (first frames from DSHOW are often black)
            for _ in range(10):
                cap.read()
            failures = 0
            print(f"[CameraBridge] Streaming from camera index {active_idx} (MJPG {TARGET_W}x{TARGET_H})", flush=True)

        ret, frame = cap.read()
        if ret and frame is not None and frame.size > 0:
            failures = 0
            ok, buf = cv2.imencode('.jpg', frame, [int(cv2.IMWRITE_JPEG_QUALITY), 82])
            if ok:
                with latest_lock:
                    latest_jpeg = buf.tobytes()
                    frame_counter += 1
                    last_frame_time = time.time()
            time.sleep(0.03)
        else:
            failures += 1
            time.sleep(0.1)
            if failures >= 15:
                print(f"[CameraBridge] Camera {active_idx} stopped delivering frames. Recovering...", flush=True)
                try:
                    cap.release()
                except Exception:
                    pass
                cap = None
                # Re-discover if the current camera seems dead for good
                if failures >= 30:
                    working_cameras, fresh_cap = discover_cameras()
                    verified_indices = [i for i, _ in working_cameras]
                    if fresh_cap is not None:
                        try:
                            fresh_cap.release()
                        except Exception:
                            pass
                    if working_cameras and current_cam_index not in verified_indices:
                        current_cam_index = working_cameras[0][0]
                    needs_reset = True
                    failures = 0


def background_extra_scan():
    """Look for additional cameras on higher indices without delaying startup."""
    global working_cameras, verified_indices, current_cam_index
    time.sleep(3)
    for idx in EXTRA_INDICES:
        if not running:
            return
        brightness, cap = probe_camera(idx)
        if cap is not None:
            try:
                cap.release()
            except Exception:
                pass
            if idx not in verified_indices:
                working_cameras.append((idx, brightness))
                working_cameras.sort(key=lambda t: t[1], reverse=True)
                verified_indices = [i for i, _ in working_cameras]
                print(f"[CameraBridge] Extra camera discovered at index {idx}", flush=True)


class CamHandler(BaseHTTPRequestHandler):
    protocol_version = 'HTTP/1.1'

    def log_message(self, fmt, *args):
        return

    def _send(self, code, body, ctype='application/json'):
        if isinstance(body, str):
            body = body.encode()
        self.send_response(code)
        self.send_header('Content-Type', ctype)
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Cache-Control', 'no-store, no-cache, must-revalidate')
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Connection', 'close')
        self.end_headers()
        try:
            self.wfile.write(body)
        except Exception:
            pass

    def do_GET(self):
        global current_cam_index, needs_reset
        parsed = urlparse(self.path)
        qs = parse_qs(parsed.query)

        if parsed.path == '/reset':
            print("[CameraBridge] Manual reset requested - reopening video stream...", flush=True)
            needs_reset = True
            self._send(200, '{"ok": true, "status": "resetting"}')
            return

        if parsed.path == '/health':
            with latest_lock:
                count = frame_counter
                age = (time.time() - last_frame_time) if last_frame_time else None
            self._send(200, '{"ok": true, "camIndex": %d, "frames": %d, "age": %s, "verified": %s}'
                       % (current_cam_index, count, ('null' if age is None else round(age, 2)), verified_indices))
            return

        if parsed.path == '/frame':
            if 'reset' in qs:
                needs_reset = True

            # Only honour a camera switch if that index was verified as working.
            if 'cam' in qs:
                try:
                    idx = int(qs['cam'][0])
                    if idx in verified_indices and idx != current_cam_index:
                        print(f"[CameraBridge] Switching to verified camera index {idx}", flush=True)
                        current_cam_index = idx
                        needs_reset = True
                    elif idx not in verified_indices:
                        # Ignore requests for dead/black devices instead of showing black
                        pass
                except Exception:
                    pass

            with latest_lock:
                data = latest_jpeg
            if data:
                self._send(200, data, 'image/jpeg')
            else:
                self._send(503, '{"ok": false, "status": "no frame yet"}')
            return

        self._send(404, '{"ok": false}')


if __name__ == '__main__':
    t = threading.Thread(target=capture_loop, daemon=True)
    t.start()
    threading.Thread(target=background_extra_scan, daemon=True).start()
    server = ThreadingHTTPServer(('127.0.0.1', 3122), CamHandler)
    server.daemon_threads = True
    print('[CameraBridge] EMEET PIXY bridge listening on http://127.0.0.1:3122/frame', flush=True)
    server.serve_forever()
