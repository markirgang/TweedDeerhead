const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const os = require('os');
const readline = require('readline');
const { exec, execFile, spawn } = require('child_process');

const PORT = process.env.PORT || 3121;
// Visitors on other computers need HTTPS: browsers only allow microphone
// capture on secure origins (https, or localhost).
const HTTPS_PORT = Number(process.env.HTTPS_PORT || 3443);
const CERT_DIR = path.join(__dirname, 'certs');
const CERT_PFX = path.join(CERT_DIR, 'tweed-deerhead.pfx');
const CERT_PASS = path.join(CERT_DIR, 'cert-password.txt');
const PUBLIC_DIR = path.join(__dirname, 'public');
const ENV_FILE = path.join(__dirname, '.env');

let httpsReady = false;

// Last known mic VU reading, served instantly if the mic daemon is busy
let lastMicLevel = { level: 0, device: null };

// Cached EMEET PIXY gimbal state (tracking is enabled automatically at startup)
let pixyTrackingMode = 'unknown';
let pixyTrackingAvailable = true;

// ============================================================================
// 1. DO NOT AUTO-LAUNCH EMEETLINK (Prevents camera feed blockage & blue 'e' logo)
// ============================================================================

// ============================================================================
// 2. PERSISTENT PYTHON DIRECTSHOW CAMERA BRIDGE (EMEET PIXY)
// ============================================================================
let camBridgeProc = null;
function startCameraBridge() {
  const scriptPath = path.join(__dirname, 'camera_bridge.py');
  if (!fs.existsSync(scriptPath)) return;
  camBridgeProc = spawn('python', [scriptPath], {
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true
  });
  camBridgeProc.stdout.on('data', d => console.log('[CameraBridge]', d.toString().trim()));
  camBridgeProc.on('exit', () => {
    setTimeout(startCameraBridge, 2000);
  });
}
startCameraBridge();

// ============================================================================
// 3. PERSISTENT PYTHON EMEET PIXY MIC & VU DAEMON (DEVICE 1 @ 44.1 kHz)
// ============================================================================
let micDaemonProc = null;
function startMicDaemon() {
  const scriptPath = path.join(__dirname, 'mic_daemon.py');
  if (!fs.existsSync(scriptPath)) return;
  micDaemonProc = spawn('python', [scriptPath], {
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true
  });
  micDaemonProc.stdout.on('data', d => console.log('[PixyMic]', d.toString().trim()));
  micDaemonProc.on('exit', () => {
    setTimeout(startMicDaemon, 2000);
  });
}
startMicDaemon();

// ============================================================================
// 4. PERSISTENT POWERSHELL SPEECH DAEMON (ZERO STARTUP LAG FOR TTS)
// ============================================================================
function createSpeechDaemon(name) {
  const scriptPath = path.join(__dirname, 'speech_daemon.ps1');
  let proc = null;
  let reqCounter = 0;
  const pending = new Map();

  function start() {
    proc = spawn(
      'powershell',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', scriptPath],
      { stdio: ['pipe', 'pipe', 'ignore'], windowsHide: true }
    );

    const rl = readline.createInterface({ input: proc.stdout });
    rl.on('line', (line) => {
      try {
        const msg = JSON.parse(line.trim());
        if (msg.type === 'ready') {
          console.log(`[${name}] Persistent Windows 11 Speech Engine Ready`);
          return;
        }
        if (msg.id && pending.has(msg.id)) {
          const { resolve } = pending.get(msg.id);
          pending.delete(msg.id);
          resolve(msg);
        }
      } catch {}
    });

    proc.on('exit', () => {
      for (const [, { reject }] of pending) {
        reject(new Error(`${name} restarted`));
      }
      pending.clear();
      setTimeout(start, 1000);
    });
  }

  start();

  return {
    send(payload, timeoutMs = 8000) {
      return new Promise((resolve, reject) => {
        if (!proc || !proc.stdin.writable) {
          return reject(new Error(`${name} not ready`));
        }
        const id = `${name}_${++reqCounter}_${Date.now()}`;
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(new Error(`${name} timeout`));
        }, timeoutMs);

        pending.set(id, {
          resolve: (val) => { clearTimeout(timer); resolve(val); },
          reject: (err) => { clearTimeout(timer); reject(err); }
        });

        proc.stdin.write(JSON.stringify({ ...payload, id }) + '\n');
      });
    },
    kill() {
      if (proc) {
        try { proc.kill(); } catch {}
      }
    }
  };
}

const ttsDaemon = createSpeechDaemon('TTS-Daemon');

// ============================================================================
// 5. PERSISTENT PYTHON INTERNATIONAL VOICE BANK (BRITISH / AUSSIE / INDIAN / ...)
//    Windows only ships two US voices, so this daemon serves a large catalog of
//    male + female neural voices from many countries, plus a local Scottish one.
// ============================================================================
const VOICE_DAEMON = 'http://127.0.0.1:3124';
let voiceDaemonProc = null;
function startVoiceDaemon() {
  const scriptPath = path.join(__dirname, 'voice_daemon.py');
  if (!fs.existsSync(scriptPath)) return;
  voiceDaemonProc = spawn('python', [scriptPath], {
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true
  });
  voiceDaemonProc.stdout.on('data', d => console.log('[VoiceBank]', d.toString().trim()));
  voiceDaemonProc.stderr.on('data', d => {
    const line = d.toString().trim();
    if (line) console.log('[VoiceBank]', line);
  });
  voiceDaemonProc.on('exit', () => {
    setTimeout(startVoiceDaemon, 3000);
  });
}
startVoiceDaemon();

let voiceCatalog = { voices: [], ready: false };
let voiceCatalogAt = 0;

async function fetchVoiceCatalog(force = false) {
  if (!force && voiceCatalog.ready && Date.now() - voiceCatalogAt < 60000) {
    return voiceCatalog;
  }
  try {
    const ctrl = new AbortController();
    const guard = setTimeout(() => ctrl.abort(), 4000);
    const res = await fetch(`${VOICE_DAEMON}/voices`, { signal: ctrl.signal });
    clearTimeout(guard);
    if (!res.ok) throw new Error(`voice daemon ${res.status}`);
    const data = await res.json();
    voiceCatalog = {
      voices: Array.isArray(data.voices) ? data.voices : [],
      ready: true,
      edge: Boolean(data.edge),
      piper: Boolean(data.piper),
      piperLoaded: Boolean(data.piperLoaded)
    };
    voiceCatalogAt = Date.now();
  } catch {
    if (!voiceCatalog.ready) {
      voiceCatalog = { voices: [], ready: false };
    }
  }
  return voiceCatalog;
}


process.on('exit', () => {
  if (camBridgeProc) { try { camBridgeProc.kill(); } catch {} }
  if (micDaemonProc) { try { micDaemonProc.kill(); } catch {} }
  if (voiceDaemonProc) { try { voiceDaemonProc.kill(); } catch {} }
  ttsDaemon.kill();
});

// Load local .env
function loadEnvFile() {
  if (!fs.existsSync(ENV_FILE)) return;
  try {
    const content = fs.readFileSync(ENV_FILE, 'utf8');
    content.split(/\r?\n/).forEach(line => {
      const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
      if (match) {
        const key = match[1];
        let val = (match[2] || '').trim();
        if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
          val = val.slice(1, -1);
        }
        if (val) process.env[key] = val;
      }
    });
  } catch (err) {
    console.warn('Could not read .env:', err.message);
  }
}

function saveGeminiKeyToEnv(apiKey) {
  process.env.GEMINI_API_KEY = apiKey.trim();
  const content = `GEMINI_API_KEY=${apiKey.trim()}\n`;
  fs.writeFileSync(ENV_FILE, content, 'utf8');
}

loadEnvFile();

const DEFAULT_DEER_PERSONA = `You are "Buckley", a witty, observant taxidermy trophy Moose/Stag mounted on an oak plaque on the wall at 121 Tweed Blvd, Nyack, NY 10960 (overlooking the Hudson River and Clausland Mountain).
You see visitors through your EMEET PIXY Webcam eyes.
React directly to what the visitor says and what you see in the webcam frame.
IMPORTANT: Keep every reply VERY SHORT and punchy (1 to 2 sentences, max 28 words) so you can speak it immediately without delay!`;

function sendJson(res, status, data) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store'
  });
  res.end(JSON.stringify(data));
}

// ============================================================================
// LOCAL NETWORK + HTTPS, so visitors on other computers can use their own mic
// Browsers only allow microphone capture on a secure origin, which means
// localhost or https. A self-signed certificate for this machine's names and
// LAN addresses is generated once and reused.
// ============================================================================
function lanAddresses() {
  const found = [];
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const info of interfaces[name] || []) {
      if (info.family === 'IPv4' && !info.internal && !info.address.startsWith('169.254.')) {
        found.push({ address: info.address, interface: name });
      }
    }
  }
  return found;
}

function networkInfo(req) {
  const addresses = lanAddresses();
  return {
    ok: true,
    hostname: os.hostname(),
    httpPort: Number(PORT),
    httpsPort: HTTPS_PORT,
    httpsReady,
    secure: Boolean(req.socket && req.socket.encrypted),
    origin: `${req.socket && req.socket.encrypted ? 'https' : 'http'}://${req.headers.host || 'localhost'}`,
    addresses: addresses.map(item => ({
      address: item.address,
      interface: item.interface,
      httpUrl: `http://${item.address}:${PORT}`,
      httpsUrl: `https://${item.address}:${HTTPS_PORT}`
    }))
  };
}

function readCertOptions() {
  if (!fs.existsSync(CERT_PFX) || !fs.existsSync(CERT_PASS)) return null;
  return {
    pfx: fs.readFileSync(CERT_PFX),
    passphrase: fs.readFileSync(CERT_PASS, 'utf8').trim(),
    minVersion: 'TLSv1.2'
  };
}

function generateCert() {
  return new Promise((resolve, reject) => {
    const scriptPath = path.join(__dirname, 'make_cert.ps1');
    if (!fs.existsSync(scriptPath)) {
      return reject(new Error('make_cert.ps1 is missing'));
    }
    console.log('[HTTPS] Creating a self-signed certificate for this PC...');
    execFile(
      'powershell',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', scriptPath, '-OutDir', CERT_DIR],
      { timeout: 60000, windowsHide: true },
      (err, stdout, stderr) => {
        if (err) {
          const detail = (stderr || stdout || err.message || '').toString().trim();
          return reject(new Error(detail || 'certificate creation failed'));
        }
        resolve();
      }
    );
  });
}

async function startHttpsServer(handler) {
  try {
    if (!readCertOptions()) {
      await generateCert();
    }
    const options = readCertOptions();
    if (!options) throw new Error('certificate files were not created');

    const httpsServer = https.createServer(options, handler);
    await new Promise((resolve, reject) => {
      httpsServer.once('error', reject);
      httpsServer.listen(HTTPS_PORT, () => {
        httpsServer.removeListener('error', reject);
        resolve();
      });
    });

    httpsReady = true;
    const urls = lanAddresses().map(item => `https://${item.address}:${HTTPS_PORT}`);
    console.log(`[HTTPS] Microphone-enabled secure server on port ${HTTPS_PORT}`);
    urls.forEach(url => console.log(`[HTTPS]   ${url}`));
  } catch (err) {
    httpsReady = false;
    console.warn(`[HTTPS] Secure server unavailable: ${err.message}`);
    console.warn('[HTTPS] Visitors on other computers can still watch and read, but their');
    console.warn('[HTTPS] own microphone needs https. Re-run: powershell -File make_cert.ps1 -OutDir certs');
  }
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk;
      if (body.length > 15 * 1024 * 1024) {
        reject(new Error('Payload too large'));
      }
    });
    req.on('end', () => {
      if (!body) return resolve({});
      try {
        resolve(JSON.parse(body));
      } catch (e) {
        reject(e);
      }
    });
    req.on('error', reject);
  });
}

// Talk to the Python camera bridge's HID endpoints (tracking / idle / privacy / status)
function requestPixyAction(action, timeoutMs = 8000) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (payload) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      pixyTrackingAvailable = payload.ok !== false;
      resolve(payload);
    };
    const timer = setTimeout(() => finish({ ok: false, error: 'PIXY HID request timed out' }), timeoutMs);

    const req = http.request(
      { host: '127.0.0.1', port: 3122, path: `/pixy/${encodeURIComponent(action)}`, method: 'GET', timeout: timeoutMs },
      (pxRes) => {
        let body = '';
        pxRes.on('data', (chunk) => { body += chunk; });
        pxRes.on('end', () => {
          try {
            const parsed = JSON.parse(body || '{}');
            if (typeof parsed.modeName === 'string' && parsed.modeName !== 'unknown') {
              pixyTrackingMode = parsed.modeName;
            }
            finish(parsed);
          } catch {
            finish({ ok: false, error: 'unreadable response from camera bridge' });
          }
        });
      }
    );
    req.on('timeout', () => { req.destroy(); finish({ ok: false, error: 'PIXY HID request timed out' }); });
    req.on('error', (err) => finish({ ok: false, error: err.message }));
    req.end();
  });
}

function runPowerShellEncoded(psScript, timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    const encoded = Buffer.from(psScript, 'utf16le').toString('base64');
    exec(
      `powershell -NoProfile -NonInteractive -EncodedCommand ${encoded}`,
      { timeout: timeoutMs, maxBuffer: 4 * 1024 * 1024 },
      (err, stdout, stderr) => {
        if (err) return reject(new Error(stderr || err.message));
        resolve(stdout.trim());
      }
    );
  });
}

function dedupeByName(items) {
  const seen = new Set();
  const out = [];
  for (const item of items) {
    const key = (item.FriendlyName || '').trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

let cachedHardware = null;

async function queryWindowsHardware(forceRefresh = false) {
  if (cachedHardware && !forceRefresh) {
    return cachedHardware;
  }

  const psScript = `
$ErrorActionPreference = 'SilentlyContinue'
$devices = @(Get-PnpDevice -PresentOnly | Where-Object {
  $_.Class -in @('Camera', 'Image', 'AudioEndpoint', 'Media', 'Ports', 'USB') -and
  ($_.Class -ne 'USB' -or $_.FriendlyName -match 'Pixy|EMEET|Camera|Webcam|Video|Audio|Mic|Arduino|Serial')
} | Select-Object Class, FriendlyName, Status, InstanceId)

$os = Get-CimInstance Win32_OperatingSystem | Select-Object Caption, Version, CSName

Add-Type -AssemblyName System.Speech
$synth = New-Object System.Speech.Synthesis.SpeechSynthesizer
$voices = @($synth.GetInstalledVoices() | ForEach-Object { $_.VoiceInfo.Name })

@{
  os = $os
  devices = $devices
  voices = $voices
} | ConvertTo-Json -Depth 4 -Compress
`;
  try {
    const stdout = await runPowerShellEncoded(psScript, 9000);
    const parsed = JSON.parse(stdout);
    const allDevs = Array.isArray(parsed.devices) ? parsed.devices : (parsed.devices ? [parsed.devices] : []);

    const cameras = dedupeByName(allDevs.filter(d =>
      d.Class === 'Camera' ||
      (d.Class === 'MEDIA' && /Camera|Webcam|PIXY/i.test(d.FriendlyName) && !/Audio/i.test(d.FriendlyName))
    ));

    const microphones = dedupeByName([
      ...allDevs.filter(d =>
        d.Class === 'AudioEndpoint' && (/\{0\.0\.1\./i.test(d.InstanceId || '') || /Mic|Input|Virtual Audio/i.test(d.FriendlyName))
      ),
      { FriendlyName: 'Windows 11 Default System Microphone', Class: 'AudioEndpoint', Status: 'OK', InstanceId: 'win11-default-mic' }
    ]);

    const speakers = dedupeByName([
      ...allDevs.filter(d =>
        d.Class === 'AudioEndpoint' && (/\{0\.0\.0\./i.test(d.InstanceId || '') || /Speaker|Headphone|Display Audio|Output/i.test(d.FriendlyName))
      ),
      { FriendlyName: 'Windows 11 Default System Speaker', Class: 'AudioEndpoint', Status: 'OK', InstanceId: 'win11-default-speaker' }
    ]);

    cachedHardware = {
      scannedAt: new Date().toISOString(),
      os: parsed.os || { Caption: 'Microsoft Windows 11 Home', CSName: os.hostname() },
      devices: allDevs,
      cameras: cameras.length ? cameras : [{ FriendlyName: 'EMEET PIXY', Class: 'Camera', Status: 'OK' }],
      microphones,
      speakers,
      voices: Array.isArray(parsed.voices) && parsed.voices.length ? parsed.voices : ['Microsoft David Desktop', 'Microsoft Zira Desktop']
    };
    return cachedHardware;
  } catch (err) {
    cachedHardware = {
      scannedAt: new Date().toISOString(),
      os: { Caption: 'Microsoft Windows 11 Home', CSName: os.hostname() },
      devices: [],
      cameras: [
        { FriendlyName: 'EMEET PIXY', Class: 'Camera', Status: 'OK' },
        { FriendlyName: 'EMEET Virtual Camera', Class: 'MEDIA', Status: 'OK' }
      ],
      microphones: [
        { FriendlyName: 'Microphone (EMEET PIXY)', Class: 'AudioEndpoint', Status: 'OK' },
        { FriendlyName: 'EMEET Virtual Audio (EMEET Virtual Camera)', Class: 'AudioEndpoint', Status: 'OK' }
      ],
      speakers: [
        { FriendlyName: 'Headphones (C-Media(R) Audio)', Class: 'AudioEndpoint', Status: 'OK' },
        { FriendlyName: 'MStar Demo (HD Audio Driver for Display Audio)', Class: 'AudioEndpoint', Status: 'OK' }
      ],
      voices: ['Microsoft David Desktop', 'Microsoft Zira Desktop'],
      error: err.message
    };
    return cachedHardware;
  }
}

queryWindowsHardware(true).then(hw => {
  console.log(`[Startup Hardware Scan] Found ${hw.cameras.length} Camera(s), ${hw.microphones.length} Mic(s), ${hw.speakers.length} Speaker(s)`);
});

// Fast in-memory TTS via persistent daemon
async function synthesizeWindowsSpeech({ text, voiceName, rate = 1.05, volume = 100 }) {
  const psRate = Math.max(-5, Math.min(5, Math.round((Number(rate) - 1.0) * 6)));
  const psVol = Math.max(0, Math.min(100, Math.round(Number(volume))));
  const res = await ttsDaemon.send({
    action: 'tts',
    text: String(text || ''),
    voiceName: String(voiceName || ''),
    rate: psRate,
    volume: psVol
  }, 8000);
  if (res && res.ok && res.audioDataUrl) {
    return res.audioDataUrl;
  }
  throw new Error(res?.error || 'TTS failed');
}

// International neural voice (British / Australian / Indian / Scottish / Irish ...)
async function synthesizeNeuralVoice({ text, voiceId, rate = 1.05, pitch = 0.88 }) {
  const ctrl = new AbortController();
  const guard = setTimeout(() => ctrl.abort(), 25000);
  try {
    const res = await fetch(`${VOICE_DAEMON}/say`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: String(text || ''),
        voiceId: String(voiceId || ''),
        rate: Number(rate) || 1.0,
        pitch: Number(pitch) || 1.0
      }),
      signal: ctrl.signal
    });
    const data = await res.json();
    if (!res.ok || !data.ok || !data.audioDataUrl) {
      throw new Error(data?.error || `voice daemon ${res.status}`);
    }
    return data.audioDataUrl;
  } finally {
    clearTimeout(guard);
  }
}

function isNeuralVoiceId(voiceName) {
  const id = String(voiceName || '');
  return id.startsWith('edge:') || id.startsWith('piper:');
}

// Single entry point used by every speech path: try the chosen international
// voice first, and fall back to the local Windows voice if it is unreachable.
async function synthesizeSpeech({ text, voiceName, rate = 1.05, pitch = 0.88, volume = 100 }) {
  if (isNeuralVoiceId(voiceName)) {
    try {
      return await synthesizeNeuralVoice({ text, voiceId: voiceName, rate, pitch });
    } catch (err) {
      console.warn(`[VoiceBank] ${voiceName} failed (${err.message}) — using the Windows voice instead`);
    }
  }
  return synthesizeWindowsSpeech({ text, voiceName: normalizeSapiVoice(voiceName), rate, volume });
}

// A neural id can never be handed to SAPI; map it back to a real installed voice.
function normalizeSapiVoice(voiceName) {
  const id = String(voiceName || '');
  if (!id || isNeuralVoiceId(id)) return 'Microsoft David Desktop';
  return id;
}

// Verify Google Gemini API Key and fetch available Gemini Vision models
async function checkGeminiStatus(apiKey) {
  const cleanKey = (apiKey || process.env.GEMINI_API_KEY || '').trim();
  if (!cleanKey) {
    return { configured: false, valid: false, models: [], maskedKey: null };
  }
  const maskedKey = cleanKey.length > 8
    ? `${cleanKey.slice(0, 4)}...${cleanKey.slice(-4)}`
    : '****';

  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(cleanKey)}`
    );
    if (!res.ok) {
      const errText = await res.text();
      return {
        configured: true,
        valid: false,
        maskedKey,
        error: `Google API returned ${res.status}: ${errText.slice(0, 150)}`
      };
    }
    const data = await res.json();
    const models = (data.models || [])
      .filter(m =>
        Array.isArray(m.supportedGenerationMethods) &&
        m.supportedGenerationMethods.includes('generateContent') &&
        /gemini/i.test(m.name)
      )
      .map(m => ({
        id: m.name.replace(/^models\//, ''),
        displayName: m.displayName || m.name.replace(/^models\//, '')
      }));

    return {
      configured: true,
      valid: true,
      maskedKey,
      models
    };
  } catch (err) {
    return {
      configured: true,
      valid: false,
      maskedKey,
      error: err.message
    };
  }
}

// Call Google Gemini Multimodal API with zero thinking delay (thinkingBudget: 0)
async function callGemini({ apiKey, model = 'gemini-3.8-flash', systemPrompt, userMessage, imageBase64, visionSummary, history = [] }) {
  const cleanKey = (apiKey || process.env.GEMINI_API_KEY || '').trim();
  if (!cleanKey) {
    throw new Error('NO_GEMINI_KEY');
  }

  const contents = [];
  for (const h of history.slice(-4)) {
    contents.push({
      role: h.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: h.content }]
    });
  }

  const userParts = [];
  if (imageBase64 && imageBase64.includes('base64,')) {
    const [header, b64] = imageBase64.split('base64,');
    const mimeMatch = header.match(/data:(.*?);/);
    const mimeType = mimeMatch ? mimeMatch[1] : 'image/jpeg';
    userParts.push({
      inline_data: {
        mime_type: mimeType,
        data: b64
      }
    });
  }

  const combinedText = [
    visionSummary ? `[PIXY CAM]: ${visionSummary}` : '',
    userMessage || 'Look at the webcam and say something short and witty to whoever you see!'
  ].filter(Boolean).join('\n');

  userParts.push({ text: combinedText });
  contents.push({ role: 'user', parts: userParts });

  const activeModel = (model && !/2\.5/i.test(model)) ? model : 'gemini-3.8-flash';
  const generationConfig = {
    temperature: 0.75,
    maxOutputTokens: 75,
    thinkingConfig: { thinkingBudget: 0 }
  };

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(activeModel)}:generateContent?key=${encodeURIComponent(cleanKey)}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      system_instruction: { parts: [{ text: systemPrompt }] },
      contents,
      generationConfig
    })
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Gemini API (${activeModel}) error ${res.status}: ${errText.slice(0, 180)}`);
  }

  const data = await res.json();
  const reply = data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
  if (!reply) throw new Error('Empty response from Google Gemini');
  return reply;
}

// Fast Local Ollama fallback
async function callOllama({ ollamaUrl = 'http://127.0.0.1:11434', model = 'llama3.2:latest', systemPrompt, userMessage, visionSummary, history = [] }) {
  const messages = [{ role: 'system', content: systemPrompt }];
  for (const h of history.slice(-4)) {
    messages.push({ role: h.role === 'assistant' ? 'assistant' : 'user', content: h.content });
  }

  const combinedText = [
    visionSummary ? `[PIXY CAM]: ${visionSummary}` : '',
    userMessage || 'Give a short 1-sentence greeting from the wall at 121 Tweed Blvd!'
  ].filter(Boolean).join('\n');

  messages.push({ role: 'user', content: combinedText });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 4200);

  try {
    const res = await fetch(`${ollamaUrl.replace(/\/$/, '')}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        model,
        messages,
        stream: false,
        keep_alive: '60m',
        options: {
          temperature: 0.8,
          num_predict: 50,
          num_ctx: 1024
        }
      })
    });
    clearTimeout(timer);
    if (!res.ok) throw new Error(`Ollama HTTP ${res.status}`);
    const data = await res.json();
    return data?.message?.content?.trim() || "Loud and clear from 121 Tweed Blvd!";
  } catch (err) {
    clearTimeout(timer);
    throw err;
  }
}

function instantBuckleyFallback(userMessage, visionSummary) {
  const lower = (userMessage || '').toLowerCase();
  if (lower.includes('where') || lower.includes('tweed') || lower.includes('nyack')) {
    return "I'm mounted right here on the oak plaque at 121 Tweed Blvd in Nyack, NY 10960! Best view in Rockland County!";
  }
  if (lower.includes('who') || lower.includes('name')) {
    return "Name's Buckley, the trophy buck of 121 Tweed Boulevard! My EMEET PIXY eyes never miss a thing!";
  }
  if (/person/i.test(visionSummary || '')) {
    return "Well hooves and antlers! I see you loud and clear on my Pixy cam here at 121 Tweed Blvd! What's shakin', neighbor?";
  }
  return "Loud and clear from the wall at 121 Tweed Blvd in Nyack! Tell me what's on your mind!";
}

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon'
};

const requestHandler = async (req, res) => {
  const parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = parsedUrl.pathname;

  // Where this app can be reached on the home network, and whether the secure
  // (microphone-capable) port is up.
  if (pathname === '/api/net/info' && req.method === 'GET') {
    return sendJson(res, 200, networkInfo(req));
  }

  // Proxy live EMEET PIXY camera frame from Python DirectShow bridge
  if (pathname === '/api/camera/frame' && req.method === 'GET') {
    const camIdx = parsedUrl.searchParams.get('cam') || '0';
    let replied = false;
    const camReq = http.get({ host: '127.0.0.1', port: 3122, path: `/frame?cam=${encodeURIComponent(camIdx)}`, timeout: 2500 }, (camRes) => {
      if (camRes.statusCode !== 200) {
        if (!replied) { replied = true; res.writeHead(503); res.end(); }
        camRes.resume();
        return;
      }
      replied = true;
      res.writeHead(200, {
        'Content-Type': 'image/jpeg',
        'Cache-Control': 'no-store, no-cache, must-revalidate'
      });
      camRes.pipe(res);
    });
    camReq.on('timeout', () => {
      camReq.destroy();
      if (!replied) { replied = true; res.writeHead(503); res.end(); }
    });
    camReq.on('error', () => {
      if (!replied) { replied = true; res.writeHead(503); res.end(); }
    });
    return;
  }

  // Force-reset DirectShow video capture stream if stalled
  if (pathname === '/api/camera/reset' && req.method === 'POST') {
    http.get('http://127.0.0.1:3122/reset', (resetRes) => {
      resetRes.resume();
      sendJson(res, 200, { ok: true, message: 'Camera DirectShow bridge reset triggered' });
    }).on('error', () => {
      sendJson(res, 200, { ok: true, message: 'Bridge restarted' });
    });
    return;
  }

  // ---------------------------------------------------------------------
  // EMEET PIXY gimbal / AI tracking control (vendor HID, no EMEET app)
  // ---------------------------------------------------------------------
  if (pathname === '/api/camera/tracking' && req.method === 'GET') {
    const status = await requestPixyAction('status');
    return sendJson(res, 200, status);
  }

  if (pathname === '/api/camera/tracking' && req.method === 'POST') {
    let body = {};
    try {
      body = await parseBody(req);
    } catch {
      body = {};
    }
    const action = String((body && body.action) || 'tracking').toLowerCase();
    const allowed = ['tracking', 'track', 'idle', 'privacy', 'gesture'];
    if (!allowed.includes(action)) {
      return sendJson(res, 400, { ok: false, error: `unknown action: ${action}` });
    }
    const result = await requestPixyAction(action);
    if (result.ok) {
      pixyTrackingMode = action === 'privacy' ? 'privacy' : action === 'idle' ? 'idle' : 'tracking';
      console.log(`[Pixy] Gimbal mode -> ${pixyTrackingMode}`);
    } else {
      console.warn(`[Pixy] Gimbal action "${action}" failed: ${result.error || 'unknown error'}`);
    }
    return sendJson(res, result.ok ? 200 : 500, result);
  }

  // Proxy real-time RMS microphone VU level from Python sounddevice daemon
  if (pathname === '/api/mic/level' && req.method === 'GET') {
    // Cache the last level so a slow/blocked mic daemon can never stall the UI
    let finished = false;
    const finish = (payload) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      try {
        res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
        res.end(JSON.stringify(payload));
      } catch {}
    };

    const timer = setTimeout(() => finish(lastMicLevel), 900);

    const micReq = http.get({ host: '127.0.0.1', port: 3123, path: '/level', timeout: 800 }, (micRes) => {
      let body = '';
      micRes.on('data', (chunk) => { body += chunk; });
      micRes.on('end', () => {
        try {
          const parsed = JSON.parse(body);
          lastMicLevel = parsed;
          finish(parsed);
        } catch {
          finish(lastMicLevel);
        }
      });
    });
    micReq.on('timeout', () => { micReq.destroy(); finish(lastMicLevel); });
    micReq.on('error', () => finish(lastMicLevel));
    return;
  }

  // Proxy microphone listening & transcription to Python daemon (Direct Device 1 @ 44.1 kHz)
  if (pathname === '/api/mic/listen' && req.method === 'POST') {
    const micReq = http.request(
      'http://127.0.0.1:3123/listen',
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, timeout: 30000 },
      (micRes) => {
        res.writeHead(micRes.statusCode, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
        micRes.pipe(res);
      }
    );
    micReq.on('timeout', () => {
      micReq.destroy();
      sendJson(res, 200, { ok: false, transcript: '', timeout: true });
    });
    micReq.on('error', (err) => {
      sendJson(res, 500, { ok: false, error: err.message });
    });
    req.pipe(micReq);
    return;
  }

  // Audio recorded in a visitor's own browser (WAV) -> speech-to-text daemon
  if (pathname === '/api/mic/transcribe' && req.method === 'POST') {
    const MAX_AUDIO_BYTES = 12 * 1024 * 1024;
    const declared = Number(req.headers['content-length'] || 0);
    if (declared > MAX_AUDIO_BYTES) {
      return sendJson(res, 413, { ok: false, transcript: '', error: 'Audio clip too large' });
    }

    let finished = false;
    const finish = (payload, status = 200) => {
      if (finished) return;
      finished = true;
      sendJson(res, status, payload);
    };

    const headers = { 'Content-Type': req.headers['content-type'] || 'audio/wav' };
    if (declared > 0) headers['Content-Length'] = String(declared);

    const sttReq = http.request(
      { host: '127.0.0.1', port: 3123, path: '/transcribe', method: 'POST', headers, timeout: 30000 },
      (sttRes) => {
        let body = '';
        sttRes.on('data', (chunk) => { body += chunk; });
        sttRes.on('end', () => {
          try {
            const parsed = JSON.parse(body);
            finish(parsed, sttRes.statusCode || 200);
          } catch {
            finish({ ok: false, transcript: '', error: 'Speech engine returned an unreadable answer' }, 502);
          }
        });
      }
    );

    sttReq.on('timeout', () => {
      sttReq.destroy();
      finish({ ok: false, transcript: '', error: 'Speech recognition timed out' }, 504);
    });
    sttReq.on('error', (err) => {
      finish({ ok: false, transcript: '', error: err.message }, 502);
    });

    req.pipe(sttReq);
    return;
  }

  if (pathname === '/api/hardware/win11' && req.method === 'GET') {
    const force = parsedUrl.searchParams.get('refresh') === '1';
    const hw = await queryWindowsHardware(force);
    return sendJson(res, 200, hw);
  }

  if (pathname === '/api/voices' && req.method === 'GET') {
    const force = parsedUrl.searchParams.get('refresh') === '1';
    const catalog = await fetchVoiceCatalog(force);
    return sendJson(res, 200, {
      ok: true,
      ready: catalog.ready,
      count: catalog.voices.length,
      edge: Boolean(catalog.edge),
      piper: Boolean(catalog.piper),
      piperLoaded: Boolean(catalog.piperLoaded),
      voices: catalog.voices
    });
  }

  if (pathname === '/api/tts' && req.method === 'POST') {
    try {
      const body = await parseBody(req);
      const audioDataUrl = await synthesizeSpeech(body);
      return sendJson(res, 200, { ok: true, audioDataUrl });
    } catch (err) {
      return sendJson(res, 500, { ok: false, error: err.message });
    }
  }

  if (pathname === '/api/gemini/status' && req.method === 'GET') {
    const queryKey = parsedUrl.searchParams.get('key') || '';
    const status = await checkGeminiStatus(queryKey);
    return sendJson(res, 200, status);
  }

  if (pathname === '/api/gemini/key' && req.method === 'POST') {
    try {
      const body = await parseBody(req);
      const apiKey = (body.apiKey || '').trim();
      if (!apiKey) {
        return sendJson(res, 400, { error: 'API Key cannot be empty' });
      }
      const status = await checkGeminiStatus(apiKey);
      saveGeminiKeyToEnv(apiKey);
      return sendJson(res, 200, status);
    } catch (err) {
      return sendJson(res, 500, { error: err.message });
    }
  }

  if (pathname === '/api/chat' && req.method === 'POST') {
    try {
      const body = await parseBody(req);
      const {
        provider = 'gemini',
        model = 'gemini-3.8-flash',
        apiKey,
        ollamaUrl = 'http://127.0.0.1:11434',
        customPersona,
        userMessage,
        imageBase64,
        visionSummary,
        history = []
      } = body;

      if (apiKey && apiKey.trim() && provider === 'gemini') {
        process.env.GEMINI_API_KEY = apiKey.trim();
      }

      const systemPrompt = (customPersona && customPersona.trim()) ? customPersona.trim() : DEFAULT_DEER_PERSONA;

      let reply = '';
      let usedProvider = provider;

      try {
        if (provider === 'gemini') {
          reply = await callGemini({
            apiKey,
            model: (model && !/2\.5/i.test(model)) ? model : 'gemini-3.8-flash',
            systemPrompt,
            userMessage,
            imageBase64,
            visionSummary,
            history
          });
          usedProvider = 'Google Gemini (gemini-3.8-flash)';
        } else {
          reply = await callOllama({
            ollamaUrl,
            model: model || 'llama3.2:latest',
            systemPrompt,
            userMessage,
            visionSummary,
            history
          });
          usedProvider = `Local AI (${model || 'llama3.2:latest'})`;
        }
      } catch {
        try {
          reply = await callOllama({
            ollamaUrl,
            model: 'llama3.2:latest',
            systemPrompt,
            userMessage,
            visionSummary,
            history
          });
          usedProvider = 'Local AI (Fast Mode)';
        } catch {
          reply = instantBuckleyFallback(userMessage, visionSummary);
          usedProvider = 'Buckley Instant Reflex';
        }
      }

      // Pre-synthesize WAV audio in the same round-trip for minimum conversational delay!
      let audioDataUrl = null;
      try {
        audioDataUrl = await synthesizeSpeech({
          text: reply,
          voiceName: body.voiceName || 'Microsoft David Desktop',
          rate: body.rate || 1.05,
          pitch: body.pitch || 0.88,
          volume: body.volume ?? 100
        });
      } catch {}

      return sendJson(res, 200, {
        reply,
        audioDataUrl,
        provider: usedProvider,
        timestamp: new Date().toISOString()
      });
    } catch (err) {
      return sendJson(res, 400, { error: err.message });
    }
  }

  let safePath = path.normalize(pathname === '/' ? '/index.html' : pathname).replace(/^(\.\.[/\\])+/, '');
  let filePath = path.join(PUBLIC_DIR, safePath);

  fs.stat(filePath, (err, stats) => {
    if (err || !stats.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('404 Not Found');
    }
    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';
    res.writeHead(200, {
      'Content-Type': contentType,
      'Cache-Control': 'no-cache'
    });
    fs.createReadStream(filePath).pipe(res);
  });
};

const server = http.createServer(requestHandler);

server.listen(PORT, () => {
  console.log(`\n🦌 ============================================================`);
  console.log(`🦌 TWEED DEERHEAD & MOOSE APP RUNNING!`);
  console.log(`📍 Wall Location: 121 Tweed Blvd, Nyack, NY 10960`);
  console.log(`📹 EMEET PIXY DirectShow Bridge: Port 3122`);
  console.log(`🎙️ EMEET PIXY Mic & Real-time VU Daemon: Port 3123`);
  console.log(`🗣️ International Voice Bank (123 voices, 50 countries): Port 3124`);
  console.log(`👄 Solenoid Jaw: Binary ON/OFF Action`);
  console.log(`🌐 Open in Browser: http://localhost:${PORT}`);

  const nets = lanAddresses();
  if (nets.length) {
    console.log(`💻 Other computers on this network can open:`);
    nets.forEach(item => {
      console.log(`     http://${item.address}:${PORT}   (watch + read, mic needs https)`);
      console.log(`     https://${item.address}:${HTTPS_PORT}   (use this computer's microphone)`);
    });
  }
  console.log(`🦌 ============================================================\n`);

  // Turn on the PIXY's built-in AI tracking automatically (via vendor HID,
  // so the EMEET app never has to run and never grabs the camera).
  enablePixyTrackingOnStartup();
});

// Secure twin of the app, so a laptop or phone on the same network can talk to
// Buckley through its own microphone.
startHttpsServer(requestHandler);

async function enablePixyTrackingOnStartup(attempt = 1) {
  if (process.env.PIXY_AUTO_TRACK === '0') {
    console.log('[Pixy] Auto-tracking disabled by PIXY_AUTO_TRACK=0');
    return;
  }

  // Ask the bridge to switch the gimbal into AI tracking mode. This is retried
  // because the camera bridge needs a couple of seconds to scan the cameras.
  const result = await requestPixyAction('tracking');

  if (result && result.ok) {
    pixyTrackingMode = 'tracking';
    console.log('[Pixy] AI gimbal tracking is ON');
    return;
  }

  if (attempt >= 5) {
    console.warn(`[Pixy] Could not enable AI tracking: ${result && result.error ? result.error : 'unknown error'}`);
    console.warn('[Pixy] Video keeps working — use the Tracking button in the app to retry.');
    return;
  }

  setTimeout(() => enablePixyTrackingOnStartup(attempt + 1), 2500);
}
