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
    - **Speaker / Audio Output** & **Windows 11 Voice Synthesis** (pitch, rate, volume, and speaker test)
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
