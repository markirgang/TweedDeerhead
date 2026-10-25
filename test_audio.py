import sounddevice as sd
import numpy as np

for idx in [1, 0, 7, 15, None]:
    try:
        sr = 44100
        recording = sd.rec(int(1.0 * sr), samplerate=sr, channels=1, dtype='float32', device=idx)
        sd.wait()
        peak = np.max(np.abs(recording))
        print(f"Device {idx}: SUCCESS! Peak = {peak:.5f}")
    except Exception as e:
        print(f"Device {idx}: FAILED - {e}")
