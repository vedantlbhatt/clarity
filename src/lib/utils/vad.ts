/**
 * Voice Activity Detection (VAD) using energy-based detection
 * Detects when user starts and stops speaking
 */

export enum VADState {
  SILENCE = 'SILENCE',
  SPEECH_STARTING = 'SPEECH_STARTING',
  SPEECH_ACTIVE = 'SPEECH_ACTIVE',
  SPEECH_ENDING = 'SPEECH_ENDING',
}

export interface VADConfig {
  /** Energy threshold above which speech is detected */
  speechThreshold?: number
  /** Energy threshold below which silence is detected */
  silenceThreshold?: number
  /** Milliseconds of silence before considering speech ended */
  silenceDurationMs?: number
  /** Number of consecutive chunks above threshold to confirm speech start */
  speechStartFrames?: number
  /** Enable debug logging */
  debug?: boolean
}

export interface VADCallbacks {
  onSpeechStart?: () => void
  onSpeechEnd?: () => void
}

export class VoiceActivityDetector {
  private state: VADState = VADState.SILENCE
  private config: Required<VADConfig>
  private callbacks: VADCallbacks
  private silenceTimer: NodeJS.Timeout | null = null
  private speechStartFrameCount = 0
  private energyHistory: number[] = []
  private readonly energyHistorySize = 5 // Smooth energy over last 5 chunks

  constructor(config: VADConfig = {}, callbacks: VADCallbacks = {}) {
    this.config = {
      speechThreshold: config.speechThreshold ?? 800,
      silenceThreshold: config.silenceThreshold ?? 200,
      silenceDurationMs: config.silenceDurationMs ?? 800,
      speechStartFrames: config.speechStartFrames ?? 2,
      debug: config.debug ?? false,
    }
    this.callbacks = callbacks
  }

  /**
   * Calculate RMS (Root Mean Square) energy of PCM audio buffer
   * PCM format: 16-bit signed integers, little-endian
   */
  private calculateEnergy(pcmBuffer: Buffer): number {
    if (pcmBuffer.length === 0) return 0

    let sumSquares = 0
    const sampleCount = pcmBuffer.length / 2 // 16-bit = 2 bytes per sample

    // Iterate through samples (16-bit signed, little-endian)
    for (let i = 0; i < pcmBuffer.length; i += 2) {
      const sample = pcmBuffer.readInt16LE(i)
      sumSquares += sample * sample
    }

    const meanSquare = sumSquares / sampleCount
    const rms = Math.sqrt(meanSquare)
    return rms
  }

  /**
   * Get smoothed energy (average of recent chunks)
   */
  private getSmoothedEnergy(energy: number): number {
    this.energyHistory.push(energy)
    if (this.energyHistory.length > this.energyHistorySize) {
      this.energyHistory.shift()
    }
    const sum = this.energyHistory.reduce((a, b) => a + b, 0)
    return sum / this.energyHistory.length
  }

  /**
   * Process an audio chunk and update VAD state
   * @param pcmBuffer PCM audio buffer (16-bit signed, little-endian)
   * @param trackDirection 'inbound' for user's voice, 'outbound' for AI's voice
   */
  processAudio(pcmBuffer: Buffer, trackDirection?: 'inbound' | 'outbound'): void {
    // Only process inbound audio (user's voice)
    if (trackDirection === 'outbound') {
      return
    }

    const energy = this.calculateEnergy(pcmBuffer)
    const smoothedEnergy = this.getSmoothedEnergy(energy)

    if (this.config.debug) {
      //console.log(`[VAD] Energy: ${smoothedEnergy.toFixed(0)}, State: ${this.state}`)
    }

    this.updateState(smoothedEnergy)
  }

  /**
   * Update VAD state based on energy level
   */
  private updateState(energy: number): void {
    switch (this.state) {
      case VADState.SILENCE:
        if (energy > this.config.speechThreshold) {
          this.speechStartFrameCount++
          if (this.speechStartFrameCount >= this.config.speechStartFrames) {
            this.state = VADState.SPEECH_STARTING
            this.speechStartFrameCount = 0
            if (this.config.debug) {
              console.log('[VAD] Speech started')
            }
            if (this.callbacks.onSpeechStart) {
              this.callbacks.onSpeechStart()
            }
            // Immediately transition to active
            this.state = VADState.SPEECH_ACTIVE
          }
        } else {
          this.speechStartFrameCount = 0
        }
        break

      case VADState.SPEECH_STARTING:
        // Shouldn't happen, but handle it
        this.state = VADState.SPEECH_ACTIVE
        break

      case VADState.SPEECH_ACTIVE:
        if (energy < this.config.silenceThreshold) {
          this.state = VADState.SPEECH_ENDING
          this.startSilenceTimer()
        }
        break

      case VADState.SPEECH_ENDING:
        if (energy > this.config.speechThreshold) {
          // Speech resumed, cancel timer
          this.cancelSilenceTimer()
          this.state = VADState.SPEECH_ACTIVE
        }
        // If still silent, timer will fire and transition to SILENCE
        break
    }
  }

  /**
   * Start silence timer - if silence continues, speech has ended
   */
  private startSilenceTimer(): void {
    if (this.silenceTimer) {
      return // Timer already running
    }

    this.silenceTimer = setTimeout(() => {
      this.state = VADState.SILENCE
      this.silenceTimer = null
      if (this.config.debug) {
        console.log('[VAD] Speech ended')
      }
      if (this.callbacks.onSpeechEnd) {
        this.callbacks.onSpeechEnd()
      }
    }, this.config.silenceDurationMs)
  }

  /**
   * Cancel silence timer
   */
  private cancelSilenceTimer(): void {
    if (this.silenceTimer) {
      clearTimeout(this.silenceTimer)
      this.silenceTimer = null
    }
  }

  /**
   * Get current VAD state
   */
  getState(): VADState {
    return this.state
  }

  /**
   * Check if user is currently speaking
   */
  isSpeaking(): boolean {
    return this.state === VADState.SPEECH_ACTIVE || this.state === VADState.SPEECH_STARTING
  }

  /**
   * Reset VAD to initial state
   */
  reset(): void {
    this.cancelSilenceTimer()
    this.state = VADState.SILENCE
    this.speechStartFrameCount = 0
    this.energyHistory = []
  }

  /**
   * Cleanup resources
   */
  destroy(): void {
    this.cancelSilenceTimer()
    this.reset()
  }
}

