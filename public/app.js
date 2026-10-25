// ============================================================================
// TWEED DEERHEAD & MOOSE — 121 Tweed Blvd, Nyack, NY 10960
// Frontend App: Dual Viewport (Video + 3D Talking Moose), Real-time Hardware VU Meter,
// Continuous Conversation Toggle, Fast Reflex AI & Binary ON/OFF Solenoid Jaw
// ============================================================================

const DEFAULT_PERSONA = `You are "Buckley", a witty, observant taxidermy trophy Moose/Stag mounted on an oak plaque at 121 Tweed Blvd, Nyack, NY 10960 (overlooking the Hudson River and Clausland Mountain).
You see visitors through your EMEET PIXY Webcam eyes.
React directly to what the visitor says and what you see in the webcam frame.
IMPORTANT: Keep every reply VERY SHORT and punchy (1 to 2 sentences, max 28 words) so you can speak it immediately without delay!`;

const VOICE_PRESETS = {
  'deep-buck': { name: 'Microsoft David Desktop', pitch: 0.70, rate: 0.95, label: 'Deep Mountain Buck' },
  'witty-trail': { name: 'Microsoft David Desktop', pitch: 0.88, rate: 1.05, label: 'Witty Tweed Trail King' },
  'ancient-oak': { name: 'Microsoft David Desktop', pitch: 0.62, rate: 0.90, label: 'Ancient Oak Trophy' },
  'nyack-radio': { name: 'Microsoft David Desktop', pitch: 0.95, rate: 1.00, label: 'Nyack Radio Host' },
  'fast-scout': { name: 'Microsoft David Desktop', pitch: 1.05, rate: 1.20, label: 'Fast Hudson Valley Scout' },
  'rustic-lady': { name: 'Microsoft Zira Desktop', pitch: 0.90, rate: 1.00, label: 'Rustic Lady Doe' }
};

const state = {
  selectedCamIndex: 1, // Physical EMEET PIXY
  bridgeActive: false,
  cocoModel: null,
  detections: [],
  motionPercent: 0,
  dominantColor: 'balanced indoor lighting',
  lastAutoGreetAt: 0,
  isThinking: false,
  isSpeaking: false,
  isListening: false,
  continuousConversationActive: false,
  currentAudio: null,
  history: [],
  win11Hardware: null,
  settings: {
    cameraId: localStorage.getItem('tweed_cameraId') || '1',
    micId: localStorage.getItem('tweed_micId') || 'mic-pixy',
    speakerId: localStorage.getItem('tweed_speakerId') || '',
    voicePreset: localStorage.getItem('tweed_voicePreset') || 'witty-trail',
    voiceURI: localStorage.getItem('tweed_voiceURI') || 'Microsoft David Desktop',
    resolution: localStorage.getItem('tweed_resolution') || '640x480',
    mirror: localStorage.getItem('tweed_mirror') !== 'false',
    motionThreshold: Number(localStorage.getItem('tweed_motionThreshold') || 18),
    pitch: Number(localStorage.getItem('tweed_pitch') || 0.88),
    rate: Number(localStorage.getItem('tweed_rate') || 1.05),
    volume: Number(localStorage.getItem('tweed_volume') || 100),
    provider: localStorage.getItem('tweed_provider') || 'gemini',
    geminiModel: localStorage.getItem('tweed_geminiModel') || 'gemini-2.5-flash',
    geminiApiKey: localStorage.getItem('tweed_geminiApiKey') || '',
    autoGreetCooldown: Number(localStorage.getItem('tweed_autoGreetCooldown') || 25),
    persona: localStorage.getItem('tweed_persona') || DEFAULT_PERSONA
  }
};

const motionCanvas = document.createElement('canvas');
motionCanvas.width = 80;
motionCanvas.height = 60;
const motionCtx = motionCanvas.getContext('2d', { willReadFrequently: true });
let prevMotionFrame = null;

const snapCanvas = document.createElement('canvas');
const snapCtx = snapCanvas.getContext('2d');

const els = {};
let toastTimer = null;
let jawClapperTimer = null;

document.addEventListener('DOMContentLoaded', async () => {
  bindElements();
  initTabs();
  loadSettingsIntoUI();

  // 1. Initialize 3D Talking Moose Animation in smaller window next to video
  const container3d = document.getElementById('deer3dContainer');
  if (container3d && window.Deerhead3D) {
    window.Deerhead3D.init(container3d);
  }

  appendChatMessage(
    'deer',
    "Well hooves and antlers! I'm Buckley, mounted on the wall at 121 Tweed Blvd, Nyack, NY 10960. My EMEET PIXY webcam and physical mic are live! Click 'Talk to Deerhead' to begin!"
  );

  // 2. Scan hardware on startup
  await Promise.all([
    refreshWindows11HardwareList(false),
    checkBackendGeminiStatus()
  ]);

  // 3. Start Live Video & AI vision loop
  startPixyBridgeLoop();
  loadCocoSsdModel();
  startVisionDetectionLoop();

  // 4. Start REAL-TIME hardware VU meter polling directly from EMEET PIXY mic!
  startRealtimeHardwareVuPolling();
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
    'deerStateBadge', 'deerSpeechText', 'lastProviderLabel',
    'activeCameraLabel', 'triggerEmeetTrackingBtn', 'autoGreetToggle', 'hudOverlayToggle',
    'webcamVideo', 'pixyBridgeImg', 'hudCanvas', 'hudFpsTag', 'hudTargetTag', 'hudMotionTag',
    'reset3dViewBtn',
    'quickCameraSelect', 'quickMicSelect', 'quickVoicePresetSelect',
    'vuStatusDot', 'vuLevelLabel', 'micStateBadge', 'vuLedLadder',
    'mainTestMicBtn', 'actionBarTestMicBtn',
    'liveTelemetryText',
    'conversationToggleBtn', 'lookAndSpeakBtn', 'stopSpeechBtn',
    'chatLog', 'chatForm', 'chatInput', 'sendChatBtn',
    'refreshDevicesBtn', 'cameraSelect', 'resolutionSelect', 'mirrorVideoToggle',
    'motionSensitivityRange', 'motionSensVal', 'hwCameraPreviewImg', 'hwPreviewBadge',
    'micSelect', 'micLevelBar', 'micStatusText', 'testMicBtn',
    'speakerSelect', 'voiceSelect', 'hwSystemVoicesGroup',
    'voicePitchRange', 'pitchVal', 'voiceRateRange', 'rateVal',
    'speakerVolumeRange', 'volVal', 'testSpeakerBtn',
    'win11OsBanner', 'win11DeviceList',
    'aiProviderSelect', 'geminiApiKeyInput', 'saveGeminiKeyBtn', 'geminiKeyVerifyStatus',
    'geminiModelSelect', 'autoGreetCooldownRange', 'cooldownVal',
    'personaTextarea', 'savePersonaBtn', 'resetPersonaBtn'
  ];
  ids.forEach(id => {
    els[id] = document.getElementById(id);
  });

  // Top API Key Save
  els.quickSaveKeyBtn?.addEventListener('click', () => saveGeminiApiKey(els.quickGeminiKeyInput.value));
  els.saveGeminiKeyBtn?.addEventListener('click', () => saveGeminiApiKey(els.geminiApiKeyInput.value));

  // Reset 3D View
  els.reset3dViewBtn?.addEventListener('click', () => {
    if (window.Deerhead3D) window.Deerhead3D.resetView();
    showToast('🔄 3D Moose View Angle Reset.');
  });

  // EMEET Hardware Tracking Trigger
  els.triggerEmeetTrackingBtn?.addEventListener('click', () => {
    fetch('/api/camera/frame?cam=1').catch(() => {});
    showToast('🎯 EMEET PIXY tracking active! Hold up your open palm ✋ to the camera for 2s to toggle physical motorized tracking.');
  });

  // CONTINUOUS CONVERSATION TOGGLE BUTTON
  els.conversationToggleBtn?.addEventListener('click', toggleContinuousConversation);

  // TEST MIC BUTTONS (Header of VU Meter + Action Bar)
  els.mainTestMicBtn?.addEventListener('click', () => testMicrophoneLevel());
  els.actionBarTestMicBtn?.addEventListener('click', () => testMicrophoneLevel());

  // Look & Speak Now
  els.lookAndSpeakBtn?.addEventListener('click', () => {
    showToast('📸 Capturing live EMEET PIXY webcam frame for Buckley...');
    triggerDeerVisionResponse('Look closely at the live EMEET PIXY webcam image right now and speak directly to whoever or whatever you see in front of your wall mount at 121 Tweed Blvd, Nyack, NY 10960!');
  });

  els.stopSpeechBtn?.addEventListener('click', () => {
    if (state.continuousConversationActive) {
      toggleContinuousConversation();
    }
    stopDeerSpeech();
    showToast('🤫 Hushed Buckley.');
  });

  // Text message send
  els.chatForm?.addEventListener('submit', (e) => {
    e.preventDefault();
    const text = els.chatInput.value.trim();
    if (!text) {
      showToast('💬 Type a message first, or toggle Talk to Deerhead!');
      return;
    }
    els.chatInput.value = '';
    handleVisitorMessage(text);
  });

  // Synced Camera Selectors
  function onCameraChange(newVal, sourceSelect) {
    state.settings.cameraId = newVal;
    state.selectedCamIndex = Number(newVal) || 1;
    localStorage.setItem('tweed_cameraId', newVal);
    if (els.cameraSelect) els.cameraSelect.value = newVal;
    if (els.quickCameraSelect) els.quickCameraSelect.value = newVal;
    const camName = sourceSelect.options[sourceSelect.selectedIndex]?.textContent || 'EMEET PIXY';
    els.activeCameraLabel.textContent = `Active Feed: ${camName}`;
    els.hwPreviewBadge.textContent = `Live Preview: ${camName}`;
    showToast(`📷 Switched Video to ${camName}`);
  }
  els.cameraSelect?.addEventListener('change', () => onCameraChange(els.cameraSelect.value, els.cameraSelect));
  els.quickCameraSelect?.addEventListener('change', () => onCameraChange(els.quickCameraSelect.value, els.quickCameraSelect));

  // Synced Microphone Selectors
  function onMicChange(newVal, sourceSelect) {
    state.settings.micId = newVal;
    localStorage.setItem('tweed_micId', newVal);
    if (els.micSelect) els.micSelect.value = newVal;
    if (els.quickMicSelect) els.quickMicSelect.value = newVal;
    const micName = sourceSelect.options[sourceSelect.selectedIndex]?.textContent || 'Microphone';
    els.micStatusText.textContent = `✅ Active Audio Input: ${micName}`;
    showToast(`🎙️ Selected ${micName}`);
  }
  els.micSelect?.addEventListener('change', () => onMicChange(els.micSelect.value, els.micSelect));
  els.quickMicSelect?.addEventListener('change', () => onMicChange(els.quickMicSelect.value, els.quickMicSelect));

  // Quick Voice Preset Selector
  els.quickVoicePresetSelect?.addEventListener('change', () => {
    applyVoicePreset(els.quickVoicePresetSelect.value);
  });

  // Voice Select in Hardware tab
  els.voiceSelect?.addEventListener('change', () => {
    const val = els.voiceSelect.value;
    if (val.startsWith('preset-')) {
      applyVoicePreset(val.replace('preset-', ''));
    } else {
      state.settings.voiceURI = val;
      localStorage.setItem('tweed_voiceURI', val);
      showToast(`🗣️ Selected Voice: ${val}`);
    }
  });

  // Hardware Tab Rescan
  els.refreshDevicesBtn?.addEventListener('click', async () => {
    els.refreshDevicesBtn.textContent = '⏳ Rescanning Windows 11...';
    await refreshWindows11HardwareList(true);
    els.refreshDevicesBtn.textContent = '🔄 Rescan Windows 11 Devices';
  });

  els.resolutionSelect?.addEventListener('change', () => {
    state.settings.resolution = els.resolutionSelect.value;
    localStorage.setItem('tweed_resolution', state.settings.resolution);
    showToast(`📐 Video Resolution set to ${state.settings.resolution}`);
  });

  els.mirrorVideoToggle?.addEventListener('change', () => {
    state.settings.mirror = els.mirrorVideoToggle.value === 'true';
    localStorage.setItem('tweed_mirror', String(state.settings.mirror));
    els.pixyBridgeImg.classList.toggle('unmirrored', !state.settings.mirror);
    els.hwCameraPreviewImg.classList.toggle('unmirrored', !state.settings.mirror);
    showToast(`🪞 Video Orientation: ${state.settings.mirror ? 'Mirrored' : 'Normal'}`);
  });

  els.motionSensitivityRange?.addEventListener('input', () => {
    state.settings.motionThreshold = Number(els.motionSensitivityRange.value);
    localStorage.setItem('tweed_motionThreshold', String(state.settings.motionThreshold));
    els.motionSensVal.textContent = `${state.settings.motionThreshold}%`;
  });

  els.testMicBtn?.addEventListener('click', () => {
    testMicrophoneLevel();
  });

  els.voicePitchRange?.addEventListener('input', () => {
    state.settings.pitch = Number(els.voicePitchRange.value);
    localStorage.setItem('tweed_pitch', String(state.settings.pitch));
    els.pitchVal.textContent = state.settings.pitch.toFixed(2);
  });

  els.voiceRateRange?.addEventListener('input', () => {
    state.settings.rate = Number(els.voiceRateRange.value);
    localStorage.setItem('tweed_rate', String(state.settings.rate));
    els.rateVal.textContent = state.settings.rate.toFixed(2);
  });

  els.speakerVolumeRange?.addEventListener('input', () => {
    state.settings.volume = Number(els.speakerVolumeRange.value);
    localStorage.setItem('tweed_volume', String(state.settings.volume));
    els.volVal.textContent = `${state.settings.volume}%`;
  });

  els.testSpeakerBtn?.addEventListener('click', async () => {
    els.testSpeakerBtn.textContent = '🔊 Speaking Test Phrase...';
    showToast('🔊 Playing Buckley test voice & clacking solenoid jaw...');
    await speakAsDeerhead(
      "Testing the binary solenoid jaw and audio from 121 Tweed Boulevard, Nyack, NY 10960! Solenoid clicks open and shut with zero lag!"
    );
    els.testSpeakerBtn.textContent = '🔊 Test Selected Voice & 3D Jaw';
  });

  // Gemini & Persona
  els.aiProviderSelect?.addEventListener('change', () => {
    state.settings.provider = els.aiProviderSelect.value;
    localStorage.setItem('tweed_provider', state.settings.provider);
  });

  els.geminiModelSelect?.addEventListener('change', () => {
    state.settings.geminiModel = els.geminiModelSelect.value;
    localStorage.setItem('tweed_geminiModel', state.settings.geminiModel);
  });

  els.savePersonaBtn?.addEventListener('click', () => {
    state.settings.persona = els.personaTextarea.value.trim() || DEFAULT_PERSONA;
    localStorage.setItem('tweed_persona', state.settings.persona);
    els.savePersonaBtn.textContent = '✅ Saved!';
    showToast('💾 Saved 121 Tweed Blvd Persona Lore!');
    setTimeout(() => { els.savePersonaBtn.textContent = '💾 Save Persona Settings'; }, 1800);
  });

  els.resetPersonaBtn?.addEventListener('click', () => {
    state.settings.persona = DEFAULT_PERSONA;
    els.personaTextarea.value = DEFAULT_PERSONA;
    localStorage.setItem('tweed_persona', DEFAULT_PERSONA);
    showToast('↩️ Reset Persona to default 121 Tweed Blvd lore.');
  });
}

function applyVoicePreset(presetKey) {
  const p = VOICE_PRESETS[presetKey];
  if (!p) return;
  state.settings.voicePreset = presetKey;
  state.settings.voiceURI = p.name;
  state.settings.pitch = p.pitch;
  state.settings.rate = p.rate;

  localStorage.setItem('tweed_voicePreset', presetKey);
  localStorage.setItem('tweed_voiceURI', p.name);
  localStorage.setItem('tweed_pitch', String(p.pitch));
  localStorage.setItem('tweed_rate', String(p.rate));

  if (els.quickVoicePresetSelect) els.quickVoicePresetSelect.value = presetKey;
  if (els.voicePitchRange) els.voicePitchRange.value = p.pitch;
  if (els.pitchVal) els.pitchVal.textContent = p.pitch.toFixed(2);
  if (els.voiceRateRange) els.voiceRateRange.value = p.rate;
  if (els.rateVal) els.rateVal.textContent = p.rate.toFixed(2);

  showToast(`🗣️ Voice preset: ${p.label}`);
}

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
  if (els.resolutionSelect) els.resolutionSelect.value = state.settings.resolution;
  if (els.mirrorVideoToggle) els.mirrorVideoToggle.value = String(state.settings.mirror);
  if (els.pixyBridgeImg) els.pixyBridgeImg.classList.toggle('unmirrored', !state.settings.mirror);
  if (els.hwCameraPreviewImg) els.hwCameraPreviewImg.classList.toggle('unmirrored', !state.settings.mirror);
  if (els.motionSensitivityRange) els.motionSensitivityRange.value = state.settings.motionThreshold;
  if (els.motionSensVal) els.motionSensVal.textContent = `${state.settings.motionThreshold}%`;
  if (els.voicePitchRange) els.voicePitchRange.value = state.settings.pitch;
  if (els.pitchVal) els.pitchVal.textContent = state.settings.pitch.toFixed(2);
  if (els.voiceRateRange) els.voiceRateRange.value = state.settings.rate;
  if (els.rateVal) els.rateVal.textContent = state.settings.rate.toFixed(2);
  if (els.speakerVolumeRange) els.speakerVolumeRange.value = state.settings.volume;
  if (els.volVal) els.volVal.textContent = `${state.settings.volume}%`;
  if (els.aiProviderSelect) els.aiProviderSelect.value = state.settings.provider;
  if (els.geminiModelSelect) els.geminiModelSelect.value = state.settings.geminiModel;
  if (els.quickVoicePresetSelect) els.quickVoicePresetSelect.value = state.settings.voicePreset;
  if (els.autoGreetCooldownRange) els.autoGreetCooldownRange.value = state.settings.autoGreetCooldown;
  if (els.cooldownVal) els.cooldownVal.textContent = `${state.settings.autoGreetCooldown} seconds`;
  if (els.personaTextarea) els.personaTextarea.value = state.settings.persona;
  if (state.settings.geminiApiKey && els.geminiApiKeyInput) {
    els.geminiApiKeyInput.value = state.settings.geminiApiKey;
  }
}

// ============================================================================
// REAL-TIME HARDWARE VU METER POLLING FROM PYTHON SOUNDDEVICE DAEMON
// Directly streams actual physical sound from Microphone (EMEET PIXY)!
// ============================================================================
function updateVuMeterDisplay(percent) {
  const p = Math.max(0, Math.min(100, Math.round(percent)));
  const dB = p > 0 ? (20 * Math.log10(p / 100)).toFixed(1) : '-∞';

  if (els.vuLevelLabel) {
    els.vuLevelLabel.textContent = `${p}% (${dB} dB)`;
  }
  if (els.vuStatusDot) {
    els.vuStatusDot.classList.toggle('active', p > 6);
  }
  if (els.micLevelBar) {
    els.micLevelBar.style.width = `${p}%`;
  }

  // Light up 16-segment colored ladder proportionally
  const litCount = Math.round((p / 100) * 16);
  const segments = els.vuLedLadder?.querySelectorAll('.vu-seg') || [];
  segments.forEach((seg, idx) => {
    seg.classList.toggle('lit', idx < litCount);
  });
}

function startRealtimeHardwareVuPolling() {
  setInterval(async () => {
    try {
      const res = await fetch('/api/mic/level');
      if (res.ok) {
        const data = await res.json();
        const rawLevel = Number(data.level || 0);
        updateVuMeterDisplay(rawLevel);

        if (els.micStateBadge) {
          if (state.isListening) {
            els.micStateBadge.textContent = 'Listening (Speak Now)';
            els.micStateBadge.className = 'vu-badge listening';
          } else if (rawLevel > 8) {
            els.micStateBadge.textContent = 'Audio Detected';
            els.micStateBadge.className = 'vu-badge listening';
          } else {
            els.micStateBadge.textContent = 'Standby (Mic Ready)';
            els.micStateBadge.className = 'vu-badge';
          }
        }
      }
    } catch {}
  }, 75);
}

// ============================================================================
// CONTINUOUS CONVERSATION TOGGLE LOOP
// "Talk to deerhead button should always stay on once pressed unless I press
// it again and then it should toggle off and stop listening. Once I stop
// talking it should respond immediately."
// ============================================================================
function toggleContinuousConversation() {
  state.continuousConversationActive = !state.continuousConversationActive;

  if (state.continuousConversationActive) {
    els.conversationToggleBtn.classList.add('active');
    els.conversationToggleBtn.textContent = '🛑 Stop Conversation (Listening Active)';
    showToast('🎙️ Continuous Loop Active! Speak into your EMEET PIXY mic—Buckley responds immediately when you finish speaking!');
    runConversationLoopCycle();
  } else {
    els.conversationToggleBtn.classList.remove('active');
    els.conversationToggleBtn.textContent = '🎙️ Talk to Deerhead (Start Continuous Loop)';
    stopDeerSpeech();
    showToast('🛑 Conversation Stopped.');
    if (els.deerStateBadge) els.deerStateBadge.textContent = '👀 Watching Room';
  }
}

async function runConversationLoopCycle() {
  if (!state.continuousConversationActive) return;

  state.isListening = true;
  if (els.deerStateBadge) els.deerStateBadge.textContent = '👂 Ears Perked (Listening...)';

  try {
    const res = await fetch('/api/mic/listen', { method: 'POST' });
    const data = await res.json();

    if (!state.continuousConversationActive) return;

    if (data.transcript && data.transcript.trim()) {
      const heard = data.transcript.trim();
      showToast(`🎙️ You: "${heard}"`);
      await handleVisitorMessageFast(heard);
    } else {
      // Loop back immediately if toggle is still ON
      if (state.continuousConversationActive) {
        setTimeout(runConversationLoopCycle, 200);
      }
    }
  } catch (err) {
    console.warn('Mic loop error:', err);
    if (state.continuousConversationActive) {
      setTimeout(runConversationLoopCycle, 600);
    }
  } finally {
    state.isListening = false;
  }
}

async function testMicrophoneLevel() {
  const btns = [els.mainTestMicBtn, els.actionBarTestMicBtn, els.testMicBtn].filter(Boolean);
  btns.forEach(b => {
    b.textContent = '🛑 Speak into EMEET PIXY Mic...';
    b.classList.add('active');
  });
  showToast('🎙️ Speak now! Testing microphone input...');

  try {
    const res = await fetch('/api/mic/listen', { method: 'POST' });
    const data = await res.json();

    if (data.transcript && data.transcript.trim()) {
      const heard = data.transcript.trim();
      if (els.micStatusText) els.micStatusText.textContent = `✅ Heard on EMEET PIXY Mic: "${heard}"`;
      showToast(`🎙️ EMEET PIXY Mic Heard: "${heard}"`);
      appendChatMessage('visitor', `[Mic Test]: ${heard}`);
    } else {
      if (els.micStatusText) els.micStatusText.textContent = `✅ EMEET PIXY Microphone active! Sound detected.`;
      showToast(`✅ EMEET PIXY Mic is working! Check VU meter as you speak.`);
    }
  } catch (err) {
    if (els.micStatusText) els.micStatusText.textContent = `⚠️ Mic error: ${err.message}`;
  } finally {
    if (els.mainTestMicBtn) {
      els.mainTestMicBtn.textContent = '🎙️ Test Mic';
      els.mainTestMicBtn.classList.remove('active');
    }
    if (els.actionBarTestMicBtn) {
      els.actionBarTestMicBtn.textContent = '🎙️ Test Mic';
      els.actionBarTestMicBtn.classList.remove('active');
    }
    if (els.testMicBtn) {
      els.testMicBtn.textContent = '🎙️ Test Microphone Input Level';
      els.testMicBtn.classList.remove('active');
    }
  }
}

// ============================================================================
// ULTRA-FAST VISITOR MESSAGE & VISION HANDLER
// ============================================================================
async function handleVisitorMessage(text) {
  appendChatMessage('visitor', text);
  await triggerDeerVisionResponse(text);
}

async function handleVisitorMessageFast(text) {
  appendChatMessage('visitor', text);
  await triggerDeerVisionResponse(text);

  // If continuous toggle is ON, immediately resume listening after speaking!
  if (state.continuousConversationActive) {
    setTimeout(runConversationLoopCycle, 300);
  }
}

async function triggerDeerVisionResponse(promptText) {
  if (state.isThinking) return;
  state.isThinking = true;
  if (els.deerStateBadge) els.deerStateBadge.textContent = '🧠 Buckley Thinking...';

  const imageBase64 = captureWebcamFrame();
  const visionSummary = els.liveTelemetryText?.textContent || '';

  try {
    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        provider: state.settings.provider,
        model: state.settings.geminiModel,
        apiKey: state.settings.geminiApiKey,
        voiceName: state.settings.voiceURI,
        rate: state.settings.rate,
        volume: state.settings.volume,
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
    if (state.history.length > 8) state.history = state.history.slice(-8);

    if (els.lastProviderLabel) els.lastProviderLabel.textContent = data.provider || 'Google Gemini';
    if (els.deerSpeechText) els.deerSpeechText.textContent = `"${reply}"`;
    appendChatMessage('deer', reply);

    // Play pre-synthesized audio with binary solenoid jaw clack!
    if (data.audioDataUrl) {
      await playAudioWav(data.audioDataUrl);
    } else {
      await speakAsDeerhead(reply);
    }
  } catch (err) {
    if (els.deerStateBadge) els.deerStateBadge.textContent = '⚠️ Ready';
    const msg = `Hold your antlers! ${err.message}`;
    if (els.deerSpeechText) els.deerSpeechText.textContent = msg;
    appendChatMessage('deer', msg);
  } finally {
    state.isThinking = false;
    if (!state.continuousConversationActive && !state.isSpeaking && els.deerStateBadge) {
      els.deerStateBadge.textContent = '👀 Tracking Room';
    }
  }
}

function appendChatMessage(sender, text) {
  if (!els.chatLog) return;
  const div = document.createElement('div');
  div.className = `chat-msg ${sender}`;
  const header = sender === 'deer'
    ? '🦌 Buckley (Mounted @ 121 Tweed Blvd, Nyack, NY 10960)'
    : '🧑 You';
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
// SPEECH SYNTHESIS & BINARY ON/OFF SOLENOID JAW CLAPPER
// "Also, the jaw is not a servo. It's on or off"
// Snaps fully OPEN [ON] and fully SHUT [OFF] like an electrical solenoid!
// ============================================================================
async function playAudioWav(audioDataUrl) {
  stopDeerSpeech();
  state.isSpeaking = true;
  if (els.deerStateBadge) els.deerStateBadge.textContent = '🗣️ Buckley Talking!';
  startBinarySolenoidJawClapper();

  const audio = new Audio(audioDataUrl);
  audio.volume = Math.max(0, Math.min(1, state.settings.volume / 100));
  audio.playbackRate = state.settings.rate;
  state.currentAudio = audio;

  await new Promise((resolve) => {
    audio.onended = resolve;
    audio.onerror = resolve;
    audio.play().catch(resolve);
  });

  stopBinarySolenoidJawClapper();
}

async function speakAsDeerhead(text) {
  stopDeerSpeech();
  state.isSpeaking = true;
  if (els.deerStateBadge) els.deerStateBadge.textContent = '🗣️ Buckley Talking!';
  startBinarySolenoidJawClapper();

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
      await playAudioWav(data.audioDataUrl);
    }
  } catch (err) {
    console.warn('TTS error:', err);
    stopBinarySolenoidJawClapper();
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
  stopBinarySolenoidJawClapper();
}

// Rapid binary solenoid clapper (snap OPEN on syllables, snap SHUT on pauses)
function startBinarySolenoidJawClapper() {
  if (jawClapperTimer) clearInterval(jawClapperTimer);
  let isOpen = false;
  jawClapperTimer = setInterval(() => {
    isOpen = !isOpen; // Binary flip between ON and OFF
    if (window.Deerhead3D) {
      window.Deerhead3D.setJawSolenoidState(isOpen);
    }
  }, 105);
}

function stopBinarySolenoidJawClapper() {
  if (jawClapperTimer) {
    clearInterval(jawClapperTimer);
    jawClapperTimer = null;
  }
  state.isSpeaking = false;
  if (window.Deerhead3D) {
    window.Deerhead3D.setJawSolenoidState(false); // Snap firmly SHUT [OFF]
  }
  if (!state.continuousConversationActive && els.deerStateBadge) {
    els.deerStateBadge.textContent = '👀 Tracking Room';
  }
}

// ============================================================================
// LIVE EMEET PIXY CAMERA STREAM LOOP
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
      if (els.pixyBridgeImg) els.pixyBridgeImg.src = tempImg.src;
      if (els.hwCameraPreviewImg) els.hwCameraPreviewImg.src = tempImg.src;
      if (!state.bridgeActive) {
        state.bridgeActive = true;
        if (els.camStatusBadge) {
          els.camStatusBadge.textContent = '📹 EMEET PIXY: LIVE';
          els.camStatusBadge.className = 'status-pill status-ok';
        }
      }
      inFlight = false;
    };
    tempImg.onerror = () => {
      inFlight = false;
    };
    tempImg.src = url;
  }, 100);
}

// ============================================================================
// REAL-TIME PIXY VISION & COCO-SSD OBJECT/PERSON TRACKING
// ============================================================================
async function loadCocoSsdModel() {
  try {
    let attempts = 0;
    while (!window.cocoSsd && attempts < 20) {
      await new Promise(r => setTimeout(r, 250));
      attempts++;
    }
    if (window.cocoSsd) {
      if (els.hudFpsTag) els.hudFpsTag.textContent = 'PIXY AI: LOADING...';
      state.cocoModel = await window.cocoSsd.load();
      if (els.hudFpsTag) els.hudFpsTag.textContent = 'PIXY AI: ONLINE';
    }
  } catch (err) {
    console.warn('COCO-SSD fallback to motion tracker:', err);
    if (els.hudFpsTag) els.hudFpsTag.textContent = 'MOTION TRACKER: ONLINE';
  }
}

function startVisionDetectionLoop() {
  let lastDetectionRun = 0;

  async function loop(now) {
    const img = els.pixyBridgeImg;
    const canvas = els.hudCanvas;
    const ctx = canvas?.getContext('2d');

    if (img && img.complete && img.naturalWidth > 0 && canvas && ctx) {
      if (canvas.width !== img.naturalWidth || canvas.height !== img.naturalHeight) {
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
      }

      if (now - lastDetectionRun > 300) {
        lastDetectionRun = now;
        computeMotionAndColor(img);
        if (state.cocoModel) {
          try {
            state.detections = await state.cocoModel.detect(img);
          } catch {
            state.detections = [];
          }
        }
        evaluateSceneAndTrack(img.naturalWidth, img.naturalHeight);
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

  if (els.hudMotionTag) els.hudMotionTag.textContent = `Motion: ${state.motionPercent}%`;
}

function describeRgb(r, g, b) {
  const brightness = (r + g + b) / 3;
  if (brightness < 45) return 'dim evening lighting';
  if (brightness > 205) return 'bright daylight';
  if (r > g + 25 && r > b + 25) return 'warm woodland tones';
  if (g > r + 20 && g > b + 20) return 'forest green tones';
  if (b > r + 20 && b > g + 15) return 'cool blue tones';
  return 'balanced indoor room lighting';
}

function drawVisionHud(ctx, width, height) {
  ctx.clearRect(0, 0, width, height);
  if (!els.hudOverlayToggle?.checked) return;

  ctx.strokeStyle = 'rgba(56, 239, 125, 0.3)';
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
    ctx.font = 'bold 13px Consolas, monospace';
    const textWidth = ctx.measureText(label).width;
    ctx.fillStyle = isPerson ? 'rgba(20, 80, 42, 0.85)' : 'rgba(90, 52, 10, 0.85)';
    ctx.fillRect(x, Math.max(0, y - 22), textWidth + 12, 20);
    ctx.fillStyle = '#ffffff';
    ctx.fillText(label, x + 6, Math.max(14, y - 7));
  });
}

function evaluateSceneAndTrack(frameW, frameH) {
  const people = state.detections.filter(d => d.class === 'person' && d.score > 0.42);
  const objects = state.detections.filter(d => d.class !== 'person' && d.score > 0.42);

  if (els.hudTargetTag) {
    els.hudTargetTag.textContent = `👀 Targets: ${state.detections.length} (${people.length} Person)`;
  }

  // 3D MOOSE MODEL EYE & HEAD TRACKING
  if (people.length > 0 && frameW > 0) {
    const primary = people[0];
    const centerX = (primary.bbox[0] + primary.bbox[2] / 2) / frameW;
    const centerY = (primary.bbox[1] + primary.bbox[3] / 2) / frameH;
    const normX = (state.settings.mirror ? (0.5 - centerX) : (centerX - 0.5)) * 2;
    const normY = (centerY - 0.5) * 2;
    if (window.Deerhead3D) {
      window.Deerhead3D.setTargetTracking(normX, normY);
    }
  } else {
    if (window.Deerhead3D) {
      window.Deerhead3D.setTargetTracking(0, 0);
    }
  }

  const summaryParts = [];
  if (people.length > 0) {
    summaryParts.push(`${people.length} person(s) spotted in front of 121 Tweed Blvd plaque`);
  }
  if (objects.length > 0) {
    const objList = [...new Set(objects.map(o => o.class))].join(', ');
    summaryParts.push(`objects: ${objList}`);
  }
  summaryParts.push(`motion: ${state.motionPercent}%`);
  summaryParts.push(`lighting: ${state.dominantColor}`);

  if (els.liveTelemetryText) {
    els.liveTelemetryText.textContent = summaryParts.join(' | ');
  }

  const nowSec = Date.now() / 1000;
  if (
    people.length > 0 &&
    els.autoGreetToggle?.checked &&
    !state.isThinking &&
    !state.isSpeaking &&
    !state.continuousConversationActive &&
    nowSec - state.lastAutoGreetAt >= state.settings.autoGreetCooldown
  ) {
    state.lastAutoGreetAt = nowSec;
    triggerDeerVisionResponse(
      `[AUTO-TRIGGER: Your EMEET PIXY webcam just spotted someone in front of your wall plaque at 121 Tweed Blvd, Nyack, NY 10960!] Greet them or comment directly on what they look like right now!`
    );
  }
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
// HARDWARE ENUMERATION & VOICE CHOICES
// ============================================================================
function populateSelectPair(selectA, selectB, items, formatLabel, getValue, savedValue) {
  if (selectA) selectA.innerHTML = '';
  if (selectB) selectB.innerHTML = '';
  items.forEach((item, idx) => {
    const val = getValue(item, idx);
    const label = formatLabel(item, idx);

    if (selectA) {
      const opt1 = document.createElement('option');
      opt1.value = val;
      opt1.textContent = label;
      selectA.appendChild(opt1);
    }
    if (selectB) {
      const opt2 = document.createElement('option');
      opt2.value = val;
      opt2.textContent = label;
      selectB.appendChild(opt2);
    }
  });

  if (savedValue && selectA && [...selectA.options].some(o => o.value === savedValue)) {
    selectA.value = savedValue;
  }
  if (savedValue && selectB && [...selectB.options].some(o => o.value === savedValue)) {
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
    if (els.win11OsBanner) els.win11OsBanner.textContent = `💻 ${osName} • Host: ${pcName}`;

    // 1. Cameras
    const cams = Array.isArray(data.cameras) && data.cameras.length > 0
      ? data.cameras
      : [{ FriendlyName: 'EMEET PIXY', InstanceId: '1' }];

    populateSelectPair(
      els.cameraSelect,
      els.quickCameraSelect,
      cams,
      (c) => /pixy/i.test(c.FriendlyName) ? `🎯 ${c.FriendlyName} (Connected Pixy Webcam)` : `📷 ${c.FriendlyName}`,
      (_c, idx) => String(idx === 0 ? 1 : 0),
      state.settings.cameraId
    );

    // 2. Microphones
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

    // 3. Speakers
    const speakers = Array.isArray(data.speakers) && data.speakers.length > 0
      ? data.speakers
      : [{ FriendlyName: 'Headphones (C-Media(R) Audio)', InstanceId: 'spk-cmedia' }];

    if (els.speakerSelect) {
      els.speakerSelect.innerHTML = '';
      speakers.forEach((s, idx) => {
        const opt = document.createElement('option');
        opt.value = s.InstanceId || `spk-${idx}`;
        opt.textContent = `🔊 ${s.FriendlyName}`;
        els.speakerSelect.appendChild(opt);
      });
      if (state.settings.speakerId && [...els.speakerSelect.options].some(o => o.value === state.settings.speakerId)) {
        els.speakerSelect.value = state.settings.speakerId;
      }
    }

    // 4. Populate System Voices in Hardware tab
    if (els.hwSystemVoicesGroup) {
      els.hwSystemVoicesGroup.innerHTML = '';
      const sysVoices = Array.isArray(data.voices) && data.voices.length > 0
        ? data.voices
        : ['Microsoft Mark', 'Microsoft David Desktop', 'Microsoft Zira Desktop'];

      sysVoices.forEach(vName => {
        const opt = document.createElement('option');
        opt.value = vName;
        opt.textContent = `${vName} (Windows 11 Voice)`;
        els.hwSystemVoicesGroup.appendChild(opt);
      });
    }

    // 5. PnP Device List
    if (els.win11DeviceList) {
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
    }

    if (els.hwScanBadge) {
      els.hwScanBadge.textContent = `✅ Win 11 Scanned (${cams.length} Cams, ${mics.length} Mics)`;
    }

    if (forceRefresh) {
      showToast(`✅ Rescanned Windows 11: ${cams.length} Camera(s), ${mics.length} Mic(s), ${speakers.length} Speaker(s)!`);
    }
  } catch (err) {
    if (els.win11OsBanner) els.win11OsBanner.textContent = `Windows 11 Hardware Scan: ${err.message}`;
  }
}

// ============================================================================
// GEMINI API KEY VERIFICATION
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
    showToast('⚠️ Please paste your Google Gemini API key first!');
    return;
  }
  state.settings.geminiApiKey = key;
  localStorage.setItem('tweed_geminiApiKey', key);
  if (els.geminiApiKeyInput) els.geminiApiKeyInput.value = key;
  if (els.quickGeminiKeyInput) els.quickGeminiKeyInput.value = key;
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
      showToast(`⚠️ Gemini check: ${data.error || 'Invalid key'}`);
    }
  } catch (err) {
    if (els.geminiKeyVerifyStatus) els.geminiKeyVerifyStatus.textContent = `❌ Error: ${err.message}`;
  }
}

function updateGeminiUiState(data) {
  if (data.valid) {
    if (els.geminiStatusBadge) {
      els.geminiStatusBadge.textContent = `✅ Gemini Ready (${data.maskedKey})`;
      els.geminiStatusBadge.className = 'status-pill status-ok';
    }
    els.quickKeyBanner?.classList.add('hidden');
    if (els.geminiKeyVerifyStatus) {
      els.geminiKeyVerifyStatus.textContent = `✅ Verified with Google Gemini (${data.maskedKey})! Saved in .env.`;
    }

    if (Array.isArray(data.models) && data.models.length > 0 && els.geminiModelSelect) {
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
      }
    }
  } else if (data.configured) {
    if (els.geminiStatusBadge) {
      els.geminiStatusBadge.textContent = '⚠️ Gemini Key Invalid';
      els.geminiStatusBadge.className = 'status-pill status-warn';
    }
    els.quickKeyBanner?.classList.remove('hidden');
  } else {
    if (els.geminiStatusBadge) {
      els.geminiStatusBadge.textContent = '🔑 Paste Gemini Key';
      els.geminiStatusBadge.className = 'status-pill status-warn';
    }
    els.quickKeyBanner?.classList.remove('hidden');
  }
}
