// Load environment variables from .env.local FIRST, before any other imports
import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })

import { createServer } from 'http'
import { parse } from 'url'
import next from 'next'
import { WebSocketServer } from 'ws'
import { writeFile, mkdir, appendFile, access } from 'fs/promises'
import { join } from 'path'
import { AzureSpeechRecognizer } from './src/lib/external/azureSpeech'
import { DeepgramTranscriber } from './src/lib/external/deepgram'
import { convertTwilioAudioToPcm, convertPcmToMulaw, extractPcmFromWav, downsample16kTo8k } from './src/lib/utils/audioConversion'
import { CallSession } from './src/lib/session/callSession'
import { handleFeedbackAt30Seconds } from './src/lib/services/feedbackHandler'
import { VoiceActivityDetector } from './src/lib/utils/vad'
import { generateConversationResponse } from './src/lib/session/geminiConversation'
import { textToSpeech, textToSpeechFile } from './src/lib/external/azureTTS'
import twilio from 'twilio'

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
    let vad: VoiceActivityDetector | null = null
    let trackDirection: 'inbound' | 'outbound' = 'inbound' // Default to inbound (user's voice)
    let isAISpeaking = false // Flag to prevent processing user speech while AI is talking
    
    /**
     * Get Twilio client
     */
    const getTwilioClient = () => {
      const accountSid = process.env.TWILIO_ACCOUNT_SID
      const authToken = process.env.TWILIO_AUTH_TOKEN

      if (!accountSid || !authToken) {
        throw new Error('Twilio credentials not configured')
      }

      return twilio(accountSid, authToken)
    }

    /**
     * Convert text to speech and play back to user via Twilio REST API
     * Uses the same approach as feedback handler: save to file, serve via HTTP, play via TwiML
     * @param text - Text to speak
     */
    /**
     * Stream Azure TTS audio directly through Media Stream WebSocket
     * This avoids using update() which stops the stream
     */
    const speakToUser = async (text: string): Promise<void> => {
      if (isAISpeaking) {
        console.log('[TTS Playback] AI is already speaking, skipping')
        return
      }

      // Check if WebSocket is still open
      if (ws.readyState !== ws.OPEN) {
        console.warn('[TTS Playback] WebSocket is not open (state:', ws.readyState, '), cannot stream audio')
        return
      }

      if (!session?.getData().callSid) {
        console.warn('[TTS Playback] No callSid available, cannot play audio')
        return
      }

      const ttsStreamSid = (ws as any).streamSid
      if (!ttsStreamSid) {
        console.warn('[TTS Playback] No streamSid available, cannot stream audio')
        return
      }

      try {
        isAISpeaking = true
        console.log('[TTS Playback] Converting to speech:', text.substring(0, 50) + '...')
        
        // Generate TTS using Azure (in-memory, don't save to file)
        const ttsBuffer = await textToSpeech(text, {
          voice: 'en-US-AriaNeural',
          rate: '+0%',
        })
        
        console.log('[TTS Playback] TTS generated, length:', ttsBuffer.length, 'bytes')
        
        // Extract PCM from WAV (Azure returns 16kHz WAV)
        const pcm16k = extractPcmFromWav(ttsBuffer)
        console.log('[TTS Playback] Extracted PCM (16kHz), length:', pcm16k.length, 'bytes')
        
        // Downsample from 16kHz to 8kHz (Twilio requires 8kHz)
        const pcm8k = downsample16kTo8k(pcm16k)
        console.log('[TTS Playback] Downsampled to 8kHz, length:', pcm8k.length, 'bytes')
        
        // Convert PCM to μ-law (Twilio Media Streams format)
        const mulawBuffer = convertPcmToMulaw(pcm8k)
        console.log('[TTS Playback] Converted to μ-law, length:', mulawBuffer.length, 'bytes')
        
        // Convert entire audio to base64 (call-gpt sends entire payload at once, not chunked)
        const base64Audio = mulawBuffer.toString('base64')
        console.log('[TTS Playback] Base64 audio length:', base64Audio.length, 'chars')
        
        // Check if WebSocket is still open
        if (ws.readyState !== ws.OPEN) {
          console.warn('[TTS Playback] WebSocket is not open, cannot send audio')
          isAISpeaking = false
          return
        }
        
        // Send entire audio payload in one message (call-gpt approach)
        // This avoids glitchy/staticy sound from small chunks and timing issues
        const mediaMessage = {
          streamSid: ttsStreamSid,
          event: 'media',
          media: {
            payload: base64Audio
          }
        }
        
        console.log('[TTS Playback] Sending entire audio payload (call-gpt style)')
        
        try {
          ws.send(JSON.stringify(mediaMessage))
          console.log('[TTS Playback] Audio sent successfully')
        } catch (error: any) {
          console.error('[TTS Playback] Error sending audio:', error)
          isAISpeaking = false
          return
        }
        
        console.log('[TTS Playback] Finished streaming audio')
        
        // Reset flag after a brief delay
        setTimeout(() => {
          isAISpeaking = false
          console.log('[TTS Playback] AI finished speaking')
        }, 100)
        
      } catch (error: any) {
        console.error('[TTS Playback] Error:', error)
        isAISpeaking = false
      }
    }
    
    // Try to get base URL from request headers
    const host = req.headers.host
    const protocol = req.headers['x-forwarded-proto'] || 'http'
    if (host && !host.includes('localhost')) {
      baseUrl = `${protocol}://${host}`
    }
    
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
          
          // Determine track direction from start event if available
          // If TwiML specified track="inbound", all media will be inbound
          // If track="both", we'll need to check message.media.track for each chunk
          if (message.start?.tracks) {
            // If tracks array exists, check what's available
            // For now, default to inbound since that's what we're using
            trackDirection = 'inbound'
          }
          
          // Check Azure credentials before initializing
          if (!process.env.AZURE_SPEECH_KEY || !process.env.AZURE_SPEECH_REGION) {
            console.error('[Azure] Missing credentials: AZURE_SPEECH_KEY or AZURE_SPEECH_REGION not set')
            ws.send(JSON.stringify({ 
              event: 'error', 
              message: 'Azure Speech credentials not configured' 
            }))
            return
          }
          
          // Store streamSid for use in callbacks (CRITICAL: needed to send audio back)
          const streamSid = message.streamSid
          // Try to get callSid from multiple sources  
          const callSid = message.start?.callSid || message.callSid || (callSidFromQuery ? callSidFromQuery : undefined)
          
          // Store WebSocket reference for sending audio back (for TTS streaming)
          const wsAny = ws as any
          wsAny.streamSid = streamSid
          wsAny.callSid = callSid
          
          // Create session tracker
          session = new CallSession(streamSid, callSid)
          console.log('[Session] CallSid sources:', {
            fromQuery: callSidFromQuery,
            fromStart: message.start?.callSid,
            fromMessage: message.callSid,
            final: callSid,
          })
          console.log('[Session] Created session for stream:', streamSid, 'call:', callSid)
          
          // Initialize Voice Activity Detector
          vad = new VoiceActivityDetector(
            {
              speechThreshold: 800,
              silenceThreshold: 200,
              silenceDurationMs: 800,
              speechStartFrames: 2,
              debug: true, // Enable debug logging for now
            },
            {
              onSpeechStart: () => {
                console.log('[VAD] 🎤 User started speaking')
                // Clear Azure audio buffer when speech starts
                // This ensures we only assess the current utterance, not previous ones
                if (recognizer) {
                  recognizer.clearAudioBuffer()
                }
              },
              onSpeechEnd: async () => {
                console.log('[VAD] 🔇 User finished speaking')
                
                // Check if session and WebSocket are still valid
                if (!session) {
                  console.warn('[Conversation] No session available, skipping conversation turn')
                  return
                }
                
                // Check if WebSocket is still open
                if (ws.readyState !== ws.OPEN) {
                  console.warn('[Conversation] WebSocket is not open (state:', ws.readyState, '), skipping conversation turn')
                  return
                }

                // Wait a brief moment for Deepgram to finalize transcript
                // Deepgram might still be processing, so we give it a small delay
                await new Promise(resolve => setTimeout(resolve, 300))
                
                // Re-check session and WebSocket after delay (stream might have stopped)
                if (!session) {
                  console.warn('[Conversation] Session became null during delay, skipping conversation turn')
                  return
                }
                
                if (ws.readyState !== ws.OPEN) {
                  console.warn('[Conversation] WebSocket closed during delay, skipping conversation turn')
                  return
                }
                
                // Get the current user transcript
                const currentTranscript = session.getLatestFinalTranscript()
                
                if (!currentTranscript || currentTranscript.trim().length === 0) {
                  console.log('[Conversation] No valid transcript found, skipping conversation turn')
                  console.log('[Conversation] Available transcripts:', session.getData().transcripts.length)
                  return
                }

                const trimmedTranscript = currentTranscript.trim()
                
                // Skip if transcript is too short (likely noise or false positive)
                if (trimmedTranscript.length < 2) {
                  console.log('[Conversation] Transcript too short, skipping:', trimmedTranscript)
                  return
                }

                console.log('[Conversation] Processing user message:', trimmedTranscript)
                
                // Add user message to conversation history
                session.addUserMessage(trimmedTranscript)
                
                // Get conversation context (past + current)
                const context = session.getConversationContext()
                const turnCount = session.getConversationTurnCount()
                
                console.log('[Conversation] Context prepared (Turn #' + turnCount + '):')
                console.log('  Past messages:', context.past.length)
                if (context.past.length > 0) {
                  context.past.forEach((msg, idx) => {
                    const roleLabel = msg.role === 'user' ? '👤 User' : '🤖 AI'
                    console.log(`    ${idx + 1}. ${roleLabel}: "${msg.text.substring(0, 50)}${msg.text.length > 50 ? '...' : ''}"`)
                  })
                } else {
                  console.log('    (No previous conversation history)')
                }
                console.log('  Current message:', context.curr)
                
                // Get Gemini-formatted history for API call
                const geminiHistory = session.getGeminiFormatHistory()
                console.log('[Conversation] Ready for Gemini API call')
                console.log(`[Conversation] Total messages in history: ${geminiHistory.length}`)
                
                // Call Gemini API with conversation context
                try {
                  const geminiResponse = await generateConversationResponse(
                    context.past.map(msg => ({
                      role: msg.role === 'assistant' ? 'model' : 'user',
                      parts: [{ text: msg.text }]
                    })),
                    context.curr || '',
                    'You are a friendly English pronunciation tutor. Have natural, helpful conversations with students. Keep responses concise (1-2 sentences) for phone conversations.'
                  )

                  // Final check before using session
                  if (!session || ws.readyState !== ws.OPEN) {
                    console.warn('[Conversation] Session or WebSocket invalid after Gemini call, skipping TTS')
                    return
                  }

                  if (geminiResponse) {
                    session.addAssistantMessage(geminiResponse)
                    console.log('[Conversation] AI response:', geminiResponse)
                    // Convert to TTS and play back
                    await speakToUser(geminiResponse)
                  }
                } catch (error: any) {
                  console.error('[Conversation] Error calling Gemini:', error)
                  
                  // Final check before using session
                  if (!session || ws.readyState !== ws.OPEN) {
                    console.warn('[Conversation] Session or WebSocket invalid after error, skipping fallback')
                    return
                  }
                  
                  // Optionally add a fallback message
                  const fallbackMessage = "I'm sorry, I didn't catch that. Could you repeat?"
                  session.addAssistantMessage(fallbackMessage)
                  console.log('[Conversation] Using fallback message:', fallbackMessage)
                  // Convert fallback to TTS and play back
                  await speakToUser(fallbackMessage)
                }

              },
            }
          )
          console.log('[VAD] Voice Activity Detector initialized')
          
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
          
          // Initialize Azure Speech Recognizer (unscripted mode - no reference text)
          try {
            
            recognizer = new AzureSpeechRecognizer({
              // No referenceText - using unscripted mode
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
                
                // Save results to file (append to single file per call)
                try {
                  const resultsDir = join(process.cwd(), 'results')
                  await mkdir(resultsDir, { recursive: true })
                  
                  // Use streamSid to create one file per call
                  const filename = `pronunciation_${streamSid || 'unknown'}.txt`
                  const filepath = join(resultsDir, filename)
                  
                  // Check if file exists to determine if we need to write header
                  const fileExists = await access(filepath).then(() => true).catch(() => false)
                  
                  let content = ''
                  
                  // Write header only if this is the first result for this call
                  if (!fileExists) {
                    const callStartTime = new Date().toISOString()
                    content += `Pronunciation Assessment Results (Two-Step Scripted Mode)\n`
                    content += `========================================================\n`
                    content += `Call Start Time: ${callStartTime}\n`
                    content += `Stream SID: ${streamSid || 'N/A'}\n`
                    content += `Call SID: ${session?.getData().callSid || 'N/A'}\n`
                    content += `\n${'='.repeat(60)}\n\n`
                  }
                  
                  // Append this result
                  const timestamp = new Date().toISOString()
                  content += `Result #${(session?.getData().azureResults.length || 0)}\n`
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
                      if (word.phonemes && word.phonemes.length > 0) {
                        content += `     Phonemes: ${word.phonemes.map(p => `${p.phoneme}(${p.accuracyScore}%)`).join(', ')}\n`
                      }
                    })
                    content += `\n`
                  }
                  
                  content += `${'-'.repeat(60)}\n\n`
                  
                  // Append to file (create if doesn't exist)
                  await appendFile(filepath, content, 'utf-8')
                  console.log(`[Results] Appended result to ${filepath}`)
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
            console.log('[Azure] Recognizer started in unscripted mode (no reference text)')
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
          // Log incoming media format for reference (first few only)
          if (!(ws as any)._inboundMediaCount) {
            (ws as any)._inboundMediaCount = 0
          }
          if ((ws as any)._inboundMediaCount++ < 3) {
            console.log('[Media Stream] Incoming media format:', {
              event: message.event,
              hasStreamSid: !!message.streamSid,
              hasSequenceNumber: !!message.sequenceNumber,
              mediaTrack: message.media?.track,
              hasPayload: !!message.media?.payload,
              payloadLength: message.media?.payload?.length || 0
            })
          }
          
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
              
              // Check if this media event specifies a track (if track="both" in TwiML)
              const mediaTrack = message.media?.track
              const currentTrack = mediaTrack === 'inbound' || mediaTrack === 'outbound' 
                ? mediaTrack 
                : trackDirection // Use default from start event
              
              // Process audio through VAD (only for inbound/user audio)
              if (vad && currentTrack === 'inbound') {
                vad.processAudio(pcmBuffer, currentTrack)
              }
              
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
          console.log('[Media Stream] Stop event details:', JSON.stringify(message, null, 2))
          console.log('[Media Stream] Stop event - isAISpeaking:', isAISpeaking)
          console.log('[Media Stream] Stop event - session exists:', !!session)
          console.log('[Media Stream] Stop event - WebSocket state:', ws.readyState)
          
          // Don't clean up immediately if AI is speaking - wait for it to finish
          // This prevents the stream from closing mid-conversation
          if (isAISpeaking) {
            console.log('[Media Stream] AI is speaking, deferring cleanup until TTS completes')
            // Set a flag to clean up after TTS finishes
            // The cleanup will happen in the speakToUser function after it finishes
            return
          }
          
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
          if (vad) {
            vad.destroy()
            vad = null
          }
        }
      } catch (error: any) {
        console.error('[Media Stream] Error parsing message:', error)
        console.error('[Media Stream] Error details:', error?.message, error?.stack)
        // Don't crash - just log the error
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
      if (vad) {
        vad.destroy()
        vad = null
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
      if (vad) {
        vad.destroy()
        vad = null
      }
    })
  })

  server.listen(port, () => {
    console.log(`> Ready on http://${hostname}:${port}`)
    console.log(`> WebSocket server ready on ws://${hostname}:${port}/api/media-stream`)
  })
})

