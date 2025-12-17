import { createServer } from 'http'
import { parse } from 'url'
import next from 'next'
import { WebSocketServer } from 'ws'
import { AzureSpeechRecognizer } from './src/lib/external/azureSpeech'
import { convertTwilioAudioToPcm } from './src/lib/utils/audioConversion'

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
    
    let recognizer: AzureSpeechRecognizer | null = null
    const referenceText = 'Hello hello hello' // Default reference text - you can make this configurable

    // Send connection acknowledgment to Twilio
    ws.send(JSON.stringify({ event: 'connected' }))

    ws.on('message', (data: Buffer) => {
      try {
        const message = JSON.parse(data.toString())
        console.log('[Media Stream] Received event:', message.event)
        
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
          
          // Initialize Azure Speech Recognizer
          try {
            recognizer = new AzureSpeechRecognizer({
              referenceText,
              onResult: (result, text) => {
                console.log('[Pronunciation] Result received:', {
                  text,
                  accuracy: result.accuracyScore,
                  pronunciation: result.pronunciationScore,
                  completeness: result.completenessScore,
                  fluency: result.fluencyScore,
                  prosody: result.prosodyScore,
                })
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
          if (recognizer) {
            recognizer.stop()
            recognizer.close()
            recognizer = null
          }
        }
      } catch (error) {
        console.error('[Media Stream] Error parsing message:', error)
      }
    })

    ws.on('close', () => {
      console.log('[Media Stream] WebSocket connection closed')
      if (recognizer) {
        recognizer.stop()
        recognizer.close()
        recognizer = null
      }
    })

    ws.on('error', (error) => {
      console.error('[Media Stream] WebSocket error:', error)
      if (recognizer) {
        recognizer.stop()
        recognizer.close()
        recognizer = null
      }
    })
  })

  server.listen(port, () => {
    console.log(`> Ready on http://${hostname}:${port}`)
    console.log(`> WebSocket server ready on ws://${hostname}:${port}/api/media-stream`)
  })
})

