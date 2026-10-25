const http = require('http');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');

const PORT = process.env.PORT || 3121;
const PUBLIC_DIR = path.join(__dirname, 'public');
const ENV_FILE = path.join(__dirname, '.env');

// Load local .env if present
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

const DEFAULT_DEER_PERSONA = `You are "Buckley" (or "Buck"), a proud, witty, observant, and charmingly rustic taxidermy White-Tailed Deerhead mounted high on an oak plaque on the wall at 121 Tweed Blvd, Nyack, NY 10960.

KEY FACTS ABOUT YOU:
- Your permanent home is on the wall at 121 Tweed Blvd, Nyack, New York 10960, perched along the scenic ridge by Clausland Mountain and Blauvelt State Park overlooking the Hudson River and the Tappan Zee / Mario Cuomo Bridge.
- Before you became a distinguished wall mount at 121 Tweed Blvd, you were the ten-point king of the trails around Tweed Boulevard, Hook Mountain, and Nyack Beach State Park. You love the indoor heating at 121 Tweed Blvd and take pride in watching over the room.
- You see the real world through your connected Pixy Webcam eyes. Every time you are called, you receive a live snapshot image from the webcam and visual tracking telemetry.
- Describe and react specifically to what you actually see in the webcam frame (people, facial expressions, waves, clothing colors, objects held up to the camera, pets, or the room) while staying 100% in character as a talking mounted deerhead!
- Keep your responses punchy, warm, funny, and natural to be spoken aloud (1 to 3 sentences, roughly 25 to 55 words) because your voice is synthesized out loud and your animated deer jaw moves as you speak.`;

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

// Query Windows 11 PnP devices for Cameras, Pixy, Audio inputs/outputs, and Serial ports
function queryWindowsHardware() {
  return new Promise((resolve) => {
    const psScript = `
      $ErrorActionPreference = 'SilentlyContinue'
      $devices = Get-PnpDevice -PresentOnly | Where-Object {
        $_.Class -in @('Camera', 'Image', 'AudioEndpoint', 'Media', 'Ports', 'USB') -and
        ($_.Class -ne 'USB' -or $_.FriendlyName -match 'Pixy|Camera|Webcam|Video|Audio|Mic|Arduino|Serial|CH340|CP210')
      } | Select-Object Class, FriendlyName, Status, InstanceId
      $os = Get-CimInstance Win32_OperatingSystem | Select-Object Caption, Version, CSName
      @{
        os = $os
        devices = @($devices)
      } | ConvertTo-Json -Depth 3 -Compress
    `;
    exec(
      `powershell -NoProfile -NonInteractive -Command "${psScript.replace(/\r?\n/g, ' ')}"`,
      { timeout: 8000, maxBuffer: 2 * 1024 * 1024 },
      (err, stdout) => {
        if (err || !stdout) {
          return resolve({
            os: { Caption: 'Windows 11', Version: process.platform, CSName: process.env.COMPUTERNAME || 'TWEED-PC' },
            devices: []
          });
        }
        try {
          const parsed = JSON.parse(stdout.trim());
          resolve(parsed);
        } catch {
          resolve({
            os: { Caption: 'Windows 11', Version: process.platform, CSName: process.env.COMPUTERNAME || 'TWEED-PC' },
            devices: []
          });
        }
      }
    );
  });
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

// Check local Ollama availability and models
async function checkOllama(ollamaUrl = 'http://127.0.0.1:11434') {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3000);
    const res = await fetch(`${ollamaUrl.replace(/\/$/, '')}/api/tags`, {
      signal: controller.signal
    });
    clearTimeout(timer);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const models = (data.models || []).map(m => m.name);
    return { available: true, models };
  } catch (err) {
    return { available: false, models: [], error: err.message };
  }
}

// Call Google Gemini Multimodal API (Vision + Text)
async function callGemini({ apiKey, model = 'gemini-2.5-flash', systemPrompt, userMessage, imageBase64, visionSummary, history = [] }) {
  const cleanKey = (apiKey || process.env.GEMINI_API_KEY || '').trim();
  if (!cleanKey) {
    throw new Error('Missing Google Gemini API Key. Please paste your Gemini API Key in the AI Brain settings or top banner.');
  }

  const contents = [];
  for (const h of history.slice(-8)) {
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
    visionSummary ? `[LIVE PIXY WEBCAM TELEMETRY AT 121 TWEED BLVD, NYACK, NY 10960]: ${visionSummary}` : '',
    userMessage || 'Look at the live webcam image right now and talk to whoever or whatever you see in front of your wall mount at 121 Tweed Blvd!'
  ].filter(Boolean).join('\n\n');

  userParts.push({ text: combinedText });
  contents.push({ role: 'user', parts: userParts });

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(cleanKey)}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      system_instruction: { parts: [{ text: systemPrompt }] },
      contents,
      generationConfig: {
        temperature: 0.85,
        maxOutputTokens: 220
      }
    })
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Gemini API (${model}) error ${res.status}: ${errText.slice(0, 220)}`);
  }

  const data = await res.json();
  const reply = data?.candidates?.[0]?.content?.parts?.map(p => p.text).join(' ')?.trim();
  if (!reply) throw new Error('Empty response from Google Gemini');
  return reply;
}

// Call Local Ollama (optional fallback)
async function callOllama({ ollamaUrl = 'http://127.0.0.1:11434', model = 'llama3.2:latest', systemPrompt, userMessage, imageBase64, visionSummary, history = [] }) {
  const messages = [{ role: 'system', content: systemPrompt }];
  for (const h of history.slice(-6)) {
    messages.push({ role: h.role === 'assistant' ? 'assistant' : 'user', content: h.content });
  }

  const combinedText = [
    visionSummary ? `[LIVE PIXY WEBCAM TELEMETRY AT 121 TWEED BLVD, NYACK, NY 10960]: ${visionSummary}` : '',
    userMessage || 'React in character as the mounted deerhead to what you see on the webcam right now!'
  ].filter(Boolean).join('\n\n');

  const userMsgObj = { role: 'user', content: combinedText };
  if (imageBase64 && /llava|vision|minicpm|moondream|gemma3/i.test(model)) {
    const rawB64 = imageBase64.includes('base64,') ? imageBase64.split('base64,')[1] : imageBase64;
    userMsgObj.images = [rawB64];
  }
  messages.push(userMsgObj);

  const res = await fetch(`${ollamaUrl.replace(/\/$/, '')}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      messages,
      stream: false,
      options: {
        temperature: 0.85,
        num_predict: 140
      }
    })
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Ollama error (${res.status}): ${errText.slice(0, 200)}`);
  }

  const data = await res.json();
  const reply = data?.message?.content?.trim();
  if (!reply) throw new Error('Empty response from Ollama');
  return reply;
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

  if (pathname === '/api/hardware/win11' && req.method === 'GET') {
    const hw = await queryWindowsHardware();
    return sendJson(res, 200, hw);
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

  if (pathname === '/api/ollama/status' && req.method === 'GET') {
    const ollamaUrl = parsedUrl.searchParams.get('url') || 'http://127.0.0.1:11434';
    const status = await checkOllama(ollamaUrl);
    return sendJson(res, 200, status);
  }

  if (pathname === '/api/chat' && req.method === 'POST') {
    try {
      const body = await parseBody(req);
      const {
        provider = 'gemini',
        model = 'gemini-2.5-flash',
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

      if (provider === 'gemini') {
        reply = await callGemini({
          apiKey,
          model: model || 'gemini-2.5-flash',
          systemPrompt,
          userMessage,
          imageBase64,
          visionSummary,
          history
        });
        usedProvider = `Google Gemini (${model || 'gemini-2.5-flash'})`;
      } else {
        reply = await callOllama({
          ollamaUrl,
          model: model || 'llama3.2:latest',
          systemPrompt,
          userMessage,
          imageBase64,
          visionSummary,
          history
        });
        usedProvider = `Local Ollama (${model || 'llama3.2:latest'})`;
      }

      return sendJson(res, 200, {
        reply,
        provider: usedProvider,
        timestamp: new Date().toISOString()
      });
    } catch (err) {
      return sendJson(res, 400, { error: err.message });
    }
  }

  // Serve static files from public/
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
  console.log(`🦌 TWEED DEERHEAD APP RUNNING!`);
  console.log(`📍 Wall Location: 121 Tweed Blvd, Nyack, NY 10960`);
  console.log(`🧠 Backend: Google Gemini Multimodal Vision`);
  console.log(`🌐 Open in Browser: http://localhost:${PORT}`);
  console.log(`🦌 ============================================================\n`);
});
