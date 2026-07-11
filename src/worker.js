/**
 * voice-clone Web Worker script.
 *
 * Deploy this file alongside your app and pass its URL to VoiceClone
 * for off-main-thread inference. Messages follow the same protocol
 * as the pocket-voice inference worker.
 *
 * Usage:
 *   const worker = new Worker('./worker.js', { type: 'module' });
 *   worker.postMessage({ type: 'load' });
 */

import { VoiceCloneEngine } from './engine.js';

const engine = new VoiceCloneEngine();
let currentVoiceName = null;

// Forward all engine events to the main thread
const FORWARDED_EVENTS = [
  'ready',
  'voices-loaded',
  'voice-cloned',
  'voice-set',
  'audio-chunk',
  'stream-end',
  'error',
  'status',
];

for (const event of FORWARDED_EVENTS) {
  engine.on(event, (data) => {
    if (event === 'audio-chunk' && data?.data) {
      // Transfer the audio buffer for zero-copy
      const audioData = data.data;
      self.postMessage({ type: event, ...data }, [audioData.buffer]);
    } else {
      self.postMessage({ type: event, ...data });
    }
  });
}

self.onmessage = async (e) => {
  const { type, data } = e.data;

  try {
    switch (type) {
      case 'load':
        await engine.loadBundle(data?.language);
        break;

      case 'set_language':
        if (engine.isGenerating) {
          self.postMessage({
            type: 'error',
            error: 'Cannot switch language while generation is running.',
          });
          return;
        }
        await engine.loadBundle(data.language);
        break;

      case 'encode_voice':
        await engine.encodeVoice(data.audio);
        break;

      case 'set_voice':
        await engine.setVoice(data.voiceName);
        break;

      case 'generate':
        await engine.generate(data.text, {
          voice: data.voice || currentVoiceName,
          temperature: data.temperature,
        });
        break;

      case 'stop':
        engine.stop();
        break;

      case 'destroy':
        await engine.destroy();
        break;

      default:
        self.postMessage({
          type: 'error',
          error: `Unknown message type: ${type}`,
        });
    }
  } catch (err) {
    self.postMessage({ type: 'error', error: err.toString() });
  }
};

self.postMessage({ type: 'status', status: 'Worker Started', state: 'idle' });
