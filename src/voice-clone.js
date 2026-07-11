/**
 * VoiceClone — High-level API for voice cloning and speech generation.
 *
 * Auto-initializes on first use. No init() needed.
 */

import { EventEmitter } from './event-emitter.js';
import { VoiceCloneEngine } from './engine.js';
import { decodeAudio } from './utils.js';
import { DEFAULT_LANGUAGE, LANGUAGE_BUNDLES, SAMPLE_RATE } from './constants.js';

export class VoiceClone extends EventEmitter {
  /**
   * @param {object} [options]
   * @param {string} [options.language] - Language bundle (default: 'english_2026-04').
   * @param {string} [options.modelBasePath] - Base URL for model/asset files.
   * @param {number} [options.sampleRate] - Target sample rate (default: 24000).
   * @param {object} [options.ort] - Pre-loaded onnxruntime-web module.
   */
  constructor(options = {}) {
    super();
    this._language = options.language || DEFAULT_LANGUAGE;
    this._sampleRate = options.sampleRate || SAMPLE_RATE;
    this._initPromise = null;

    this._engine = new VoiceCloneEngine({
      modelBasePath: options.modelBasePath,
      ort: options.ort,
    });

    // Proxy engine events
    for (const event of ['ready', 'voices-loaded', 'voice-cloned', 'voice-set', 'audio-chunk', 'stream-end', 'error', 'status']) {
      this._engine.on(event, (data) => this.emit(event, data));
    }
  }

  /** Lazy init — loads models on first call, subsequent calls are a no-op. */
  async _ensureReady() {
    if (!this._initPromise) {
      this._initPromise = this._engine.loadBundle(this._language);
    }
    return this._initPromise;
  }

  /** The underlying engine instance. */
  get engine() { return this._engine; }

  /** Whether the SDK is ready for generation. */
  get isReady() { return this._engine.isReady; }

  /** Whether generation is currently running. */
  get isGenerating() { return this._engine.isGenerating; }

  /** Current sample rate. */
  get sampleRate() { return this._engine.sampleRate; }

  /** Current language. */
  get language() { return this._engine.language; }

  /**
   * Clone a voice from audio.
   * Accepts Float32Array (raw PCM), ArrayBuffer, or Blob.
   */
  async cloneVoice(audioData) {
    await this._ensureReady();
    const pcm = audioData instanceof Float32Array
      ? audioData
      : await decodeAudio(audioData, this._sampleRate);
    return this._engine.encodeVoice(pcm);
  }

  /**
   * Generate speech from text. Streams audio via 'audio-chunk' events.
   */
  async generate(text, options = {}) {
    await this._ensureReady();
    return this._engine.generate(text, options);
  }

  /**
   * Generate and collect all audio into a single Float32Array.
   * Returns { audio: Float32Array, sampleRate: number }.
   */
  async speak(text, options = {}) {
    await this._ensureReady();
    const chunks = [];
    const onChunk = ({ data }) => chunks.push(data);
    this.on('audio-chunk', onChunk);

    try {
      await this._engine.generate(text, options);
    } finally {
      this.off('audio-chunk', onChunk);
    }

    const total = chunks.reduce((n, c) => n + c.length, 0);
    const audio = new Float32Array(total);
    let offset = 0;
    for (const c of chunks) { audio.set(c, offset); offset += c.length; }
    return { audio, sampleRate: this._sampleRate };
  }

  /** Stop any ongoing generation. */
  stop() { this._engine.stop(); }

  /** Switch language bundle. */
  async setLanguage(language) {
    if (!LANGUAGE_BUNDLES.includes(language)) {
      throw new Error(`Unsupported language: ${language}. Available: ${LANGUAGE_BUNDLES.join(', ')}`);
    }
    this._language = language;
    this._initPromise = null;
    await this._ensureReady();
  }

  /** Switch to a built-in voice. */
  async setVoice(voiceName) {
    await this._ensureReady();
    return this._engine.setVoice(voiceName);
  }

  /** List available built-in voices. */
  async getVoices() {
    await this._ensureReady();
    return this._engine.getVoices();
  }

  /** Release all resources. */
  async destroy() {
    await this._engine.destroy();
    this.removeAllListeners();
  }
}
