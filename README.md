# 🦌 TweedDeerhead — Interactive AI Mounted Deerhead

An interactive, animatronic-style AI Deerhead ("**Buckley**, the Tweed Blvd Stag") mounted on the wall at **121 Tweed Blvd, Nyack, NY 10960**. Buckley watches the room through a connected **Pixy Webcam** (or any USB/Windows 11 camera), detects visitors and objects in real time, and talks to people he sees using **Google Gemini Multimodal Vision** and Windows 11 speech synthesis.

---

## ✨ Features

- **🪵 Mounted at 121 Tweed Blvd, Nyack, NY 10960:** Buckley has a full Hudson Valley & Clausland Mountain backstory and believes he is mounted on an oak plaque at 121 Tweed Blvd.
- **📹 Live Pixy Webcam Video Window:**
  - Real-time video feed with a **Pixy Vision HUD** overlay (person & object bounding boxes powered by TensorFlow.js COCO-SSD + Pixy motion/color tracking).
  - Automatic eye-tracking: Buckley's pupils follow people as they move across the room.
  - **Auto-Greet on Sight:** Automatically captures a webcam frame and talks to visitors when someone steps in front of the camera.
- **⚙️ Dedicated Windows 11 Hardware Settings Tab:**
  - Top navigation tab (`⚙️ Hardware Settings (Win 11)`) to select and test:
    - **Webcam / Pixy Camera** (with resolution & mirror controls + live hardware preview)
    - **Microphone Input** (with real-time green VU level meter & continuous hands-free listening mode)
    - **Speaker / Audio Output** & **Voice Synthesis** (pitch, rate, volume, and speaker test)
      - **123 male & female voices from 50 countries:** British, Australian, Indian, Scottish, Irish, New Zealand, South African, Canadian, Singaporean, Kenyan, Tanzanian, Filipino and American, plus Spanish, French, German, Italian, Portuguese, Dutch, Swedish, Polish, Russian, Turkish, Hindi, Japanese, Korean, Mandarin, Arabic, Hebrew, Greek, Czech, Danish, Finnish, Norwegian, Hungarian, Romanian, Ukrainian, Vietnamese, Thai, Indonesian, Malay, Tamil, Telugu, Bengali, Gujarati, Kannada, Malayalam, Marathi, Persian and Urdu.
    - **Windows 11 Device Manager PnP Inspector** (scans connected cameras, Pixy USB devices, audio endpoints, and COM ports)
- **🧠 Google Gemini Multimodal Vision Backend:**
  - Powered by Google Gemini (`gemini-2.5-flash`, `gemini-2.5-pro`, etc.).
  - Sends both the live webcam frame and visual telemetry so Buckley comments specifically on what visitors look like, what they're holding, or what they're doing.

---

## 🚀 Quick Start (Windows 11)

1. Double-click **`Launch-TweedDeerhead.bat`** (or run `npm start` inside `C:\Users\marki\OneDrive\Desktop\TweedDeerhead`).
2. Open **http://localhost:3121** in your browser.
3. Paste your **Google Gemini API Key** in the top bar (or in the **🧠 Google Gemini & Persona** tab) and click **Save & Connect Gemini**.
   - Your key is saved locally in `.env` (which is excluded via `.gitignore` so it is never uploaded to GitHub).
4. Use the **⚙️ Hardware Settings (Win 11)** tab at the top to select your **Pixy Webcam**, **Microphone**, and **Speaker**.

---

## 🗣️ International Voices (British, Australian, Indian, Scottish, Irish…)

Windows itself only ships two English voices (both American: David and Zira), so the app runs a small **voice bank daemon** (`voice_daemon.py`, port **3124**) that adds 123 male and female voices from 50 countries.

Two engines are used:

| Engine | Used for | Notes |
|---|---|---|
| Microsoft neural voices (`edge-tts`) | British, Australian, Indian, Irish, NZ, South African, Canadian, Singaporean, Kenyan, Tanzanian, Filipino + ~40 world languages | Natural-sounding, needs an internet connection |
| Local Piper voice | **Scottish** (Microsoft has no Scottish voice in any accent) | Runs offline on this PC, ~0.3 s |

If the internet drops or a neural voice fails, the app automatically falls back to the Windows voice so Buckley never goes silent.

**One-time setup on a new PC:**

```powershell
python -m pip install --user edge-tts piper-tts
# Scottish voice model (63 MB, downloaded once)
mkdir voices
curl -L -o voices/en_GB-alba-medium.onnx `
  https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_GB/alba/medium/en_GB-alba-medium.onnx
curl -L -o voices/en_GB-alba-medium.onnx.json `
  https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_GB/alba/medium/en_GB-alba-medium.onnx.json
```

To refresh the voice catalog from Microsoft: `python build_voice_catalog.py`
