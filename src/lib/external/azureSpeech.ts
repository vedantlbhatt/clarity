import * as sdk from 'microsoft-cognitiveservices-speech-sdk'

export interface PronunciationAssessmentResult {
  accuracyScore: number
  pronunciationScore: number
  completenessScore: number
  fluencyScore: number
  prosodyScore: number
  words?: Array<{
    word: string
    accuracyScore: number
    errorType: string
  }>
}

export interface AzureSpeechRecognizerConfig {
  referenceText: string
  onResult?: (result: PronunciationAssessmentResult, text: string) => void
  onError?: (error: Error) => void
}

export class AzureSpeechRecognizer {
  private speechConfig: sdk.SpeechConfig
  private audioConfig: sdk.AudioConfig
  private pushStream: sdk.PushAudioInputStream
  private recognizer: sdk.SpeechRecognizer | null = null
  private pronunciationConfig: sdk.PronunciationAssessmentConfig
  private isClosed = false
  private config: AzureSpeechRecognizerConfig

  constructor(config: AzureSpeechRecognizerConfig) {
    this.config = config

    const subscriptionKey = process.env.AZURE_SPEECH_KEY
    const region = process.env.AZURE_SPEECH_REGION

    if (!subscriptionKey || !region) {
      throw new Error('Azure Speech credentials not configured. Set AZURE_SPEECH_KEY and AZURE_SPEECH_REGION in .env.local')
    }

    // Create speech config
    this.speechConfig = sdk.SpeechConfig.fromSubscription(subscriptionKey, region)
    this.speechConfig.speechRecognitionLanguage = 'en-US'

    // Create push audio input stream for real-time audio
    // Azure Pronunciation Assessment works better with 16kHz, but Twilio sends 8kHz
    // We'll use 8kHz for now (telephony format) - if issues persist, we may need to resample to 16kHz
    const audioFormat = sdk.AudioStreamFormat.getWaveFormatPCM(8000, 16, 1) // 8kHz, 16-bit, mono (telephony format)
    this.pushStream = sdk.AudioInputStream.createPushStream(audioFormat)
    this.audioConfig = sdk.AudioConfig.fromStreamInput(this.pushStream)
    
    console.log('[Azure] Audio format configured: 8kHz, 16-bit, mono PCM')

    // Create pronunciation assessment config
    this.pronunciationConfig = new sdk.PronunciationAssessmentConfig(
      config.referenceText,
      sdk.PronunciationAssessmentGradingSystem.HundredMark,
      sdk.PronunciationAssessmentGranularity.Word,
      true // enable miscue detection
    )
    this.pronunciationConfig.enableProsodyAssessment = true

    // Create recognizer
    this.recognizer = new sdk.SpeechRecognizer(this.speechConfig, this.audioConfig)

    // Apply pronunciation assessment
    this.pronunciationConfig.applyTo(this.recognizer)

    // Set up event handlers
    this.setupEventHandlers()
  }

  private setupEventHandlers() {
    if (!this.recognizer) return

    // Handle interim (partial) recognition results - shows what Azure is hearing in real-time
    this.recognizer.recognizing = (s, e) => {
      if (e.result.text) {
        console.log(`[Azure] Recognizing (partial): "${e.result.text}"`)
      }
    }

    // Handle recognized results (final)
    this.recognizer.recognized = (s, e) => {
      if (e.result.reason === sdk.ResultReason.RecognizedSpeech && e.result.text) {
        const text = e.result.text.trim()
        console.log(`[Azure] Recognized (final): "${text}"`)
        
        // Log everything, even if it's just punctuation, so we can see what Azure is hearing
        if (!text || text === '.' || text.length < 2) {
          console.log(`[Azure] Note: Only got "${text}" - Azure may not be hearing clear speech`)
          return
        }
        
        try {
          const pronunciationResult = sdk.PronunciationAssessmentResult.fromResult(e.result)
          
          const result: PronunciationAssessmentResult = {
            accuracyScore: pronunciationResult.accuracyScore,
            pronunciationScore: pronunciationResult.pronunciationScore,
            completenessScore: pronunciationResult.completenessScore,
            fluencyScore: pronunciationResult.fluencyScore,
            prosodyScore: pronunciationResult.prosodyScore,
            words: pronunciationResult.detailResult?.Words?.map((word: any) => ({
              word: word.Word,
              accuracyScore: word.PronunciationAssessment.AccuracyScore,
              errorType: word.PronunciationAssessment.ErrorType,
            })),
          }

          console.log('[Azure] Pronunciation Assessment Result:')
          console.log(`  Text: "${e.result.text}"`)
          console.log(`  Accuracy: ${result.accuracyScore}%`)
          console.log(`  Pronunciation: ${result.pronunciationScore}%`)
          console.log(`  Completeness: ${result.completenessScore}%`)
          console.log(`  Fluency: ${result.fluencyScore}%`)
          console.log(`  Prosody: ${result.prosodyScore}%`)

          if (result.words && result.words.length > 0) {
            console.log('  Word-level details:')
            result.words.forEach((word, idx) => {
              console.log(`    ${idx + 1}. "${word.word}": ${word.accuracyScore}% (${word.errorType || 'None'})`)
            })
          }

          if (this.config.onResult) {
            this.config.onResult(result, e.result.text)
          }
        } catch (error) {
          console.error('[Azure] Error parsing pronunciation result:', error)
        }
      }
    }

    // Handle errors
    this.recognizer.canceled = (s, e) => {
      if (e.errorCode !== sdk.CancellationErrorCode.NoError) {
        const error = new Error(`Azure Speech recognition canceled: ${e.errorDetails}`)
        console.error('[Azure] Recognition canceled:', e.errorDetails)
        if (this.config.onError) {
          this.config.onError(error)
        }
      }
    }

    // Handle session stopped
    this.recognizer.sessionStopped = () => {
      console.log('[Azure] Session stopped')
    }
  }

  public start(): void {
    if (!this.recognizer || this.isClosed) {
      throw new Error('Recognizer is not initialized or has been closed')
    }

    this.recognizer.startContinuousRecognitionAsync(
      () => {
        console.log('[Azure] Continuous recognition started')
      },
      (error) => {
        console.error('[Azure] Failed to start recognition:', error)
        if (this.config.onError) {
          this.config.onError(error as Error)
        }
      }
    )
  }

  public writeAudioChunk(audioChunk: Buffer): void {
    if (this.isClosed) {
      return
    }
    // Convert Node.js Buffer to ArrayBuffer for Azure SDK
    // Buffer.buffer is the underlying ArrayBuffer, but we need to slice it to the correct size
    const arrayBuffer = audioChunk.buffer.slice(
      audioChunk.byteOffset,
      audioChunk.byteOffset + audioChunk.byteLength
    )
    this.pushStream.write(arrayBuffer)
  }

  public stop(): void {
    if (this.recognizer && !this.isClosed) {
      this.recognizer.stopContinuousRecognitionAsync(
        () => {
          console.log('[Azure] Continuous recognition stopped')
        },
        (error) => {
          console.error('[Azure] Error stopping recognition:', error)
        }
      )
    }
  }

  public close(): void {
    if (this.isClosed) {
      return
    }

    this.stop()
    
    if (this.recognizer) {
      this.recognizer.close()
      this.recognizer = null
    }

    this.pushStream.close()
    // Note: pronunciationConfig doesn't have a close() method - don't call it
    // AudioConfig from PushAudioInputStream may not have a close() method
    try {
      if (this.audioConfig && typeof (this.audioConfig as any).close === 'function') {
        this.audioConfig.close()
      }
    } catch (error) {
      // Ignore close errors - some AudioConfig types don't support close()
      console.log('[Azure] AudioConfig close skipped (not supported)')
    }
    
    try {
      if (this.speechConfig && typeof (this.speechConfig as any).close === 'function') {
        this.speechConfig.close()
      }
    } catch (error) {
      // Ignore close errors
      console.log('[Azure] SpeechConfig close skipped')
    }

    this.isClosed = true
    console.log('[Azure] Recognizer closed')
  }
}

