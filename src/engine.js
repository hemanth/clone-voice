/**
 * VoiceCloneEngine — Core inference engine for Pocket TTS voice cloning.
 *
 * Wraps the ONNX model pipeline: mimi_encoder, text_conditioner,
 * flow_lm_main, flow_lm_flow, and mimi_decoder into clean async methods.
 *
 * This is the "headless" core — no DOM, no audio playback, just tensors in/out.
 */

import { EventEmitter } from './event-emitter.js';
import { parseNpy, parseVoicesBin } from './utils.js';
import {
  SAMPLE_RATE,
  LATENT_DIM,
  CONDITIONING_DIM,
  SAMPLES_PER_FRAME,
  MAX_TOKEN_PER_CHUNK,
  MAX_FRAMES,
  LSD_STEPS,
  CHUNK_GAP_SEC,
  TEMPERATURE,
  MODEL_STEMS,
  DEFAULT_LANGUAGE,
  LANGUAGE_BUNDLES,
  HF_CDN_BASE,
} from './constants.js';

export class VoiceCloneEngine extends EventEmitter {
  /**
   * @param {object} [options]
   * @param {string} [options.modelBasePath] - Base URL for model files.
   * @param {object} [options.ort] - onnxruntime-web module reference.
   */
  constructor(options = {}) {
    super();
    this.modelBasePath = options.modelBasePath || HF_CDN_BASE;
    this.ort = options.ort || null;

    // Sessions
    this._sessions = {
      mimiEncoder: null,
      textConditioner: null,
      flowLmMain: null,
      flowLmFlow: null,
      mimiDecoder: null,
    };

    // Bundle state
    this._bundleMetadata = null;
    this._tokenizer = null;
    this._tokenizerModelB64 = null;
    this._bosBeforeVoice = null;
    this._predefinedVoiceRecords = {};
    this._voiceConditioningCache = new Map();
    this._customVoiceEmbedding = null;
    this._currentVoiceName = null;
    this._stTensors = [];

    // Model parameters (updated from bundle metadata)
    this._sampleRate = SAMPLE_RATE;
    this._samplesPerFrame = SAMPLES_PER_FRAME;
    this._latentDim = LATENT_DIM;
    this._conditioningDim = CONDITIONING_DIM;
    this._maxTokenPerChunk = MAX_TOKEN_PER_CHUNK;

    // Generation control
    this._isGenerating = false;
    this._isReady = false;
    this._currentLanguage = null;
  }

  /** Whether the engine is ready for generation. */
  get isReady() {
    return this._isReady;
  }

  /** Whether generation is currently running. */
  get isGenerating() {
    return this._isGenerating;
  }

  /** Current sample rate. */
  get sampleRate() {
    return this._sampleRate;
  }

  /** Current language bundle. */
  get language() {
    return this._currentLanguage;
  }

  /** Currently active voice name. */
  get currentVoice() {
    return this._currentVoiceName;
  }

  // ── ORT Initialization ───────────────────────────────────────────

  /**
   * Set the ONNX Runtime module. Call before loadBundle() if not passed in constructor.
   * @param {object} ortModule
   */
  setOrt(ortModule) {
    this.ort = ortModule.default || ortModule;
  }

  /**
   * Resolve the ONNX Runtime module, importing from CDN if needed.
   */
  async _ensureOrt() {
    if (this.ort) return;
    this.emit('status', { status: 'Loading ONNX Runtime...', state: 'loading' });
    const version = '1.20.0';
    const cdnBase = `https://cdn.jsdelivr.net/npm/onnxruntime-web@${version}/dist/`;
    const ortModule = await import(
      `https://cdn.jsdelivr.net/npm/onnxruntime-web@${version}/dist/ort.min.mjs`
    );
    this.ort = ortModule.default || ortModule;
    this.ort.env.wasm.wasmPaths = cdnBase;
    this.ort.env.wasm.simd = true;
    if (typeof navigator !== 'undefined') {
      this.ort.env.wasm.numThreads =
        typeof crossOriginIsolated !== 'undefined' && crossOriginIsolated
          ? Math.min(navigator.hardwareConcurrency || 4, 8)
          : 1;
    }
  }

  // ── Tensor Helpers ───────────────────────────────────────────────

  _createTensor(dtype, data, dims) {
    return new this.ort.Tensor(dtype, data, dims);
  }

  _makeFilledArray(shape, dtype, fill) {
    const size = shape.reduce((a, b) => a * b, 1);
    if (dtype === 'int64') return new BigInt64Array(size);
    if (dtype === 'bool') return new Uint8Array(size);
    const data = new Float32Array(size);
    if (fill === 'nan') data.fill(NaN);
    else if (fill === 'ones') data.fill(1);
    return data;
  }

  _initStateFromManifest(manifest) {
    const state = {};
    for (const entry of manifest) {
      state[entry.input_name] = this._createTensor(
        entry.dtype,
        this._makeFilledArray(entry.shape, entry.dtype, entry.fill),
        entry.shape
      );
    }
    return state;
  }

  _updateStateFromManifestOutputs(state, result, manifest) {
    for (const entry of manifest) {
      state[entry.input_name] = result[entry.output_name];
    }
  }

  // ── Voice Record Helpers ─────────────────────────────────────────

  _groupVoiceRecordByModule(record) {
    const grouped = {};
    for (const [key, value] of Object.entries(record)) {
      const slash = key.indexOf('/');
      if (slash === -1) continue;
      const moduleName = key.slice(0, slash);
      const tensorKey = key.slice(slash + 1);
      if (!grouped[moduleName]) grouped[moduleName] = {};
      grouped[moduleName][tensorKey] = value;
    }
    return grouped;
  }

  _adaptTypedArray(source, entry) {
    const targetShape = entry.shape;
    const targetSize = targetShape.reduce((a, b) => a * b, 1);
    const target = this._makeFilledArray(targetShape, entry.dtype, entry.fill);

    if (source.shape.length === targetShape.length) {
      const exactShape = source.shape.every(
        (dim, idx) => dim === targetShape[idx]
      );
      if (exactShape) {
        if (entry.dtype === 'int64') return new BigInt64Array(source.data);
        if (entry.dtype === 'bool') return new Uint8Array(source.data);
        return new Float32Array(source.data);
      }
    }

    if (source.data.length === targetSize) {
      if (entry.dtype === 'int64') return new BigInt64Array(source.data);
      if (entry.dtype === 'bool') return new Uint8Array(source.data);
      return new Float32Array(source.data);
    }

    if (source.shape.length !== targetShape.length) return target;

    // Partial copy for mismatched shapes
    const strides = [];
    let stride = 1;
    for (let i = source.shape.length - 1; i >= 0; i--) {
      strides[i] = stride;
      stride *= source.shape[i];
    }

    const indices = new Array(source.shape.length).fill(0);
    const maxIndices = source.shape.map((dim, idx) =>
      Math.min(dim, targetShape[idx])
    );

    const targetIndex = (coords) => {
      let idx = 0;
      let tStride = 1;
      for (let i = targetShape.length - 1; i >= 0; i--) {
        idx += coords[i] * tStride;
        tStride *= targetShape[i];
      }
      return idx;
    };

    let done = false;
    while (!done) {
      let sourceIdx = 0;
      for (let i = 0; i < indices.length; i++) {
        sourceIdx += indices[i] * strides[i];
      }
      target[targetIndex(indices)] = source.data[sourceIdx];

      for (let dim = indices.length - 1; dim >= 0; dim--) {
        indices[dim] += 1;
        if (indices[dim] < maxIndices[dim]) break;
        indices[dim] = 0;
        if (dim === 0) done = true;
      }
    }

    return target;
  }

  _deriveStep(moduleState) {
    if (moduleState.step) {
      return {
        data: BigInt64Array.from([BigInt(moduleState.step.data[0])]),
        shape: [1],
        dtype: 'int64',
      };
    }
    if (moduleState.offset && !moduleState.end_offset) {
      return {
        data: BigInt64Array.from([BigInt(moduleState.offset.data[0])]),
        shape: [1],
        dtype: 'int64',
      };
    }
    if (moduleState.current_end) {
      return {
        data: BigInt64Array.from([BigInt(moduleState.current_end.shape[0])]),
        shape: [1],
        dtype: 'int64',
      };
    }
    return { data: BigInt64Array.from([0n]), shape: [1], dtype: 'int64' };
  }

  _stateFromVoiceRecord(record) {
    const grouped = this._groupVoiceRecordByModule(record);
    const state = this._initStateFromManifest(
      this._bundleMetadata.flow_lm_state_manifest
    );

    for (const entry of this._bundleMetadata.flow_lm_state_manifest) {
      const moduleState = grouped[entry.module] || {};
      let source = moduleState[entry.key];
      if (!source && entry.key === 'step') {
        source = this._deriveStep(moduleState);
      }
      if (!source) continue;

      const data = this._adaptTypedArray(source, entry);
      state[entry.input_name] = this._createTensor(
        entry.dtype,
        data,
        entry.shape
      );
    }

    return state;
  }

  _prepareVoiceEmbeddingData(voiceEmb) {
    let data = voiceEmb.data;
    let dims = voiceEmb.shape.slice();

    if (this._bundleMetadata.insert_bos_before_voice && this._bosBeforeVoice) {
      const bosData = this._bosBeforeVoice.data;
      const combined = new Float32Array(bosData.length + data.length);
      combined.set(bosData, 0);
      combined.set(data, bosData.length);
      data = combined;
      dims = [1, dims[1] + this._bosBeforeVoice.shape[1], dims[2]];
    }

    return this._createTensor('float32', data, dims);
  }

  async _buildVoiceConditionedState(voiceEmb) {
    const flowLmState = this._initStateFromManifest(
      this._bundleMetadata.flow_lm_state_manifest
    );
    const emptySeq = this._createTensor(
      'float32',
      new Float32Array(0),
      [1, 0, this._latentDim]
    );
    const voiceTensor = this._prepareVoiceEmbeddingData(voiceEmb);

    const result = await this._sessions.flowLmMain.run({
      sequence: emptySeq,
      text_embeddings: voiceTensor,
      ...flowLmState,
    });

    this._updateStateFromManifestOutputs(
      flowLmState,
      result,
      this._bundleMetadata.flow_lm_state_manifest
    );
    return flowLmState;
  }

  // ── Text Processing ──────────────────────────────────────────────

  _prepareTextPrompt(text) {
    let prompt = text.trim();
    if (!prompt) return { text: '', framesAfterEos: 1 };

    prompt = prompt.replace(/\r/g, ' ').replace(/\n/g, ' ').replace(/\s+/g, ' ');
    if (this._bundleMetadata.remove_semicolons) {
      prompt = prompt.replace(/;/g, ',');
    }

    const wordCount = prompt.split(/\s+/).filter(Boolean).length;
    let framesAfterEos = wordCount <= 4 ? 3 : 1;
    if (this._bundleMetadata.model_recommended_frames_after_eos != null) {
      framesAfterEos = Number(
        this._bundleMetadata.model_recommended_frames_after_eos
      );
    }

    if (prompt && !/[A-ZÀ-Þ]/.test(prompt[0])) {
      prompt = prompt[0].toUpperCase() + prompt.slice(1);
    }
    if (prompt && /[0-9A-Za-zÀ-ÿ]/.test(prompt[prompt.length - 1])) {
      prompt += '.';
    }
    if (
      this._bundleMetadata.pad_with_spaces_for_short_inputs &&
      wordCount < 5
    ) {
      prompt = '        ' + prompt;
    }

    return { text: prompt, framesAfterEos };
  }

  _splitTextIntoSentences(text) {
    const re = /[^.!?]+[.!?]+|[^.!?]+$/g;
    const matches = text.match(re);
    if (!matches) return [];
    return matches.map((s) => s.trim()).filter(Boolean);
  }

  _splitTokenIdsIntoChunks(tokenIds, maxTokens) {
    const chunks = [];
    for (let i = 0; i < tokenIds.length; i += maxTokens) {
      const chunkText = this._tokenizer
        .decodeIds(tokenIds.slice(i, i + maxTokens))
        .trim();
      if (chunkText) chunks.push(chunkText);
    }
    return chunks;
  }

  _splitIntoBestSentences(text) {
    const prepared = this._prepareTextPrompt(text);
    if (!prepared.text) {
      return { chunks: [], framesAfterEos: prepared.framesAfterEos };
    }

    const sentences = this._splitTextIntoSentences(prepared.text);
    if (!sentences.length) {
      return { chunks: [prepared.text], framesAfterEos: prepared.framesAfterEos };
    }

    const chunks = [];
    let currentChunk = '';

    for (const sentenceText of sentences) {
      const sentenceTokenIds = this._tokenizer.encodeIds(sentenceText);
      const sentenceTokens = sentenceTokenIds.length;

      if (sentenceTokens > this._maxTokenPerChunk) {
        if (currentChunk) {
          chunks.push(currentChunk.trim());
          currentChunk = '';
        }
        const splitChunks = this._splitTokenIdsIntoChunks(
          sentenceTokenIds,
          this._maxTokenPerChunk
        );
        for (const sc of splitChunks) {
          if (sc) chunks.push(sc.trim());
        }
        continue;
      }

      if (!currentChunk) {
        currentChunk = sentenceText;
        continue;
      }

      const combined = `${currentChunk} ${sentenceText}`;
      const combinedTokens = this._tokenizer.encodeIds(combined).length;
      if (combinedTokens > this._maxTokenPerChunk) {
        chunks.push(currentChunk.trim());
        currentChunk = sentenceText;
      } else {
        currentChunk = combined;
      }
    }

    if (currentChunk) chunks.push(currentChunk.trim());
    return { chunks, framesAfterEos: prepared.framesAfterEos };
  }

  // ── Flow Buffers ─────────────────────────────────────────────────

  _precomputeFlowBuffers() {
    this._stTensors = [];
    const dt = 1.0 / LSD_STEPS;
    for (let step = 0; step < LSD_STEPS; step++) {
      const s = step / LSD_STEPS;
      const t = s + dt;
      this._stTensors.push({
        s: this._createTensor('float32', new Float32Array([s]), [1, 1]),
        t: this._createTensor('float32', new Float32Array([t]), [1, 1]),
      });
    }
  }

  // ── Bundle URL Helpers ───────────────────────────────────────────

  _bundleDir(language) {
    return `${this.modelBasePath}/onnx/${language}`;
  }

  _bundlePath(language, filename) {
    return `${this._bundleDir(language)}/${filename}`;
  }

  // ── Session Management ───────────────────────────────────────────

  async _releaseSession(session) {
    if (session && typeof session.release === 'function') {
      await session.release();
    }
  }

  async _releaseSessions() {
    await Promise.all([
      this._releaseSession(this._sessions.mimiEncoder),
      this._releaseSession(this._sessions.textConditioner),
      this._releaseSession(this._sessions.flowLmMain),
      this._releaseSession(this._sessions.flowLmFlow),
      this._releaseSession(this._sessions.mimiDecoder),
    ]);
  }

  // ── Public API ───────────────────────────────────────────────────

  /**
   * Load a language bundle and all associated models.
   * @param {string} [language] - Language bundle name (default: 'english_2026-04').
   * @returns {Promise<void>}
   */
  async loadBundle(language = DEFAULT_LANGUAGE) {
    if (!LANGUAGE_BUNDLES.includes(language)) {
      throw new Error(`Unsupported language bundle: ${language}`);
    }

    await this._ensureOrt();
    this._precomputeFlowBuffers();

    this.emit('status', {
      status: `Loading ${language} bundle...`,
      state: 'loading',
    });

    this._currentLanguage = language;
    this._isReady = false;

    // Load bundle metadata
    const metaResponse = await fetch(this._bundlePath(language, 'bundle.json'));
    if (!metaResponse.ok) {
      throw new Error(`Failed to load bundle metadata for ${language}`);
    }
    this._bundleMetadata = await metaResponse.json();

    // Update parameters from metadata
    this._sampleRate = Number(this._bundleMetadata.sample_rate);
    this._samplesPerFrame = Number(this._bundleMetadata.samples_per_frame);
    this._latentDim = Number(this._bundleMetadata.latent_dim);
    this._conditioningDim = Number(this._bundleMetadata.conditioning_dim);
    this._maxTokenPerChunk = Number(
      this._bundleMetadata.max_token_per_chunk || 50
    );

    // Release existing sessions
    await this._releaseSessions();

    // Load all ONNX sessions in parallel
    const sessionOptions = {
      executionProviders: ['wasm'],
      graphOptimizationLevel: 'all',
    };

    const [encoder, textCond, flowMain, flowFlow, decoder] = await Promise.all([
      this.ort.InferenceSession.create(
        this._bundlePath(language, MODEL_STEMS.mimi_encoder),
        sessionOptions
      ),
      this.ort.InferenceSession.create(
        this._bundlePath(language, MODEL_STEMS.text_conditioner),
        sessionOptions
      ),
      this.ort.InferenceSession.create(
        this._bundlePath(language, MODEL_STEMS.flow_lm_main),
        sessionOptions
      ),
      this.ort.InferenceSession.create(
        this._bundlePath(language, MODEL_STEMS.flow_lm_flow),
        sessionOptions
      ),
      this.ort.InferenceSession.create(
        this._bundlePath(language, MODEL_STEMS.mimi_decoder),
        sessionOptions
      ),
    ]);

    this._sessions.mimiEncoder = encoder;
    this._sessions.textConditioner = textCond;
    this._sessions.flowLmMain = flowMain;
    this._sessions.flowLmFlow = flowFlow;
    this._sessions.mimiDecoder = decoder;

    // Load tokenizer
    const tokResponse = await fetch(
      this._bundlePath(language, this._bundleMetadata.tokenizer_file)
    );
    if (!tokResponse.ok) {
      throw new Error(`Failed to load tokenizer for ${language}`);
    }
    const tokBuf = await tokResponse.arrayBuffer();
    this._tokenizerModelB64 = btoa(
      String.fromCharCode(...new Uint8Array(tokBuf))
    );

    // Import SentencePiece — consumers must make sentencepiece.js reachable
    // or provide it via options. We'll try dynamic import first.
    if (!this._tokenizer) {
      const spModule = await this._loadSentencePiece();
      this._tokenizer = new spModule.SentencePieceProcessor();
    }
    await this._tokenizer.loadFromB64StringModel(this._tokenizerModelB64);

    // Load BOS before voice (optional)
    this._bosBeforeVoice = null;
    if (this._bundleMetadata.bos_before_voice_file) {
      const bosResponse = await fetch(
        this._bundlePath(language, this._bundleMetadata.bos_before_voice_file)
      );
      if (bosResponse.ok) {
        this._bosBeforeVoice = parseNpy(await bosResponse.arrayBuffer());
      }
    }

    // Load predefined voices
    this._predefinedVoiceRecords = {};
    const voicesResponse = await fetch(
      this._bundlePath(language, 'voices.bin')
    );
    if (voicesResponse.ok) {
      this._predefinedVoiceRecords = parseVoicesBin(
        await voicesResponse.arrayBuffer()
      );
    }

    // Clear voice cache for new bundle
    this._voiceConditioningCache = new Map();

    // Set default voice
    let defaultVoice = this._bundleMetadata.predefined_voices?.includes('alba')
      ? 'alba'
      : null;
    if (!defaultVoice) {
      defaultVoice = Object.keys(this._predefinedVoiceRecords)[0] || null;
    }
    this._currentVoiceName = defaultVoice;

    if (defaultVoice) {
      await this._cachePredefinedVoice(defaultVoice);
    }

    if (this._customVoiceEmbedding) {
      this._voiceConditioningCache.delete('custom');
    }

    this._isReady = true;

    this.emit('voices-loaded', {
      voices:
        this._bundleMetadata.predefined_voices ||
        Object.keys(this._predefinedVoiceRecords),
      defaultVoice,
      language,
    });
    this.emit('ready', { language, sampleRate: this._sampleRate });
    this.emit('status', { status: 'Ready', state: 'idle' });
  }

  /**
   * Load the SentencePiece module. Override this for custom loading.
   * @returns {Promise<{ SentencePieceProcessor: new() => any }>}
   */
  async _loadSentencePiece() {
    // Try global, then dynamic import from CDN
    if (typeof globalThis !== 'undefined' && globalThis.SentencePieceProcessor) {
      return { SentencePieceProcessor: globalThis.SentencePieceProcessor };
    }
    // CDN fallback
    return await import(
      'https://cdn.jsdelivr.net/npm/@nicedoc/sentencepiece@0.0.1/sentencepiece.js'
    );
  }

  /**
   * Get list of available predefined voices.
   * @returns {string[]}
   */
  getVoices() {
    return (
      this._bundleMetadata?.predefined_voices ||
      Object.keys(this._predefinedVoiceRecords)
    );
  }

  /**
   * Switch to a predefined voice by name.
   * @param {string} voiceName
   */
  async setVoice(voiceName) {
    if (this._isGenerating) {
      throw new Error('Cannot switch voice while generation is running.');
    }
    if (voiceName === 'custom') {
      await this._cacheCustomVoice();
    } else {
      await this._cachePredefinedVoice(voiceName);
    }
    this._currentVoiceName = voiceName;
    this.emit('voice-set', { voiceName });
  }

  /**
   * Encode audio into a voice embedding for cloning.
   * @param {Float32Array} audioData - Mono PCM at model sample rate (24kHz).
   * @returns {Promise<{ data: Float32Array, shape: number[] }>}
   */
  async encodeVoice(audioData) {
    if (this._isGenerating) {
      throw new Error('Cannot encode voice while generation is running.');
    }
    if (!this._isReady) {
      throw new Error('Engine not ready. Call loadBundle() first.');
    }

    const input = this._createTensor('float32', audioData, [
      1,
      1,
      audioData.length,
    ]);
    const outputs = await this._sessions.mimiEncoder.run({ audio: input });
    const embeddings =
      outputs[this._sessions.mimiEncoder.outputNames[0]];

    let dims = embeddings.dims.slice();
    let data = new Float32Array(embeddings.data);
    while (dims.length > 3) {
      if (dims[0] !== 1) break;
      dims = dims.slice(1);
    }
    if (dims.length < 3) {
      dims = [1, dims[0], dims[1]];
    }

    this._customVoiceEmbedding = { data, shape: dims };
    this._currentVoiceName = 'custom';
    await this._cacheCustomVoice(true);

    this.emit('voice-cloned', { voiceName: 'custom', shape: dims });
    return { data, shape: dims };
  }

  /**
   * Generate speech from text. Emits 'audio-chunk' events as audio is produced.
   * @param {string} text - Text to speak.
   * @param {object} [options]
   * @param {string} [options.voice] - Voice name override.
   * @param {number} [options.temperature=0.7] - Sampling temperature.
   * @returns {Promise<void>}
   */
  async generate(text, options = {}) {
    if (this._isGenerating) return;
    if (!this._isReady) {
      throw new Error('Engine not ready. Call loadBundle() first.');
    }

    const voiceName = options.voice || this._currentVoiceName;
    const temperature = options.temperature ?? TEMPERATURE;

    this._isGenerating = true;
    this.emit('status', { status: 'Generating...', state: 'running' });

    try {
      const { chunks, framesAfterEos } = this._splitIntoBestSentences(text);
      if (!chunks.length) throw new Error('No text to generate');

      if (voiceName === 'custom') {
        await this._cacheCustomVoice();
      } else {
        await this._cachePredefinedVoice(voiceName);
      }
      this._currentVoiceName = voiceName;

      await this._runGenerationPipeline(
        voiceName,
        chunks,
        framesAfterEos,
        temperature
      );
    } catch (err) {
      this.emit('error', { error: err.message || err.toString() });
    } finally {
      if (this._isGenerating) {
        this.emit('stream-end', {});
        this.emit('status', { status: 'Finished', state: 'idle' });
      }
      this._isGenerating = false;
    }
  }

  /**
   * Stop any ongoing generation.
   */
  stop() {
    this._isGenerating = false;
    this.emit('status', { status: 'Stopped', state: 'idle' });
  }

  /**
   * Release all ONNX sessions and free resources.
   */
  async destroy() {
    this.stop();
    await this._releaseSessions();
    this._sessions = {
      mimiEncoder: null,
      textConditioner: null,
      flowLmMain: null,
      flowLmFlow: null,
      mimiDecoder: null,
    };
    this._isReady = false;
    this._bundleMetadata = null;
    this._tokenizer = null;
    this._voiceConditioningCache.clear();
    this.removeAllListeners();
  }

  // ── Internal Voice Caching ───────────────────────────────────────

  async _cachePredefinedVoice(voiceName, force = false) {
    if (!this._predefinedVoiceRecords[voiceName]) {
      throw new Error(`Unknown built-in voice: ${voiceName}`);
    }
    if (!force && this._voiceConditioningCache.has(voiceName)) return;
    this.emit('status', {
      status: `Preparing voice (${voiceName})...`,
      state: 'loading',
    });
    const conditioned = this._stateFromVoiceRecord(
      this._predefinedVoiceRecords[voiceName]
    );
    this._voiceConditioningCache.set(voiceName, conditioned);
  }

  async _cacheCustomVoice(force = false) {
    if (!this._customVoiceEmbedding) {
      throw new Error('No custom voice loaded.');
    }
    if (!force && this._voiceConditioningCache.has('custom')) return;
    this.emit('status', {
      status: 'Preparing custom voice...',
      state: 'loading',
    });
    const conditioned = await this._buildVoiceConditionedState(
      this._customVoiceEmbedding
    );
    this._voiceConditioningCache.set('custom', conditioned);
  }

  // ── Generation Pipeline ──────────────────────────────────────────

  async _runGenerationPipeline(voiceName, chunks, framesAfterEos, temperature) {
    let mimiState = this._initStateFromManifest(
      this._bundleMetadata.mimi_state_manifest
    );
    const emptySeq = this._createTensor(
      'float32',
      new Float32Array(0),
      [1, 0, this._latentDim]
    );
    const emptyTextEmb = this._createTensor(
      'float32',
      new Float32Array(0),
      [1, 0, this._conditioningDim]
    );
    const baseFlowState = this._voiceConditioningCache.get(voiceName);
    if (!baseFlowState) {
      throw new Error(
        `Voice conditioning cache missing for '${voiceName}'.`
      );
    }
    let flowLmState = { ...baseFlowState };

    const firstChunkFrames = 3;
    const normalChunkFrames = 12;
    const allGeneratedLatents = [];
    let isFirstAudioChunk = true;
    let totalFlowLmTime = 0;
    let totalDecodeTime = 0;
    const generationStart = performance.now();

    for (let chunkIdx = 0; chunkIdx < chunks.length; chunkIdx++) {
      if (!this._isGenerating) break;

      // Reset state per chunk (matches pocket-voice defaults)
      if (chunkIdx > 0) {
        flowLmState = { ...baseFlowState };
        mimiState = this._initStateFromManifest(
          this._bundleMetadata.mimi_state_manifest
        );
      }

      const chunkText = chunks[chunkIdx];
      let isFirstAudioChunkOfTextChunk = true;
      const tokenIds = this._tokenizer.encodeIds(chunkText);
      const textInput = this._createTensor(
        'int64',
        BigInt64Array.from(tokenIds.map((t) => BigInt(t))),
        [1, tokenIds.length]
      );

      let textEmb = (
        await this._sessions.textConditioner.run({ token_ids: textInput })
      )[this._sessions.textConditioner.outputNames[0]];
      if (textEmb.dims.length === 2) {
        textEmb = this._createTensor(
          'float32',
          new Float32Array(textEmb.data),
          [1, textEmb.dims[0], textEmb.dims[1]]
        );
      }

      const condResult = await this._sessions.flowLmMain.run({
        sequence: emptySeq,
        text_embeddings: textEmb,
        ...flowLmState,
      });
      this._updateStateFromManifestOutputs(
        flowLmState,
        condResult,
        this._bundleMetadata.flow_lm_state_manifest
      );

      const chunkLatents = [];
      let chunkDecodedFrames = 0;
      let currentLatent = this._createTensor(
        'float32',
        new Float32Array(this._latentDim).fill(NaN),
        [1, 1, this._latentDim]
      );
      let eosStep = null;
      let chunkEnded = false;
      let chunkGenTimeMs = 0;

      for (let step = 0; step < MAX_FRAMES; step++) {
        if (!this._isGenerating) break;
        if (step > 0 && step % 4 === 0) {
          await new Promise((resolve) => setTimeout(resolve, 0));
        }

        const stepStart = performance.now();
        const arResult = await this._sessions.flowLmMain.run({
          sequence: currentLatent,
          text_embeddings: emptyTextEmb,
          ...flowLmState,
        });
        const stepElapsed = performance.now() - stepStart;
        chunkGenTimeMs += stepElapsed;
        totalFlowLmTime += stepElapsed;

        const conditioning = arResult.conditioning;
        const eosLogit = arResult.eos_logit.data[0];
        const isEos = eosLogit > -4.0;
        if (isEos && eosStep == null) eosStep = step;
        const shouldStop =
          eosStep != null && step >= eosStep + framesAfterEos;

        // Sample latent noise
        const std = Math.sqrt(temperature);
        const latentData = new Float32Array(this._latentDim);
        for (let i = 0; i < this._latentDim; i++) {
          let u = 0;
          let v = 0;
          while (u === 0) u = Math.random();
          while (v === 0) v = Math.random();
          latentData[i] =
            Math.sqrt(-2.0 * Math.log(u)) *
            Math.cos(2.0 * Math.PI * v) *
            std;
        }

        // Flow matching (Euler steps)
        const dt = 1.0 / LSD_STEPS;
        for (let lsdIndex = 0; lsdIndex < LSD_STEPS; lsdIndex++) {
          const flowResult = await this._sessions.flowLmFlow.run({
            c: conditioning,
            s: this._stTensors[lsdIndex].s,
            t: this._stTensors[lsdIndex].t,
            x: this._createTensor('float32', latentData, [
              1,
              this._latentDim,
            ]),
          });
          const flowDir = flowResult.flow_dir.data;
          for (let i = 0; i < this._latentDim; i++) {
            latentData[i] += flowDir[i] * dt;
          }
        }

        chunkLatents.push(new Float32Array(latentData));
        allGeneratedLatents.push(new Float32Array(latentData));
        currentLatent = this._createTensor('float32', latentData, [
          1,
          1,
          this._latentDim,
        ]);
        this._updateStateFromManifestOutputs(
          flowLmState,
          arResult,
          this._bundleMetadata.flow_lm_state_manifest
        );

        // Determine decode batch size
        const pending = chunkLatents.length - chunkDecodedFrames;
        let decodeSize = 0;
        if (shouldStop) {
          decodeSize = pending;
        } else if (isFirstAudioChunk && pending >= firstChunkFrames) {
          decodeSize = firstChunkFrames;
        } else if (pending >= normalChunkFrames) {
          decodeSize = normalChunkFrames;
        }

        if (decodeSize > 0) {
          const decodeLatents = new Float32Array(
            decodeSize * this._latentDim
          );
          for (let frame = 0; frame < decodeSize; frame++) {
            decodeLatents.set(
              chunkLatents[chunkDecodedFrames + frame],
              frame * this._latentDim
            );
          }

          const decoderStart = performance.now();
          const decodeResult = await this._sessions.mimiDecoder.run({
            latent: this._createTensor('float32', decodeLatents, [
              1,
              decodeSize,
              this._latentDim,
            ]),
            ...mimiState,
          });
          const decoderElapsed = performance.now() - decoderStart;
          chunkGenTimeMs += decoderElapsed;
          totalDecodeTime += decoderElapsed;

          for (const entry of this._bundleMetadata.mimi_state_manifest) {
            mimiState[entry.input_name] = decodeResult[entry.output_name];
          }

          chunkDecodedFrames += decodeSize;
          const audioFloat32 = new Float32Array(
            decodeResult[this._sessions.mimiDecoder.outputNames[0]].data
          );
          const isLastChunk =
            shouldStop && chunkIdx === chunks.length - 1;

          this.emit('audio-chunk', {
            data: audioFloat32,
            sampleRate: this._sampleRate,
            metrics: {
              chunkDuration: audioFloat32.length / this._sampleRate,
              genTimeSec: chunkGenTimeMs / 1000,
              isFirst: isFirstAudioChunk,
              isLast: isLastChunk,
              chunkStart: isFirstAudioChunkOfTextChunk,
            },
          });

          isFirstAudioChunk = false;
          isFirstAudioChunkOfTextChunk = false;
          chunkGenTimeMs = 0;
        }

        if (shouldStop) {
          chunkEnded = true;
          break;
        }
      }

      // Insert silence between text chunks
      if (
        chunkEnded &&
        this._isGenerating &&
        chunkIdx < chunks.length - 1
      ) {
        const gapSamples = Math.max(
          1,
          Math.floor(CHUNK_GAP_SEC * this._sampleRate)
        );
        const silence = new Float32Array(gapSamples);
        this.emit('audio-chunk', {
          data: silence,
          sampleRate: this._sampleRate,
          metrics: {
            chunkDuration: gapSamples / this._sampleRate,
            isFirst: false,
            isLast: false,
            isSilence: true,
          },
        });
      }
    }

    const totalTime = (performance.now() - generationStart) / 1000;
    const audioSeconds =
      (allGeneratedLatents.length * this._samplesPerFrame) / this._sampleRate;
    const genTime = (totalFlowLmTime + totalDecodeTime) / 1000;
    const rtfx = genTime > 0 ? audioSeconds / genTime : 0;

    this.emit('status', {
      status: `Finished (RTFx: ${rtfx.toFixed(2)}x)`,
      state: 'idle',
      metrics: { rtfx, genTime, totalTime, audioDuration: audioSeconds },
    });
  }
}
