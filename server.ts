// Load environment variables from .env.local FIRST, before any other imports
import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })

import { createServer } from 'http'
import { parse } from 'url'
import next from 'next'
import { WebSocketServer } from 'ws'
import { writeFile, mkdir, appendFile } from 'fs/promises'
import { join } from 'path'
import { AzureSpeechRecognizer } from './src/lib/external/azureSpeech'
import { DeepgramTranscriber } from './src/lib/external/deepgram'
import { convertTwilioAudioToPcm } from './src/lib/utils/audioConversion'
import { CallSession } from './src/lib/session/callSession'
import { handleFeedbackAt30Seconds } from './src/lib/services/feedbackHandler'

const dev = process.env.NODE_ENV !== 'production'
const hostname = 'localhost'
const port = parseInt(process.env.PORT || '3000', 10)

const app = next({ dev, hostname, port })
const handle = app.getRequestHandler()

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
    
    // Extract callSid from query parameters
    const url = parse(req.url || '', true)
    const callSidFromQuery = url.query?.callSid as string | undefined
    
    let recognizer: AzureSpeechRecognizer | null = null
    let transcriber: DeepgramTranscriber | null = null
    let session: CallSession | null = null
    let feedbackTriggered = false
    let baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000'
    
    // Try to get base URL from request headers
    const host = req.headers.host
    const protocol = req.headers['x-forwarded-proto'] || 'http'
    if (host && !host.includes('localhost')) {
      baseUrl = `${protocol}://${host}`
    }
    
    const referenceText = 'The quick brown fox jumps over the lazy dog. She sells seashells by the seashore. Peter Piper picked a peck of pickled peppers. How much wood would a woodchuck chuck? Unique New York. Red leather, yellow leather. Toy boat. Irish wristwatch.' // Default reference text - you can make this configurable

    // Send connection acknowledgment to Twilio
    ws.send(JSON.stringify({ event: 'connected' }))

    ws.on('message', (data: Buffer) => {
      try {
        const message = JSON.parse(data.toString())
        //console.log('[Media Stream] Received event:', message.event)
        
        // Handle Twilio Media Stream events
        if (message.event === 'connected') {
          console.log('[Media Stream] Connected event received')
        } else if (message.event === 'start') {
          console.log('[Media Stream] Stream started')
          console.log('[Media Stream] Start details:', {
            streamSid: message.streamSid,
            tracks: message.start?.tracks,
            mediaFormat: message.start?.mediaFormat,
          })
          
          // Check Azure credentials before initializing
          if (!process.env.AZURE_SPEECH_KEY || !process.env.AZURE_SPEECH_REGION) {
            console.error('[Azure] Missing credentials: AZURE_SPEECH_KEY or AZURE_SPEECH_REGION not set')
            ws.send(JSON.stringify({ 
              event: 'error', 
              message: 'Azure Speech credentials not configured' 
            }))
            return
          }
          
          // Store streamSid for use in callbacks
          const streamSid = message.streamSid
          // Try to get callSid from multiple sources
          const callSid = message.start?.callSid || message.callSid || callSidFromQuery
          
          // Create session tracker
          session = new CallSession(streamSid, callSid)
          console.log('[Session] CallSid sources:', {
            fromQuery: callSidFromQuery,
            fromStart: message.start?.callSid,
            fromMessage: message.callSid,
            final: callSid,
          })
          console.log('[Session] Created session for stream:', streamSid, 'call:', callSid)
          
          // Start timer that checks for 30 seconds
          session.startTimer((elapsedSeconds) => {
            if (elapsedSeconds === 30 && !feedbackTriggered) {
              feedbackTriggered = true
              console.log('[Session] 30 seconds reached, triggering feedback')
              handleFeedbackAt30Seconds(session!, baseUrl).catch((error) => {
                console.error('[Session] Error in feedback handler:', error)
              })
            }
          })
          
          // Initialize Deepgram Transcriber
          try {
            transcriber = new DeepgramTranscriber({
              onTranscript: async (result) => {
                console.log(`[Deepgram] ${result.isFinal ? 'Final' : 'Interim'} transcript: "${result.transcript}"`)
                
                // Store transcript in session
                if (session) {
                  session.addTranscript(result)
                }
                
                // Save transcription to file
                try {
                  const resultsDir = join(process.cwd(), 'results')
                  await mkdir(resultsDir, { recursive: true })
                  
                  const transcriptFile = join(resultsDir, `transcription_${streamSid}.txt`)
                  const timestamp = new Date().toISOString()
                  const prefix = result.isFinal ? '[FINAL]' : '[INTERIM]'
                  
                  let line = `${prefix} [${timestamp}] ${result.transcript}`
                  
                  // Add word-level confidence if available
                  if (result.words && result.words.length > 0) {
                    const wordConfidences = result.words.map(w => 
                      `${w.word}(${(w.confidence * 100).toFixed(0)}%)`
                    ).join(' ')
                    line += `\n  Word confidence: ${wordConfidences}`
                  }
                  
                  await appendFile(
                    transcriptFile,
                    `${line}\n`,
                    'utf-8'
                  )
                } catch (error) {
                  console.error('[Deepgram] Error saving transcription:', error)
                }
              },
              onError: (error) => {
                console.error('[Deepgram] Error:', error)
              },
            })
            console.log('[Deepgram] Transcriber initialized')
          } catch (error: any) {
            console.error('[Deepgram] Failed to initialize:', error)
            // Don't fail the whole call if Deepgram fails
          }
          
          // Initialize Azure Speech Recognizer
          try {
            
            recognizer = new AzureSpeechRecognizer({
              referenceText,
              onResult: async (result, text) => {
                console.log('[Pronunciation] Result received:', {
                  text,
                  accuracy: result.accuracyScore,
                  pronunciation: result.pronunciationScore,
                  completeness: result.completenessScore,
                  fluency: result.fluencyScore,
                  prosody: result.prosodyScore,
                })
                
                // Store Azure result in session
                if (session) {
                  session.addAzureResult(result, text)
                }
                
                // Save results to file
                try {
                  const resultsDir = join(process.cwd(), 'results')
                  await mkdir(resultsDir, { recursive: true })
                  
                  const timestamp = new Date().toISOString()
                  const filename = `pronunciation_${Date.now()}.txt`
                  const filepath = join(resultsDir, filename)
                  
                  let content = `Pronunciation Assessment Result\n`
                  content += `==============================\n`
                  content += `Timestamp: ${timestamp}\n`
                  content += `Stream SID: ${streamSid || 'N/A'}\n`
                  content += `Reference Text: ${referenceText}\n`
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
                      if (word.phonemes && word.phonemes.length > 0) {
                        content += `     Phonemes: ${word.phonemes.map(p => `${p.phoneme}(${p.accuracyScore}%)`).join(', ')}\n`
                      }
                    })
                  }
                  
                  content += `\n${'='.repeat(30)}\n\n`
                  
                  await writeFile(filepath, content, 'utf-8')
                  console.log(`[Results] Saved to ${filepath}`)
                } catch (error) {
                  console.error('[Results] Error saving to file:', error)
                }
              },
              onError: (error) => {
                console.error('[Azure] Error:', error)
                ws.send(JSON.stringify({ 
                  event: 'error', 
                  message: error.message 
                }))
              },
            })
            
            recognizer.start()
            console.log('[Azure] Recognizer started with reference text:', referenceText)
          } catch (error: any) {
            console.error('[Azure] Failed to initialize:', error)
            console.error('[Azure] Error details:', error?.message, error?.stack)
            ws.send(JSON.stringify({ 
              event: 'error', 
              message: `Azure initialization failed: ${error?.message || 'Unknown error'}` 
            }))
          }
        } else if (message.event === 'media') {
          // Twilio sends audio as base64-encoded μ-law
          // According to Twilio docs: message.media.payload contains base64 μ-law
          if (recognizer && message.media?.payload) {
            try {
              // Log first few media events to verify we're getting payloads
              if (!(recognizer as any)._mediaCount) {
                (recognizer as any)._mediaCount = 0
              }
              (recognizer as any)._mediaCount++
              
              if ((recognizer as any)._mediaCount <= 5) {
                console.log(`[Media Stream] Media event #${(recognizer as any)._mediaCount}: payload length=${message.media.payload?.length || 0} chars`)
              }
              
              // Convert μ-law to PCM
              const pcmBuffer = convertTwilioAudioToPcm(message.media.payload)
              
              // Store audio chunk in session
              if (session) {
                session.addAudioChunk(pcmBuffer)
              }
              
              // Send PCM audio to Azure
              // Only write if buffer has data
              if (pcmBuffer.length > 0) {
                // Log audio chunk details for first few chunks
                if ((recognizer as any)._mediaCount <= 5) {
                  console.log(`[Media Stream] Converted to PCM: ${pcmBuffer.length} bytes`)
                  // Check if audio has non-zero samples (not silence)
                  let nonZeroSamples = 0
                  let maxSample = 0
                  for (let i = 0; i < Math.min(pcmBuffer.length, 200); i += 2) {
                    const sample = Math.abs(pcmBuffer.readInt16LE(i))
                    if (sample > 100) { // Threshold for non-silence
                      nonZeroSamples++
                    }
                    if (sample > maxSample) maxSample = sample
                  }
                  console.log(`[Media Stream] Sample analysis: ${nonZeroSamples} non-silent samples, max amplitude: ${maxSample}`)
                }
                
                // Log occasionally after first 5
                if ((recognizer as any)._mediaCount > 5 && Math.random() < 0.01) {
                  let nonZeroSamples = 0
                  for (let i = 0; i < Math.min(pcmBuffer.length, 100); i += 2) {
                    const sample = pcmBuffer.readInt16LE(i)
                    if (Math.abs(sample) > 100) {
                      nonZeroSamples++
                    }
                  }
                  if (nonZeroSamples === 0) {
                    console.log(`[Media Stream] WARNING: Audio chunk appears to be silence`)
                  }
                }
                
                recognizer.writeAudioChunk(pcmBuffer)
                
                // Also send to Deepgram for transcription
                if (transcriber) {
                  transcriber.sendAudio(pcmBuffer)
                }
              } else {
                console.warn(`[Media Stream] WARNING: PCM buffer is empty after conversion`)
              }
            } catch (error) {
              console.error('[Media Stream] Error processing audio:', error)
            }
          } else if (!recognizer) {
            // Recognizer not initialized yet - this is normal before 'start' event
            // Don't log as warning, just skip
          } else if (!message.media?.payload) {
            // Log if payload is missing
            console.warn('[Media Stream] Media event missing payload')
          }
        } else if (message.event === 'stop') {
          console.log('[Media Stream] Stream stopped')
          if (session) {
            session.stopTimer()
            session.cleanup()
            session = null
          }
          if (recognizer) {
            recognizer.stop()
            recognizer.close()
            recognizer = null
          }
          if (transcriber) {
            transcriber.close()
            transcriber = null
          }
        }
      } catch (error) {
        console.error('[Media Stream] Error parsing message:', error)
      }
    })

    ws.on('close', () => {
      console.log('[Media Stream] WebSocket connection closed')
      if (session) {
        session.stopTimer()
        session.cleanup()
        session = null
      }
      if (recognizer) {
        recognizer.stop()
        recognizer.close()
        recognizer = null
      }
      if (transcriber) {
        transcriber.close()
        transcriber = null
      }
    })

    ws.on('error', (error) => {
      console.error('[Media Stream] WebSocket error:', error)
      if (session) {
        session.stopTimer()
        session.cleanup()
        session = null
      }
      if (recognizer) {
        recognizer.stop()
        recognizer.close()
        recognizer = null
      }
      if (transcriber) {
        transcriber.close()
        transcriber = null
      }
    })
  })

  server.listen(port, () => {
    console.log(`> Ready on http://${hostname}:${port}`)
    console.log(`> WebSocket server ready on ws://${hostname}:${port}/api/media-stream`)
  })
})

