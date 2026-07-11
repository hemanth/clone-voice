/**
 * recordMic — Browser mic recording helper.
 * Returns a Blob of audio ready to pass to cloneVoice().
 */

const DEFAULT_DURATION = 5000;
const MAX_DURATION = 15000;

/**
 * Record audio from the microphone.
 *
 * @param {object} [options]
 * @param {number} [options.duration=5000] - Recording duration in ms (max 15s).
 * @param {function} [options.onStart] - Called when recording starts.
 * @param {function} [options.onTick] - Called each second with elapsed seconds.
 * @param {AbortSignal} [options.signal] - AbortSignal to stop early.
 * @returns {Promise<Blob>} Audio blob ready for cloneVoice().
 */
export async function recordMic(options = {}) {
  const {
    duration = DEFAULT_DURATION,
    onStart,
    onTick,
    signal,
  } = options;

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

    recorder.onstop = () => {
      stream.getTracks().forEach((t) => t.stop());
      clearInterval(tickTimer);
      const blob = new Blob(chunks, { type: recorder.mimeType || 'audio/webm' });
      resolve(blob);
    };

    recorder.onerror = (e) => {
      stream.getTracks().forEach((t) => t.stop());
      clearInterval(tickTimer);
      reject(e.error || new Error('Recording failed'));
    };

    // Auto-stop after duration
    const stopTimer = setTimeout(() => recorder.stop(), ms);

    // Tick callback
    let elapsed = 0;
    const tickTimer = onTick
      ? setInterval(() => { elapsed++; onTick(elapsed); }, 1000)
      : null;

    // AbortSignal support
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
  const mimes = [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/ogg;codecs=opus',
    'audio/mp4',
  ];
  for (const m of mimes) {
    if (MediaRecorder.isTypeSupported(m)) return m;
  }
  return '';
}
