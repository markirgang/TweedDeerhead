const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const readline = require('readline');
const { exec, spawn } = require('child_process');

const PORT = process.env.PORT || 3121;
const PUBLIC_DIR = path.join(__dirname, 'public');
const ENV_FILE = path.join(__dirname, '.env');

// ============================================================================
// 1. AUTO-START EMEETLINK TO ENGAGE HARDWARE AI TRACKING ON STARTUP
// ============================================================================
function launchEmeetLinkTracking() {
  const emeetPath = 'C:\\Program Files\\EMEETLINK\\EMEETLINK.exe';
  if (fs.existsSync(emeetPath)) {
    exec(`powershell -NoProfile -Command "if (-not (Get-Process EMEETLINK -ErrorAction SilentlyContinue)) { Start-Process '${emeetPath}' -WindowStyle Minimized }"`, (err) => {
      if (!err) console.log('[EMEET PIXY] EMEETLINK started for hardware auto-tracking');
    });
  }
}
launchEmeetLinkTracking();

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

process.on('exit', () => {
  if (camBridgeProc) { try { camBridgeProc.kill(); } catch {} }
  if (micDaemonProc) { try { micDaemonProc.kill(); } catch {} }
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

const server = http.createServer(async (req, res) => {
  const parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = parsedUrl.pathname;

  // Proxy live EMEET PIXY camera frame from Python DirectShow bridge
  if (pathname === '/api/camera/frame' && req.method === 'GET') {
    const camIdx = parsedUrl.searchParams.get('cam') || '1';
    http.get(`http://127.0.0.1:3122/frame?cam=${encodeURIComponent(camIdx)}`, (camRes) => {
      if (camRes.statusCode !== 200) {
        res.writeHead(503);
        return res.end();
      }
      res.writeHead(200, {
        'Content-Type': 'image/jpeg',
        'Cache-Control': 'no-store, no-cache, must-revalidate'
      });
      camRes.pipe(res);
    }).on('error', () => {
      res.writeHead(503);
      res.end();
    });
    return;
  }

  // Proxy real-time RMS microphone VU level from Python sounddevice daemon
  if (pathname === '/api/mic/level' && req.method === 'GET') {
    http.get('http://127.0.0.1:3123/level', (micRes) => {
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      micRes.pipe(res);
    }).on('error', () => {
      sendJson(res, 200, { level: 0 });
    });
    return;
  }

  // Proxy microphone listening & transcription to Python daemon (Direct Device 1 @ 44.1 kHz)
  if (pathname === '/api/mic/listen' && req.method === 'POST') {
    const micReq = http.request(
      'http://127.0.0.1:3123/listen',
      { method: 'POST', headers: { 'Content-Type': 'application/json' } },
      (micRes) => {
        res.writeHead(micRes.statusCode, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
        micRes.pipe(res);
      }
    );
    micReq.on('error', (err) => {
      sendJson(res, 500, { ok: false, error: err.message });
    });
    req.pipe(micReq);
    return;
  }

  if (pathname === '/api/hardware/win11' && req.method === 'GET') {
    const force = parsedUrl.searchParams.get('refresh') === '1';
    const hw = await queryWindowsHardware(force);
    return sendJson(res, 200, hw);
  }

  if (pathname === '/api/tts' && req.method === 'POST') {
    try {
      const body = await parseBody(req);
      const audioDataUrl = await synthesizeWindowsSpeech(body);
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
        audioDataUrl = await synthesizeWindowsSpeech({
          text: reply,
          voiceName: body.voiceName || 'Microsoft David Desktop',
          rate: body.rate || 1.05,
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
});

server.listen(PORT, () => {
  console.log(`\n🦌 ============================================================`);
  console.log(`🦌 TWEED DEERHEAD & MOOSE APP RUNNING!`);
  console.log(`📍 Wall Location: 121 Tweed Blvd, Nyack, NY 10960`);
  console.log(`📹 EMEET PIXY DirectShow Bridge: Port 3122`);
  console.log(`🎙️ EMEET PIXY Mic & Real-time VU Daemon: Port 3123`);
  console.log(`👄 Solenoid Jaw: Binary ON/OFF Action`);
  console.log(`🌐 Open in Browser: http://localhost:${PORT}`);
  console.log(`🦌 ============================================================\n`);
});
