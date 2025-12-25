// Azure TTS has been replaced by Ultravox for speech synthesis.
// These stubs remain so existing imports won't break; they throw to avoid accidental use.

export interface AzureTTSConfig {
  voice?: string
  rate?: string
  pitch?: string
}

export async function textToSpeech(): Promise<never> {
  throw new Error('Azure TTS is disabled; Ultravox now handles TTS playback.')
}

export async function textToSpeechFile(): Promise<never> {
  throw new Error('Azure TTS is disabled; Ultravox now handles TTS playback.')
}
