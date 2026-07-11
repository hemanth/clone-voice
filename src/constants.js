/**
 * Shared constants for the voice-clone SDK.
 */

/** Default sample rate used by Pocket TTS models. */
export const SAMPLE_RATE = 24000;

/** Default latent dimension for the model. */
export const LATENT_DIM = 32;

/** Default conditioning dimension for the model. */
export const CONDITIONING_DIM = 1024;

/** Default samples per frame. */
export const SAMPLES_PER_FRAME = 1920;

/** Maximum tokens per text chunk for generation. */
export const MAX_TOKEN_PER_CHUNK = 50;

/** Maximum frames per generation step. */
export const MAX_FRAMES = 500;

/** Latent step diffusion steps (Euler method). */
export const LSD_STEPS = 1;

/** Gap between text chunks in seconds. */
export const CHUNK_GAP_SEC = 0.25;

/** Default generation temperature. */
export const TEMPERATURE = 0.7;

/** ONNX model filenames. */
export const MODEL_STEMS = {
  mimi_encoder: 'mimi_encoder_int8.onnx',
  text_conditioner: 'text_conditioner_int8.onnx',
  flow_lm_main: 'flow_lm_main_int8.onnx',
  flow_lm_flow: 'flow_lm_flow_int8.onnx',
  mimi_decoder: 'mimi_decoder_int8.onnx',
};

/** Supported language bundles. */
export const LANGUAGE_BUNDLES = [
  'english_2026-04',
  'german',
  'italian',
  'portuguese',
  'spanish',
];

/** Default language bundle. */
export const DEFAULT_LANGUAGE = 'english_2026-04';

/** Default HuggingFace CDN base URL for models. */
export const HF_CDN_BASE =
  'https://huggingface.co/spaces/KevinAHM/pocket-tts-web/resolve/main';
