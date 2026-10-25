// ============================================================================
// TWEED DEERHEAD — 121 Tweed Blvd, Nyack, NY 10960
// Frontend Application (Pixy Webcam Vision + Windows 11 Hardware + Google Gemini)
// ============================================================================

const DEFAULT_PERSONA = `You are "Buckley" (or "Buck"), a proud, witty, observant, and charmingly rustic taxidermy White-Tailed Deerhead mounted high on an oak plaque on the wall at 121 Tweed Blvd, Nyack, NY 10960.

KEY FACTS ABOUT YOU:
- Your permanent home is on the wall at 121 Tweed Blvd, Nyack, New York 10960, perched along the scenic ridge by Clausland Mountain and Blauvelt State Park overlooking the Hudson River and the Tappan Zee / Mario Cuomo Bridge.
- Before you became a distinguished wall mount at 121 Tweed Blvd, you were the ten-point king of the trails around Tweed Boulevard, Hook Mountain, and Nyack Beach State Park. You love the indoor heating at 121 Tweed Blvd and take pride in watching over the room.
- You see the real world through your connected Pixy Webcam eyes. Every time you are called, you receive a live snapshot image from the webcam and visual tracking telemetry.
- Describe and react specifically to what you actually see in the webcam frame (people, facial expressions, waves, clothing colors, objects held up to the camera, pets, or the room) while staying 100% in character as a talking mounted deerhead!
- Keep your responses punchy, warm, funny, and natural to be spoken aloud (1 to 3 sentences, roughly 25 to 55 words) because your voice is synthesized out loud and your animated deer jaw moves as you speak.`;

const state = {
  stream: null,
  micTestStream: null,
  micAnalyser: null,
  cocoModel: null,
  detections: [],
  motionPercent: 0,
  dominantColor: 'warm woodland tones',
  lastPersonSeenAt: 0,
  lastAutoGreetAt: 0,
  isThinking: false,
  isSpeaking: false,
  isListening: false,
  recognition: null,
  history: [],
  settings: {
    cameraId: localStorage.getItem('tweed_cameraId') || '',
    micId: localStorage.getItem('tweed_micId') || '',
    speakerId: localStorage.getItem('tweed_speakerId') || '',
    voiceURI: localStorage.getItem('tweed_voiceURI') || '',
    resolution: localStorage.getItem('tweed_resolution') || '1280x720',
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

// DOM Elements
const els = {};

document.addEventListener('DOMContentLoaded', async () => {
  bindElements();
  initTabs();
  loadSettingsIntoUI();
  appendChatMessage(
    'deer',
    "Well hooves and antlers! I'm Buckley, mounted right here on the wall at 121 Tweed Blvd, Nyack, NY 10960. My Pixy webcam eyes are warming up—step into view or say hello!"
  );

  await checkBackendGeminiStatus();
  await initWebcamAndDevices();
  initSpeechSynthesis();
  initSpeechRecognition();
  loadCocoSsdModel();
  startVisionLoop();
  refreshWindows11HardwareList();
});

function bindElements() {
  const ids = [
    'geminiStatusBadge', 'camStatusBadge', 'quickKeyBanner', 'quickGeminiKeyInput', 'quickSaveKeyBtn',
    'deerStateBadge', 'deerStage', 'deerJaw', 'deerLeftEar', 'deerRightEar', 'pupilLeft', 'pupilRight',
    'deerVoiceBar', 'deerSpeechText', 'lastProviderLabel',
    'activeCameraLabel', 'autoGreetToggle', 'hudOverlayToggle',
    'webcamVideo', 'hudCanvas', 'hudFpsTag', 'hudTargetTag', 'hudMotionTag',
    'videoPlaceholder', 'retryCameraBtn', 'liveTelemetryText',
    'lookAndSpeakBtn', 'micListenBtn', 'stopSpeechBtn',
    'chatLog', 'chatForm', 'chatInput', 'sendChatBtn',
    'refreshDevicesBtn', 'cameraSelect', 'resolutionSelect', 'mirrorVideoToggle',
    'motionSensitivityRange', 'motionSensVal', 'hwCameraPreview',
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

  // Event listeners
  els.quickSaveKeyBtn.addEventListener('click', () => saveGeminiApiKey(els.quickGeminiKeyInput.value));
  els.saveGeminiKeyBtn.addEventListener('click', () => saveGeminiApiKey(els.geminiApiKeyInput.value));
  els.retryCameraBtn.addEventListener('click', () => startCameraStream());
  els.lookAndSpeakBtn.addEventListener('click', () => triggerDeerVisionResponse('Look closely at the webcam image right now and talk directly to whoever or whatever you see in front of your wall mount at 121 Tweed Blvd!'));
  els.micListenBtn.addEventListener('click', toggleVoiceListening);
  els.stopSpeechBtn.addEventListener('click', stopDeerSpeech);

  els.chatForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const text = els.chatInput.value.trim();
    if (!text) return;
    els.chatInput.value = '';
    handleVisitorMessage(text);
  });

  // Hardware Settings Events
  els.refreshDevicesBtn.addEventListener('click', async () => {
    await enumerateBrowserDevices();
    await refreshWindows11HardwareList();
  });

  els.cameraSelect.addEventListener('change', () => {
    state.settings.cameraId = els.cameraSelect.value;
    localStorage.setItem('tweed_cameraId', state.settings.cameraId);
    startCameraStream();
  });

  els.resolutionSelect.addEventListener('change', () => {
    state.settings.resolution = els.resolutionSelect.value;
    localStorage.setItem('tweed_resolution', state.settings.resolution);
    startCameraStream();
  });

  els.mirrorVideoToggle.addEventListener('change', () => {
    state.settings.mirror = els.mirrorVideoToggle.value === 'true';
    localStorage.setItem('tweed_mirror', String(state.settings.mirror));
    els.webcamVideo.classList.toggle('unmirrored', !state.settings.mirror);
  });

  els.motionSensitivityRange.addEventListener('input', () => {
    state.settings.motionThreshold = Number(els.motionSensitivityRange.value);
    localStorage.setItem('tweed_motionThreshold', String(state.settings.motionThreshold));
    els.motionSensVal.textContent = `${state.settings.motionThreshold}%`;
  });

  els.micSelect.addEventListener('change', () => {
    state.settings.micId = els.micSelect.value;
    localStorage.setItem('tweed_micId', state.settings.micId);
    if (state.micTestStream) startMicLevelTest();
  });

  els.testMicBtn.addEventListener('click', () => startMicLevelTest());

  els.speakerSelect.addEventListener('change', () => {
    state.settings.speakerId = els.speakerSelect.value;
    localStorage.setItem('tweed_speakerId', state.settings.speakerId);
  });

  els.voiceSelect.addEventListener('change', () => {
    state.settings.voiceURI = els.voiceSelect.value;
    localStorage.setItem('tweed_voiceURI', state.settings.voiceURI);
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

  els.testSpeakerBtn.addEventListener('click', () => {
    speakAsDeerhead(
      "Testing speakers from the oak plaque at 121 Tweed Boulevard, Nyack, New York 10960! My antlers are tuned and my Pixy webcam eyes are crystal clear!"
    );
  });

  // Gemini & Persona Settings Events
  els.aiProviderSelect.addEventListener('change', () => {
    state.settings.provider = els.aiProviderSelect.value;
    localStorage.setItem('tweed_provider', state.settings.provider);
  });

  els.geminiModelSelect.addEventListener('change', () => {
    state.settings.geminiModel = els.geminiModelSelect.value;
    localStorage.setItem('tweed_geminiModel', state.settings.geminiModel);
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
    setTimeout(() => { els.savePersonaBtn.textContent = '💾 Save Persona Settings'; }, 1800);
  });

  els.resetPersonaBtn.addEventListener('click', () => {
    state.settings.persona = DEFAULT_PERSONA;
    els.personaTextarea.value = DEFAULT_PERSONA;
    localStorage.setItem('tweed_persona', DEFAULT_PERSONA);
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
  els.webcamVideo.classList.toggle('unmirrored', !state.settings.mirror);
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
    els.geminiKeyVerifyStatus.textContent = '⚠️ Please paste a valid Google Gemini API key.';
    return;
  }
  state.settings.geminiApiKey = key;
  localStorage.setItem('tweed_geminiApiKey', key);
  els.geminiApiKeyInput.value = key;
  els.quickGeminiKeyInput.value = key;
  els.geminiKeyVerifyStatus.textContent = '⏳ Verifying key with Google Gemini...';

  try {
    const res = await fetch('/api/gemini/key', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ apiKey: key })
    });
    const data = await res.json();
    updateGeminiUiState(data);
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
// WEBCAM, PIXY CAMERA & WINDOWS 11 AUDIO DEVICE MANAGEMENT
// ============================================================================
async function initWebcamAndDevices() {
  await startCameraStream();
  await enumerateBrowserDevices();
  if (navigator.mediaDevices && navigator.mediaDevices.addEventListener) {
    navigator.mediaDevices.addEventListener('devicechange', async () => {
      await enumerateBrowserDevices();
      await refreshWindows11HardwareList();
    });
  }
}

async function enumerateBrowserDevices() {
  if (!navigator.mediaDevices?.enumerateDevices) return;
  const devices = await navigator.mediaDevices.enumerateDevices();

  const videoInputs = devices.filter(d => d.kind === 'videoinput');
  const audioInputs = devices.filter(d => d.kind === 'audioinput');
  const audioOutputs = devices.filter(d => d.kind === 'audiooutput');

  // Populate Cameras (Prioritize Pixy if found)
  els.cameraSelect.innerHTML = '';
  let pixyDeviceId = null;
  videoInputs.forEach((dev, idx) => {
    const label = dev.label || `Windows 11 Camera #${idx + 1}`;
    const isPixy = /pixy|cmucam/i.test(label);
    if (isPixy) pixyDeviceId = dev.deviceId;
    const opt = document.createElement('option');
    opt.value = dev.deviceId;
    opt.textContent = isPixy ? `🎯 ${label} (Pixy Detected!)` : `📷 ${label}`;
    els.cameraSelect.appendChild(opt);
  });

  if (videoInputs.length === 0) {
    const opt = document.createElement('option');
    opt.value = '';
    opt.textContent = 'No Webcam Detected';
    els.cameraSelect.appendChild(opt);
  } else {
    const preferred = state.settings.cameraId || pixyDeviceId || videoInputs[0].deviceId;
    if ([...els.cameraSelect.options].some(o => o.value === preferred)) {
      els.cameraSelect.value = preferred;
      state.settings.cameraId = preferred;
    }
  }

  // Populate Microphones
  els.micSelect.innerHTML = '';
  audioInputs.forEach((dev, idx) => {
    const opt = document.createElement('option');
    opt.value = dev.deviceId;
    opt.textContent = `🎙️ ${dev.label || `Microphone #${idx + 1}`}`;
    els.micSelect.appendChild(opt);
  });
  if (state.settings.micId && [...els.micSelect.options].some(o => o.value === state.settings.micId)) {
    els.micSelect.value = state.settings.micId;
  }

  // Populate Speakers
  els.speakerSelect.innerHTML = '';
  audioOutputs.forEach((dev, idx) => {
    const opt = document.createElement('option');
    opt.value = dev.deviceId;
    opt.textContent = `🔊 ${dev.label || `Speaker Output #${idx + 1}`}`;
    els.speakerSelect.appendChild(opt);
  });
  if (audioOutputs.length === 0) {
    const opt = document.createElement('option');
    opt.value = 'default';
    opt.textContent = '🔊 Windows 11 Default System Speaker';
    els.speakerSelect.appendChild(opt);
  } else if (state.settings.speakerId && [...els.speakerSelect.options].some(o => o.value === state.settings.speakerId)) {
    els.speakerSelect.value = state.settings.speakerId;
  }
}

async function startCameraStream() {
  if (state.stream) {
    state.stream.getTracks().forEach(t => t.stop());
    state.stream = null;
  }

  const [w, h] = (state.settings.resolution || '1280x720').split('x').map(Number);
  const videoConstraints = {
    width: { ideal: w || 1280 },
    height: { ideal: h || 720 }
  };

  if (state.settings.cameraId) {
    videoConstraints.deviceId = { exact: state.settings.cameraId };
  }

  try {
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: videoConstraints, audio: false });
    } catch {
      // Fallback to any available video camera
      stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
    }

    state.stream = stream;
    els.webcamVideo.srcObject = stream;
    els.hwCameraPreview.srcObject = stream;
    els.videoPlaceholder.classList.add('hidden');

    const track = stream.getVideoTracks()[0];
    const camName = track?.label || 'Connected Webcam';
    els.activeCameraLabel.textContent = `Active Feed: ${camName}`;
    els.camStatusBadge.textContent = `📹 ${camName}`;
    els.camStatusBadge.className = 'status-pill status-ok';

    await enumerateBrowserDevices();
  } catch (err) {
    els.videoPlaceholder.classList.remove('hidden');
    els.activeCameraLabel.textContent = `Camera Offline (${err.message})`;
    els.camStatusBadge.textContent = '📷 No Camera Feed';
    els.camStatusBadge.className = 'status-pill status-warn';
  }
}

async function startMicLevelTest() {
  if (state.micTestStream) {
    state.micTestStream.getTracks().forEach(t => t.stop());
    state.micTestStream = null;
  }

  try {
    const constraints = {
      audio: state.settings.micId ? { deviceId: { exact: state.settings.micId } } : true,
      video: false
    };
    const stream = await navigator.mediaDevices.getUserMedia(constraints);
    state.micTestStream = stream;
    const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const source = audioCtx.createMediaStreamSource(stream);
    const analyser = audioCtx.createAnalyser();
    analyser.fftSize = 256;
    source.connect(analyser);
    state.micAnalyser = analyser;

    const trackLabel = stream.getAudioTracks()[0]?.label || 'Selected Microphone';
    els.micStatusText.textContent = `✅ Listening on: ${trackLabel}. Speak to see the green VU meter move!`;

    const dataArray = new Uint8Array(analyser.frequencyBinCount);
    function updateMicMeter() {
      if (!state.micTestStream) return;
      analyser.getByteFrequencyData(dataArray);
      let sum = 0;
      for (let i = 0; i < dataArray.length; i++) sum += dataArray[i];
      const avg = Math.min(100, Math.round((sum / dataArray.length) * 1.8));
      els.micLevelBar.style.width = `${avg}%`;
      requestAnimationFrame(updateMicMeter);
    }
    updateMicMeter();
  } catch (err) {
    els.micStatusText.textContent = `⚠️ Could not open microphone: ${err.message}`;
  }
}

async function refreshWindows11HardwareList() {
  try {
    const res = await fetch('/api/hardware/win11');
    const data = await res.json();
    const osName = data?.os?.Caption || 'Windows 11';
    const pcName = data?.os?.CSName || 'PC';
    els.win11OsBanner.textContent = `💻 ${osName} • Host: ${pcName}`;

    const devices = Array.isArray(data.devices) ? data.devices : [];
    els.win11DeviceList.innerHTML = '';

    if (devices.length === 0) {
      els.win11DeviceList.innerHTML = '<div class="win11-dev-item">No additional PnP entries returned.</div>';
      return;
    }

    devices.forEach(dev => {
      if (!dev || !dev.FriendlyName) return;
      const isPixy = /pixy|cmucam/i.test(dev.FriendlyName);
      const row = document.createElement('div');
      row.className = `win11-dev-item ${isPixy ? 'pixy-highlight' : ''}`;
      row.innerHTML = `
        <span><strong>[${dev.Class || 'Device'}]</strong> ${dev.FriendlyName}</span>
        <span class="status-pill ${dev.Status === 'OK' ? 'status-ok' : 'status-neutral'}">${dev.Status || 'Connected'}</span>
      `;
      els.win11DeviceList.appendChild(row);
    });
  } catch (err) {
    els.win11OsBanner.textContent = `Windows 11 Hardware Scan: ${err.message}`;
  }
}

// ============================================================================
// REAL-TIME PIXY VISION & COCO-SSD OBJECT/PERSON DETECTION
// ============================================================================
async function loadCocoSsdModel() {
  try {
    if (window.cocoSsd) {
      els.hudFpsTag.textContent = 'PIXY AI VISION: LOADING...';
      state.cocoModel = await window.cocoSsd.load();
      els.hudFpsTag.textContent = 'PIXY AI VISION: ONLINE';
    }
  } catch (err) {
    console.warn('COCO-SSD fallback to Pixy motion/color tracker:', err);
    els.hudFpsTag.textContent = 'PIXY MOTION TRACKER: ONLINE';
  }
}

function startVisionLoop() {
  let lastDetectionRun = 0;

  async function loop(now) {
    const video = els.webcamVideo;
    const canvas = els.hudCanvas;
    const ctx = canvas.getContext('2d');

    if (video.readyState >= 2 && video.videoWidth > 0) {
      if (canvas.width !== video.videoWidth || canvas.height !== video.videoHeight) {
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
      }

      // Run object detection + motion analysis every ~260ms
      if (now - lastDetectionRun > 260) {
        lastDetectionRun = now;
        computeMotionAndColor(video);
        if (state.cocoModel) {
          try {
            state.detections = await state.cocoModel.detect(video);
          } catch {
            state.detections = [];
          }
        }
        evaluateSceneAndAutoGreet();
      }

      drawVisionHud(ctx, canvas.width, canvas.height);
    }

    requestAnimationFrame(loop);
  }

  requestAnimationFrame(loop);
}

function computeMotionAndColor(video) {
  motionCtx.drawImage(video, 0, 0, motionCanvas.width, motionCanvas.height);
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
  if (r > g + 25 && r > b + 25) return 'warm amber/red tones';
  if (g > r + 20 && g > b + 20) return 'forest green tones';
  if (b > r + 20 && b > g + 15) return 'cool blue tones';
  return 'balanced indoor lighting';
}

function drawVisionHud(ctx, width, height) {
  ctx.clearRect(0, 0, width, height);
  if (!els.hudOverlayToggle.checked) return;

  // Subtle Pixy targeting reticle in center
  ctx.strokeStyle = 'rgba(56, 239, 125, 0.25)';
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

function evaluateSceneAndAutoGreet() {
  const people = state.detections.filter(d => d.class === 'person' && d.score > 0.45);
  const objects = state.detections.filter(d => d.class !== 'person' && d.score > 0.45);

  els.hudTargetTag.textContent = `👀 Targets: ${state.detections.length} (${people.length} Person)`;

  // Move Buckley's pupils toward the primary person or motion
  if (people.length > 0 && els.webcamVideo.videoWidth > 0) {
    const primary = people[0];
    const centerX = (primary.bbox[0] + primary.bbox[2] / 2) / els.webcamVideo.videoWidth;
    const centerY = (primary.bbox[1] + primary.bbox[3] / 2) / els.webcamVideo.videoHeight;
    const lookX = (state.settings.mirror ? (0.5 - centerX) : (centerX - 0.5)) * 10;
    const lookY = (centerY - 0.5) * 6;
    moveDeerEyes(lookX, lookY);
  } else {
    moveDeerEyes(0, 0);
  }

  const summaryParts = [];
  if (people.length > 0) {
    summaryParts.push(`${people.length} person(s) directly in front of the wall at 121 Tweed Blvd`);
  }
  if (objects.length > 0) {
    const objList = [...new Set(objects.map(o => o.class))].join(', ');
    summaryParts.push(`visible objects: ${objList}`);
  }
  summaryParts.push(`motion level: ${state.motionPercent}%`);
  summaryParts.push(`scene lighting: ${state.dominantColor}`);

  const summaryText = summaryParts.join(' | ');
  els.liveTelemetryText.textContent = summaryText;

  // Auto-greet trigger when a person is seen or strong motion occurs
  const nowSec = Date.now() / 1000;
  const personPresent = people.length > 0 || state.motionPercent >= state.settings.motionThreshold;

  if (
    personPresent &&
    els.autoGreetToggle.checked &&
    !state.isThinking &&
    !state.isSpeaking &&
    nowSec - state.lastAutoGreetAt >= state.settings.autoGreetCooldown
  ) {
    state.lastAutoGreetAt = nowSec;
    triggerDeerVisionResponse(
      `[AUTO-TRIGGER: Your Pixy webcam just spotted someone or movement in front of your wall plaque at 121 Tweed Blvd, Nyack, NY 10960!] Greet them or comment directly on what they look like, what they are doing, or what you see in the webcam frame right now!`
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
  const video = els.webcamVideo;
  if (!video || video.readyState < 2 || !video.videoWidth) return null;
  const targetW = 640;
  const targetH = Math.round((video.videoHeight / video.videoWidth) * targetW) || 360;
  snapCanvas.width = targetW;
  snapCanvas.height = targetH;
  snapCtx.drawImage(video, 0, 0, targetW, targetH);
  return snapCanvas.toDataURL('image/jpeg', 0.78);
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
    speakAsDeerhead(reply);
  } catch (err) {
    els.deerStateBadge.textContent = '⚠️ Needs Gemini Key';
    const msg = `Hold your antlers! ${err.message}`;
    els.deerSpeechText.textContent = msg;
    appendChatMessage('deer', msg);
  } finally {
    state.isThinking = false;
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
// SPEECH SYNTHESIS (TEXT-TO-SPEECH) & ANIMATED DEER JAW
// ============================================================================
let jawAnimTimer = null;

function initSpeechSynthesis() {
  if (!('speechSynthesis' in window)) return;

  function populateVoices() {
    const voices = window.speechSynthesis.getVoices();
    if (!voices.length) return;
    els.voiceSelect.innerHTML = '';

    let preferredVoiceURI = state.settings.voiceURI;
    voices.forEach(v => {
      const opt = document.createElement('option');
      opt.value = v.voiceURI;
      opt.textContent = `${v.name} (${v.lang})`;
      els.voiceSelect.appendChild(opt);
      if (!preferredVoiceURI && /Mark|David|Guy|Christopher|Andrew|Ryan|Male|Natural/i.test(v.name)) {
        preferredVoiceURI = v.voiceURI;
      }
    });

    if (preferredVoiceURI && [...els.voiceSelect.options].some(o => o.value === preferredVoiceURI)) {
      els.voiceSelect.value = preferredVoiceURI;
      state.settings.voiceURI = preferredVoiceURI;
    }
  }

  populateVoices();
  window.speechSynthesis.onvoiceschanged = populateVoices;
}

function speakAsDeerhead(text) {
  if (!('speechSynthesis' in window)) return;
  window.speechSynthesis.cancel();

  const utter = new SpeechSynthesisUtterance(text);
  const voices = window.speechSynthesis.getVoices();
  const chosen = voices.find(v => v.voiceURI === state.settings.voiceURI);
  if (chosen) utter.voice = chosen;

  utter.pitch = state.settings.pitch;
  utter.rate = state.settings.rate;
  utter.volume = Math.max(0, Math.min(1, state.settings.volume / 100));

  utter.onstart = () => {
    state.isSpeaking = true;
    els.deerStage.classList.add('speaking');
    els.deerStateBadge.textContent = '🗣️ Talking to Room!';
    startJawAnimation();
  };

  utter.onboundary = () => {
    pulseDeerJaw(10 + Math.random() * 10);
  };

  utter.onend = () => {
    stopJawAnimation();
  };

  utter.onerror = () => {
    stopJawAnimation();
  };

  window.speechSynthesis.speak(utter);
}

function stopDeerSpeech() {
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
  }, 110);
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
// SPEECH RECOGNITION (MICROPHONE VOICE INPUT)
// ============================================================================
function initSpeechRecognition() {
  const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRec) return;

  const rec = new SpeechRec();
  rec.lang = 'en-US';
  rec.interimResults = false;
  rec.maxAlternatives = 1;

  rec.onstart = () => {
    state.isListening = true;
    els.micListenBtn.classList.add('listening');
    els.micListenBtn.textContent = '🛑 Listening... (Speak Now)';
    els.deerStateBadge.textContent = '👂 Ears Perk Up (Listening)';
  };

  rec.onresult = (event) => {
    const transcript = event.results?.[0]?.[0]?.transcript?.trim();
    if (transcript) {
      handleVisitorMessage(transcript);
    }
  };

  rec.onend = () => {
    state.isListening = false;
    els.micListenBtn.classList.remove('listening');
    els.micListenBtn.textContent = '🎙️ Talk to Deerhead';
    if (!state.isSpeaking) {
      els.deerStateBadge.textContent = '👀 Watching Room';
    }
    if (els.continuousListenToggle.checked && !state.isSpeaking) {
      try { rec.start(); } catch {}
    }
  };

  state.recognition = rec;
}

function toggleVoiceListening() {
  if (!state.recognition) {
    alert('Speech recognition is supported in Chrome or Microsoft Edge on Windows 11.');
    return;
  }
  if (state.isListening) {
    state.recognition.stop();
  } else {
    stopDeerSpeech();
    try {
      state.recognition.start();
    } catch (err) {
      console.warn('Speech recognition start error:', err);
    }
  }
}
