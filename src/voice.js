/**
 * Voice — the thing clone() returns. Speak, stream, stop.
 */

import { EventEmitter } from './event-emitter.js';
import { encodeWav } from './utils.js';

export class Voice extends EventEmitter {
  constructor(engine, voiceName, sampleRate) {
    super();
    this._engine = engine;
    this._voiceName = voiceName;
    this._sampleRate = sampleRate;
    engine.on('audio-chunk', (data) => this.emit('chunk', data.data));
    engine.on('stream-end', () => this.emit('end'));
    engine.on('error', (data) => this.emit('error', data));
  }

  /** Generate speech, return WAV ArrayBuffer. */
  async speak(text, opts = {}) {
    const chunks = [];
    const onChunk = (pcm) => chunks.push(pcm);
    this.on('chunk', onChunk);

    try {
      await this._engine.generate(text, { voice: this._voiceName, ...opts });
    } finally {
      this.off('chunk', onChunk);
    }

    const total = chunks.reduce((n, c) => n + c.length, 0);
    const audio = new Float32Array(total);
    let offset = 0;
    for (const c of chunks) { audio.set(c, offset); offset += c.length; }
    return encodeWav(audio, this._sampleRate);
  }

  /** Stream speech — listen to 'chunk' events for Float32Array PCM. */
  async stream(text, opts = {}) {
    return this._engine.generate(text, { voice: this._voiceName, ...opts });
  }

  /** Stop generation. */
  stop() { this._engine.stop(); }
}
