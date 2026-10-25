import cv2
import time
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer
from urllib.parse import urlparse, parse_qs

# Auto-detect the working camera index on startup
def find_working_cam():
    for idx in [1, 0, 2, 3]:
        try:
            cap = cv2.VideoCapture(idx, cv2.CAP_DSHOW)
            if cap.isOpened():
                ret, frame = cap.read()
                cap.release()
                if ret and frame is not None:
                    return idx
        except Exception:
            pass
    return 1

current_cam_index = find_working_cam()
print(f"[CameraBridge] Auto-detected active camera at index: {current_cam_index}", flush=True)

latest_jpeg = None
lock = threading.Lock()
running = True

def capture_loop():
    global latest_jpeg, current_cam_index
    active_idx = -1
    cap = None

    while running:
        if active_idx != current_cam_index or cap is None or not cap.isOpened():
            if cap is not None:
                try:
                    cap.release()
                except Exception:
                    pass
            active_idx = current_cam_index
            cap = cv2.VideoCapture(active_idx, cv2.CAP_DSHOW)
            if not cap.isOpened():
                # Fallback to alternate index
                alt_idx = 0 if active_idx == 1 else 1
                cap = cv2.VideoCapture(alt_idx, cv2.CAP_DSHOW)
                if cap.isOpened():
                    active_idx = alt_idx
                    current_cam_index = alt_idx

            if cap.isOpened():
                cap.set(cv2.CAP_PROP_FRAME_WIDTH, 640)
                cap.set(cv2.CAP_PROP_FRAME_HEIGHT, 480)

        if cap and cap.isOpened():
            ret, frame = cap.read()
            if ret and frame is not None:
                ok, buf = cv2.imencode('.jpg', frame, [int(cv2.IMWRITE_JPEG_QUALITY), 80])
                if ok:
                    with lock:
                        latest_jpeg = buf.tobytes()
                time.sleep(0.04)
            else:
                time.sleep(0.15)
        else:
            time.sleep(0.3)

class CamHandler(BaseHTTPRequestHandler):
    def log_message(self, format, *args):
        return

    def do_GET(self):
        global current_cam_index
        parsed = urlparse(self.path)
        if parsed.path == '/frame':
            qs = parse_qs(parsed.query)
            if 'cam' in qs:
                try:
                    idx = int(qs['cam'][0])
                    if idx != current_cam_index and idx in [0, 1, 2]:
                        current_cam_index = idx
                except Exception:
                    pass
            with lock:
                data = latest_jpeg
            if data:
                self.send_response(200)
                self.send_header('Content-Type', 'image/jpeg')
                self.send_header('Cache-Control', 'no-store, no-cache, must-revalidate')
                self.send_header('Access-Control-Allow-Origin', '*')
                self.end_headers()
                self.wfile.write(data)
            else:
                self.send_response(503)
                self.end_headers()
        else:
            self.send_response(404)
            self.end_headers()

if __name__ == '__main__':
    t = threading.Thread(target=capture_loop, daemon=True)
    t.start()
    server = HTTPServer(('127.0.0.1', 3122), CamHandler)
    print(f'EMEET PIXY DirectShow Camera Bridge running on http://127.0.0.1:3122/frame (active cam: {current_cam_index})', flush=True)
    server.serve_forever()
