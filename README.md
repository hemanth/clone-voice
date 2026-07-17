# clone-voice

Clone any voice from a short audio clip and generate speech.

```bash
npm install clone-voice
```

## Quick start

```js
import clone from 'clone-voice';

const voice = await clone('./my-voice.wav');
const wav = await voice.speak('Hello from my cloned voice!');
```

`clone()` loads models, encodes the voice, returns a `Voice`. `voice.speak()` returns a WAV `ArrayBuffer`. That's the whole API.

## From mic

```js
import clone from 'clone-voice';

const voice = await clone.mic(5000);
const wav = await voice.speak('Cloned from my mic!');
```

Works in browser (MediaRecorder) and Node/CLI (sox).

## Built-in voices

```js
const voice = await clone('alba');
const wav = await voice.speak('Using a built-in voice.');
```

## Streaming

```js
const voice = await clone('./my-voice.wav');

voice.on('chunk', (pcm) => player.play(pcm));
await voice.stream('Streaming speech.');
```

## Node.js / CLI

```js
import { writeFile } from 'node:fs/promises';
import clone from 'clone-voice';

const voice = await clone('./voice.wav');
const wav = await voice.speak('Hello from Node.');
await writeFile('./output.wav', Buffer.from(wav));
```

## Multi-language

```js
const voice = await clone('./stimme.wav', { lang: 'german' });
const wav = await voice.speak('Hallo, wie geht es Ihnen?');
```

Supported: `english_2026-04`, `german`, `italian`, `portuguese`, `spanish`.

## Credits

- [Pocket TTS](https://github.com/kyutai-labs/pocket-tts) by Kyutai
- [ONNX Web models](https://huggingface.co/spaces/KevinAHM/pocket-tts-web) by KevinAHM

## License

MIT © [Hemanth.HM](https://h3manth.com)
