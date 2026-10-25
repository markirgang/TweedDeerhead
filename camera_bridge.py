import cv2
import time
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer
from urllib.parse import urlparse, parse_qs

current_cam_index = 0
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
                cap = cv2.VideoCapture(0, cv2.CAP_DSHOW)
            cap.set(cv2.CAP_PROP_FRAME_WIDTH, 640)
            cap.set(cv2.CAP_PROP_FRAME_HEIGHT, 480)

        ret, frame = cap.read()
        if ret and frame is not None:
            ok, buf = cv2.imencode('.jpg', frame, [int(cv2.IMWRITE_JPEG_QUALITY), 80])
            if ok:
                with lock:
                    latest_jpeg = buf.tobytes()
            time.sleep(0.05)
        else:
            time.sleep(0.2)

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
                    if idx != current_cam_index:
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
    print('EMEET PIXY DirectShow Camera Bridge running on http://127.0.0.1:3122/frame', flush=True)
    server.serve_forever()
