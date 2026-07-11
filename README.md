# clone-voice

Clone any voice from a short audio clip and generate speech — entirely in the browser.

```bash
npm install clone-voice
```

## Quick start

```js
import { cloneVoice, speak } from 'clone-voice';

await cloneVoice('/my-voice.wav');
const wav = await speak('Hello from my cloned voice!');
```

`cloneVoice` accepts a URL, `ArrayBuffer`, `Blob`, or `Float32Array`. `speak` returns a WAV `ArrayBuffer`. Models lazy-load on first call.

## Streaming

```js
import { cloneVoice, generate, on } from 'clone-voice';

await cloneVoice('/my-voice.wav');
on('audio-chunk', ({ data }) => { /* Float32Array PCM */ });
await generate('Streaming speech.');
```

## Record from mic

```js
import { recordMic, cloneVoice, speak } from 'clone-voice';

const blob = await recordMic({ duration: 5000 });
await cloneVoice(blob);
const wav = await speak('Cloned from my mic!');
```

## Node.js / CLI

```js
import { readFile, writeFile } from 'node:fs/promises';
import { cloneVoice, speak } from 'clone-voice';

await cloneVoice((await readFile('./voice.wav')).buffer);
const wav = await speak('Hello from Node.');
await writeFile('./output.wav', Buffer.from(wav));
```

## Built-in voices

```js
import { setVoice, speak } from 'clone-voice';

await setVoice('alba');
const wav = await speak('Using a built-in voice.');
```

## Streaming playback

```js
import { cloneVoice, generate, on, PCMPlayer } from 'clone-voice';

const ctx = new AudioContext({ sampleRate: 24000 });
const player = new PCMPlayer(ctx);

on('audio-chunk', ({ data }) => player.play(data));
on('stream-end', () => player.notifyStreamEnded());

await cloneVoice('/my-voice.wav');
await generate('Streaming with worklet playback.');
```

## Multi-language

```js
import { setLanguage, speak } from 'clone-voice';

await setLanguage('german');
const wav = await speak('Hallo, wie geht es Ihnen?');
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
