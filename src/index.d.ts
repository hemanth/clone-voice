// Type declarations for voice-clone

// ── Events ──────────────────────────────────────────────────────────

export interface AudioChunkEvent {
  data: Float32Array;
  sampleRate: number;
  metrics: {
    chunkDuration: number;
    genTimeSec: number;
    isFirst: boolean;
    isLast: boolean;
    chunkStart: boolean;
    isSilence?: boolean;
  };
}

export interface StatusEvent {
  status: string;
  state: 'idle' | 'loading' | 'running';
  metrics?: {
    rtfx: number;
    genTime: number;
    totalTime: number;
    audioDuration: number;
  };
}

export interface VoicesLoadedEvent {
  voices: string[];
  defaultVoice: string | null;
  language: string;
}

export interface VoiceClonedEvent {
  voiceName: string;
  shape: number[];
}

export interface VoiceSetEvent {
  voiceName: string;
}

export interface ReadyEvent {
  language: string;
  sampleRate: number;
}

export interface ErrorEvent {
  error: string;
}

export interface VoiceEmbedding {
  data: Float32Array;
  shape: number[];
}

// ── EventEmitter ────────────────────────────────────────────────────

export class EventEmitter {
  on(event: string, listener: (data: any) => void, options?: { once?: boolean }): this;
  once(event: string, listener: (data: any) => void): this;
  off(event: string, listener: (data: any) => void): this;
  emit(event: string, data?: any): void;
  removeAllListeners(event?: string): this;
}

// ── VoiceCloneEngine ────────────────────────────────────────────────

export interface EngineOptions {
  modelBasePath?: string;
  ort?: any;
}

export class VoiceCloneEngine extends EventEmitter {
  constructor(options?: EngineOptions);

  readonly isReady: boolean;
  readonly isGenerating: boolean;
  readonly sampleRate: number;
  readonly language: string | null;
  readonly currentVoice: string | null;

  setOrt(ortModule: any): void;
  loadBundle(language?: string): Promise<void>;
  getVoices(): string[];
  setVoice(voiceName: string): Promise<void>;
  encodeVoice(audioData: Float32Array): Promise<VoiceEmbedding>;
  generate(text: string, options?: GenerateOptions): Promise<void>;
  stop(): void;
  destroy(): Promise<void>;

  on(event: 'ready', listener: (data: ReadyEvent) => void): this;
  on(event: 'voices-loaded', listener: (data: VoicesLoadedEvent) => void): this;
  on(event: 'voice-cloned', listener: (data: VoiceClonedEvent) => void): this;
  on(event: 'voice-set', listener: (data: VoiceSetEvent) => void): this;
  on(event: 'audio-chunk', listener: (data: AudioChunkEvent) => void): this;
  on(event: 'stream-end', listener: (data: {}) => void): this;
  on(event: 'error', listener: (data: ErrorEvent) => void): this;
  on(event: 'status', listener: (data: StatusEvent) => void): this;
}

export interface VoiceCloneOptions {
  language?: string;
  modelBasePath?: string;
  sampleRate?: number;
  ort?: any;
}

export interface GenerateOptions {
  voice?: string;
  temperature?: number;
}



export class VoiceClone extends EventEmitter {
  constructor(options?: VoiceCloneOptions);

  readonly engine: VoiceCloneEngine;
  readonly isReady: boolean;
  readonly isGenerating: boolean;
  readonly sampleRate: number;
  readonly language: string | null;

  cloneVoice(input: string | Float32Array | ArrayBuffer | Blob): Promise<VoiceEmbedding>;
  generate(text: string, options?: GenerateOptions): Promise<void>;
  speak(text: string, options?: GenerateOptions): Promise<ArrayBuffer>;
  stop(): void;
  setLanguage(language: string): Promise<void>;
  setVoice(voiceName: string): Promise<void>;
  getVoices(): Promise<string[]>;
  destroy(): Promise<void>;

  on(event: 'ready', listener: (data: ReadyEvent) => void): this;
  on(event: 'voices-loaded', listener: (data: VoicesLoadedEvent) => void): this;
  on(event: 'voice-cloned', listener: (data: VoiceClonedEvent) => void): this;
  on(event: 'voice-set', listener: (data: VoiceSetEvent) => void): this;
  on(event: 'audio-chunk', listener: (data: AudioChunkEvent) => void): this;
  on(event: 'stream-end', listener: (data: {}) => void): this;
  on(event: 'error', listener: (data: ErrorEvent) => void): this;
  on(event: 'status', listener: (data: StatusEvent) => void): this;
}

// ── PCMPlayer ───────────────────────────────────────────────────────

export interface PCMPlayerOptions {
  minBufferBeforePlaybackMs?: number;
}

export interface PlaybackStatus {
  currentTime: number;
  scheduledTime: number;
  bufferedDuration: number;
  state: string;
  worklet: {
    bufferLevelSamples: number;
    bufferLevelMs: number;
    underruns: number;
    chunksPlayed: number;
    pendingChunks: number;
  };
}

export class PCMPlayer extends EventEmitter {
  constructor(audioContext: AudioContext, options?: PCMPlayerOptions);

  readonly isInitialized: boolean;
  playbackTime: number;
  volume: number;
  metrics: {
    chunksPlayed: number;
    underruns: number;
    bufferLevel: number;
    samplesPlayed: number;
  };

  ready(): Promise<void>;
  play(data: Float32Array | Int16Array): void;
  notifyStreamEnded(): void;
  reset(): void;
  resume(): Promise<void>;
  getAnalyserData(): Uint8Array;
  getTimeDomainData(): Uint8Array;
  getPlaybackStatus(): PlaybackStatus;

  on(event: 'playback-started', listener: (data: { startTime: number; bufferedSamples: number }) => void): this;
  on(event: 'playback-complete', listener: (data: { endTime: number }) => void): this;
  on(event: 'audio-started', listener: (data: { startTime: number; duration: number; samples: number }) => void): this;
  on(event: 'volume-change', listener: (data: { volume: number }) => void): this;
}
// ── Top-level functions (shared singleton) ──────────────────────────

export function cloneVoice(input: string | Float32Array | ArrayBuffer | Blob): Promise<VoiceEmbedding>;
export function generate(text: string, options?: GenerateOptions): Promise<void>;
export function speak(text: string, options?: GenerateOptions): Promise<ArrayBuffer>;
export function setLanguage(language: string): Promise<void>;
export function setVoice(voiceName: string): Promise<void>;
export function getVoices(): Promise<string[]>;
export function stop(): void;
export function on(event: string, listener: (data: any) => void): () => void;
export function off(event: string, listener: (data: any) => void): void;
export function getInstance(options?: VoiceCloneOptions): VoiceClone;

// ── Mic Recording ───────────────────────────────────────────────────

export interface RecordMicOptions {
  duration?: number;
  onStart?: () => void;
  onTick?: (elapsedSeconds: number) => void;
  signal?: AbortSignal;
}

export function recordMic(options?: RecordMicOptions): Promise<ArrayBuffer>;

// ── Utilities ───────────────────────────────────────────────────────

export function encodeWav(samples: Float32Array, sampleRate?: number): ArrayBuffer;
export function resampleLinear(samples: Float32Array, fromRate: number, toRate: number): Float32Array;
export function decodeAudio(input: ArrayBuffer | Blob, targetRate?: number): Promise<Float32Array>;
export function parseNpy(buffer: ArrayBuffer): { data: Float32Array; shape: number[] };
export function parseVoicesBin(buffer: ArrayBuffer): Record<string, Record<string, { data: Float32Array | BigInt64Array | Uint8Array; shape: number[]; dtype: string }>>;

// ── Constants ───────────────────────────────────────────────────────

export const SAMPLE_RATE: number;
export const LATENT_DIM: number;
export const CONDITIONING_DIM: number;
export const SAMPLES_PER_FRAME: number;
export const MAX_FRAMES: number;
export const LSD_STEPS: number;
export const TEMPERATURE: number;
export const MODEL_STEMS: Record<string, string>;
export const LANGUAGE_BUNDLES: string[];
export const DEFAULT_LANGUAGE: string;
export const HF_CDN_BASE: string;
