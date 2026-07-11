# clone-voice

Clone any voice from a short audio clip and generate speech — entirely in the browser.

```bash
npm install clone-voice
```

## Quick start

```js
import { cloneVoice, speak } from 'clone-voice';

const audio = await fetch('/my-voice.wav').then(r => r.arrayBuffer());
await cloneVoice(audio);

const { audio: pcm } = await speak('Hello from my cloned voice!');
```

`cloneVoice()` encodes audio into a voice embedding. `speak()` returns the full buffer. `generate()` streams chunks. Models lazy-load on first call.

## Streaming

```js
import { cloneVoice, generate, on } from 'clone-voice';

await cloneVoice(audioData);
on('audio-chunk', ({ data }) => { /* Float32Array PCM */ });
await generate('Streaming speech.');
```

## Record from mic

```js
import { recordMic, cloneVoice, speak } from 'clone-voice';

const blob = await recordMic({ duration: 5000 });
await cloneVoice(blob);
const { audio } = await speak('Cloned from my mic!');
```

`recordMic()` returns a `Blob`. Pass `onTick` for a timer, `signal` to stop early.

## Node.js / CLI

WAV files decode automatically — no browser APIs needed.

```js
import { readFile, writeFile } from 'node:fs/promises';
import { cloneVoice, speak, encodeWav } from 'clone-voice';

const wav = await readFile('./voice-sample.wav');
await cloneVoice(wav.buffer);

const { audio } = await speak('Hello from Node.');
await writeFile('./output.wav', Buffer.from(encodeWav(audio)));
```

Supports PCM int16, int24, and IEEE float32 WAV at any sample rate.

## Built-in voices

```js
import { setVoice, getVoices, generate } from 'clone-voice';

const voices = await getVoices();
await setVoice('alba');
await generate('Using a built-in voice.');
```

## Streaming playback

```js
import { cloneVoice, generate, on, PCMPlayer } from 'clone-voice';

const ctx = new AudioContext({ sampleRate: 24000 });
const player = new PCMPlayer(ctx);

on('audio-chunk', ({ data }) => player.play(data));
on('stream-end', () => player.notifyStreamEnded());

await cloneVoice(audioData);
await generate('Streaming with worklet playback.');
```

## Multi-language

```js
import { setLanguage, generate } from 'clone-voice';

await setLanguage('german');
await generate('Hallo, wie geht es Ihnen?');
```

Supported: `english_2026-04`, `german`, `italian`, `portuguese`, `spanish`.

## Multiple instances

```js
import { VoiceClone } from 'clone-voice';

const en = new VoiceClone({ language: 'english_2026-04' });
const de = new VoiceClone({ language: 'german' });
```

Top-level functions use a shared singleton. Use `VoiceClone` class when you need separate instances.

## Credits

- [Pocket TTS](https://github.com/kyutai-labs/pocket-tts) by Kyutai
- [ONNX Web models](https://huggingface.co/spaces/KevinAHM/pocket-tts-web) by KevinAHM

## License

MIT © [Hemanth.HM](https://h3manth.com)
