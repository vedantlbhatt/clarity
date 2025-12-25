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
    phonemes?: Array<{
      phoneme: string
      accuracyScore: number
    }>
  }>
}

export interface AzureSpeechRecognizerConfig {
  referenceText?: string // Optional: if not provided, uses unscripted mode
  onResult?: (result: PronunciationAssessmentResult, text: string) => void
  onTranscript?: (text: string, isFinal: boolean) => void // Callback for STT transcripts (Step 1)
  onError?: (error: Error) => void
}

export class AzureSpeechRecognizer {
  private speechConfig: sdk.SpeechConfig
  private audioConfig: sdk.AudioConfig
  private pushStream: sdk.PushAudioInputStream
  private recognizer: sdk.SpeechRecognizer | null = null
  private isClosed = false
  private config: AzureSpeechRecognizerConfig
  private audioBuffer: Buffer[] = [] // Buffer audio chunks for two-step processing
  private audioBufferBytes = 0
  private readonly maxAudioBufferBytes = 320_000 // ~20 seconds at 8kHz 16-bit mono
  private isProcessing = false // Flag to prevent concurrent processing
  private currentUtterance: Buffer[] = [] // Chunks for current utterance
  private currentUtteranceBytes = 0
  private assessmentQueue: Array<{ referenceText: string; audio: Buffer[] }> = []

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
    
    // Enable detailed output format to get word-level confidence
    this.speechConfig.setProperty(sdk.PropertyId.SpeechServiceResponse_RequestWordLevelTimestamps, "true")
    this.speechConfig.outputFormat = sdk.OutputFormat.Detailed

    // Create push audio input stream for real-time audio
    // Azure Pronunciation Assessment works better with 16kHz, but Twilio sends 8kHz
    // We'll use 8kHz for now (telephony format) - if issues persist, we may need to resample to 16kHz
    const audioFormat = sdk.AudioStreamFormat.getWaveFormatPCM(8000, 16, 1) // 8kHz, 16-bit, mono (telephony format)
    this.pushStream = sdk.AudioInputStream.createPushStream(audioFormat)
    this.audioConfig = sdk.AudioConfig.fromStreamInput(this.pushStream)
    
    console.log('[Azure] Audio format configured: 8kHz, 16-bit, mono PCM')

    // Create recognizer for STT (no pronunciation assessment initially)
    // We'll use two-step approach: STT first, then scripted pronunciation assessment
    this.recognizer = new sdk.SpeechRecognizer(this.speechConfig, this.audioConfig)
    
    console.log('[Azure] Using two-step approach: STT first, then scripted pronunciation assessment')
    
    // Don't apply pronunciation assessment yet - we'll do it after getting STT transcript

    // Set up event handlers
    this.setupEventHandlers()
  }

  private setupEventHandlers() {
    if (!this.recognizer) return

    // Handle interim (partial) recognition results - shows what Azure is hearing in real-time
    this.recognizer.recognizing = (s, e) => {
      if (e.result.text) {
        console.log(`[Azure] Recognizing (partial): "${e.result.text}"`)
        // Notify about partial transcript
        if (this.config.onTranscript) {
          this.config.onTranscript(e.result.text, false) // false = interim/partial
        }
      }
    }

    // Handle recognized results (final) - Step 1: Get accurate STT transcript
    this.recognizer.recognized = async (s, e) => {
      console.log(`[Azure] Recognition event fired - Reason: ${e.result.reason}, Text: "${e.result.text || '(empty)'}"`)
      if (e.result.reason === sdk.ResultReason.RecognizedSpeech && e.result.text) {
        const text = e.result.text.trim()
        console.log(`[Azure] Step 1 - STT Recognized (final): "${text}"`)
        
        // Notify about transcript (for conversation/Gemini)
        if (this.config.onTranscript) {
          this.config.onTranscript(text, true) // Always final in recognized event
        }
        
        // Log everything, even if it's just punctuation, so we can see what Azure is hearing
        if (!text || text === '.' || text.length < 2) {
          console.log(`[Azure] Note: Only got "${text}" (length: ${text.length}) - Azure may not be hearing clear speech, skipping Step 2`)
          return
        }
        
        console.log(`[Azure] Step 1 text passed validation check, proceeding to Step 2 with referenceText: "${text}"`)
        this.enqueueAssessment(text)
      } else {
        console.log(`[Azure] Recognition event but not RecognizedSpeech - Reason: ${e.result.reason}`)
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
      (error: any) => {
        console.error('[Azure] Failed to start recognition:', error)
        if (this.config.onError) {
          this.config.onError(error instanceof Error ? error : new Error(String(error)))
        }
      }
    )
  }

  public writeAudioChunk(audioChunk: Buffer): void {
    if (this.isClosed) {
      return
    }
    // Buffer audio chunk for two-step processing (bounded window to avoid stale/oversized buffers)
    const copy = Buffer.from(audioChunk)
    this.audioBuffer.push(copy)
    this.audioBufferBytes += copy.length

    // Track current utterance audio
    this.currentUtterance.push(copy)
    this.currentUtteranceBytes += copy.length
    while (this.currentUtteranceBytes > this.maxAudioBufferBytes && this.currentUtterance.length > 0) {
      const removedUtterance = this.currentUtterance.shift()
      if (removedUtterance) {
        this.currentUtteranceBytes -= removedUtterance.length
      }
    }

    // Trim from the front if buffer exceeds max size
    while (this.audioBufferBytes > this.maxAudioBufferBytes && this.audioBuffer.length > 0) {
      const removed = this.audioBuffer.shift()
      if (removed) {
        this.audioBufferBytes -= removed.length
      }
    }
    
    // Convert Node.js Buffer to ArrayBuffer for Azure SDK
    // Buffer.buffer is the underlying ArrayBuffer, but we need to slice it to the correct size
    const arrayBuffer = audioChunk.buffer.slice(
      audioChunk.byteOffset,
      audioChunk.byteOffset + audioChunk.byteLength
    ) as ArrayBuffer
    this.pushStream.write(arrayBuffer)
  }

  /**
   * Queue an assessment for the current utterance using a snapshot of the buffered audio.
   */
  private enqueueAssessment(referenceText: string): void {
    const audioSnapshot = [...this.currentUtterance]
    this.assessmentQueue.push({ referenceText, audio: audioSnapshot })
    this.currentUtterance = []
    this.currentUtteranceBytes = 0
    this.processAssessmentQueue().catch((error) => {
      console.error('[Azure] Error in assessment queue:', error)
      if (this.config.onError) {
        this.config.onError(error instanceof Error ? error : new Error(String(error)))
      }
    })
  }

  /**
   * Process the assessment queue sequentially to avoid overlap.
   */
  private async processAssessmentQueue(): Promise<void> {
    if (this.isProcessing) return
    this.isProcessing = true

    while (this.assessmentQueue.length > 0) {
      const item = this.assessmentQueue.shift()
      if (!item) continue
      await this.doScriptedPronunciationAssessment(item.referenceText, item.audio)
    }

    this.isProcessing = false
  }

  /**
   * Step 2: Do scripted pronunciation assessment using STT transcript
   * This uses the accurate transcript from STT for better pronunciation assessment
   */
  private async doScriptedPronunciationAssessment(referenceText: string, audioSnapshot?: Buffer[]): Promise<void> {
    console.log(`[Azure] Step 2 - Starting scripted pronunciation assessment`)
    console.log(`[Azure] Reference text being used: "${referenceText}"`)
    console.log(`[Azure] Reference text length: ${referenceText.length}`)
    console.log(`[Azure] Reference text char codes: ${Array.from(referenceText).map(c => c.charCodeAt(0)).join(', ')}`)
    
    // Create a new recognizer for pronunciation assessment
    // Note: We'll use the buffered audio if available, otherwise this is a limitation
    const assessmentAudioFormat = sdk.AudioStreamFormat.getWaveFormatPCM(8000, 16, 1)
    const assessmentPushStream = sdk.AudioInputStream.createPushStream(assessmentAudioFormat)
    const assessmentAudioConfig = sdk.AudioConfig.fromStreamInput(assessmentPushStream)
    
    const assessmentRecognizer = new sdk.SpeechRecognizer(this.speechConfig, assessmentAudioConfig)
    
    // Create scripted pronunciation assessment config using STT transcript
    const assessmentConfig = new sdk.PronunciationAssessmentConfig(
      referenceText, // Use STT transcript as reference (scripted mode)
      sdk.PronunciationAssessmentGradingSystem.HundredMark,
      sdk.PronunciationAssessmentGranularity.Phoneme,
      true // Enable miscue detection for scripted mode
    )
    assessmentConfig.enableProsodyAssessment = true
    assessmentConfig.applyTo(assessmentRecognizer)
    
    console.log('[Azure] Scripted pronunciation assessment config applied')
    
    // Replay buffered audio for assessment (use snapshot if provided)
    const audioBufferCopy = audioSnapshot ? [...audioSnapshot] : [...this.audioBuffer]
    
    if (audioBufferCopy.length > 0) {
      const totalAudio = Buffer.concat(audioBufferCopy)
      const arrayBuffer = totalAudio.buffer.slice(
        totalAudio.byteOffset,
        totalAudio.byteOffset + totalAudio.byteLength
      ) as ArrayBuffer
      assessmentPushStream.write(arrayBuffer)
      assessmentPushStream.close()
      console.log(`[Azure] Replayed ${audioBufferCopy.length} audio chunks (${totalAudio.length} bytes) for assessment`)
      console.log(`[Azure] Audio duration estimate: ~${Math.round(totalAudio.length / 160)}ms (at 8kHz, 16-bit mono)`)
    } else {
      console.warn('[Azure] No buffered audio available - assessment may be incomplete')
      assessmentPushStream.close()
    }
    
    // Perform one-shot recognition with pronunciation assessment
    return new Promise((resolve, reject) => {
      assessmentRecognizer.recognizeOnceAsync(
        (result) => {
          try {
            if (result.reason === sdk.ResultReason.RecognizedSpeech) {
              const pronunciationResult = sdk.PronunciationAssessmentResult.fromResult(result)
              
              const assessmentResult: PronunciationAssessmentResult = {
                accuracyScore: pronunciationResult.accuracyScore,
                pronunciationScore: pronunciationResult.pronunciationScore,
                completenessScore: pronunciationResult.completenessScore,
                fluencyScore: pronunciationResult.fluencyScore,
                prosodyScore: pronunciationResult.prosodyScore,
                words: pronunciationResult.detailResult?.Words?.map((word: any) => ({
                  word: word.Word,
                  accuracyScore: word.PronunciationAssessment?.AccuracyScore || 0,
                  errorType: word.PronunciationAssessment?.ErrorType || 'None',
                  phonemes: word.Phonemes?.map((phoneme: any) => ({
                    phoneme: phoneme.Phoneme || phoneme.Phonemes || 'N/A',
                    accuracyScore: phoneme.PronunciationAssessment?.AccuracyScore || 0,
                  })),
                })),
              }
              
              console.log('[Azure] Step 2 - Pronunciation Assessment Result:')
              console.log(`  Reference text: "${referenceText}"`)
              console.log(`  Recognized text: "${result.text}"`)
              
              // Warn if Step 2 recognized different text than Step 1
              if (result.text.trim() !== referenceText.trim() && result.text.trim() !== '.' && result.text.trim().length > 0) {
                console.warn(`[Azure] WARNING: Step 2 recognized "${result.text}" but reference was "${referenceText}"`)
              }
              
              // If Step 2 only recognized ".", the audio buffer might be wrong
              if (result.text.trim() === '.' && referenceText.trim() !== '.') {
                console.error(`[Azure] ERROR: Step 2 only recognized "." but reference was "${referenceText}"`)
                console.error(`[Azure] This suggests the audio buffer contains wrong audio (silence or previous utterance)`)
                console.error(`[Azure] Audio buffer had ${audioBufferCopy.length} chunks`)
              }
              
              console.log(`  Accuracy: ${assessmentResult.accuracyScore}%`)
              console.log(`  Pronunciation: ${assessmentResult.pronunciationScore}%`)
              console.log(`  Completeness: ${assessmentResult.completenessScore}%`)
              console.log(`  Fluency: ${assessmentResult.fluencyScore}%`)
              console.log(`  Prosody: ${assessmentResult.prosodyScore}%`)
              
              if (assessmentResult.words && assessmentResult.words.length > 0) {
                console.log('  Word-level details:')
                assessmentResult.words.forEach((word, idx) => {
                  console.log(`    ${idx + 1}. "${word.word}": ${word.accuracyScore}% (${word.errorType || 'None'})`)
                })
              }
              
              // Call callback with assessment result
              if (this.config.onResult) {
                this.config.onResult(assessmentResult, result.text)
              }
              
              assessmentRecognizer.close()
              resolve()
            } else {
              const error = new Error(`Assessment failed: ${result.reason}`)
              console.error('[Azure] Assessment recognition failed:', result.reason)
              assessmentRecognizer.close()
              reject(error)
            }
          } catch (error) {
            console.error('[Azure] Error processing assessment result:', error)
            assessmentRecognizer.close()
            reject(error)
          }
        },
        (error) => {
          console.error('[Azure] Assessment recognition error:', error)
          assessmentRecognizer.close()
          reject(error)
        }
      )
    })
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

