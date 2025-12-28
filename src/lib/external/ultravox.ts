import { config as loadEnv } from 'dotenv'

loadEnv()

export interface UltravoxCallConfig {
  systemPrompt?: string
  model?: string
  voice?: string
  temperature?: number
  firstSpeaker?: 'FIRST_SPEAKER_AGENT' | 'FIRST_SPEAKER_CALLER'
  firstSpeakerSettings?: {
    user?: Record<string, unknown>
    agent?: Record<string, unknown>
  }
  medium?: {
    twilio?: Record<string, unknown>
  }
  selectedTools?: any[]
}

export interface UltravoxCallResponse {
  callId: string
  joinUrl: string
}

const DEFAULT_CONFIG: UltravoxCallConfig = {
  systemPrompt: 'You are the user\'s good friend. Keep replies brief and natural. Make sure every response prompts the user to speak in some way; carry the conversation on at all times.',
  model: 'fixie-ai/ultravox',
  voice: 'Mark',
  temperature: 0.3,
  // For telephony, Ultravox examples use user as first speaker.
  firstSpeakerSettings: { user: {} },
  medium: { twilio: {} },
  selectedTools: [],
}

export async function createUltravoxCall(
  overrides: Partial<UltravoxCallConfig> = {}
): Promise<UltravoxCallResponse> {
  const apiKey = process.env.ULTRAVOX_API_KEY
  if (!apiKey) {
    throw new Error('ULTRAVOX_API_KEY is not set')
  }

  const payload: UltravoxCallConfig = {
    ...DEFAULT_CONFIG,
    ...overrides,
  }

  const response = await fetch('https://api.ultravox.ai/api/calls', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-API-Key': apiKey,
    },
    body: JSON.stringify(payload),
  })

  if (!response.ok) {
    const text = await response.text()
    throw new Error(`Ultravox call creation failed: ${response.status} ${response.statusText} - ${text}`)
  }

  const data = (await response.json()) as UltravoxCallResponse
  if (!data.callId || !data.joinUrl) {
    throw new Error('Ultravox response missing callId or joinUrl')
  }
  return data
}

