"""
Tweed Deerhead international voice bank.

Windows itself ships only two US English voices (David + Zira), which is why the
app used to sound exclusively American. This daemon adds a large, curated bank of
male and female voices from many countries.

Two engines are used:

  edge  - Microsoft's neural voices (the same ones Edge "Read Aloud" uses).
          British, Australian, Indian, Irish, New Zealand, South African,
          Canadian, Singaporean, Kenyan, Tanzanian, Filipino and ~40 more
          languages, each with male and female options. Needs internet.

  piper - A local offline neural voice used for Scottish (Alba), which
          Microsoft does not offer in any accent. Runs on this PC, ~0.3 s.

Endpoints (127.0.0.1:3124):
  GET  /health  -> daemon + engine status
  GET  /voices  -> the catalog (from voice_catalog.json)
  POST /say     -> {"text","voiceId","rate","pitch"} -> {"ok","audioDataUrl"}
"""

import asyncio
import base64
import json
import os
import re
import sys
import threading
import time
import traceback
import wave
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse

HERE = os.path.dirname(os.path.abspath(__file__))
CATALOG_PATH = os.path.join(HERE, 'voice_catalog.json')
PIPER_DIR = os.path.join(HERE, 'voices')
PORT = 3124

# ---------------------------------------------------------------------------
# Optional engines
# ---------------------------------------------------------------------------
try:
    import edge_tts
    EDGE_AVAILABLE = True
except Exception as exc:  # pragma: no cover
    edge_tts = None
    EDGE_AVAILABLE = False
    print(f'[VoiceBank] edge-tts unavailable: {exc}', flush=True)

try:
    from piper import PiperVoice, SynthesisConfig
    PIPER_AVAILABLE = True
except Exception as exc:  # pragma: no cover
    PiperVoice = None
    SynthesisConfig = None
    PIPER_AVAILABLE = False
    print(f'[VoiceBank] piper unavailable: {exc}', flush=True)

_piper_voice = None
_piper_lock = threading.Lock()

# ---------------------------------------------------------------------------
# Catalog
# ---------------------------------------------------------------------------
def load_catalog():
    try:
        with open(CATALOG_PATH, 'r', encoding='utf-8') as fh:
            data = json.load(fh)
        voices = data.get('voices') if isinstance(data, dict) else data
        return voices or []
    except Exception as exc:
        print(f'[VoiceBank] Could not read {CATALOG_PATH}: {exc}', flush=True)
        return []


CATALOG = load_catalog()
VOICES_BY_ID = {v['id']: v for v in CATALOG}

# Accept a bare short name too ("en-GB-SoniaNeural")
for _v in CATALOG:
    VOICES_BY_ID.setdefault(_v['shortName'], _v)


def resolve_voice(voice_id):
    if not voice_id:
        return None
    if voice_id in VOICES_BY_ID:
        return VOICES_BY_ID[voice_id]
    # tolerate "edge:en-GB-SoniaNeural" vs "en-GB-SoniaNeural" style mismatch
    for prefix in ('edge:', 'piper:'):
        if voice_id.startswith(prefix):
            bare = voice_id[len(prefix):]
            if bare in VOICES_BY_ID:
                return VOICES_BY_ID[bare]
    return None


# ---------------------------------------------------------------------------
# Scottish / offline Piper voice
# ---------------------------------------------------------------------------
def get_piper_voice():
    """Load the local Piper model once (takes ~4 s) and reuse it forever."""
    global _piper_voice
    if _piper_voice is not None:
        return _piper_voice
    if not PIPER_AVAILABLE:
        raise RuntimeError('piper is not installed')

    with _piper_lock:
        if _piper_voice is not None:
            return _piper_voice

        model = None
        for name in sorted(os.listdir(PIPER_DIR)) if os.path.isdir(PIPER_DIR) else []:
            if name.endswith('.onnx'):
                model = os.path.join(PIPER_DIR, name)
                break
        if not model:
            raise RuntimeError(
                'Scottish voice model not found in voices/ '
                '(download en_GB-alba-medium.onnx from rhasspy/piper-voices)'
            )

        _piper_voice = PiperVoice.load(model)
        return _piper_voice


def preload_piper():
    try:
        t0 = time.time()
        get_piper_voice()
        print(f'[VoiceBank] Scottish Piper voice loaded in {time.time() - t0:.1f}s', flush=True)
    except Exception as exc:
        print(f'[VoiceBank] Piper preload skipped: {exc}', flush=True)


def synth_piper(text, rate, pitch):
    voice = get_piper_voice()
    # Piper has no pitch control; length_scale is the inverse of speaking rate.
    length_scale = max(0.6, min(1.7, 1.0 / max(0.5, min(2.0, rate))))

    import io
    buf = io.BytesIO()
    with wave.open(buf, 'wb') as wav_file:
        voice.synthesize_wav(text, wav_file, syn_config=SynthesisConfig(length_scale=length_scale))
    raw = buf.getvalue()
    return raw, 'audio/wav'


# ---------------------------------------------------------------------------
# Microsoft neural voices (edge)
# ---------------------------------------------------------------------------
def _pct(value, span=100):
    delta = int(round((value - 1.0) * span))
    delta = max(-50, min(50, delta))
    return f'{delta:+d}%'


def _hz(value, span=60):
    delta = int(round((value - 1.0) * span))
    delta = max(-40, min(40, delta))
    return f'{delta:+d}Hz'


def synth_edge(text, short_name, rate, pitch):
    if not EDGE_AVAILABLE:
        raise RuntimeError('edge-tts is not installed')

    async def _run():
        communicate = edge_tts.Communicate(
            text,
            short_name,
            rate=_pct(rate),
            pitch=_hz(pitch),
        )
        chunks = []
        async for chunk in communicate.stream():
            if chunk.get('type') == 'audio':
                chunks.append(chunk['data'])
        return b''.join(chunks)

    audio = asyncio.run(_run())
    if not audio:
        raise RuntimeError('Microsoft returned no audio')
    return audio, 'audio/mpeg'


# ---------------------------------------------------------------------------
# HTTP daemon
# ---------------------------------------------------------------------------
def status_payload():
    piper_ready = _piper_voice is not None
    return {
        'ok': True,
        'voiceCount': len(CATALOG),
        'edge': EDGE_AVAILABLE,
        'piper': PIPER_AVAILABLE,
        'piperLoaded': piper_ready,
    }


class VoiceHandler(BaseHTTPRequestHandler):
    protocol_version = 'HTTP/1.1'

    def log_message(self, fmt, *args):
        return

    def _send(self, code, payload, ctype='application/json'):
        body = payload if isinstance(payload, (bytes, bytearray)) else json.dumps(payload).encode()
        self.send_response(code)
        self.send_header('Content-Type', ctype)
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Cache-Control', 'no-store')
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Connection', 'close')
        self.end_headers()
        try:
            self.wfile.write(body)
        except Exception:
            pass

    def do_GET(self):
        path = urlparse(self.path).path
        if path == '/health':
            return self._send(200, status_payload())
        if path == '/voices':
            payload = dict(status_payload())
            payload['voices'] = CATALOG
            return self._send(200, payload)
        return self._send(404, {'ok': False, 'error': 'not found'})

    def do_POST(self):
        path = urlparse(self.path).path
        if path != '/say':
            return self._send(404, {'ok': False, 'error': 'not found'})

        try:
            length = int(self.headers.get('Content-Length') or 0)
            raw = self.rfile.read(length) if length else b'{}'
            body = json.loads(raw.decode('utf-8') or '{}')
        except Exception as exc:
            return self._send(400, {'ok': False, 'error': f'bad request: {exc}'})

        text = str(body.get('text') or '').strip()
        if not text:
            return self._send(400, {'ok': False, 'error': 'text is required'})

        voice_id = str(body.get('voiceId') or body.get('voiceName') or '')
        voice = resolve_voice(voice_id)
        if not voice:
            return self._send(404, {'ok': False, 'error': f'unknown voice: {voice_id}'})

        rate = float(body.get('rate') or 1.0)
        pitch = float(body.get('pitch') or 1.0)

        started = time.time()
        try:
            if voice['engine'] == 'piper':
                audio, mime = synth_piper(text, rate, pitch)
            else:
                audio, mime = synth_edge(text, voice['shortName'], rate, pitch)
        except Exception as exc:
            traceback.print_exc()
            return self._send(500, {'ok': False, 'error': str(exc), 'voice': voice_id})

        encoded = base64.b64encode(audio).decode('ascii')
        payload = {
            'ok': True,
            'voice': voice_id,
            'voiceName': voice.get('name'),
            'country': voice.get('country'),
            'gender': voice.get('gender'),
            'engine': voice['engine'],
            'mime': mime,
            'bytes': len(audio),
            'elapsedMs': int((time.time() - started) * 1000),
            'audioDataUrl': f'data:{mime};base64,{encoded}',
        }
        print(
            f"[VoiceBank] {voice.get('country')} / {voice.get('name')} "
            f"({voice.get('gender')}) -> {len(audio)} bytes in {payload['elapsedMs']} ms",
            flush=True,
        )
        return self._send(200, payload)


def main():
    print('[VoiceBank] Tweed Deerhead voice bank starting...', flush=True)
    print(f'[VoiceBank] {len(CATALOG)} voices loaded '
          f'(edge={EDGE_AVAILABLE}, piper={PIPER_AVAILABLE})', flush=True)

    if PIPER_AVAILABLE:
        threading.Thread(target=preload_piper, daemon=True).start()

    server = ThreadingHTTPServer(('127.0.0.1', PORT), VoiceHandler)
    server.daemon_threads = True
    print(f'[VoiceBank] Voice daemon running on http://127.0.0.1:{PORT}', flush=True)
    server.serve_forever()


if __name__ == '__main__':
    try:
        main()
    except KeyboardInterrupt:
        sys.exit(0)
