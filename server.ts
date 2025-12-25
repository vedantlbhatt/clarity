// Load environment variables from .env.local FIRST, before any other imports
import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })

import { createServer } from 'http'
import { parse } from 'url'
import next from 'next'
import { WebSocketServer, WebSocket } from 'ws'
import { mkdir, appendFile, access } from 'fs/promises'
import { join } from 'path'
import { AzureSpeechRecognizer } from './src/lib/external/azureSpeech'
import { convertTwilioAudioToPcm } from './src/lib/utils/audioConversion'
import { createUltravoxCall } from './src/lib/external/ultravox'

const dev = process.env.NODE_ENV !== 'production'
const hostname = 'localhost'
const port = parseInt(process.env.PORT || '3000', 10)

const app = next({ dev, hostname, port })
const handle = app.getRequestHandler()

type SessionData = {
  callSid?: string
  userTranscripts: string[]
  aiTranscripts: string[]
  pronunciationResults: Array<{
    text: string
    accuracy: number
    pronunciation: number
    completeness: number
    fluency: number
    prosody: number
    words?: Array<{
      word: string
      accuracy: number
      errorType?: string
      phonemes?: Array<{
        phoneme: string
        accuracy: number
      }>
    }>
  }>
}

const sessions = new Map<string, SessionData>()

const appendTranscript = async (
  streamSid: string,
  speaker: 'user' | 'ai',
  text: string
) => {
  const session = sessions.get(streamSid)
  if (!session) return
  if (speaker === 'user') {
    session.userTranscripts.push(text)
  } else {
    session.aiTranscripts.push(text)
  }
  try {
    const resultsDir = join(process.cwd(), 'results')
    await mkdir(resultsDir, { recursive: true })
    const filepath = join(resultsDir, `transcripts_${streamSid}.txt`)
    const line = `[${speaker.toUpperCase()}] ${text}\n`
    await appendFile(filepath, line, 'utf-8')
  } catch (error) {
    console.error('[Transcripts] Error writing transcript:', error)
  }
}

app.prepare().then(() => {
  const server = createServer()

  // Create WebSocket server WITHOUT attaching to server initially
  // We'll handle upgrades manually to ensure they're processed before Next.js
  const wss = new WebSocketServer({ 
    noServer: true, // Don't attach to server automatically
    path: '/api/media-stream',
    verifyClient: (info: any) => {
      console.log('[Media Stream] WebSocket upgrade request from:', info.origin)
      console.log('[Media Stream] Request path:', info.req.url)
      return true // Accept all connections
    }
  })

  // Handle WebSocket upgrades FIRST - before Next.js
  server.on('upgrade', (request, socket, head) => {
    const pathname = parse(request.url || '', true).pathname
    
    if (pathname === '/api/media-stream') {
      console.log('[Media Stream] Upgrade request received for /api/media-stream')
      wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit('connection', ws, request)
      })
    } else {
      // Not a WebSocket upgrade, destroy the socket
      socket.destroy()
    }
  })

  // Handle all HTTP requests with Next.js
  server.on('request', async (req, res) => {
    try {
      const parsedUrl = parse(req.url!, true)
      await handle(req, res, parsedUrl)
    } catch (err) {
      console.error('Error occurred handling', req.url, err)
      res.statusCode = 500
      res.end('internal server error')
    }
  })

  // Log when WebSocket server is ready
  wss.on('listening', () => {
    console.log('[Media Stream] WebSocket server is listening on /api/media-stream')
  })

  wss.on('error', (error) => {
    console.error('[Media Stream] WebSocket server error:', error)
  })

  wss.on('connection', (ws, req) => {
    console.log('[Media Stream] WebSocket connection established')
    console.log('[Media Stream] Request URL:', req.url)
    console.log('[Media Stream] Request headers:', req.headers)

    const url = parse(req.url || '', true)
    const callSidFromQuery = url.query?.callSid as string | undefined

    let recognizer: AzureSpeechRecognizer | null = null
    let uvSocket: WebSocket | null = null
    let uvCallId: string | null = null
    let streamSid: string | null = null
    let azureResultCount = 0
    const pendingToUltravox: string[] = []

    const cleanup = () => {
      if (recognizer) {
        recognizer.stop()
        recognizer.close()
        recognizer = null
      }
      if (uvSocket) {
        try {
          uvSocket.close()
        } catch {}
        uvSocket = null
      }
    }

    const ensureUltravox = async () => {
      if (uvSocket) return
      const uvCall = await createUltravoxCall()
      uvCallId = uvCall.callId
      console.log('[Ultravox] Call created:', uvCallId)

      uvSocket = new WebSocket(uvCall.joinUrl)

      uvSocket.on('open', () => {
        console.log('[Ultravox] WebSocket connected to joinUrl')
        // Flush any pending Twilio messages (start + early media) to Ultravox
        while (pendingToUltravox.length > 0 && uvSocket && uvSocket.readyState === WebSocket.OPEN) {
          const msg = pendingToUltravox.shift()
          if (msg) {
            uvSocket.send(msg)
          }
        }
      })

      uvSocket.on('message', (data) => {
        const text = data.toString()
        //console.log('[Ultravox] → Twilio message', text.slice(0, 200))
        if (ws.readyState === ws.OPEN) {
          ws.send(text)
        }
      })

      uvSocket.on('close', () => {
        console.log('[Ultravox] WebSocket closed')
      })

      uvSocket.on('error', (error) => {
        console.error('[Ultravox] WebSocket error:', error)
      })
    }

    const logCallSummary = (sid: string) => {
      const session = sessions.get(sid)
      if (!session) return
      const count = session.pronunciationResults.length
      console.log(`[Feedback] Call summary for stream ${sid}:`)
      console.log(`  Pronunciation results: ${count}`)
      if (count > 0) {
        const last = session.pronunciationResults[count - 1]
        console.log(
          `  Last result -> Acc:${last.accuracy}% Pron:${last.pronunciation}% Comp:${last.completeness}% Flu:${last.fluency}% Pros:${last.prosody}% text="${last.text}"`
        )
      }

      // Aggregate phoneme accuracy across all results
      const phonemeStats = new Map<string, { sum: number; count: number }>()
      const allWords = session.pronunciationResults.flatMap((r) => r.words || [])
      allWords.forEach((w) => {
        (w.phonemes || []).forEach((p) => {
          const entry = phonemeStats.get(p.phoneme) || { sum: 0, count: 0 }
          entry.sum += p.accuracy
          entry.count += 1
          phonemeStats.set(p.phoneme, entry)
        })
      })

      const phonemeAverages = Array.from(phonemeStats.entries()).map(([phoneme, v]) => ({
        phoneme,
        avg: v.sum / v.count,
        count: v.count,
      }))

      const worstPhonemes = phonemeAverages
        .sort((a, b) => a.avg - b.avg)
        .slice(0, 5)

      if (worstPhonemes.length > 0) {
        console.log('  Phonemes needing work (lowest avg accuracy):')
        worstPhonemes.forEach((p) => {
          console.log(`    /${p.phoneme}/  avg:${p.avg.toFixed(1)}%  samples:${p.count}`)
        })
      }

      const resultsPath = join(process.cwd(), 'results', `pronunciation_${sid}.txt`)
      console.log(`  Detailed file: ${resultsPath}`)
    }

    const ensureRecognizer = () => {
      if (recognizer) return
      if (!process.env.AZURE_SPEECH_KEY || !process.env.AZURE_SPEECH_REGION) {
        console.error('[Azure] Missing credentials: AZURE_SPEECH_KEY or AZURE_SPEECH_REGION not set')
        ws.send(JSON.stringify({ event: 'error', message: 'Azure Speech credentials not configured' }))
        return
      }

      recognizer = new AzureSpeechRecognizer({
        onTranscript: (text, isFinal) => {
          console.log(`[Azure] Transcript (${isFinal ? 'final' : 'partial'}): "${text}"`)
        },
        onResult: async (result, text) => {
          azureResultCount += 1
          console.log('[Pronunciation] Result received:', {
            text,
            accuracy: result.accuracyScore,
            pronunciation: result.pronunciationScore,
            completeness: result.completenessScore,
            fluency: result.fluencyScore,
            prosody: result.prosodyScore,
          })

          try {
            if (streamSid) {
              const s = sessions.get(streamSid)
              if (s) {
                s.pronunciationResults.push({
                  text,
                  accuracy: result.accuracyScore,
                  pronunciation: result.pronunciationScore,
                  completeness: result.completenessScore,
                  fluency: result.fluencyScore,
                  prosody: result.prosodyScore,
                  words: result.words?.map((w) => ({
                    word: w.word,
                    accuracy: w.accuracyScore,
                    errorType: w.errorType,
                    phonemes: w.phonemes?.map((p) => ({
                      phoneme: p.phoneme,
                      accuracy: p.accuracyScore,
                    })),
                  })),
                })
              }
            }

            const resultsDir = join(process.cwd(), 'results')
            await mkdir(resultsDir, { recursive: true })
            const filename = `pronunciation_${streamSid || 'unknown'}.txt`
            const filepath = join(resultsDir, filename)
            const fileExists = await access(filepath).then(() => true).catch(() => false)

            let content = ''
            if (!fileExists) {
              const callStartTime = new Date().toISOString()
              content += `Pronunciation Assessment Results\n`
              content += `===============================\n`
              content += `Call Start Time: ${callStartTime}\n`
              content += `Stream SID: ${streamSid || 'N/A'}\n`
              content += `Call SID: ${callSidFromQuery || 'N/A'}\n`
              content += `Ultravox Call ID: ${uvCallId || 'N/A'}\n`
              content += `\n${'='.repeat(60)}\n\n`
            }

            const timestamp = new Date().toISOString()
            content += `Result #${azureResultCount}\n`
            content += `Timestamp: ${timestamp}\n`
            content += `Recognized Text: "${text}"\n\n`
            content += `Scores:\n`
            content += `  Accuracy: ${result.accuracyScore}%\n`
            content += `  Pronunciation: ${result.pronunciationScore}%\n`
            content += `  Completeness: ${result.completenessScore}%\n`
            content += `  Fluency: ${result.fluencyScore}%\n`
            content += `  Prosody: ${result.prosodyScore}%\n\n`

            if (result.words && result.words.length > 0) {
              content += `Word-level Details:\n`
              result.words.forEach((word, idx) => {
                content += `  ${idx + 1}. "${word.word}": ${word.accuracyScore}% (${word.errorType || 'None'})\n`
              })
              content += `\n`
            }

            content += `${'-'.repeat(60)}\n\n`
            await appendFile(filepath, content, 'utf-8')
            console.log(`[Results] Appended result to ${filepath}`)
          } catch (error) {
            console.error('[Results] Error saving to file:', error)
          }
        },
        onError: (error) => {
          console.error('[Azure] Error:', error)
          ws.send(JSON.stringify({ event: 'error', message: error.message }))
        },
      })

      recognizer.start()
      console.log('[Azure] Recognizer started for pronunciation assessment')
    }

    // Send connection acknowledgment to Twilio
    ws.send(JSON.stringify({ event: 'connected' }))

    ws.on('message', async (data: Buffer) => {
      const raw = data.toString()
      let message: any
      try {
        message = JSON.parse(raw)
      } catch (error) {
        console.error('[Media Stream] Error parsing message:', error)
        return
      }

      /*
      if (message?.event) {
        console.log('[Twilio] event ->', message.event, 'seq', message.sequenceNumber || '')
      }
        */

      // Forward to Ultravox if connected
      if (uvSocket && uvSocket.readyState === WebSocket.OPEN) {
        uvSocket.send(raw)
      } else {
        pendingToUltravox.push(raw)
      }

      if (message.event === 'start') {
        const sid: string = message.streamSid
        streamSid = sid
        console.log('[Media Stream] Stream started:', { streamSid: sid, callSid: message.start?.callSid })
        sessions.set(sid, {
          callSid: message.start?.callSid || callSidFromQuery,
          userTranscripts: [],
          aiTranscripts: [],
          pronunciationResults: [],
        })
        try {
          await ensureUltravox()
        } catch (error: any) {
          console.error('[Ultravox] Failed to create or connect:', error)
          ws.send(JSON.stringify({ event: 'error', message: error.message || 'Ultravox init failed' }))
        }
        ensureRecognizer()
      } else if (message.event === 'media') {
        if (recognizer && message.media?.payload) {
          try {
            const pcmBuffer = convertTwilioAudioToPcm(message.media.payload)
            if (pcmBuffer.length > 0) {
              recognizer.writeAudioChunk(pcmBuffer)
            }
          } catch (error) {
            console.error('[Media Stream] Error processing audio:', error)
          }
        }
      } else if (message.event === 'stop') {
        console.log('[Media Stream] Stream stopped')
        cleanup()
        if (streamSid) {
          logCallSummary(streamSid)
          sessions.delete(streamSid)
        }
      }
    })

    ws.on('close', () => {
      console.log('[Media Stream] WebSocket connection closed')
      cleanup()
      if (streamSid) {
        logCallSummary(streamSid)
        sessions.delete(streamSid)
      }
    })

    ws.on('error', (error) => {
      console.error('[Media Stream] WebSocket error:', error)
      cleanup()
      if (streamSid) {
        logCallSummary(streamSid)
        sessions.delete(streamSid)
      }
    })
  })

  server.listen(port, () => {
    console.log(`> Ready on http://${hostname}:${port}`)
    console.log(`> WebSocket server ready on ws://${hostname}:${port}/api/media-stream`)
  })
})

