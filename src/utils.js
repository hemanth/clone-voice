/**
 * Utility functions for audio processing and format conversion.
 */

/**
 * Encode Float32 PCM samples into a WAV buffer.
 * @param {Float32Array} samples - Mono PCM samples in [-1, 1] range.
 * @param {number} [sampleRate=24000] - Sample rate in Hz.
 * @returns {ArrayBuffer} WAV file as an ArrayBuffer.
 */
export function encodeWav(samples, sampleRate = 24000) {
  const numChannels = 1;
  const bitsPerSample = 16;
  const bytesPerSample = bitsPerSample / 8;
  const blockAlign = numChannels * bytesPerSample;
  const dataSize = samples.length * blockAlign;
  const bufferSize = 44 + dataSize;
  const buffer = new ArrayBuffer(bufferSize);
  const view = new DataView(buffer);

  // RIFF header
  writeString(view, 0, 'RIFF');
  view.setUint32(4, bufferSize - 8, true);
  writeString(view, 8, 'WAVE');

  // fmt chunk
  writeString(view, 12, 'fmt ');
  view.setUint32(16, 16, true); // chunk size
  view.setUint16(20, 1, true); // PCM format
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true); // byte rate
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitsPerSample, true);

  // data chunk
  writeString(view, 36, 'data');
  view.setUint32(40, dataSize, true);

  // PCM data (float32 -> int16)
  let offset = 44;
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    const val = s < 0 ? s * 0x8000 : s * 0x7fff;
    view.setInt16(offset, val, true);
    offset += 2;
  }

  return buffer;
}

/**
 * Write an ASCII string into a DataView.
 * @param {DataView} view
 * @param {number} offset
 * @param {string} str
 */
function writeString(view, offset, str) {
  for (let i = 0; i < str.length; i++) {
    view.setUint8(offset + i, str.charCodeAt(i));
  }
}

/**
 * Resample an audio buffer to a target sample rate using linear interpolation.
 * @param {Float32Array} samples - Source samples.
 * @param {number} fromRate - Source sample rate.
 * @param {number} toRate - Target sample rate.
 * @returns {Float32Array} Resampled samples.
 */
export function resampleLinear(samples, fromRate, toRate) {
  if (fromRate === toRate) return new Float32Array(samples);
  const ratio = fromRate / toRate;
  const newLength = Math.round(samples.length / ratio);
  const result = new Float32Array(newLength);
  for (let i = 0; i < newLength; i++) {
    const srcIndex = i * ratio;
    const lo = Math.floor(srcIndex);
    const hi = Math.min(lo + 1, samples.length - 1);
    const frac = srcIndex - lo;
    result[i] = samples[lo] * (1 - frac) + samples[hi] * frac;
  }
  return result;
}

/**
 * Convert an ArrayBuffer or Blob to Float32Array PCM at the given sample rate.
 * Works in browser environments using OfflineAudioContext.
 * @param {ArrayBuffer | Blob} input
 * @param {number} [targetRate=24000]
 * @returns {Promise<Float32Array>}
 */
export async function decodeAudio(input, targetRate = 24000) {
  let arrayBuffer;
  if (input instanceof Blob) {
    arrayBuffer = await input.arrayBuffer();
  } else if (input instanceof ArrayBuffer) {
    arrayBuffer = input;
  } else {
    throw new TypeError(
      'decodeAudio expects an ArrayBuffer or Blob, got ' + typeof input
    );
  }

  // Browser path: use OfflineAudioContext
  if (typeof OfflineAudioContext !== 'undefined') {
    const tempCtx = new OfflineAudioContext(1, 1, targetRate);
    const audioBuffer = await tempCtx.decodeAudioData(arrayBuffer.slice(0));
    if (audioBuffer.sampleRate === targetRate) {
      return audioBuffer.getChannelData(0);
    }
    const offlineCtx = new OfflineAudioContext(
      1,
      Math.ceil(audioBuffer.duration * targetRate),
      targetRate
    );
    const source = offlineCtx.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(offlineCtx.destination);
    source.start(0);
    const rendered = await offlineCtx.startRendering();
    return rendered.getChannelData(0);
  }

  // Node / non-browser fallback: parse WAV if possible, else assume raw float32
  if (isWav(arrayBuffer)) {
    return decodeWav(arrayBuffer, targetRate);
  }

  // Last resort: assume raw Float32 PCM at targetRate
  return new Float32Array(arrayBuffer);
}

/**
 * Check if an ArrayBuffer starts with a RIFF/WAVE header.
 */
function isWav(buffer) {
  if (buffer.byteLength < 12) return false;
  const view = new DataView(buffer);
  const riff = String.fromCharCode(view.getUint8(0), view.getUint8(1), view.getUint8(2), view.getUint8(3));
  const wave = String.fromCharCode(view.getUint8(8), view.getUint8(9), view.getUint8(10), view.getUint8(11));
  return riff === 'RIFF' && wave === 'WAVE';
}

/**
 * Decode a WAV file ArrayBuffer into Float32Array PCM.
 * Handles PCM int16 (format 1) and IEEE float32 (format 3).
 * No external dependencies.
 */
function decodeWav(buffer, targetRate) {
  const view = new DataView(buffer);
  let offset = 12; // skip RIFF header

  let audioFormat = 1;
  let numChannels = 1;
  let sampleRate = 24000;
  let bitsPerSample = 16;
  let dataOffset = 0;
  let dataSize = 0;

  // Walk chunks
  while (offset < buffer.byteLength - 8) {
    const chunkId = String.fromCharCode(
      view.getUint8(offset), view.getUint8(offset + 1),
      view.getUint8(offset + 2), view.getUint8(offset + 3)
    );
    const chunkSize = view.getUint32(offset + 4, true);

    if (chunkId === 'fmt ') {
      audioFormat = view.getUint16(offset + 8, true);
      numChannels = view.getUint16(offset + 10, true);
      sampleRate = view.getUint32(offset + 12, true);
      bitsPerSample = view.getUint16(offset + 22, true);
    } else if (chunkId === 'data') {
      dataOffset = offset + 8;
      dataSize = chunkSize;
      break;
    }

    offset += 8 + chunkSize;
    if (offset % 2 !== 0) offset++; // chunks are word-aligned
  }

  if (!dataOffset) throw new Error('WAV file has no data chunk');
  if (audioFormat !== 1 && audioFormat !== 3) {
    throw new Error(`Unsupported WAV format: ${audioFormat} (only PCM int16 and IEEE float32)`);
  }

  // Extract samples from first channel
  let samples;
  if (audioFormat === 3 && bitsPerSample === 32) {
    // IEEE float32
    const totalSamples = dataSize / 4;
    const channelSamples = Math.floor(totalSamples / numChannels);
    samples = new Float32Array(channelSamples);
    for (let i = 0; i < channelSamples; i++) {
      samples[i] = view.getFloat32(dataOffset + i * numChannels * 4, true);
    }
  } else if (audioFormat === 1 && bitsPerSample === 16) {
    // PCM int16
    const totalSamples = dataSize / 2;
    const channelSamples = Math.floor(totalSamples / numChannels);
    samples = new Float32Array(channelSamples);
    for (let i = 0; i < channelSamples; i++) {
      const val = view.getInt16(dataOffset + i * numChannels * 2, true);
      samples[i] = val / 32768;
    }
  } else if (audioFormat === 1 && bitsPerSample === 24) {
    // PCM int24
    const bytesPerSample = 3;
    const totalSamples = dataSize / bytesPerSample;
    const channelSamples = Math.floor(totalSamples / numChannels);
    samples = new Float32Array(channelSamples);
    for (let i = 0; i < channelSamples; i++) {
      const off = dataOffset + i * numChannels * bytesPerSample;
      const val = (view.getUint8(off) | (view.getUint8(off + 1) << 8) | (view.getInt8(off + 2) << 16));
      samples[i] = val / 8388608;
    }
  } else {
    throw new Error(`Unsupported WAV bit depth: ${bitsPerSample}`);
  }

  // Resample if needed
  if (sampleRate !== targetRate) {
    return resampleLinear(samples, sampleRate, targetRate);
  }
  return samples;
}

/**
 * Parse a NumPy .npy file containing float32 data.
 * @param {ArrayBuffer} buffer
 * @returns {{ data: Float32Array, shape: number[] }}
 */
export function parseNpy(buffer) {
  const view = new DataView(buffer);
  const magic = new Uint8Array(buffer, 0, 6);
  const expected = [0x93, 0x4e, 0x55, 0x4d, 0x50, 0x59];
  for (let i = 0; i < expected.length; i++) {
    if (magic[i] !== expected[i]) {
      throw new Error('Invalid NPY file');
    }
  }

  const major = view.getUint8(6);
  const headerLen =
    major === 1 ? view.getUint16(8, true) : view.getUint32(8, true);
  const headerOffset = major === 1 ? 10 : 12;
  const headerText = new TextDecoder().decode(
    new Uint8Array(buffer, headerOffset, headerLen)
  );
  const shapeMatch = headerText.match(/\(\s*([0-9,\s]+)\)/);
  if (!shapeMatch) {
    throw new Error('Could not parse NPY shape');
  }
  const shape = shapeMatch[1]
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => Number.parseInt(part, 10));
  const dataOffset = headerOffset + headerLen;
  const data = new Float32Array(buffer, dataOffset);
  return { data: new Float32Array(data), shape };
}

/**
 * Parse the voices.bin binary format used by Pocket TTS.
 * @param {ArrayBuffer} buffer
 * @returns {Record<string, Record<string, { data: Float32Array|BigInt64Array|Uint8Array, shape: number[], dtype: string }>>}
 */
export function parseVoicesBin(buffer) {
  const view = new DataView(buffer);
  let offset = 0;
  const magic = new TextDecoder().decode(new Uint8Array(buffer, offset, 5));
  offset += 5;
  if (magic !== 'PTVB1') {
    throw new Error('Invalid voices.bin header');
  }

  const voices = {};
  const voiceCount = view.getUint32(offset, true);
  offset += 4;

  for (let voiceIndex = 0; voiceIndex < voiceCount; voiceIndex++) {
    const nameLen = view.getUint16(offset, true);
    offset += 2;
    const name = new TextDecoder().decode(
      new Uint8Array(buffer, offset, nameLen)
    );
    offset += nameLen;

    const tensorCount = view.getUint16(offset, true);
    offset += 2;
    const tensors = {};

    for (let tensorIndex = 0; tensorIndex < tensorCount; tensorIndex++) {
      const keyLen = view.getUint16(offset, true);
      offset += 2;
      const key = new TextDecoder().decode(
        new Uint8Array(buffer, offset, keyLen)
      );
      offset += keyLen;

      const dtypeCode = view.getUint8(offset);
      offset += 1;
      const rank = view.getUint8(offset);
      offset += 1;

      const shape = [];
      for (let dimIndex = 0; dimIndex < rank; dimIndex++) {
        shape.push(view.getUint32(offset, true));
        offset += 4;
      }

      const byteLength = view.getUint32(offset, true);
      offset += 4;

      let data;
      if (dtypeCode === 0) {
        data = new Float32Array(buffer.slice(offset, offset + byteLength));
      } else if (dtypeCode === 1) {
        data = new BigInt64Array(buffer.slice(offset, offset + byteLength));
      } else if (dtypeCode === 2) {
        data = new Uint8Array(buffer.slice(offset, offset + byteLength));
      } else {
        throw new Error(`Unsupported voices.bin dtype code: ${dtypeCode}`);
      }
      offset += byteLength;

      tensors[key] = {
        data,
        shape,
        dtype:
          dtypeCode === 0 ? 'float32' : dtypeCode === 1 ? 'int64' : 'bool',
      };
    }

    voices[name] = tensors;
  }

  return voices;
}
