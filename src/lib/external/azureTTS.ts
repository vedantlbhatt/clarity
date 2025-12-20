import * as sdk from 'microsoft-cognitiveservices-speech-sdk'

export interface AzureTTSConfig {
  voice?: string // e.g., 'en-US-AriaNeural', 'en-US-JennyNeural'
  rate?: string // e.g., '+0%', '-20%', '+20%'
  pitch?: string // e.g., '+0Hz', '+2Hz', '-2Hz'
}

/**
 * Convert text to speech using Azure TTS
 * Returns audio as Buffer (WAV format)
 */
export async function textToSpeech(
  text: string,
  config: AzureTTSConfig = {}
): Promise<Buffer> {
  const subscriptionKey = process.env.AZURE_SPEECH_KEY
  const region = process.env.AZURE_SPEECH_REGION

  if (!subscriptionKey || !region) {
    throw new Error('Azure Speech credentials not configured')
  }

  const speechConfig = sdk.SpeechConfig.fromSubscription(subscriptionKey, region)
  speechConfig.speechSynthesisLanguage = 'en-US'
  speechConfig.speechSynthesisVoiceName = config.voice || 'en-US-AriaNeural'

  // Use default audio output (we'll get audio from result.audioData)
  const synthesizer = new sdk.SpeechSynthesizer(speechConfig, null as any)

  // Use SSML for more control
  const ssml = `
    <speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="en-US">
      <voice name="${config.voice || 'en-US-AriaNeural'}">
        <prosody rate="${config.rate || '+0%'}" pitch="${config.pitch || '+0Hz'}">
          ${text}
        </prosody>
      </voice>
    </speak>
  `

  return new Promise<Buffer>((resolve, reject) => {
    synthesizer.speakSsmlAsync(
      ssml,
      (result) => {
        if (result.reason === sdk.ResultReason.SynthesizingAudioCompleted) {
          // Convert ArrayBuffer to Buffer
          const audioData = result.audioData
          const buffer = Buffer.from(audioData)
          synthesizer.close()
          resolve(buffer)
        } else if (result.reason === sdk.ResultReason.Canceled) {
          const cancellation = sdk.CancellationDetails.fromResult(result)
          synthesizer.close()
          reject(new Error(`TTS canceled: ${cancellation.reason} - ${cancellation.errorDetails}`))
        } else {
          synthesizer.close()
          reject(new Error(`TTS failed: ${result.reason}`))
        }
      },
      (error) => {
        synthesizer.close()
        reject(error)
      }
    )
  })
}

/**
 * Convert text to speech and save to file
 */
export async function textToSpeechFile(
  text: string,
  outputPath: string,
  config: AzureTTSConfig = {}
): Promise<void> {
  const audioBuffer = await textToSpeech(text, config)
  const fs = await import('fs/promises')
  await fs.writeFile(outputPath, audioBuffer)
}

