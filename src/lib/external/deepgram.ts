import { createClient, LiveTranscriptionEvents } from '@deepgram/sdk'

export interface DeepgramTranscriptionResult {
  transcript: string
  isFinal: boolean
  confidence?: number
}

export interface DeepgramTranscriberConfig {
  onTranscript?: (result: DeepgramTranscriptionResult) => void
  onError?: (error: Error) => void
}

export class DeepgramTranscriber {
  private client: ReturnType<typeof createClient>
  private connection: ReturnType<typeof createClient['listen']['live']> | null = null
  private config: DeepgramTranscriberConfig
  private isClosed = false

  constructor(config: DeepgramTranscriberConfig) {
    this.config = config

    const apiKey = process.env.DEEPGRAM_API_KEY
    if (!apiKey) {
      throw new Error('Deepgram API key not configured. Set DEEPGRAM_API_KEY in .env.local')
    }

    this.client = createClient(apiKey)
    this.setupConnection()
  }

  private setupConnection() {
    this.connection = this.client.listen.live({
      model: 'nova-2',
      language: 'en-US',
      sample_rate: 8000, // Match Twilio's 8kHz
      channels: 1, // Mono
      encoding: 'linear16', // PCM 16-bit
      interim_results: true, // Get partial transcripts
      punctuate: true,
      diarize: false,
    })

    this.connection.on(LiveTranscriptionEvents.Open, () => {
      console.log('[Deepgram] Connection opened')
    })

    this.connection.on(LiveTranscriptionEvents.Transcript, (data) => {
      if (data.channel?.alternatives?.[0]) {
        const transcript = data.channel.alternatives[0].transcript
        const isFinal = data.is_final || false
        const confidence = data.channel.alternatives[0].confidence

        if (transcript && transcript.trim()) {
          console.log(`[Deepgram] ${isFinal ? 'Final' : 'Interim'}: "${transcript}"`)
          
          if (this.config.onTranscript) {
            this.config.onTranscript({
              transcript: transcript.trim(),
              isFinal,
              confidence,
            })
          }
        }
      }
    })

    this.connection.on(LiveTranscriptionEvents.SpeechStarted, () => {
      console.log('[Deepgram] Speech started')
    })

    this.connection.on(LiveTranscriptionEvents.UtteranceEnd, (data) => {
      console.log('[Deepgram] Utterance ended')
    })

    this.connection.on(LiveTranscriptionEvents.Close, () => {
      console.log('[Deepgram] Connection closed')
    })

    this.connection.on(LiveTranscriptionEvents.Error, (error) => {
      console.error('[Deepgram] Error:', error)
      if (this.config.onError) {
        this.config.onError(new Error(error.message || 'Deepgram error'))
      }
    })
  }

  public sendAudio(audioChunk: Buffer): void {
    if (this.isClosed || !this.connection) {
      return
    }

    try {
      // Deepgram expects raw PCM audio as Buffer/Uint8Array
      // Our audio is already PCM 16-bit, so we can send it directly
      this.connection.send(audioChunk)
    } catch (error) {
      console.error('[Deepgram] Error sending audio:', error)
    }
  }

  public close(): void {
    if (this.isClosed) {
      return
    }

    this.isClosed = true
    
    if (this.connection) {
      try {
        this.connection.finish()
      } catch (error) {
        console.error('[Deepgram] Error closing connection:', error)
      }
      this.connection = null
    }

    console.log('[Deepgram] Transcriber closed')
  }
}

