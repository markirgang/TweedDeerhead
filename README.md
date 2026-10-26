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
- **💻 Talk From Any Computer on the Network:**
  - Open the app's **https** address on a laptop, tablet or phone and switch **🎧 Listening with** to that machine's own microphone — no software to install.
  - Browser audio is voice-detected locally, sent to the wall PC as a small WAV clip, transcribed there, and answered by Buckley. The reply plays on the visitor's computer.
  - The wall PC's PIXY microphone keeps working independently, so people standing at 121 Tweed Blvd are never ignored.
- **🎵 Music &amp; Lipsync:**
  - Import any **MP3 / WAV / M4A / OGG** file (drag it onto the card or use **Choose MP3**) and Buckley's jaw solenoid chatters along with the song in real time.
  - **Import a YouTube link** — paste a `youtu.be/…` or `youtube.com/watch?v=…` URL and Buckley downloads just the audio track onto the wall PC, then lipsyncs to it exactly like a local file. Imported tracks are cached and listed so you can replay them with one click.
  - The jaw is driven from the **live audio envelope** (Web Audio analyser), not a fixed timer, so it speeds up on busy passages and closes during quiet ones.
  - Play / pause / stop, seek, and volume controls, plus a live jaw meter showing `[OPEN - ON]` / `[SHUT - OFF]`.
  - While a song plays the microphone loop pauses so Buckley sings instead of trying to answer the stereo, and a **👄 Lipsync** switch turns the jaw motion off if you just want the music.
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

---

## 🎬 Importing a YouTube Link

Paste a YouTube URL into the **Music & Lipsync** card and press **🎬 Import YouTube**.

Buckley downloads **only the audio track** onto the wall PC, caches it under
`cache/youtube/`, and plays it from this server. That last part matters: a browser
can never read the audio out of a YouTube embed (it lives in a cross-origin
iframe), so an embedded player would force the jaw onto a fake timer. By serving
the audio ourselves the `<audio>` element is same-origin, the Web Audio analyser
can see the waveform, and the jaw follows the **real** song.

- Supported links: `youtu.be/…`, `youtube.com/watch?v=…`, `/shorts/…`, `/live/…`, and bare 11-character video ids.
- Imports are cached — pasting the same link again is instant and never re-downloads.
- Imported tracks appear in **📼 Imported from YouTube**; click one to load it, `✕` to delete it from the PC.
- Cache entries older than 30 days are pruned at startup.

**One-time setup** (needs Python, which this app already uses):

```powershell
python -m pip install --user yt-dlp
```

The server looks for `yt-dlp` on `PATH`, then `python -m yt_dlp`, then `py -3 -m yt_dlp`.
If none is found the card shows an install hint and local MP3 playback keeps working.
`ffmpeg` is **not** required — YouTube's m4a audio stream is used as-is.

> YouTube sometimes asks a network to "confirm you're not a bot". If an import
> fails with that message, wait a minute and retry, or drop the song in as an MP3.

---

## 💻 Talking to Buckley From Another Computer

Any laptop, tablet or phone on the same home network can open the app and talk to
Buckley through **its own microphone**. The wall PC's PIXY microphone keeps
listening too — the person in front of the deerhead can always just speak.

### Which address to open

| Address | What it does |
|---|---|
| `http://localhost:3121` | Full app on the wall PC (PIXY camera + PIXY mic) |
| `http://<lan-ip>:3121` | Watch + read from another device. **Mic is blocked** — browsers refuse microphone access on plain `http://` |
| `https://<lan-ip>:3443` | **Use this one to talk from another device.** Secure page, browser microphone allowed |
| `https://tweedeer.local:3443` | Same thing using the PC's name, if your router resolves `.local` |

The Live tab shows the exact `https://…:3443` link for the network the app is on,
and the server prints both URLs at startup.

### Steps on the visitor's computer

1. Open the **https** address (e.g. `https://192.168.86.180:3443`).
2. The browser warns about a self-signed certificate. Choose **Advanced → Proceed**
   (Chrome/Edge) or **Advanced → Accept the Risk and Continue** (Firefox). This is
   expected: the certificate is generated locally by this PC.
3. Set **🎧 Listening with:** to **💻 This computer's microphone** — on the Live tab
   or in Hardware Settings.
4. Allow microphone access when the browser asks. The VU meter now follows that
   computer's microphone, and Buckley answers through that computer's speakers.

### Optional: remove the certificate warning

Double-click **`certs/tweed-deerhead.cer`** on the visitor's PC and install it into
**Trusted Root Certification Authorities**. After that the padlock is green and no
warning appears. The certificate is valid for 5 years.

### Notes

- The certificate covers this PC's name, `localhost`, and its LAN IP addresses. If
  the router assigns a **new IP**, regenerate it and restart the server:
  ```powershell
  powershell -File .\make_cert.ps1 -OutDir .\certs
  ```
  The server also creates it automatically on first start.
- `certs/` is gitignored — the private key and password are never committed.
- Override the secure port with `HTTPS_PORT` (for example `set HTTPS_PORT=8443`) if
  3443 is already taken.
- Audio is transcribed on the wall PC by `mic_daemon.py`, so the visitor's computer
  only needs a browser — nothing to install.
- Selecting the PIXY mic on a remote device still works for *listening*, but the
  audio comes from the wall PC's room, not from that device.
- Set `TW_NO_DAEMONS=1` before `node server.js` to run just the web page, without
  starting the Python camera / mic / voice daemons. Handy for testing the UI on a
  machine that has no PIXY attached.
