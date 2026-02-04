import { createClient, LiveTranscriptionEvents } from '@deepgram/sdk'

export interface WordDetail {
  word: string
  confidence: number
  start: number
  end: number
  punctuated_word?: string
}

export interface DeepgramTranscriptionResult {
  transcript: string
  isFinal: boolean
  confidence?: number // Overall confidence for the transcript
  words?: WordDetail[] // Word-level confidence scores
}

export interface DeepgramTranscriberConfig {
  onTranscript?: (result: DeepgramTranscriptionResult) => void
  onError?: (error: Error) => void
}

export class DeepgramTranscriber {
  private client: ReturnType<typeof createClient>
  private connection: any = null // Deepgram live connection type
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
      filler_words: true, // Detect filler words (um, uh, etc.)
    })

    this.connection.on(LiveTranscriptionEvents.Open, () => {
      console.log('[Deepgram] Connection opened')
    })

    this.connection.on(LiveTranscriptionEvents.Transcript, (data: any) => {
      if (data.channel?.alternatives?.[0]) {
        const alternative = data.channel.alternatives[0]
        const transcript = alternative.transcript
        const isFinal = data.is_final || false
        const confidence = alternative.confidence

        // Extract word-level confidence scores
        const words: WordDetail[] = alternative.words?.map((word: any) => ({
          word: word.word || '',
          confidence: word.confidence || 0,
          start: word.start || 0,
          end: word.end || 0,
          punctuated_word: word.punctuated_word,
        })) || []

        if (transcript && transcript.trim()) {
          console.log(`[Deepgram] ${isFinal ? 'Final' : 'Interim'}: "${transcript}"`)
          
          // Log word-level confidence for final transcripts
          if (isFinal && words.length > 0) {
            console.log(`[Deepgram] Word-level confidence:`, 
              words.map(w => `${w.word}(${(w.confidence * 100).toFixed(1)}%)`).join(', ')
            )
          }
          
          if (this.config.onTranscript) {
            this.config.onTranscript({
              transcript: transcript.trim(),
              isFinal,
              confidence,
              words: words.length > 0 ? words : undefined,
            })
          }
        }
      }
    })

    this.connection.on(LiveTranscriptionEvents.SpeechStarted, () => {
      console.log('[Deepgram] Speech started')
    })

    this.connection.on(LiveTranscriptionEvents.UtteranceEnd, (data: any) => {
      console.log('[Deepgram] Utterance ended')
    })

    this.connection.on(LiveTranscriptionEvents.Close, () => {
      console.log('[Deepgram] Connection closed')
    })

    this.connection.on(LiveTranscriptionEvents.Error, (error: any) => {
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

