/**
 * clone-voice — Clone any voice, generate speech.
 *
 * @module clone-voice
 */

import { VoiceCloneEngine } from './engine.js';
import { Voice } from './voice.js';
import { decodeAudio } from './utils.js';
import { recordMic } from './mic.js';
import { DEFAULT_LANGUAGE, SAMPLE_RATE } from './constants.js';

let _engine;
let _lang = DEFAULT_LANGUAGE;

async function getEngine(opts = {}) {
  const lang = opts.lang || _lang;
  if (!_engine) {
    _engine = new VoiceCloneEngine({ modelBasePath: opts.modelBasePath, ort: opts.ort });
    await _engine.loadBundle(lang);
    _lang = lang;
  } else if (lang !== _lang) {
    await _engine.loadBundle(lang);
    _lang = lang;
  }
  return _engine;
}

function looksLikeUrl(s) {
  return s.includes('/') || s.includes('.') || s.startsWith('http');
}

/**
 * Clone a voice from audio or pick a built-in voice.
 *
 * @param {string|ArrayBuffer|Blob|Float32Array} input - URL, file path, audio data, or built-in voice name.
 * @param {object} [opts]
 * @param {string} [opts.lang] - Language bundle.
 * @returns {Promise<Voice>}
 */
async function clone(input, opts = {}) {
  const engine = await getEngine(opts);
  let voiceName;

  if (typeof input === 'string' && !looksLikeUrl(input)) {
    // Built-in voice name
    await engine.setVoice(input);
    voiceName = input;
  } else {
    // Audio input — URL, ArrayBuffer, Blob, Float32Array
    let pcm;
    if (typeof input === 'string') {
      const res = await fetch(input);
      pcm = await decodeAudio(await res.arrayBuffer(), SAMPLE_RATE);
    } else if (input instanceof Float32Array) {
      pcm = input;
    } else {
      pcm = await decodeAudio(input, SAMPLE_RATE);
    }
    await engine.encodeVoice(pcm);
    voiceName = engine.currentVoice;
  }

  return new Voice(engine, voiceName, SAMPLE_RATE);
}

/**
 * Clone a voice from the microphone.
 *
 * @param {number} [duration=5000] - Recording duration in ms.
 * @param {object} [opts] - Options passed to clone().
 * @returns {Promise<Voice>}
 */
clone.mic = async function (duration = 5000, opts = {}) {
  const audio = await recordMic({ duration, ...opts });
  return clone(audio, opts);
};

export default clone;

// Re-exports for power users
export { Voice } from './voice.js';
export { VoiceCloneEngine } from './engine.js';
export { PCMPlayer } from './pcm-player.js';
export { EventEmitter } from './event-emitter.js';
export { recordMic } from './mic.js';
export { encodeWav, resampleLinear, decodeAudio } from './utils.js';
export { SAMPLE_RATE, LANGUAGE_BUNDLES, DEFAULT_LANGUAGE } from './constants.js';
