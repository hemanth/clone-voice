/**
 * clone-voice live demo — loads clone-voice from ESM CDN.
 */

let cloneModule = null;
let currentVoice = null;
let selectedVoice = 'alba';
let useMic = false;

const $ = (s) => document.querySelector(s);
const status = (msg, type = '') => {
  const el = $('#status');
  el.textContent = msg;
  el.className = 'status' + (type ? ` ${type}` : '');
};

// ── Voice buttons ───────────────────────────────────────────────

document.querySelectorAll('.voice-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.voice-btn').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');

    if (btn.dataset.mic) {
      useMic = true;
      selectedVoice = null;
    } else {
      useMic = false;
      selectedVoice = btn.dataset.voice;
    }
  });
});

// ── Load module ─────────────────────────────────────────────────

async function loadClone() {
  if (cloneModule) return cloneModule;
  status('Loading clone-voice from CDN...');
  const mod = await import('https://esm.sh/clone-voice@0.2.0?bundle-deps&external=onnxruntime-web');

  // Load ONNX Runtime separately
  if (!window.ort) {
    status('Loading ONNX Runtime...');
    await loadScript('https://cdn.jsdelivr.net/npm/onnxruntime-web@1.21.0/dist/ort.webgpu.min.js');
  }

  cloneModule = mod.default;
  return cloneModule;
}

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.onload = resolve;
    s.onerror = reject;
    document.head.appendChild(s);
  });
}

// ── Generate ────────────────────────────────────────────────────

$('#speak-btn').addEventListener('click', async () => {
  const text = $('#text-input').value.trim();
  if (!text) { status('Enter some text first.', 'error'); return; }

  const btn = $('#speak-btn');
  const btnText = btn.querySelector('.btn-text');
  const btnLoader = btn.querySelector('.btn-loader');
  const statusText = btn.querySelector('.status-text');

  btn.disabled = true;
  btnText.hidden = true;
  btnLoader.hidden = false;

  try {
    const clone = await loadClone();

    // Get or create voice
    if (useMic) {
      statusText.textContent = 'Recording from mic (5s)...';
      status('🎙️ Recording... speak now!');
      const micBtn = document.querySelector('[data-mic]');
      micBtn.classList.add('recording');

      currentVoice = await clone.mic(5000, {
        onTick: (s) => { status(`🎙️ Recording... ${5 - s}s remaining`); },
      });

      micBtn.classList.remove('recording');
    } else {
      statusText.textContent = 'Loading models & voice...';
      status(`Loading voice "${selectedVoice}"...`);
      currentVoice = await clone(selectedVoice);
    }

    statusText.textContent = 'Generating speech...';
    status('Generating speech...');

    const wav = await currentVoice.speak(text);

    // Play audio
    const blob = new Blob([wav], { type: 'audio/wav' });
    const url = URL.createObjectURL(blob);
    const audio = $('#audio-player');
    audio.src = url;

    // Draw waveform
    drawWaveform(wav);

    $('#player').hidden = false;
    audio.play();
    status('✓ Done! Audio generated in-browser.', 'success');
  } catch (err) {
    console.error(err);
    status(`Error: ${err.message}`, 'error');
  } finally {
    btn.disabled = false;
    btnText.hidden = false;
    btnLoader.hidden = true;
  }
});

// ── Waveform ────────────────────────────────────────────────────

function drawWaveform(wavBuffer) {
  const container = $('#waveform');
  container.innerHTML = '';

  const view = new DataView(wavBuffer);
  const dataOffset = 44;
  const sampleCount = (wavBuffer.byteLength - dataOffset) / 2;
  const bars = 80;
  const samplesPerBar = Math.floor(sampleCount / bars);

  for (let i = 0; i < bars; i++) {
    let sum = 0;
    for (let j = 0; j < samplesPerBar; j++) {
      const idx = dataOffset + (i * samplesPerBar + j) * 2;
      if (idx + 1 < wavBuffer.byteLength) {
        sum += Math.abs(view.getInt16(idx, true));
      }
    }
    const avg = sum / samplesPerBar / 32768;
    const height = Math.max(4, avg * 60);

    const bar = document.createElement('div');
    bar.className = 'bar';
    bar.style.height = `${height}px`;
    container.appendChild(bar);
  }
}
