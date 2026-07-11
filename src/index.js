/**
 * voice-clone — Browser & Node voice cloning SDK.
 *
 * @module voice-clone
 */

import { VoiceClone } from './voice-clone.js';

// ── Lazy singleton for top-level functions ──────────────────────────

let _instance;
function _vc() {
  if (!_instance) _instance = new VoiceClone();
  return _instance;
}

/** Clone a voice from audio (Float32Array, ArrayBuffer, or Blob). */
export async function cloneVoice(audioData) {
  return _vc().cloneVoice(audioData);
}

/** Generate speech — streams via 'audio-chunk' events on the shared instance. */
export async function generate(text, options) {
  return _vc().generate(text, options);
}

/** Generate speech and return the full audio buffer. */
export async function speak(text, options) {
  return _vc().speak(text, options);
}

/** Switch language. */
export async function setLanguage(language) {
  return _vc().setLanguage(language);
}

/** Switch to a built-in voice. */
export async function setVoice(voiceName) {
  return _vc().setVoice(voiceName);
}

/** List available built-in voices. */
export async function getVoices() {
  return _vc().getVoices();
}

/** Stop generation. */
export function stop() {
  return _vc().stop();
}

/** Listen to events on the shared instance. */
export function on(event, listener) {
  _vc().on(event, listener);
  return off.bind(null, event, listener);
}

/** Remove event listener. */
export function off(event, listener) {
  _vc().off(event, listener);
}

/** Get the shared VoiceClone instance (for advanced use). */
export function getInstance(options) {
  if (options && !_instance) {
    _instance = new VoiceClone(options);
  }
  return _vc();
}

// ── Re-exports for power users ──────────────────────────────────────

export { VoiceClone } from './voice-clone.js';
export { VoiceCloneEngine } from './engine.js';
export { PCMPlayer } from './pcm-player.js';
export { EventEmitter } from './event-emitter.js';
export { recordMic } from './mic.js';
export { encodeWav, resampleLinear, decodeAudio, parseNpy, parseVoicesBin } from './utils.js';
export {
  SAMPLE_RATE,
  LATENT_DIM,
  CONDITIONING_DIM,
  SAMPLES_PER_FRAME,
  MAX_FRAMES,
  LSD_STEPS,
  TEMPERATURE,
  MODEL_STEMS,
  LANGUAGE_BUNDLES,
  DEFAULT_LANGUAGE,
  HF_CDN_BASE,
} from './constants.js';
