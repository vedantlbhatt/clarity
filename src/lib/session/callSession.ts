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
  conversationHistory: Array<{
    role: 'user' | 'assistant'
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
      conversationHistory: [],
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
   * Add a transcript from Azure STT (Step 1 recognition)
   */
  addAzureTranscript(text: string, isFinal: boolean = true): void {
    const timestamp = Date.now()
    this.data.transcripts.push({
      text: text.trim(),
      isFinal: isFinal,
      timestamp,
      words: undefined, // Azure STT Step 1 doesn't provide word-level confidence
    })
    
    // Extract filler words (um, uh, etc.) from transcript
    const fillerWordPattern = /\b(um|uh|er|ah|like|you know|well|so)\b/gi
    const matches = text.match(fillerWordPattern)
    if (matches) {
      matches.forEach((word) => {
        this.data.fillerWords.push({
          word: word.toLowerCase(),
          timestamp,
        })
      })
    }
    
    console.log(`[Session] Added Azure transcript (${isFinal ? 'final' : 'interim'}): "${text}"`)
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
   * Add a user message to conversation history
   */
  addUserMessage(text: string): void {
    this.data.conversationHistory.push({
      role: 'user',
      text: text.trim(),
      timestamp: Date.now(),
    })
  }

  /**
   * Add an assistant (AI) message to conversation history
   */
  addAssistantMessage(text: string): void {
    this.data.conversationHistory.push({
      role: 'assistant',
      text: text.trim(),
      timestamp: Date.now(),
    })
  }

  /**
   * Get conversation context for Gemini
   * Returns: { past: conversation history array, curr: current user message }
   */
  getConversationContext(): {
    past: Array<{ role: 'user' | 'assistant'; text: string }>
    curr: string | null
  } {
    const history = this.data.conversationHistory
    
    if (history.length === 0) {
      return { past: [], curr: null }
    }

    // Get the most recent user message (current)
    let curr: string | null = null
    let past: Array<{ role: 'user' | 'assistant'; text: string }> = []

    // Find the last user message (should be the most recent if user just finished speaking)
    for (let i = history.length - 1; i >= 0; i--) {
      if (history[i].role === 'user') {
        curr = history[i].text
        // Past is everything before this current message
        past = history.slice(0, i).map(msg => ({
          role: msg.role,
          text: msg.text,
        }))
        break
      }
    }

    // If no user message found, return all as past
    if (curr === null) {
      past = history.map(msg => ({
        role: msg.role,
        text: msg.text,
      }))
    }

    return { past, curr }
  }

  /**
   * Get the most recent final transcript (from Azure STT or Deepgram)
   * This is used to get the current user message when speech ends
   */
  getLatestFinalTranscript(): string | null {
    const finalTranscripts = this.data.transcripts
      .filter(t => t.isFinal)
      .sort((a, b) => b.timestamp - a.timestamp) // Most recent first
    
    if (finalTranscripts.length === 0) {
      return null
    }

    // Get the most recent final transcript
    // If there are multiple final transcripts since last user message, combine them
    const lastUserMessageTime = this.data.conversationHistory
      .filter(msg => msg.role === 'user')
      .slice(-1)[0]?.timestamp || 0

    // Get all final transcripts after the last user message
    const recentTranscripts = finalTranscripts
      .filter(t => t.timestamp > lastUserMessageTime)
      .map(t => t.text)
      .join(' ')
      .trim()

    return recentTranscripts || finalTranscripts[0].text
  }

  /**
   * Get conversation history formatted for Gemini API
   * Returns array of messages in format: [{ role: 'user'|'model', parts: [{ text: '...' }] }]
   * Note: Gemini uses 'model' instead of 'assistant'
   */
  getGeminiFormatHistory(): Array<{ role: 'user' | 'model'; parts: Array<{ text: string }> }> {
    return this.data.conversationHistory.map(msg => ({
      role: msg.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: msg.text }],
    }))
  }

  /**
   * Get conversation turn count (number of user messages)
   */
  getConversationTurnCount(): number {
    return this.data.conversationHistory.filter(msg => msg.role === 'user').length
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


