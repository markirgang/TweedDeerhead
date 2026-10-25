import sounddevice as sd
import numpy as np
import io
import wave
import speech_recognition as sr

# Find the best Pixy or default device index
def get_pixy_device():
    devs = sd.query_devices()
    for i, d in enumerate(devs):
        if d['max_input_channels'] > 0 and 'pixy' in d['name'].lower():
            try:
                # Test opening with 44100
                stream = sd.InputStream(device=i, channels=1, samplerate=44100)
                stream.start()
                stream.stop()
                stream.close()
                return i
            except Exception:
                continue
    return None

dev_idx = get_pixy_device()
print(f"Verified Pixy audio input index: {dev_idx}")
