// ============================================================================
// TWEED DEERHEAD — 121 Tweed Blvd, Nyack, NY 10960
// Frontend Application (EMEET PIXY Vision + Windows 11 Hardware + Google Gemini)
// ============================================================================

const DEFAULT_PERSONA = `You are "Buckley" (or "Buck"), a proud, witty, observant, and charmingly rustic taxidermy White-Tailed Deerhead mounted high on an oak plaque on the wall at 121 Tweed Blvd, Nyack, NY 10960.

KEY FACTS ABOUT YOU:
- Your permanent home is on the wall at 121 Tweed Blvd, Nyack, New York 10960, perched along the scenic ridge by Clausland Mountain and Blauvelt State Park overlooking the Hudson River and the Tappan Zee / Mario Cuomo Bridge.
- Before you became a distinguished wall mount at 121 Tweed Blvd, you were the ten-point king of the trails around Tweed Boulevard, Hook Mountain, and Nyack Beach State Park. You love the indoor heating at 121 Tweed Blvd and take pride in watching over the room.
- You see the real world through your connected EMEET PIXY Webcam eyes. Every time you are called, you receive a live snapshot image from the webcam and visual tracking telemetry.
- Describe and react specifically to what you actually see in the webcam frame (people, facial expressions, waves, clothing colors, objects held up to the camera, pets, or the room) while staying 100% in character as a talking mounted deerhead!
- Keep your responses punchy, warm, funny, and natural to be spoken aloud (1 to 3 sentences, roughly 25 to 55 words) because your voice is synthesized out loud and your animated deer jaw moves as you speak.`;

const state = {
  useBridgeCamera: true,
  selectedCamIndex: 0,
  bridgeActive: false,
  cocoModel: null,
  detections: [],
  motionPercent: 0,
  dominantColor: 'balanced indoor lighting',
  lastAutoGreetAt: 0,
  isThinking: false,
  isSpeaking: false,
  isListening: false,
  currentAudio: null,
  history: [],
  win11Hardware: null,
  settings: {
    cameraId: localStorage.getItem('tweed_cameraId') || '0',
    micId: localStorage.getItem('tweed_micId') || '',
    speakerId: localStorage.getItem('tweed_speakerId') || '',
    voiceURI: localStorage.getItem('tweed_voiceURI') || 'Microsoft David Desktop',
    resolution: localStorage.getItem('tweed_resolution') || '640x480',
    mirror: localStorage.getItem('tweed_mirror') !== 'false',
    motionThreshold: Number(localStorage.getItem('tweed_motionThreshold') || 18),
    pitch: Number(localStorage.getItem('tweed_pitch') || 0.85),
    rate: Number(localStorage.getItem('tweed_rate') || 1.0),
    volume: Number(localStorage.getItem('tweed_volume') || 100),
    provider: localStorage.getItem('tweed_provider') || 'gemini',
    geminiModel: localStorage.getItem('tweed_geminiModel') || 'gemini-2.5-flash',
    geminiApiKey: localStorage.getItem('tweed_geminiApiKey') || '',
    autoGreetCooldown: Number(localStorage.getItem('tweed_autoGreetCooldown') || 25),
    persona: localStorage.getItem('tweed_persona') || DEFAULT_PERSONA
  }
};

// Offscreen canvases for motion & snapshot capture
const motionCanvas = document.createElement('canvas');
motionCanvas.width = 80;
motionCanvas.height = 60;
const motionCtx = motionCanvas.getContext('2d', { willReadFrequently: true });
let prevMotionFrame = null;

const snapCanvas = document.createElement('canvas');
const snapCtx = snapCanvas.getContext('2d');

const els = {};
let toastTimer = null;
let jawAnimTimer = null;

document.addEventListener('DOMContentLoaded', async () => {
  bindElements();
  initTabs();
  loadSettingsIntoUI();
  appendChatMessage(
    'deer',
    "Well hooves and antlers! I'm Buckley, mounted right here on the wall at 121 Tweed Blvd, Nyack, NY 10960. I just scanned your Windows 11 hardware on startup—your EMEET PIXY webcam and microphone are ready!"
  );

  // Immediately scan Windows 11 hardware & Gemini status on startup
  await Promise.all([
    refreshWindows11HardwareList(false),
    checkBackendGeminiStatus()
  ]);
  startPixyBridgeLoop();
  loadCocoSsdModel();
  startVisionDetectionLoop();
});

function showToast(msg, durationMs = 3400) {
  if (!els.toastBanner) return;
  els.toastBanner.textContent = msg;
  els.toastBanner.classList.remove('hidden');
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    els.toastBanner.classList.add('hidden');
  }, durationMs);
}

function bindElements() {
  const ids = [
    'geminiStatusBadge', 'camStatusBadge', 'hwScanBadge',
    'quickKeyBanner', 'quickGeminiKeyInput', 'quickSaveKeyBtn',
    'toastBanner',
    'deerStateBadge', 'deerStage', 'deerJaw', 'deerLeftEar', 'deerRightEar', 'pupilLeft', 'pupilRight',
    'deerVoiceBar', 'deerSpeechText', 'lastProviderLabel',
    'activeCameraLabel', 'autoGreetToggle', 'hudOverlayToggle',
    'webcamVideo', 'pixyBridgeImg', 'hudCanvas', 'hudFpsTag', 'hudTargetTag', 'hudMotionTag',
    'quickCameraSelect', 'quickMicSelect', 'quickSpeakerSelect',
    'liveTelemetryText',
    'lookAndSpeakBtn', 'micListenBtn', 'stopSpeechBtn',
    'chatLog', 'chatForm', 'chatInput', 'sendChatBtn',
    'refreshDevicesBtn', 'cameraSelect', 'resolutionSelect', 'mirrorVideoToggle',
    'motionSensitivityRange', 'motionSensVal', 'hwCameraPreviewImg', 'hwPreviewBadge',
    'micSelect', 'micLevelBar', 'micStatusText', 'continuousListenToggle', 'testMicBtn',
    'speakerSelect', 'voiceSelect', 'voicePitchRange', 'pitchVal',
    'voiceRateRange', 'rateVal', 'speakerVolumeRange', 'volVal', 'testSpeakerBtn',
    'win11OsBanner', 'win11DeviceList',
    'aiProviderSelect', 'geminiApiKeyInput', 'saveGeminiKeyBtn', 'geminiKeyVerifyStatus',
    'geminiModelSelect', 'autoGreetCooldownRange', 'cooldownVal',
    'personaTextarea', 'savePersonaBtn', 'resetPersonaBtn'
  ];
  ids.forEach(id => {
    els[id] = document.getElementById(id);
  });

  // Top & Settings Gemini Key Save
  els.quickSaveKeyBtn.addEventListener('click', () => saveGeminiApiKey(els.quickGeminiKeyInput.value));
  els.saveGeminiKeyBtn.addEventListener('click', () => saveGeminiApiKey(els.geminiApiKeyInput.value));

  // Main Live Action Buttons
  els.lookAndSpeakBtn.addEventListener('click', () => {
    showToast('📸 Capturing live EMEET PIXY webcam frame for Buckley...');
    triggerDeerVisionResponse('Look closely at the live EMEET PIXY webcam image right now and speak directly to whoever or whatever you see in front of your wall mount at 121 Tweed Blvd, Nyack, NY 10960!');
  });

  els.micListenBtn.addEventListener('click', () => {
    listenViaMicrophone(false);
  });

  els.stopSpeechBtn.addEventListener('click', () => {
    stopDeerSpeech();
    showToast('🤫 Hushed Buckley.');
  });

  els.chatForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const text = els.chatInput.value.trim();
    if (!text) {
      showToast('💬 Type a message first, or click "🎙️ Talk to Deerhead (Use Mic)"!');
      return;
    }
    els.chatInput.value = '';
    handleVisitorMessage(text);
  });

  // Synced Camera Selectors (Main Tab + Hardware Tab)
  function onCameraChange(newVal, sourceSelect) {
    state.settings.cameraId = newVal;
    state.selectedCamIndex = Number(sourceSelect.selectedIndex) || 0;
    localStorage.setItem('tweed_cameraId', newVal);
    els.cameraSelect.value = newVal;
    els.quickCameraSelect.value = newVal;
    const camName = sourceSelect.options[sourceSelect.selectedIndex]?.textContent || 'EMEET PIXY';
    els.activeCameraLabel.textContent = `Active Feed: ${camName}`;
    els.hwPreviewBadge.textContent = `Live Preview: ${camName}`;
    showToast(`📷 Switched Video Input to ${camName}`);
  }
  els.cameraSelect.addEventListener('change', () => onCameraChange(els.cameraSelect.value, els.cameraSelect));
  els.quickCameraSelect.addEventListener('change', () => onCameraChange(els.quickCameraSelect.value, els.quickCameraSelect));

  // Synced Microphone Selectors (Main Tab + Hardware Tab)
  function onMicChange(newVal, sourceSelect) {
    state.settings.micId = newVal;
    localStorage.setItem('tweed_micId', newVal);
    els.micSelect.value = newVal;
    els.quickMicSelect.value = newVal;
    const micName = sourceSelect.options[sourceSelect.selectedIndex]?.textContent || 'Microphone';
    els.micStatusText.textContent = `✅ Active Audio Input: ${micName}`;
    showToast(`🎙️ Selected ${micName}`);
  }
  els.micSelect.addEventListener('change', () => onMicChange(els.micSelect.value, els.micSelect));
  els.quickMicSelect.addEventListener('change', () => onMicChange(els.quickMicSelect.value, els.quickMicSelect));

  // Synced Speaker Selectors (Main Tab + Hardware Tab)
  function onSpeakerChange(newVal, sourceSelect) {
    state.settings.speakerId = newVal;
    localStorage.setItem('tweed_speakerId', newVal);
    els.speakerSelect.value = newVal;
    els.quickSpeakerSelect.value = newVal;
    const spkName = sourceSelect.options[sourceSelect.selectedIndex]?.textContent || 'Speaker';
    showToast(`🔊 Selected Audio Output: ${spkName}`);
  }
  els.speakerSelect.addEventListener('change', () => onSpeakerChange(els.speakerSelect.value, els.speakerSelect));
  els.quickSpeakerSelect.addEventListener('change', () => onSpeakerChange(els.quickSpeakerSelect.value, els.quickSpeakerSelect));

  // Hardware Settings Tab Buttons & Controls
  els.refreshDevicesBtn.addEventListener('click', async () => {
    els.refreshDevicesBtn.textContent = '⏳ Rescanning Windows 11...';
    await refreshWindows11HardwareList(true);
    els.refreshDevicesBtn.textContent = '🔄 Rescan Windows 11 Devices';
  });

  els.resolutionSelect.addEventListener('change', () => {
    state.settings.resolution = els.resolutionSelect.value;
    localStorage.setItem('tweed_resolution', state.settings.resolution);
    showToast(`📐 Video Resolution set to ${state.settings.resolution}`);
  });

  els.mirrorVideoToggle.addEventListener('change', () => {
    state.settings.mirror = els.mirrorVideoToggle.value === 'true';
    localStorage.setItem('tweed_mirror', String(state.settings.mirror));
    els.pixyBridgeImg.classList.toggle('unmirrored', !state.settings.mirror);
    els.hwCameraPreviewImg.classList.toggle('unmirrored', !state.settings.mirror);
    showToast(`🪞 Video Orientation: ${state.settings.mirror ? 'Mirrored' : 'Normal'}`);
  });

  els.motionSensitivityRange.addEventListener('input', () => {
    state.settings.motionThreshold = Number(els.motionSensitivityRange.value);
    localStorage.setItem('tweed_motionThreshold', String(state.settings.motionThreshold));
    els.motionSensVal.textContent = `${state.settings.motionThreshold}%`;
  });

  els.testMicBtn.addEventListener('click', () => {
    listenViaMicrophone(true);
  });

  els.voiceSelect.addEventListener('change', () => {
    state.settings.voiceURI = els.voiceSelect.value;
    localStorage.setItem('tweed_voiceURI', state.settings.voiceURI);
    showToast(`🗣️ Selected Voice: ${state.settings.voiceURI}`);
  });

  els.voicePitchRange.addEventListener('input', () => {
    state.settings.pitch = Number(els.voicePitchRange.value);
    localStorage.setItem('tweed_pitch', String(state.settings.pitch));
    els.pitchVal.textContent = state.settings.pitch.toFixed(2);
  });

  els.voiceRateRange.addEventListener('input', () => {
    state.settings.rate = Number(els.voiceRateRange.value);
    localStorage.setItem('tweed_rate', String(state.settings.rate));
    els.rateVal.textContent = state.settings.rate.toFixed(2);
  });

  els.speakerVolumeRange.addEventListener('input', () => {
    state.settings.volume = Number(els.speakerVolumeRange.value);
    localStorage.setItem('tweed_volume', String(state.settings.volume));
    els.volVal.textContent = `${state.settings.volume}%`;
  });

  els.testSpeakerBtn.addEventListener('click', async () => {
    els.testSpeakerBtn.textContent = '🔊 Speaking Test Phrase...';
    showToast('🔊 Playing Buckley test voice on Windows 11 Speaker...');
    await speakAsDeerhead(
      "Testing speakers from the oak plaque at 121 Tweed Boulevard, Nyack, New York 10960! My EMEET PIXY webcam eyes are locked in and my antlers are ready!"
    );
    els.testSpeakerBtn.textContent = '🔊 Test Speaker & Deerhead Voice';
  });

  // Gemini & Persona Settings Events
  els.aiProviderSelect.addEventListener('change', () => {
    state.settings.provider = els.aiProviderSelect.value;
    localStorage.setItem('tweed_provider', state.settings.provider);
    showToast(`🧠 AI Backend set to ${state.settings.provider === 'gemini' ? 'Google Gemini' : 'Local Ollama'}`);
  });

  els.geminiModelSelect.addEventListener('change', () => {
    state.settings.geminiModel = els.geminiModelSelect.value;
    localStorage.setItem('tweed_geminiModel', state.settings.geminiModel);
    showToast(`🧠 Gemini Model set to ${state.settings.geminiModel}`);
  });

  els.autoGreetCooldownRange.addEventListener('input', () => {
    state.settings.autoGreetCooldown = Number(els.autoGreetCooldownRange.value);
    localStorage.setItem('tweed_autoGreetCooldown', String(state.settings.autoGreetCooldown));
    els.cooldownVal.textContent = `${state.settings.autoGreetCooldown} seconds`;
  });

  els.savePersonaBtn.addEventListener('click', () => {
    state.settings.persona = els.personaTextarea.value.trim() || DEFAULT_PERSONA;
    localStorage.setItem('tweed_persona', state.settings.persona);
    els.savePersonaBtn.textContent = '✅ Saved!';
    showToast('💾 Saved 121 Tweed Blvd Deerhead Persona!');
    setTimeout(() => { els.savePersonaBtn.textContent = '💾 Save Persona Settings'; }, 1800);
  });

  els.resetPersonaBtn.addEventListener('click', () => {
    state.settings.persona = DEFAULT_PERSONA;
    els.personaTextarea.value = DEFAULT_PERSONA;
    localStorage.setItem('tweed_persona', DEFAULT_PERSONA);
    showToast('↩️ Reset Persona to default 121 Tweed Blvd, Nyack, NY 10960 lore.');
  });
}

// ============================================================================
// TOP TAB NAVIGATION
// ============================================================================
function initTabs() {
  const buttons = document.querySelectorAll('.tab-btn');
  const panels = document.querySelectorAll('.tab-panel');

  buttons.forEach(btn => {
    btn.addEventListener('click', () => {
      const targetId = btn.getAttribute('data-tab');
      buttons.forEach(b => {
        b.classList.toggle('active', b === btn);
        b.setAttribute('aria-selected', String(b === btn));
      });
      panels.forEach(p => {
        p.classList.toggle('active', p.id === targetId);
      });
    });
  });
}

function loadSettingsIntoUI() {
  els.resolutionSelect.value = state.settings.resolution;
  els.mirrorVideoToggle.value = String(state.settings.mirror);
  els.pixyBridgeImg.classList.toggle('unmirrored', !state.settings.mirror);
  els.hwCameraPreviewImg.classList.toggle('unmirrored', !state.settings.mirror);
  els.motionSensitivityRange.value = state.settings.motionThreshold;
  els.motionSensVal.textContent = `${state.settings.motionThreshold}%`;
  els.voicePitchRange.value = state.settings.pitch;
  els.pitchVal.textContent = state.settings.pitch.toFixed(2);
  els.voiceRateRange.value = state.settings.rate;
  els.rateVal.textContent = state.settings.rate.toFixed(2);
  els.speakerVolumeRange.value = state.settings.volume;
  els.volVal.textContent = `${state.settings.volume}%`;
  els.aiProviderSelect.value = state.settings.provider;
  els.geminiModelSelect.value = state.settings.geminiModel;
  els.autoGreetCooldownRange.value = state.settings.autoGreetCooldown;
  els.cooldownVal.textContent = `${state.settings.autoGreetCooldown} seconds`;
  els.personaTextarea.value = state.settings.persona;
  if (state.settings.geminiApiKey) {
    els.geminiApiKeyInput.value = state.settings.geminiApiKey;
  }
}

// ============================================================================
// GOOGLE GEMINI API KEY VERIFICATION
// ============================================================================
async function checkBackendGeminiStatus() {
  try {
    const query = state.settings.geminiApiKey
      ? `?key=${encodeURIComponent(state.settings.geminiApiKey)}`
      : '';
    const res = await fetch(`/api/gemini/status${query}`);
    const data = await res.json();
    updateGeminiUiState(data);
  } catch (err) {
    console.warn('Gemini status check failed:', err);
  }
}

async function saveGeminiApiKey(rawKey) {
  const key = (rawKey || '').trim();
  if (!key) {
    showToast('⚠️ Please paste your Google Gemini API key (starts with AIza...) in the box first!');
    els.geminiKeyVerifyStatus.textContent = '⚠️ Please paste a valid Google Gemini API key.';
    return;
  }
  state.settings.geminiApiKey = key;
  localStorage.setItem('tweed_geminiApiKey', key);
  els.geminiApiKeyInput.value = key;
  els.quickGeminiKeyInput.value = key;
  els.geminiKeyVerifyStatus.textContent = '⏳ Verifying key with Google Gemini...';
  showToast('⏳ Verifying Google Gemini API Key...');

  try {
    const res = await fetch('/api/gemini/key', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ apiKey: key })
    });
    const data = await res.json();
    updateGeminiUiState(data);
    if (data.valid) {
      showToast(`✅ Connected to Google Gemini Vision (${data.maskedKey})!`);
    } else {
      showToast(`⚠️ Gemini Key check: ${data.error || 'Invalid key'}`);
    }
  } catch (err) {
    els.geminiKeyVerifyStatus.textContent = `❌ Error saving key: ${err.message}`;
  }
}

function updateGeminiUiState(data) {
  if (data.valid) {
    els.geminiStatusBadge.textContent = `✅ Gemini Ready (${data.maskedKey})`;
    els.geminiStatusBadge.className = 'status-pill status-ok';
    els.quickKeyBanner.classList.add('hidden');
    els.geminiKeyVerifyStatus.textContent = `✅ Verified with Google Gemini (${data.maskedKey})! Saved to local .env.`;

    if (Array.isArray(data.models) && data.models.length > 0) {
      const current = state.settings.geminiModel;
      els.geminiModelSelect.innerHTML = '';
      data.models.forEach(m => {
        const opt = document.createElement('option');
        opt.value = m.id;
        opt.textContent = `${m.id} (${m.displayName})`;
        els.geminiModelSelect.appendChild(opt);
      });
      if ([...els.geminiModelSelect.options].some(o => o.value === current)) {
        els.geminiModelSelect.value = current;
      } else {
        state.settings.geminiModel = els.geminiModelSelect.value;
      }
    }
  } else if (data.configured) {
    els.geminiStatusBadge.textContent = '⚠️ Gemini Key Invalid';
    els.geminiStatusBadge.className = 'status-pill status-warn';
    els.quickKeyBanner.classList.remove('hidden');
    els.geminiKeyVerifyStatus.textContent = `⚠️ ${data.error || 'Key validation failed'}`;
  } else {
    els.geminiStatusBadge.textContent = '🔑 Paste Gemini Key';
    els.geminiStatusBadge.className = 'status-pill status-warn';
    els.quickKeyBanner.classList.remove('hidden');
  }
}

// ============================================================================
// WINDOWS 11 HARDWARE SCAN ON STARTUP (CAMERAS, MICROPHONES, SPEAKERS, VOICES)
// ============================================================================
function populateSelectPair(selectA, selectB, items, formatLabel, getValue, savedValue) {
  selectA.innerHTML = '';
  selectB.innerHTML = '';
  items.forEach((item, idx) => {
    const val = getValue(item, idx);
    const label = formatLabel(item, idx);

    const opt1 = document.createElement('option');
    opt1.value = val;
    opt1.textContent = label;
    selectA.appendChild(opt1);

    const opt2 = document.createElement('option');
    opt2.value = val;
    opt2.textContent = label;
    selectB.appendChild(opt2);
  });

  if (savedValue && [...selectA.options].some(o => o.value === savedValue)) {
    selectA.value = savedValue;
    selectB.value = savedValue;
  }
}

async function refreshWindows11HardwareList(forceRefresh = false) {
  try {
    const res = await fetch(`/api/hardware/win11${forceRefresh ? '?refresh=1' : ''}`);
    const data = await res.json();
    state.win11Hardware = data;

    const osName = data?.os?.Caption || 'Windows 11';
    const pcName = data?.os?.CSName || 'TWEEDDEER';
    els.win11OsBanner.textContent = `💻 ${osName} • Host: ${pcName}`;

    // 1. Populate Video Cameras (Both Main Tab + Hardware Settings Tab)
    const cams = Array.isArray(data.cameras) && data.cameras.length > 0
      ? data.cameras
      : [{ FriendlyName: 'EMEET PIXY', InstanceId: '0' }];

    populateSelectPair(
      els.cameraSelect,
      els.quickCameraSelect,
      cams,
      (c) => /pixy/i.test(c.FriendlyName) ? `🎯 ${c.FriendlyName} (Connected Pixy Webcam)` : `📷 ${c.FriendlyName}`,
      (_c, idx) => String(idx),
      state.settings.cameraId
    );

    // 2. Populate Microphones (Both Main Tab + Hardware Settings Tab)
    const mics = Array.isArray(data.microphones) && data.microphones.length > 0
      ? data.microphones
      : [{ FriendlyName: 'Microphone (EMEET PIXY)', InstanceId: 'mic-pixy' }];

    populateSelectPair(
      els.micSelect,
      els.quickMicSelect,
      mics,
      (m) => /pixy/i.test(m.FriendlyName) ? `🎙️ ${m.FriendlyName} (Pixy Mic)` : `🎙️ ${m.FriendlyName}`,
      (m, idx) => m.InstanceId || `mic-${idx}`,
      state.settings.micId
    );

    // 3. Populate Speakers / Audio Output (Both Main Tab + Hardware Settings Tab)
    const speakers = Array.isArray(data.speakers) && data.speakers.length > 0
      ? data.speakers
      : [{ FriendlyName: 'Headphones (C-Media(R) Audio)', InstanceId: 'spk-cmedia' }];

    populateSelectPair(
      els.speakerSelect,
      els.quickSpeakerSelect,
      speakers,
      (s) => `🔊 ${s.FriendlyName}`,
      (s, idx) => s.InstanceId || `spk-${idx}`,
      state.settings.speakerId
    );

    // 4. Populate Windows 11 Installed Speech Voices
    const voices = Array.isArray(data.voices) && data.voices.length > 0
      ? data.voices
      : ['Microsoft David Desktop', 'Microsoft Zira Desktop'];

    els.voiceSelect.innerHTML = '';
    voices.forEach(vName => {
      const opt = document.createElement('option');
      opt.value = vName;
      opt.textContent = `🗣️ ${vName} (Windows 11 SAPI Voice)`;
      els.voiceSelect.appendChild(opt);
    });
    if ([...els.voiceSelect.options].some(o => o.value === state.settings.voiceURI)) {
      els.voiceSelect.value = state.settings.voiceURI;
    }

    // 5. Populate PnP Device Manager List
    const devices = Array.isArray(data.devices) ? data.devices : [];
    els.win11DeviceList.innerHTML = '';

    devices.forEach(dev => {
      if (!dev || !dev.FriendlyName) return;
      const isPixy = /pixy/i.test(dev.FriendlyName);
      const row = document.createElement('div');
      row.className = `win11-dev-item ${isPixy ? 'pixy-highlight' : ''}`;
      row.innerHTML = `
        <span><strong>[${dev.Class || 'Device'}]</strong> ${escapeHtml(dev.FriendlyName)}</span>
        <span class="status-pill ${dev.Status === 'OK' ? 'status-ok' : 'status-neutral'}">${escapeHtml(dev.Status || 'Connected')}</span>
      `;
      els.win11DeviceList.appendChild(row);
    });

    if (els.hwScanBadge) {
      els.hwScanBadge.textContent = `✅ Scanned: ${cams.length} Cams, ${mics.length} Mics, ${speakers.length} Speakers`;
    }

    if (forceRefresh) {
      showToast(`✅ Rescanned Windows 11: ${cams.length} Camera(s), ${mics.length} Mic(s), ${speakers.length} Speaker(s)!`);
    }
  } catch (err) {
    els.win11OsBanner.textContent = `Windows 11 Hardware Scan: ${err.message}`;
  }
}

// ============================================================================
// LIVE EMEET PIXY DIRECTSHOW CAMERA STREAM LOOP
// ============================================================================
function startPixyBridgeLoop() {
  let inFlight = false;

  setInterval(() => {
    if (inFlight) return;
    inFlight = true;
    const url = `/api/camera/frame?cam=${state.selectedCamIndex}&t=${Date.now()}`;

    const tempImg = new Image();
    tempImg.crossOrigin = 'anonymous';
    tempImg.onload = () => {
      els.pixyBridgeImg.src = tempImg.src;
      els.hwCameraPreviewImg.src = tempImg.src;
      if (!state.bridgeActive) {
        state.bridgeActive = true;
        els.camStatusBadge.textContent = '📹 EMEET PIXY: LIVE';
        els.camStatusBadge.className = 'status-pill status-ok';
      }
      inFlight = false;
    };
    tempImg.onerror = () => {
      inFlight = false;
    };
    tempImg.src = url;
  }, 110);
}

// ============================================================================
// REAL-TIME PIXY VISION & COCO-SSD OBJECT/PERSON DETECTION
// ============================================================================
async function loadCocoSsdModel() {
  try {
    let attempts = 0;
    while (!window.cocoSsd && attempts < 20) {
      await new Promise(r => setTimeout(r, 300));
      attempts++;
    }
    if (window.cocoSsd) {
      els.hudFpsTag.textContent = 'EMEET PIXY AI VISION: LOADING...';
      state.cocoModel = await window.cocoSsd.load();
      els.hudFpsTag.textContent = 'EMEET PIXY AI VISION: ONLINE';
    }
  } catch (err) {
    console.warn('COCO-SSD fallback to Pixy motion/color tracker:', err);
    els.hudFpsTag.textContent = 'EMEET PIXY MOTION TRACKER: ONLINE';
  }
}

function startVisionDetectionLoop() {
  let lastDetectionRun = 0;

  async function loop(now) {
    const img = els.pixyBridgeImg;
    const canvas = els.hudCanvas;
    const ctx = canvas.getContext('2d');

    if (img && img.complete && img.naturalWidth > 0) {
      if (canvas.width !== img.naturalWidth || canvas.height !== img.naturalHeight) {
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
      }

      if (now - lastDetectionRun > 320) {
        lastDetectionRun = now;
        computeMotionAndColor(img);
        if (state.cocoModel) {
          try {
            state.detections = await state.cocoModel.detect(img);
          } catch {
            state.detections = [];
          }
        }
        evaluateSceneAndAutoGreet(img.naturalWidth, img.naturalHeight);
      }

      drawVisionHud(ctx, canvas.width, canvas.height);
    }

    requestAnimationFrame(loop);
  }

  requestAnimationFrame(loop);
}

function computeMotionAndColor(sourceEl) {
  motionCtx.drawImage(sourceEl, 0, 0, motionCanvas.width, motionCanvas.height);
  const frame = motionCtx.getImageData(0, 0, motionCanvas.width, motionCanvas.height);
  const data = frame.data;

  let diffPixels = 0;
  let rSum = 0, gSum = 0, bSum = 0;
  const totalPixels = motionCanvas.width * motionCanvas.height;

  for (let i = 0; i < data.length; i += 4) {
    rSum += data[i];
    gSum += data[i + 1];
    bSum += data[i + 2];

    if (prevMotionFrame) {
      const diff =
        Math.abs(data[i] - prevMotionFrame[i]) +
        Math.abs(data[i + 1] - prevMotionFrame[i + 1]) +
        Math.abs(data[i + 2] - prevMotionFrame[i + 2]);
      if (diff > 75) diffPixels++;
    }
  }

  prevMotionFrame = new Uint8ClampedArray(data);
  state.motionPercent = Math.min(100, Math.round((diffPixels / totalPixels) * 300));

  const rAvg = Math.round(rSum / totalPixels);
  const gAvg = Math.round(gSum / totalPixels);
  const bAvg = Math.round(bSum / totalPixels);
  state.dominantColor = describeRgb(rAvg, gAvg, bAvg);

  els.hudMotionTag.textContent = `Motion: ${state.motionPercent}%`;
}

function describeRgb(r, g, b) {
  const brightness = (r + g + b) / 3;
  if (brightness < 45) return 'dim evening lighting';
  if (brightness > 205) return 'bright daylight';
  if (r > g + 25 && r > b + 25) return 'warm amber/woodland tones';
  if (g > r + 20 && g > b + 20) return 'forest green tones';
  if (b > r + 20 && b > g + 15) return 'cool blue tones';
  return 'balanced indoor room lighting';
}

function drawVisionHud(ctx, width, height) {
  ctx.clearRect(0, 0, width, height);
  if (!els.hudOverlayToggle.checked) return;

  ctx.strokeStyle = 'rgba(56, 239, 125, 0.28)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(width / 2 - 20, height / 2);
  ctx.lineTo(width / 2 + 20, height / 2);
  ctx.moveTo(width / 2, height / 2 - 20);
  ctx.lineTo(width / 2, height / 2 + 20);
  ctx.stroke();

  state.detections.forEach(det => {
    let [x, y, w, h] = det.bbox;
    if (state.settings.mirror) {
      x = width - x - w;
    }

    const isPerson = det.class === 'person';
    ctx.strokeStyle = isPerson ? '#38ef7d' : '#ffb65c';
    ctx.lineWidth = isPerson ? 3 : 2;
    ctx.strokeRect(x, y, w, h);

    const label = `${det.class.toUpperCase()} ${Math.round(det.score * 100)}%`;
    ctx.font = 'bold 14px Consolas, monospace';
    const textWidth = ctx.measureText(label).width;
    ctx.fillStyle = isPerson ? 'rgba(20, 80, 42, 0.85)' : 'rgba(90, 52, 10, 0.85)';
    ctx.fillRect(x, Math.max(0, y - 24), textWidth + 14, 22);
    ctx.fillStyle = '#ffffff';
    ctx.fillText(label, x + 7, Math.max(15, y - 8));
  });
}

function evaluateSceneAndAutoGreet(frameW, frameH) {
  const people = state.detections.filter(d => d.class === 'person' && d.score > 0.42);
  const objects = state.detections.filter(d => d.class !== 'person' && d.score > 0.42);

  els.hudTargetTag.textContent = `👀 Targets: ${state.detections.length} (${people.length} Person)`;

  if (people.length > 0 && frameW > 0) {
    const primary = people[0];
    const centerX = (primary.bbox[0] + primary.bbox[2] / 2) / frameW;
    const centerY = (primary.bbox[1] + primary.bbox[3] / 2) / frameH;
    const lookX = (state.settings.mirror ? (0.5 - centerX) : (centerX - 0.5)) * 10;
    const lookY = (centerY - 0.5) * 6;
    moveDeerEyes(lookX, lookY);
  } else {
    moveDeerEyes(0, 0);
  }

  const summaryParts = [];
  if (people.length > 0) {
    summaryParts.push(`${people.length} person(s) spotted in front of 121 Tweed Blvd wall plaque`);
  }
  if (objects.length > 0) {
    const objList = [...new Set(objects.map(o => o.class))].join(', ');
    summaryParts.push(`objects in view: ${objList}`);
  }
  summaryParts.push(`motion: ${state.motionPercent}%`);
  summaryParts.push(`lighting: ${state.dominantColor}`);

  els.liveTelemetryText.textContent = summaryParts.join(' | ');

  const nowSec = Date.now() / 1000;
  const personPresent = people.length > 0;

  if (
    personPresent &&
    els.autoGreetToggle.checked &&
    !state.isThinking &&
    !state.isSpeaking &&
    nowSec - state.lastAutoGreetAt >= state.settings.autoGreetCooldown
  ) {
    state.lastAutoGreetAt = nowSec;
    triggerDeerVisionResponse(
      `[AUTO-TRIGGER: Your EMEET PIXY webcam just spotted someone in front of your wall plaque at 121 Tweed Blvd, Nyack, NY 10960!] Greet them or comment directly on what they look like or what they are doing right now!`
    );
  }
}

function moveDeerEyes(dx, dy) {
  const clampX = Math.max(-5, Math.min(5, dx));
  const clampY = Math.max(-4, Math.min(4, dy));
  els.pupilLeft.setAttribute('cx', String(174 + clampX));
  els.pupilLeft.setAttribute('cy', String(202 + clampY));
  els.pupilRight.setAttribute('cx', String(246 + clampX));
  els.pupilRight.setAttribute('cy', String(202 + clampY));
}

function captureWebcamFrame() {
  const img = els.pixyBridgeImg;
  if (!img || !img.complete || !img.naturalWidth) return null;
  snapCanvas.width = img.naturalWidth;
  snapCanvas.height = img.naturalHeight;
  snapCtx.drawImage(img, 0, 0);
  return snapCanvas.toDataURL('image/jpeg', 0.8);
}

// ============================================================================
// CONVERSATION & GOOGLE GEMINI MULTIMODAL CALLS
// ============================================================================
async function handleVisitorMessage(text) {
  appendChatMessage('visitor', text);
  await triggerDeerVisionResponse(text);
}

async function triggerDeerVisionResponse(promptText) {
  if (state.isThinking) return;
  state.isThinking = true;
  els.deerStateBadge.textContent = '🧠 Inspecting Pixy Frame...';
  const origBtnText = els.lookAndSpeakBtn.textContent;
  els.lookAndSpeakBtn.textContent = '⏳ Buckley is Thinking...';

  const imageBase64 = captureWebcamFrame();
  const visionSummary = els.liveTelemetryText.textContent;

  try {
    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        provider: state.settings.provider,
        model: state.settings.geminiModel,
        apiKey: state.settings.geminiApiKey,
        customPersona: state.settings.persona,
        userMessage: promptText,
        imageBase64,
        visionSummary,
        history: state.history
      })
    });

    const data = await res.json();
    if (!res.ok || data.error) {
      throw new Error(data.error || `HTTP ${res.status}`);
    }

    const reply = data.reply;
    state.history.push({ role: 'user', content: promptText });
    state.history.push({ role: 'assistant', content: reply });
    if (state.history.length > 12) state.history = state.history.slice(-12);

    els.lastProviderLabel.textContent = data.provider || 'Google Gemini';
    els.deerSpeechText.textContent = `"${reply}"`;
    appendChatMessage('deer', reply);
    await speakAsDeerhead(reply);
  } catch (err) {
    els.deerStateBadge.textContent = '⚠️ Error';
    const msg = `Hold your antlers! ${err.message}`;
    els.deerSpeechText.textContent = msg;
    appendChatMessage('deer', msg);
  } finally {
    state.isThinking = false;
    els.lookAndSpeakBtn.textContent = origBtnText;
  }
}

function appendChatMessage(sender, text) {
  const div = document.createElement('div');
  div.className = `chat-msg ${sender}`;
  const header = sender === 'deer'
    ? '🦌 Buckley (Mounted @ 121 Tweed Blvd, Nyack, NY)'
    : '🧑 Visitor in Room';
  div.innerHTML = `<div class="msg-header">${header}</div><div>${escapeHtml(text)}</div>`;
  els.chatLog.appendChild(div);
  els.chatLog.scrollTop = els.chatLog.scrollHeight;
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// ============================================================================
// WINDOWS 11 NATIVE + HTML5 AUDIO SPEECH SYNTHESIS & ANIMATED DEER JAW
// ============================================================================
async function speakAsDeerhead(text) {
  stopDeerSpeech();
  state.isSpeaking = true;
  els.deerStage.classList.add('speaking');
  els.deerStateBadge.textContent = '🗣️ Talking to Room!';
  startJawAnimation();

  try {
    const res = await fetch('/api/tts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text,
        voiceName: state.settings.voiceURI,
        rate: state.settings.rate,
        volume: state.settings.volume
      })
    });
    const data = await res.json();
    if (data.ok && data.audioDataUrl) {
      const audio = new Audio(data.audioDataUrl);
      audio.volume = Math.max(0, Math.min(1, state.settings.volume / 100));
      audio.playbackRate = state.settings.rate;
      state.currentAudio = audio;
      await new Promise((resolve) => {
        audio.onended = resolve;
        audio.onerror = resolve;
        audio.play().catch(resolve);
      });
    }
  } catch (err) {
    console.warn('TTS play error:', err);
  } finally {
    stopJawAnimation();
  }
}

function stopDeerSpeech() {
  if (state.currentAudio) {
    try {
      state.currentAudio.pause();
      state.currentAudio.currentTime = 0;
    } catch {}
    state.currentAudio = null;
  }
  if ('speechSynthesis' in window) {
    window.speechSynthesis.cancel();
  }
  stopJawAnimation();
}

function startJawAnimation() {
  if (jawAnimTimer) clearInterval(jawAnimTimer);
  jawAnimTimer = setInterval(() => {
    const openPx = 4 + Math.random() * 14;
    pulseDeerJaw(openPx);
  }, 105);
}

function pulseDeerJaw(openPx) {
  els.deerJaw.style.transform = `translateY(${openPx.toFixed(1)}px)`;
  const earWiggle = (Math.random() - 0.5) * 6;
  els.deerLeftEar.style.transform = `rotate(${earWiggle.toFixed(1)}deg)`;
  els.deerRightEar.style.transform = `rotate(${(-earWiggle).toFixed(1)}deg)`;
  els.deerVoiceBar.style.width = `${Math.min(100, Math.round((openPx / 18) * 100))}%`;
}

function stopJawAnimation() {
  if (jawAnimTimer) {
    clearInterval(jawAnimTimer);
    jawAnimTimer = null;
  }
  state.isSpeaking = false;
  els.deerStage.classList.remove('speaking');
  els.deerJaw.style.transform = 'translateY(0px)';
  els.deerLeftEar.style.transform = 'rotate(0deg)';
  els.deerRightEar.style.transform = 'rotate(0deg)';
  els.deerVoiceBar.style.width = '0%';
  els.deerStateBadge.textContent = '👀 Watching Room';
}

// ============================================================================
// WINDOWS 11 MICROPHONE LISTENING
// ============================================================================
async function listenViaMicrophone() {
  if (state.isListening) return;
  stopDeerSpeech();
  state.isListening = true;

  const selectedMicLabel = els.micSelect.options[els.micSelect.selectedIndex]?.textContent || 'Microphone (EMEET PIXY)';

  els.micListenBtn.classList.add('listening');
  els.micListenBtn.textContent = '🛑 Listening Now (Speak!)...';
  els.testMicBtn.classList.add('listening');
  els.testMicBtn.textContent = '🛑 Listening Now (Speak!)...';
  els.deerStateBadge.textContent = '👂 Ears Perk Up (Listening)';
  els.micStatusText.textContent = `🎙️ Listening on ${selectedMicLabel}... Speak now!`;
  showToast(`🎙️ Listening on ${selectedMicLabel} — Speak to Buckley now!`);

  const vuTimer = setInterval(() => {
    const lvl = 25 + Math.round(Math.random() * 65);
    els.micLevelBar.style.width = `${lvl}%`;
  }, 140);

  try {
    const res = await fetch('/api/mic/listen', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ timeoutSec: 5 })
    });
    const data = await res.json();
    clearInterval(vuTimer);

    const peakLevel = Math.min(100, Math.max(15, Number(data.audioLevel || 40)));
    els.micLevelBar.style.width = `${peakLevel}%`;

    if (data.transcript && data.transcript.trim()) {
      const heard = data.transcript.trim();
      els.micStatusText.textContent = `✅ Heard on ${selectedMicLabel}: "${heard}" (Peak Level: ${peakLevel}%)`;
      showToast(`🎙️ Heard you say: "${heard}"`);
      await handleVisitorMessage(heard);
    } else {
      els.micStatusText.textContent = `✅ ${selectedMicLabel} active (Peak Level: ${peakLevel}%). Click again and speak clearly right away!`;
      showToast(`🎙️ Mic active (Peak Level: ${peakLevel}%). Speak right after clicking!`);
    }
  } catch (err) {
    clearInterval(vuTimer);
    els.micStatusText.textContent = `⚠️ Mic check error: ${err.message}`;
  } finally {
    state.isListening = false;
    els.micListenBtn.classList.remove('listening');
    els.micListenBtn.textContent = '🎙️ Talk to Deerhead (Use Mic)';
    els.testMicBtn.classList.remove('listening');
    els.testMicBtn.textContent = '🎙️ Test Microphone & Speak to Buckley';
    if (!state.isSpeaking) {
      els.deerStateBadge.textContent = '👀 Watching Room';
    }
    if (els.continuousListenToggle && els.continuousListenToggle.checked && !state.isSpeaking) {
      setTimeout(() => listenViaMicrophone(), 600);
    }
  }
}
