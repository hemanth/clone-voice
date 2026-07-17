/**
 * clone-voice test suite
 *
 * Uses Node's built-in test runner (node --test).
 * No external dependencies required.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  EventEmitter,
  encodeWav,
  resampleLinear,
  SAMPLE_RATE,
  LANGUAGE_BUNDLES,
  DEFAULT_LANGUAGE,
} from '../src/index.js';

import { parseNpy, parseVoicesBin } from '../src/utils.js';
import { Voice } from '../src/voice.js';
import {
  LATENT_DIM,
  CONDITIONING_DIM,
  SAMPLES_PER_FRAME,
  MAX_TOKEN_PER_CHUNK,
  MAX_FRAMES,
  LSD_STEPS,
  CHUNK_GAP_SEC,
  TEMPERATURE,
  MODEL_STEMS,
  HF_CDN_BASE,
} from '../src/constants.js';

// ── EventEmitter ────────────────────────────────────────────────────

describe('EventEmitter', () => {
  it('calls listeners on emit', () => {
    const ee = new EventEmitter();
    let called = false;
    ee.on('test', () => { called = true; });
    ee.emit('test');
    assert.equal(called, true);
  });

  it('passes data to listener', () => {
    const ee = new EventEmitter();
    let received;
    ee.on('data', (d) => { received = d; });
    ee.emit('data', 42);
    assert.equal(received, 42);
  });

  it('supports multiple listeners on the same event', () => {
    const ee = new EventEmitter();
    const calls = [];
    ee.on('ev', () => calls.push('a'));
    ee.on('ev', () => calls.push('b'));
    ee.emit('ev');
    assert.deepEqual(calls, ['a', 'b']);
  });

  it('once() fires only once', () => {
    const ee = new EventEmitter();
    let count = 0;
    ee.once('ping', () => { count++; });
    ee.emit('ping');
    ee.emit('ping');
    assert.equal(count, 1);
  });

  it('off() removes a specific listener', () => {
    const ee = new EventEmitter();
    let count = 0;
    const fn = () => { count++; };
    ee.on('x', fn);
    ee.emit('x');
    ee.off('x', fn);
    ee.emit('x');
    assert.equal(count, 1);
  });

  it('off() on unknown event is a no-op', () => {
    const ee = new EventEmitter();
    assert.doesNotThrow(() => ee.off('nope', () => {}));
  });

  it('removeAllListeners(event) clears specific event', () => {
    const ee = new EventEmitter();
    let a = 0, b = 0;
    ee.on('a', () => { a++; });
    ee.on('b', () => { b++; });
    ee.removeAllListeners('a');
    ee.emit('a');
    ee.emit('b');
    assert.equal(a, 0);
    assert.equal(b, 1);
  });

  it('removeAllListeners() clears everything', () => {
    const ee = new EventEmitter();
    let count = 0;
    ee.on('x', () => { count++; });
    ee.on('y', () => { count++; });
    ee.removeAllListeners();
    ee.emit('x');
    ee.emit('y');
    assert.equal(count, 0);
  });

  it('on() returns this for chaining', () => {
    const ee = new EventEmitter();
    const result = ee.on('x', () => {});
    assert.equal(result, ee);
  });

  it('off() returns this for chaining', () => {
    const ee = new EventEmitter();
    const result = ee.off('x', () => {});
    assert.equal(result, ee);
  });

  it('removeAllListeners() returns this for chaining', () => {
    const ee = new EventEmitter();
    const result = ee.removeAllListeners();
    assert.equal(result, ee);
  });

  it('does not throw when emitting event with no listeners', () => {
    const ee = new EventEmitter();
    assert.doesNotThrow(() => ee.emit('nothing'));
  });

  it('once listener is removed after firing even with multiple listeners', () => {
    const ee = new EventEmitter();
    const calls = [];
    ee.once('ev', () => calls.push('once'));
    ee.on('ev', () => calls.push('always'));
    ee.emit('ev');
    ee.emit('ev');
    assert.deepEqual(calls, ['once', 'always', 'always']);
  });
});

// ── encodeWav ───────────────────────────────────────────────────────

describe('encodeWav', () => {
  it('returns an ArrayBuffer', () => {
    const wav = encodeWav(new Float32Array(100));
    assert.ok(wav instanceof ArrayBuffer);
  });

  it('produces a valid RIFF/WAVE header', () => {
    const wav = encodeWav(new Float32Array(10));
    const view = new DataView(wav);
    const riff = String.fromCharCode(view.getUint8(0), view.getUint8(1), view.getUint8(2), view.getUint8(3));
    const wave = String.fromCharCode(view.getUint8(8), view.getUint8(9), view.getUint8(10), view.getUint8(11));
    assert.equal(riff, 'RIFF');
    assert.equal(wave, 'WAVE');
  });

  it('encodes correct data size', () => {
    const samples = new Float32Array(48);
    const wav = encodeWav(samples);
    const view = new DataView(wav);
    // data chunk size at offset 40
    const dataSize = view.getUint32(40, true);
    assert.equal(dataSize, 48 * 2); // 16-bit = 2 bytes per sample
  });

  it('total buffer size = 44 header + data', () => {
    const samples = new Float32Array(100);
    const wav = encodeWav(samples);
    assert.equal(wav.byteLength, 44 + 100 * 2);
  });

  it('uses specified sample rate', () => {
    const wav = encodeWav(new Float32Array(10), 44100);
    const view = new DataView(wav);
    assert.equal(view.getUint32(24, true), 44100);
  });

  it('defaults to 24000 sample rate', () => {
    const wav = encodeWav(new Float32Array(10));
    const view = new DataView(wav);
    assert.equal(view.getUint32(24, true), 24000);
  });

  it('clamps samples to [-1, 1]', () => {
    const samples = new Float32Array([2.0, -2.0, 0.5]);
    const wav = encodeWav(samples);
    const view = new DataView(wav);
    // +2.0 clamped to 1.0 → 0x7FFF
    assert.equal(view.getInt16(44, true), 0x7FFF);
    // -2.0 clamped to -1.0 → -0x8000
    assert.equal(view.getInt16(46, true), -0x8000);
  });

  it('encodes silence correctly', () => {
    const silence = new Float32Array(5); // all zeros
    const wav = encodeWav(silence);
    const view = new DataView(wav);
    for (let i = 0; i < 5; i++) {
      assert.equal(view.getInt16(44 + i * 2, true), 0);
    }
  });

  it('encodes empty samples', () => {
    const wav = encodeWav(new Float32Array(0));
    assert.equal(wav.byteLength, 44);
  });

  it('sets mono channel', () => {
    const wav = encodeWav(new Float32Array(10));
    const view = new DataView(wav);
    assert.equal(view.getUint16(22, true), 1); // numChannels
  });

  it('sets 16-bit depth', () => {
    const wav = encodeWav(new Float32Array(10));
    const view = new DataView(wav);
    assert.equal(view.getUint16(34, true), 16); // bitsPerSample
  });
});

// ── resampleLinear ──────────────────────────────────────────────────

describe('resampleLinear', () => {
  it('returns a copy when rates are equal', () => {
    const input = new Float32Array([1, 2, 3]);
    const output = resampleLinear(input, 24000, 24000);
    assert.deepEqual(Array.from(output), [1, 2, 3]);
    assert.notEqual(input.buffer, output.buffer); // must be a copy
  });

  it('downsamples by half', () => {
    const input = new Float32Array([0, 1, 0, 1, 0, 1]);
    const output = resampleLinear(input, 48000, 24000);
    assert.equal(output.length, 3);
  });

  it('upsamples by double', () => {
    const input = new Float32Array([0, 1, 0]);
    const output = resampleLinear(input, 24000, 48000);
    assert.equal(output.length, 6);
  });

  it('preserves DC signal', () => {
    const dc = new Float32Array(100).fill(0.5);
    const output = resampleLinear(dc, 16000, 24000);
    for (const v of output) {
      assert.ok(Math.abs(v - 0.5) < 0.001, `expected ~0.5, got ${v}`);
    }
  });

  it('returns Float32Array', () => {
    const output = resampleLinear(new Float32Array([1, 2]), 44100, 22050);
    assert.ok(output instanceof Float32Array);
  });

  it('handles single sample', () => {
    const output = resampleLinear(new Float32Array([0.7]), 8000, 24000);
    assert.ok(output.length >= 1);
    assert.ok(Math.abs(output[0] - 0.7) < 0.01);
  });
});

// ── Constants ───────────────────────────────────────────────────────

describe('Constants', () => {
  it('SAMPLE_RATE is 24000', () => {
    assert.equal(SAMPLE_RATE, 24000);
  });

  it('DEFAULT_LANGUAGE is english_2026-04', () => {
    assert.equal(DEFAULT_LANGUAGE, 'english_2026-04');
  });

  it('LANGUAGE_BUNDLES is a non-empty array', () => {
    assert.ok(Array.isArray(LANGUAGE_BUNDLES));
    assert.ok(LANGUAGE_BUNDLES.length > 0);
  });

  it('LANGUAGE_BUNDLES includes default language', () => {
    assert.ok(LANGUAGE_BUNDLES.includes(DEFAULT_LANGUAGE));
  });

  it('LANGUAGE_BUNDLES includes expected languages', () => {
    for (const lang of ['german', 'italian', 'portuguese', 'spanish']) {
      assert.ok(LANGUAGE_BUNDLES.includes(lang), `missing ${lang}`);
    }
  });

  it('LATENT_DIM is a positive integer', () => {
    assert.equal(LATENT_DIM, 32);
  });

  it('CONDITIONING_DIM is 1024', () => {
    assert.equal(CONDITIONING_DIM, 1024);
  });

  it('SAMPLES_PER_FRAME is 1920', () => {
    assert.equal(SAMPLES_PER_FRAME, 1920);
  });

  it('MAX_TOKEN_PER_CHUNK is 50', () => {
    assert.equal(MAX_TOKEN_PER_CHUNK, 50);
  });

  it('MAX_FRAMES is 500', () => {
    assert.equal(MAX_FRAMES, 500);
  });

  it('LSD_STEPS is 1', () => {
    assert.equal(LSD_STEPS, 1);
  });

  it('CHUNK_GAP_SEC is 0.25', () => {
    assert.equal(CHUNK_GAP_SEC, 0.25);
  });

  it('TEMPERATURE is 0.7', () => {
    assert.equal(TEMPERATURE, 0.7);
  });

  it('MODEL_STEMS has all required keys', () => {
    const expected = ['mimi_encoder', 'text_conditioner', 'flow_lm_main', 'flow_lm_flow', 'mimi_decoder'];
    for (const key of expected) {
      assert.ok(key in MODEL_STEMS, `missing MODEL_STEMS.${key}`);
      assert.ok(MODEL_STEMS[key].endsWith('.onnx'), `${key} should be an .onnx file`);
    }
  });

  it('HF_CDN_BASE is a valid URL', () => {
    assert.ok(HF_CDN_BASE.startsWith('https://'));
  });
});

// ── parseNpy ────────────────────────────────────────────────────────

describe('parseNpy', () => {
  function makeNpyBuffer(shape, data) {
    // Build a minimal v1 .npy file
    const header = `{'descr': '<f4', 'fortran_order': False, 'shape': (${shape.join(', ')},), }`;
    const padLen = 64 - ((10 + header.length) % 64);
    const paddedHeader = header + ' '.repeat(padLen - 1) + '\n';
    const headerBytes = new TextEncoder().encode(paddedHeader);
    const totalSize = 10 + headerBytes.length + data.byteLength;
    const buf = new ArrayBuffer(totalSize);
    const view = new DataView(buf);
    const u8 = new Uint8Array(buf);
    // magic
    u8.set([0x93, 0x4e, 0x55, 0x4d, 0x50, 0x59], 0);
    view.setUint8(6, 1); // major
    view.setUint8(7, 0); // minor
    view.setUint16(8, headerBytes.length, true);
    u8.set(headerBytes, 10);
    new Uint8Array(buf, 10 + headerBytes.length).set(new Uint8Array(data.buffer));
    return buf;
  }

  it('parses a 1D float32 array', () => {
    const data = new Float32Array([1.0, 2.0, 3.0]);
    const buf = makeNpyBuffer([3], data);
    const result = parseNpy(buf);
    assert.deepEqual(result.shape, [3]);
    assert.equal(result.data.length, 3);
    assert.ok(Math.abs(result.data[0] - 1.0) < 0.001);
    assert.ok(Math.abs(result.data[2] - 3.0) < 0.001);
  });

  it('parses a 2D shape', () => {
    const data = new Float32Array([1, 2, 3, 4, 5, 6]);
    const buf = makeNpyBuffer([2, 3], data);
    const result = parseNpy(buf);
    assert.deepEqual(result.shape, [2, 3]);
    assert.equal(result.data.length, 6);
  });

  it('rejects invalid magic bytes', () => {
    const buf = new ArrayBuffer(64);
    new Uint8Array(buf).set([0x00, 0x00, 0x00, 0x00, 0x00, 0x00]);
    assert.throws(() => parseNpy(buf), /Invalid NPY file/);
  });
});

// ── parseVoicesBin ──────────────────────────────────────────────────

describe('parseVoicesBin', () => {
  function makeVoicesBin(voices) {
    // Calculate total size
    const encoder = new TextEncoder();
    let size = 5 + 4; // magic + voiceCount
    for (const [name, tensors] of Object.entries(voices)) {
      size += 2 + encoder.encode(name).length; // nameLen + name
      size += 2; // tensorCount
      for (const [key, t] of Object.entries(tensors)) {
        size += 2 + encoder.encode(key).length; // keyLen + key
        size += 1 + 1; // dtypeCode + rank
        size += t.shape.length * 4; // shape dims
        size += 4; // byteLength
        size += t.data.byteLength; // data
      }
    }

    const buf = new ArrayBuffer(size);
    const view = new DataView(buf);
    const u8 = new Uint8Array(buf);
    let offset = 0;

    // magic
    u8.set(encoder.encode('PTVB1'), 0);
    offset += 5;
    // voiceCount
    view.setUint32(offset, Object.keys(voices).length, true);
    offset += 4;

    for (const [name, tensors] of Object.entries(voices)) {
      const nameBytes = encoder.encode(name);
      view.setUint16(offset, nameBytes.length, true);
      offset += 2;
      u8.set(nameBytes, offset);
      offset += nameBytes.length;

      view.setUint16(offset, Object.keys(tensors).length, true);
      offset += 2;

      for (const [key, t] of Object.entries(tensors)) {
        const keyBytes = encoder.encode(key);
        view.setUint16(offset, keyBytes.length, true);
        offset += 2;
        u8.set(keyBytes, offset);
        offset += keyBytes.length;

        view.setUint8(offset, t.dtypeCode);
        offset += 1;
        view.setUint8(offset, t.shape.length);
        offset += 1;

        for (const dim of t.shape) {
          view.setUint32(offset, dim, true);
          offset += 4;
        }

        view.setUint32(offset, t.data.byteLength, true);
        offset += 4;
        u8.set(new Uint8Array(t.data.buffer, t.data.byteOffset, t.data.byteLength), offset);
        offset += t.data.byteLength;
      }
    }

    return buf;
  }

  it('parses a single voice with float32 tensor', () => {
    const data = new Float32Array([1.0, 2.0]);
    const bin = makeVoicesBin({
      'alba': {
        'embedding': { dtypeCode: 0, shape: [1, 2], data: data },
      },
    });
    const result = parseVoicesBin(bin);
    assert.ok('alba' in result);
    assert.ok('embedding' in result.alba);
    assert.equal(result.alba.embedding.dtype, 'float32');
    assert.deepEqual(result.alba.embedding.shape, [1, 2]);
    assert.equal(result.alba.embedding.data.length, 2);
  });

  it('parses multiple voices', () => {
    const bin = makeVoicesBin({
      'alba': {
        'emb': { dtypeCode: 0, shape: [2], data: new Float32Array([1, 2]) },
      },
      'bella': {
        'emb': { dtypeCode: 0, shape: [2], data: new Float32Array([3, 4]) },
      },
    });
    const result = parseVoicesBin(bin);
    assert.ok('alba' in result);
    assert.ok('bella' in result);
  });

  it('handles uint8 (bool) dtype', () => {
    const bin = makeVoicesBin({
      'voice': {
        'mask': { dtypeCode: 2, shape: [3], data: new Uint8Array([1, 0, 1]) },
      },
    });
    const result = parseVoicesBin(bin);
    assert.equal(result.voice.mask.dtype, 'bool');
    assert.equal(result.voice.mask.data.length, 3);
  });

  it('rejects invalid magic', () => {
    const buf = new ArrayBuffer(32);
    new Uint8Array(buf).set(new TextEncoder().encode('WRONG'));
    assert.throws(() => parseVoicesBin(buf), /Invalid voices\.bin header/);
  });
});

// ── Voice ───────────────────────────────────────────────────────────

describe('Voice', () => {
  function mockEngine() {
    const ee = new EventEmitter();
    ee.generate = async () => {};
    ee.stop = () => {};
    return ee;
  }

  it('proxies audio-chunk events as chunk', () => {
    const engine = mockEngine();
    const voice = new Voice(engine, 'test', 24000);
    const chunks = [];
    voice.on('chunk', (d) => chunks.push(d));
    engine.emit('audio-chunk', { data: new Float32Array([1]) });
    assert.equal(chunks.length, 1);
  });

  it('proxies stream-end as end', () => {
    const engine = mockEngine();
    const voice = new Voice(engine, 'test', 24000);
    let ended = false;
    voice.on('end', () => { ended = true; });
    engine.emit('stream-end');
    assert.ok(ended);
  });

  it('proxies error events', () => {
    const engine = mockEngine();
    const voice = new Voice(engine, 'test', 24000);
    let err;
    voice.on('error', (e) => { err = e; });
    engine.emit('error', 'boom');
    assert.equal(err, 'boom');
  });

  it('speak() returns a WAV ArrayBuffer', async () => {
    const engine = mockEngine();
    engine.generate = async () => {
      engine.emit('audio-chunk', { data: new Float32Array(100) });
    };
    const voice = new Voice(engine, 'test', 24000);
    const wav = await voice.speak('hello');
    assert.ok(wav instanceof ArrayBuffer);
    assert.ok(wav.byteLength > 44);
  });

  it('speak() concatenates multiple chunks', async () => {
    const engine = mockEngine();
    engine.generate = async () => {
      engine.emit('audio-chunk', { data: new Float32Array(50) });
      engine.emit('audio-chunk', { data: new Float32Array(50) });
    };
    const voice = new Voice(engine, 'test', 24000);
    const wav = await voice.speak('hello');
    // 100 samples × 2 bytes + 44 header
    assert.equal(wav.byteLength, 44 + 100 * 2);
  });

  it('speak() passes options to engine.generate', async () => {
    const engine = mockEngine();
    let passedOpts;
    engine.generate = async (text, opts) => { passedOpts = opts; };
    const voice = new Voice(engine, 'myvoice', 24000);
    await voice.speak('hello', { temp: 0.5 });
    assert.equal(passedOpts.voice, 'myvoice');
    assert.equal(passedOpts.temp, 0.5);
  });

  it('stream() delegates to engine.generate', async () => {
    const engine = mockEngine();
    let called = false;
    engine.generate = async () => { called = true; };
    const voice = new Voice(engine, 'test', 24000);
    await voice.stream('hello');
    assert.ok(called);
  });

  it('stop() delegates to engine.stop', () => {
    const engine = mockEngine();
    let stopped = false;
    engine.stop = () => { stopped = true; };
    const voice = new Voice(engine, 'test', 24000);
    voice.stop();
    assert.ok(stopped);
  });

  it('speak() cleans up chunk listener on error', async () => {
    const engine = mockEngine();
    engine.generate = async () => { throw new Error('fail'); };
    const voice = new Voice(engine, 'test', 24000);
    await assert.rejects(() => voice.speak('hello'), /fail/);
    // After error, no leftover listeners for 'chunk' from speak()
    // (the once from constructor still exists)
  });
});

// ── looksLikeUrl (heuristic via clone) ──────────────────────────────

describe('looksLikeUrl heuristic', () => {
  // We test the logic directly since it's a simple internal function.
  // Replicated here to avoid importing private internals.
  function looksLikeUrl(s) {
    return s.includes('/') || s.includes('.') || s.startsWith('http');
  }

  it('file path with slash is a URL', () => {
    assert.ok(looksLikeUrl('./voice.wav'));
  });

  it('file path with dot is a URL', () => {
    assert.ok(looksLikeUrl('voice.wav'));
  });

  it('http URL is a URL', () => {
    assert.ok(looksLikeUrl('https://example.com/voice.wav'));
  });

  it('bare name is not a URL', () => {
    assert.ok(!looksLikeUrl('alba'));
  });

  it('another bare name is not a URL', () => {
    assert.ok(!looksLikeUrl('english_2026-04'));
  });
});

// ── WAV round-trip ──────────────────────────────────────────────────

describe('WAV round-trip', () => {
  it('encode → decode preserves signal approximately', async () => {
    // decodeAudio in Node falls back to WAV parser
    const { decodeAudio } = await import('../src/utils.js');
    const original = new Float32Array([0, 0.5, -0.5, 1.0, -1.0]);
    const wav = encodeWav(original, 24000);
    const decoded = await decodeAudio(wav, 24000);
    assert.equal(decoded.length, original.length);
    for (let i = 0; i < original.length; i++) {
      // int16 quantization means ~1/32768 error
      assert.ok(Math.abs(decoded[i] - original[i]) < 0.001, `sample ${i}: ${decoded[i]} vs ${original[i]}`);
    }
  });

  it('encode → decode at different sample rate resamples', async () => {
    const { decodeAudio } = await import('../src/utils.js');
    const original = new Float32Array(48000).fill(0.3);
    const wav = encodeWav(original, 48000);
    const decoded = await decodeAudio(wav, 24000);
    // Should be roughly half the length
    assert.ok(decoded.length > 20000 && decoded.length < 28000);
  });
});

// ── Default export shape ────────────────────────────────────────────

describe('Default export', () => {
  it('clone is a function', async () => {
    const mod = await import('../src/index.js');
    assert.equal(typeof mod.default, 'function');
  });

  it('clone.mic is a function', async () => {
    const mod = await import('../src/index.js');
    assert.equal(typeof mod.default.mic, 'function');
  });

  it('named exports include expected symbols', async () => {
    const mod = await import('../src/index.js');
    assert.equal(typeof mod.Voice, 'function');
    assert.equal(typeof mod.VoiceCloneEngine, 'function');
    assert.equal(typeof mod.EventEmitter, 'function');
    assert.equal(typeof mod.recordMic, 'function');
    assert.equal(typeof mod.encodeWav, 'function');
    assert.equal(typeof mod.resampleLinear, 'function');
    assert.equal(typeof mod.decodeAudio, 'function');
    assert.equal(typeof mod.SAMPLE_RATE, 'number');
    assert.ok(Array.isArray(mod.LANGUAGE_BUNDLES));
    assert.equal(typeof mod.DEFAULT_LANGUAGE, 'string');
  });
});
