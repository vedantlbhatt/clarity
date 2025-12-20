import { DeepgramTranscriptionResult } from '../external/deepgram'
import { PronunciationAssessmentResult } from '../external/azureSpeech'

export interface CallSessionData {
  streamSid: string
  callSid?: string
  startTime: number
  audioChunks: Buffer[]
  transcripts: Array<{
    text: string
    isFinal: boolean
    timestamp: number
    words?: Array<{
      word: string
      confidence: number
      start: number
      end: number
    }>
  }>
  fillerWords: Array<{
    word: string
    timestamp: number
  }>
  azureResults: Array<{
    result: PronunciationAssessmentResult
    text: string
    timestamp: number
  }>
}

export class CallSession {
  private data: CallSessionData
  private elapsedTime: number = 0
  private timerInterval: NodeJS.Timeout | null = null

  constructor(streamSid: string, callSid?: string) {
    this.data = {
      streamSid,
      callSid,
      startTime: Date.now(),
      audioChunks: [],
      transcripts: [],
      fillerWords: [],
      azureResults: [],
    }
  }

  /**
   * Add an audio chunk to the session
   */
  addAudioChunk(chunk: Buffer): void {
    this.data.audioChunks.push(chunk)
  }

  /**
   * Add a transcript from Deepgram
   */
  addTranscript(result: DeepgramTranscriptionResult): void {
    const timestamp = Date.now()
    this.data.transcripts.push({
      text: result.transcript,
      isFinal: result.isFinal,
      timestamp,
      words: result.words,
    })

    // Extract filler words (um, uh, etc.) from transcript
    const fillerWordPattern = /\b(um|uh|er|ah|like|you know|well|so)\b/gi
    const matches = result.transcript.match(fillerWordPattern)
    if (matches) {
      matches.forEach((word) => {
        this.data.fillerWords.push({
          word: word.toLowerCase(),
          timestamp,
        })
      })
    }
  }

  /**
   * Add an Azure pronunciation assessment result
   */
  addAzureResult(result: PronunciationAssessmentResult, text: string): void {
    this.data.azureResults.push({
      result,
      text,
      timestamp: Date.now(),
    })
  }

  /**
   * Get the full combined transcript (only final transcripts)
   */
  getFullTranscript(): string {
    return this.data.transcripts
      .filter((t) => t.isFinal)
      .map((t) => t.text)
      .join(' ')
      .trim()
  }

  /**
   * Get all transcripts (including interim)
   */
  getAllTranscripts(): string {
    return this.data.transcripts.map((t) => t.text).join(' ').trim()
  }

  /**
   * Get combined audio buffer
   */
  getCombinedAudio(): Buffer {
    return Buffer.concat(this.data.audioChunks)
  }

  /**
   * Get elapsed time in seconds
   */
  getElapsedTime(): number {
    return this.elapsedTime
  }

  /**
   * Update elapsed time (called by timer)
   */
  updateElapsedTime(seconds: number): void {
    this.elapsedTime = seconds
  }

  /**
   * Get all session data
   */
  getData(): CallSessionData {
    return { ...this.data }
  }

  /**
   * Get filler word count
   */
  getFillerWordCount(): number {
    return this.data.fillerWords.length
  }

  /**
   * Start a timer that updates elapsed time
   */
  startTimer(onTick?: (elapsedSeconds: number) => void): void {
    if (this.timerInterval) {
      clearInterval(this.timerInterval)
    }

    this.timerInterval = setInterval(() => {
      const elapsed = Math.floor((Date.now() - this.data.startTime) / 1000)
      this.updateElapsedTime(elapsed)
      if (onTick) {
        onTick(elapsed)
      }
    }, 1000) // Update every second
  }

  /**
   * Stop the timer
   */
  stopTimer(): void {
    if (this.timerInterval) {
      clearInterval(this.timerInterval)
      this.timerInterval = null
    }
  }

  /**
   * Clean up resources
   */
  cleanup(): void {
    this.stopTimer()
    // Clear large buffers to free memory
    this.data.audioChunks = []
  }
}

