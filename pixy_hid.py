"""
Direct HID control of the EMEET PIXY gimbal.

The PIXY exposes a vendor-defined HID interface (USB 328F:00C0, MI_04) that the
official EMEET Studio app uses to switch the camera between Idle / Tracking /
Privacy. Speaking that protocol directly means we get hardware AI tracking
WITHOUT launching the EMEET app (which grabs the camera and breaks our video
feed or shows a blue "e" logo).

Wire format (recovered from the open-source emeet-pixyd project):
    config report : 09 <iface> 01 00 00 01 00 01 <mode>
    commit report : 09 <iface> 01 <iface>
    reports are padded to the device's 32-byte report length.

Modes for iface 0x01: 0x00 = idle, 0x01 = tracking, 0x02 = privacy.
"""

import threading
import time

try:
    import hid
    HID_AVAILABLE = True
except Exception:  # pragma: no cover - optional dependency
    hid = None
    HID_AVAILABLE = False

VID = 0x328F
PID = 0x00C0

REPORT_ID = 0x09
IFACE_TRACKING = 0x01
IFACE_GESTURE = 0x04
REPORT_LEN = 32

MODE_IDLE = 0x00
MODE_TRACKING = 0x01
MODE_PRIVACY = 0x02

MODE_NAMES = {
    MODE_IDLE: 'idle',
    MODE_TRACKING: 'tracking',
    MODE_PRIVACY: 'privacy',
}

ACTION_TO_MODE = {
    'idle': MODE_IDLE,
    'tracking': MODE_TRACKING,
    'track': MODE_TRACKING,
    'privacy': MODE_PRIVACY,
}

_lock = threading.Lock()
_last_state = {'available': HID_AVAILABLE, 'mode': None, 'modeName': 'unknown', 'error': None}


def _config_payload(iface, mode_byte):
    return bytes([REPORT_ID, iface, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, mode_byte])


def _commit_payload(iface):
    return bytes([REPORT_ID, iface, 0x01, iface])


def _write(dev, payload):
    buf = payload + bytes(max(0, REPORT_LEN - len(payload)))
    written = dev.write(buf)
    return bool(written and written > 0)


def _read_mode(dev, timeout_s=0.8):
    """Read reports until we find the tracking-interface reply; return its mode byte."""
    deadline = time.time() + timeout_s
    while time.time() < deadline:
        try:
            data = dev.read(64)
        except Exception:
            return None
        if data:
            raw = bytes(data)
            if len(raw) >= 9 and raw[0] == REPORT_ID and raw[1] == IFACE_TRACKING:
                return raw[8]
        time.sleep(0.03)
    return None


def _open():
    if not HID_AVAILABLE:
        return None, 'hidapi not installed (run: pip install hidapi)'
    devices = hid.enumerate(VID, PID)
    if not devices:
        return None, 'EMEET PIXY HID interface not found (is the camera plugged in?)'

    # Prefer the vendor-defined collection (usage page 0x0083) if present
    devices.sort(key=lambda d: 0 if (d.get('usage_page') or 0) == 0x0083 else 1)
    for d in devices:
        try:
            dev = hid.device()
            dev.open_path(d['path'])
            dev.set_nonblocking(1)
            return dev, None
        except Exception as exc:
            last = str(exc)
    return None, last if 'last' in dir() else 'could not open HID device'


def set_mode(mode):
    """Set the gimbal mode. `mode` is a name ('idle'/'tracking'/'privacy') or byte."""
    mode_byte = mode if isinstance(mode, int) else ACTION_TO_MODE.get(str(mode).lower())
    if mode_byte is None:
        return {'ok': False, 'error': 'unknown mode: %r' % (mode,)}

    with _lock:
        dev, err = _open()
        if dev is None:
            _last_state.update({'available': HID_AVAILABLE, 'error': err})
            return {'ok': False, 'error': err, 'mode': None, 'modeName': 'unknown'}

        try:
            if not _write(dev, _config_payload(IFACE_TRACKING, mode_byte)):
                raise RuntimeError('config write rejected')
            time.sleep(0.2)
            if not _write(dev, _commit_payload(IFACE_TRACKING)):
                raise RuntimeError('commit write rejected')
            time.sleep(0.2)
            readback = _read_mode(dev)
        except Exception as exc:
            _last_state.update({'error': str(exc)})
            return {'ok': False, 'error': str(exc), 'mode': None, 'modeName': 'unknown'}
        finally:
            try:
                dev.close()
            except Exception:
                pass

        name = MODE_NAMES.get(readback, 'unknown')
        ok = readback == mode_byte
        _last_state.update({
            'available': True,
            'mode': readback,
            'modeName': name,
            'error': None if ok else 'device reported %s after requesting %s'
                     % (name, MODE_NAMES.get(mode_byte, mode_byte)),
        })
        return {'ok': ok, 'requested': MODE_NAMES.get(mode_byte), 'mode': readback,
                'modeName': name, 'error': _last_state['error']}


def enable_gesture(enabled=True):
    """Enable/disable the palm-gesture toggle. Returns {'ok': bool, ...}."""
    with _lock:
        dev, err = _open()
        if dev is None:
            return {'ok': False, 'error': err}
        try:
            value = 0x01 if enabled else 0x00
            if not _write(dev, _config_payload(IFACE_GESTURE, value)):
                raise RuntimeError('gesture config write rejected')
            time.sleep(0.2)
            if not _write(dev, _commit_payload(IFACE_GESTURE)):
                raise RuntimeError('gesture commit write rejected')
            time.sleep(0.2)
            return {'ok': True, 'gesture': bool(enabled)}
        except Exception as exc:
            return {'ok': False, 'error': str(exc)}
        finally:
            try:
                dev.close()
            except Exception:
                pass


def status():
    return dict(_last_state)


if __name__ == '__main__':
    import sys

    action = (sys.argv[1] if len(sys.argv) > 1 else 'status').lower()
    if action == 'status':
        print(status())
    elif action == 'gesture':
        print(enable_gesture(True))
    else:
        print(set_mode(action))
