import { EventEmitter } from './event-emitter.js';

// ── Voice ───────────────────────────────────────────────────────────

export class Voice extends EventEmitter {
  speak(text: string, opts?: { temp?: number }): Promise<ArrayBuffer>;
  stream(text: string, opts?: { temp?: number }): Promise<void>;
  stop(): void;

  on(event: 'chunk', listener: (pcm: Float32Array) => void): this;
  on(event: 'end', listener: () => void): this;
  on(event: 'error', listener: (err: any) => void): this;
}

// ── clone() ─────────────────────────────────────────────────────────

interface CloneOptions {
  lang?: string;
  modelBasePath?: string;
  ort?: any;
}

interface CloneFn {
  (input: string | ArrayBuffer | Blob | Float32Array, opts?: CloneOptions): Promise<Voice>;
  mic(duration?: number, opts?: CloneOptions): Promise<Voice>;
}

declare const clone: CloneFn;
export default clone;

// ── Re-exports ──────────────────────────────────────────────────────

export { VoiceCloneEngine } from './engine.js';
export { PCMPlayer } from './pcm-player.js';
export { EventEmitter } from './event-emitter.js';
export function recordMic(opts?: { duration?: number; onStart?: () => void; onTick?: (s: number) => void; signal?: AbortSignal }): Promise<ArrayBuffer>;
export function encodeWav(samples: Float32Array, sampleRate?: number): ArrayBuffer;
export function resampleLinear(samples: Float32Array, fromRate: number, toRate: number): Float32Array;
export function decodeAudio(input: ArrayBuffer | Blob, targetRate?: number): Promise<Float32Array>;
export const SAMPLE_RATE: number;
export const LANGUAGE_BUNDLES: string[];
export const DEFAULT_LANGUAGE: string;
