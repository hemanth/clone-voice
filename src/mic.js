/**
 * recordMic — Universal mic recording for browser and Node/CLI.
 * Returns an ArrayBuffer (WAV) ready to pass to cloneVoice().
 */

const DEFAULT_DURATION = 5000;
const MAX_DURATION = 15000;

/**
 * Record audio from the microphone.
 * Works in browser (MediaRecorder) and Node/CLI (sox/arecord).
 *
 * @param {object} [options]
 * @param {number} [options.duration=5000] - Recording duration in ms (max 15s).
 * @param {function} [options.onStart] - Called when recording starts.
 * @param {function} [options.onTick] - Called each second with elapsed seconds.
 * @param {AbortSignal} [options.signal] - AbortSignal to stop early.
 * @returns {Promise<ArrayBuffer>} WAV audio ready for cloneVoice().
 */
export async function recordMic(options = {}) {
  if (typeof navigator !== 'undefined' && navigator.mediaDevices) {
    return recordBrowser(options);
  }
  return recordNode(options);
}

// ── Browser ─────────────────────────────────────────────────────────

async function recordBrowser(options) {
  const { duration = DEFAULT_DURATION, onStart, onTick, signal } = options;
  const ms = Math.min(duration, MAX_DURATION);

  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      sampleRate: 24000,
      channelCount: 1,
      echoCancellation: true,
      noiseSuppression: true,
    },
  });

  const mimeType = getSupportedMime();
  const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : {});
  const chunks = [];

  return new Promise((resolve, reject) => {
    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunks.push(e.data);
    };

    recorder.onstop = async () => {
      stream.getTracks().forEach((t) => t.stop());
      clearInterval(tickTimer);
      const blob = new Blob(chunks, { type: recorder.mimeType || 'audio/webm' });
      resolve(await blob.arrayBuffer());
    };

    recorder.onerror = (e) => {
      stream.getTracks().forEach((t) => t.stop());
      clearInterval(tickTimer);
      reject(e.error || new Error('Recording failed'));
    };

    const stopTimer = setTimeout(() => recorder.stop(), ms);

    let elapsed = 0;
    const tickTimer = onTick
      ? setInterval(() => { elapsed++; onTick(elapsed); }, 1000)
      : null;

    if (signal) {
      signal.addEventListener('abort', () => {
        clearTimeout(stopTimer);
        if (recorder.state === 'recording') recorder.stop();
      }, { once: true });
    }

    recorder.start(100);
    if (onStart) onStart();
  });
}

function getSupportedMime() {
  if (typeof MediaRecorder === 'undefined') return '';
  for (const m of ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4']) {
    if (MediaRecorder.isTypeSupported(m)) return m;
  }
  return '';
}

// ── Node / CLI ──────────────────────────────────────────────────────

async function recordNode(options) {
  const { duration = DEFAULT_DURATION, onStart, onTick, signal } = options;
  const seconds = Math.min(duration, MAX_DURATION) / 1000;

  const { spawn } = await import('node:child_process');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { readFile, unlink } = await import('node:fs/promises');
  const { randomBytes } = await import('node:crypto');

  const tmpFile = join(tmpdir(), `clone-voice-${randomBytes(4).toString('hex')}.wav`);
  const { cmd, args } = getRecordCommand(tmpFile, seconds);

  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, { stdio: ['pipe', 'pipe', 'pipe'] });
    let done = false;

    const cleanup = async (err) => {
      if (done) return;
      done = true;
      clearInterval(tickId);
      try {
        if (err) {
          reject(err);
        } else {
          const buf = await readFile(tmpFile);
          resolve(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
        }
      } catch (e) {
        reject(e);
      } finally {
        unlink(tmpFile).catch(() => {});
      }
    };

    proc.on('close', (code) => {
      if (code && code !== 0 && !done) {
        cleanup(new Error(`Recording process exited with code ${code}. Is sox installed? (brew install sox / apt install sox)`));
      } else {
        cleanup();
      }
    });

    proc.on('error', (err) => {
      if (err.code === 'ENOENT') {
        cleanup(new Error(
          `"${cmd}" not found. Install sox:\n` +
          '  macOS:  brew install sox\n' +
          '  Linux:  apt install sox libsox-fmt-all\n' +
          '  Windows: choco install sox'
        ));
      } else {
        cleanup(err);
      }
    });

    let elapsed = 0;
    const tickId = onTick
      ? setInterval(() => { elapsed++; onTick(elapsed); }, 1000)
      : null;

    if (signal) {
      signal.addEventListener('abort', () => {
        proc.kill('SIGTERM');
      }, { once: true });
    }

    if (onStart) onStart();
  });
}

function getRecordCommand(outFile, seconds) {
  const platform = typeof process !== 'undefined' ? process.platform : '';

  // sox's `rec` command works on macOS, Linux, Windows
  // Falls back to `arecord` on Linux if sox isn't available
  if (platform === 'linux') {
    // Try sox first, but we use rec which is a sox alias
    return {
      cmd: 'rec',
      args: ['-q', '-r', '24000', '-c', '1', '-b', '16', '-t', 'wav', outFile, 'trim', '0', String(seconds)],
    };
  }

  // macOS and Windows: use sox's rec
  return {
    cmd: 'rec',
    args: ['-q', '-r', '24000', '-c', '1', '-b', '16', '-t', 'wav', outFile, 'trim', '0', String(seconds)],
  };
}
