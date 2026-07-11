/**
 * PCMPlayer — AudioWorklet-based streaming PCM player.
 *
 * Uses a ring-buffer AudioWorklet processor with backpressure for smooth,
 * glitch-free streaming playback. Browser-only — import this only in
 * browser environments.
 */

import { EventEmitter } from './event-emitter.js';

export class PCMPlayer extends EventEmitter {
  /**
   * @param {AudioContext} audioContext
   * @param {object} [options]
   * @param {number} [options.minBufferBeforePlaybackMs=300] - Min buffer before playback starts.
   */
  constructor(audioContext, options = {}) {
    super();
    this.audioContext = audioContext;
    this.options = options;
    this.workletNode = null;
    this.isInitialized = false;
    this.playbackTime = 0;

    this.gainNode = this.audioContext.createGain();
    this.gainNode.connect(this.audioContext.destination);
    this.analyser = this.audioContext.createAnalyser();
    this.gainNode.connect(this.analyser);

    this._pendingChunks = [];
    this._availableCapacity = 0;
    this._isWorkletReady = false;
    this._hasReceivedInitialCapacity = false;
    this._pendingStreamEnd = false;

    this.metrics = {
      chunksPlayed: 0,
      underruns: 0,
      bufferLevel: 0,
      samplesPlayed: 0,
    };

    this._initPromise = this._initialize();
  }

  /** Wait for the worklet to be ready. */
  async ready() {
    return this._initPromise;
  }

  async _initialize() {
    if (this.isInitialized) return;

    const sampleRate = this.audioContext.sampleRate;
    const minBufferMs = this.options.minBufferBeforePlaybackMs || 300;
    const minBufferSamples = Math.floor((minBufferMs * sampleRate) / 1000);
    const bufferSizeSamples = sampleRate * 60;

    const processorCode = `
      class PCMProcessor extends AudioWorkletProcessor {
        constructor() {
          super();
          this.bufferSize = ${bufferSizeSamples};
          this.ringBuffer = new Float32Array(this.bufferSize);
          this.readPos = 0;
          this.writePos = 0;
          this.isPlaying = false;
          this.minBufferSamples = ${minBufferSamples};
          this.targetBufferSamples = ${minBufferSamples * 2};
          this.streamEnded = false;
          this.playbackCompleteReported = false;
          this.frameCount = 0;
          this.reportInterval = 256;

          this.port.onmessage = (e) => {
            switch(e.data.type) {
              case 'audio': this.addAudio(e.data.data); break;
              case 'reset': this.reset(); break;
              case 'stream-ended': this.streamEnded = true; break;
            }
          };
          this.sendCapacityUpdate();
        }

        addAudio(float32Data) {
          const samples = float32Data.length;
          const available = this.getAvailableSpace();
          if (samples > available) {
            const overflow = samples - available;
            this.readPos = (this.readPos + overflow) % this.bufferSize;
          }
          if (this.writePos + samples <= this.bufferSize) {
            this.ringBuffer.set(float32Data, this.writePos);
            this.writePos += samples;
            if (this.writePos >= this.bufferSize) this.writePos = 0;
          } else {
            const firstPart = this.bufferSize - this.writePos;
            const secondPart = samples - firstPart;
            this.ringBuffer.set(float32Data.slice(0, firstPart), this.writePos);
            this.ringBuffer.set(float32Data.slice(firstPart), 0);
            this.writePos = secondPart;
          }
          const buffered = this.getBufferedSamples();
          if (!this.isPlaying && buffered >= this.minBufferSamples) {
            this.isPlaying = true;
            this.port.postMessage({ type: 'playback-started', buffered, audioTime: currentTime });
          }
          this.sendCapacityUpdate();
        }

        getAvailableSpace() {
          return this.bufferSize - this.getBufferedSamples() - 128;
        }

        getBufferedSamples() {
          return this.writePos >= this.readPos
            ? this.writePos - this.readPos
            : this.bufferSize - this.readPos + this.writePos;
        }

        sendCapacityUpdate() {
          const buffered = this.getBufferedSamples();
          const capacity = this.getAvailableSpace();
          let requestSamples = 0;
          if (buffered < this.targetBufferSamples) {
            requestSamples = Math.min(capacity, this.targetBufferSamples - buffered);
          }
          this.port.postMessage({ type: 'capacity', buffered, capacity, requestSamples, isPlaying: this.isPlaying });
        }

        process(inputs, outputs) {
          const output = outputs[0];
          if (!output || !output[0]) return true;
          const outputChannel = output[0];
          const numSamples = outputChannel.length;
          if (++this.frameCount % this.reportInterval === 0) this.sendCapacityUpdate();
          if (!this.isPlaying) { outputChannel.fill(0); return true; }
          const buffered = this.getBufferedSamples();
          if (buffered < numSamples) {
            let samplesRead = 0;
            if (buffered > 0) {
              if (this.readPos + buffered <= this.bufferSize) {
                for (let i = 0; i < buffered; i++) outputChannel[i] = this.ringBuffer[this.readPos + i];
                this.readPos += buffered;
                if (this.readPos >= this.bufferSize) this.readPos = 0;
              } else {
                const fp = this.bufferSize - this.readPos;
                const sp = buffered - fp;
                for (let i = 0; i < fp; i++) outputChannel[i] = this.ringBuffer[this.readPos + i];
                for (let i = 0; i < sp; i++) outputChannel[fp + i] = this.ringBuffer[i];
                this.readPos = sp;
              }
              samplesRead = buffered;
            }
            for (let i = samplesRead; i < numSamples; i++) outputChannel[i] = 0;
            if (this.streamEnded && buffered === 0) {
              if (!this.playbackCompleteReported) {
                this.port.postMessage({ type: 'playback-complete' });
                this.playbackCompleteReported = true;
              }
              this.isPlaying = false;
              this.streamEnded = false;
            } else {
              this.port.postMessage({ type: 'underrun', buffered, needed: numSamples });
              this.sendCapacityUpdate();
            }
          } else {
            if (this.readPos + numSamples <= this.bufferSize) {
              for (let i = 0; i < numSamples; i++) outputChannel[i] = this.ringBuffer[this.readPos + i];
              this.readPos += numSamples;
              if (this.readPos >= this.bufferSize) this.readPos = 0;
            } else {
              const fp = this.bufferSize - this.readPos;
              const sp = numSamples - fp;
              for (let i = 0; i < fp; i++) outputChannel[i] = this.ringBuffer[this.readPos + i];
              for (let i = 0; i < sp; i++) outputChannel[fp + i] = this.ringBuffer[i];
              this.readPos = sp;
            }
          }
          return true;
        }

        reset() {
          this.readPos = 0;
          this.writePos = 0;
          this.ringBuffer.fill(0);
          this.isPlaying = false;
          this.streamEnded = false;
          this.playbackCompleteReported = false;
          this.sendCapacityUpdate();
        }
      }
      registerProcessor('pcm-processor', PCMProcessor);
    `;

    const blob = new Blob([processorCode], { type: 'application/javascript' });
    const workletUrl = URL.createObjectURL(blob);
    await this.audioContext.audioWorklet.addModule(workletUrl);
    URL.revokeObjectURL(workletUrl);

    this.workletNode = new AudioWorkletNode(
      this.audioContext,
      'pcm-processor'
    );
    this.workletNode.connect(this.gainNode);

    this.workletNode.port.onmessage = (e) => {
      switch (e.data.type) {
        case 'capacity':
          this._handleCapacityUpdate(e.data);
          break;
        case 'underrun':
          this.metrics.underruns++;
          this._processPendingChunks();
          break;
        case 'playback-started':
          this.emit('playback-started', {
            startTime: this.audioContext.currentTime,
            bufferedSamples: e.data.buffered,
          });
          break;
        case 'playback-complete':
          this.emit('playback-complete', {
            endTime: this.audioContext.currentTime,
          });
          break;
      }
    };

    this.isInitialized = true;
    this._isWorkletReady = true;
  }

  _handleCapacityUpdate(data) {
    this._availableCapacity = data.capacity;
    this.metrics.bufferLevel = data.buffered;
    if (!this._hasReceivedInitialCapacity) {
      this._hasReceivedInitialCapacity = true;
      if (this._pendingChunks.length > 0) this._processPendingChunks();
    }
    if (data.requestSamples > 0 && this._pendingChunks.length > 0) {
      this._processPendingChunks();
    }
  }

  _processPendingChunks() {
    if (
      !this._isWorkletReady ||
      this._pendingChunks.length === 0 ||
      this._availableCapacity <= 0
    )
      return;

    const chunk = this._pendingChunks[0];
    if (chunk.length <= this._availableCapacity) {
      this._pendingChunks.shift();
      this.workletNode.port.postMessage({ type: 'audio', data: chunk });
      this._availableCapacity = 0;
    } else if (this._availableCapacity > 4096) {
      const partial = chunk.slice(0, this._availableCapacity);
      this._pendingChunks[0] = chunk.slice(this._availableCapacity);
      this.workletNode.port.postMessage({ type: 'audio', data: partial });
      this._availableCapacity = 0;
    }
    if (this._pendingChunks.length === 0 && this._pendingStreamEnd) {
      this.workletNode.port.postMessage({ type: 'stream-ended' });
      this._pendingStreamEnd = false;
    }
  }

  /**
   * Feed PCM audio data to the player.
   * @param {Float32Array | Int16Array} data
   */
  play(data) {
    if (!this.isInitialized) {
      if (!this._initPendingQueue) {
        this._initPendingQueue = [];
        this._initPromise.then(() => {
          const queue = this._initPendingQueue;
          this._initPendingQueue = null;
          for (const d of queue) this.play(d);
        });
      }
      this._initPendingQueue.push(data);
      return;
    }
    if (this.audioContext.state !== 'running') return;
    const float32 =
      data instanceof Int16Array ? this._pcm16ToFloat32(data) : data;
    this._pendingChunks.push(float32);
    if (this._hasReceivedInitialCapacity && this._availableCapacity > 0) {
      this._processPendingChunks();
    }
    this.metrics.chunksPlayed++;
    const duration = float32.length / this.audioContext.sampleRate;
    this.playbackTime = this.audioContext.currentTime + duration;
    this.emit('audio-started', {
      startTime: this.audioContext.currentTime,
      duration,
      samples: float32.length,
    });
  }

  /**
   * Notify the player that the stream has ended.
   */
  notifyStreamEnded() {
    if (this._pendingChunks.length > 0) {
      this._pendingStreamEnd = true;
    } else if (this.workletNode) {
      this.workletNode.port.postMessage({ type: 'stream-ended' });
    }
  }

  _pcm16ToFloat32(pcm16) {
    const float32 = new Float32Array(pcm16.length);
    for (let i = 0; i < pcm16.length; i++) float32[i] = pcm16[i] / 32768;
    return float32;
  }

  /**
   * Reset the player (clear buffer, stop playback).
   */
  reset() {
    this.playbackTime = 0;
    this._pendingChunks = [];
    this._pendingStreamEnd = false;
    this._availableCapacity = 0;
    if (this.workletNode) {
      this.workletNode.port.postMessage({ type: 'reset' });
    }
    if (this.gainNode) {
      const now = this.audioContext.currentTime;
      this.gainNode.gain.setValueAtTime(this.gainNode.gain.value, now);
      this.gainNode.gain.linearRampToValueAtTime(0, now + 0.05);
      setTimeout(() => {
        this.gainNode.gain.value = 1;
      }, 100);
    }
  }

  /** Resume a suspended audio context. */
  async resume() {
    if (this.audioContext.state === 'suspended') {
      await this.audioContext.resume();
    }
  }

  /** Get/set volume (0-1). */
  get volume() {
    return this.gainNode.gain.value;
  }

  set volume(value) {
    const v = Math.max(0, Math.min(1, value));
    this.gainNode.gain.value = v;
    this.emit('volume-change', { volume: v });
  }

  /**
   * Get frequency domain analyser data.
   * @returns {Uint8Array}
   */
  getAnalyserData() {
    const bufferLength = this.analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);
    this.analyser.getByteFrequencyData(dataArray);
    return dataArray;
  }

  /**
   * Get time domain waveform data.
   * @returns {Uint8Array}
   */
  getTimeDomainData() {
    const bufferLength = this.analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);
    this.analyser.getByteTimeDomainData(dataArray);
    return dataArray;
  }

  /**
   * Get current playback status.
   */
  getPlaybackStatus() {
    const bufferMs = this.metrics.bufferLevel
      ? (this.metrics.bufferLevel / this.audioContext.sampleRate) * 1000
      : 0;
    return {
      currentTime: this.audioContext.currentTime,
      scheduledTime: this.playbackTime,
      bufferedDuration: bufferMs / 1000,
      state: this.audioContext.state,
      worklet: {
        bufferLevelSamples: this.metrics.bufferLevel,
        bufferLevelMs: bufferMs,
        underruns: this.metrics.underruns,
        chunksPlayed: this.metrics.chunksPlayed,
        pendingChunks: this._pendingChunks.length,
      },
    };
  }
}
