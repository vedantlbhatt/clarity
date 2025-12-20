import { CallSession } from '../session/callSession'
import { processCallData } from './dataProcessor'
import { generateFeedback } from './feedbackGenerator'
import { textToSpeechFile } from '../external/azureTTS'
import twilio from 'twilio'
import { join } from 'path'
import { mkdir } from 'fs/promises'

/**
 * Handle feedback generation and playback at 30 seconds
 */
export async function handleFeedbackAt30Seconds(
  session: CallSession,
  baseUrl: string
): Promise<void> {
  try {
    console.log('[Feedback Handler] Starting feedback generation at 30 seconds')

    // Get session data
    const sessionData = session.getData()

    // Process the data
    const processedData = processCallData(sessionData)
    console.log('[Feedback Handler] Processed data:', {
      transcriptLength: processedData.fullTranscript.length,
      wordsPerMinute: processedData.speakingPace.wordsPerMinute,
      fillerCount: processedData.fillerWords.count,
      avgAccuracy: processedData.pronunciation.averageAccuracy,
    })

    // Generate feedback with Gemini
    let feedbackText: string
    try {
      feedbackText = await generateFeedback(processedData, {
        tone: 'encouraging',
        focus: 'all',
      })
      console.log('[Feedback Handler] Generated feedback:', feedbackText)
    } catch (error: any) {
      console.error('[Feedback Handler] Error generating feedback:', error)
      feedbackText = "Thanks for practicing! Keep working on your pronunciation and fluency."
    }

    // Convert feedback to speech
    const ttsDir = join(process.cwd(), 'results', 'tts')
    await mkdir(ttsDir, { recursive: true })
    
    const audioFilename = `feedback_${sessionData.streamSid}_${Date.now()}.wav`
    const audioPath = join(ttsDir, audioFilename)
    
    try {
      await textToSpeechFile(feedbackText, audioPath, {
        voice: 'en-US-AriaNeural',
        rate: '+0%',
      })
      console.log('[Feedback Handler] TTS audio saved to:', audioPath)
    } catch (error: any) {
      console.error('[Feedback Handler] Error generating TTS:', error)
      // Fallback: use Twilio Say instead
      await playFeedbackViaSay(sessionData.callSid, feedbackText)
      return
    }

    // Play audio via Twilio
    const audioUrl = `${baseUrl}/api/tts-audio/${audioFilename}`
    await playFeedbackViaAudio(sessionData.callSid, audioUrl)
  } catch (error: any) {
    console.error('[Feedback Handler] Error in feedback handler:', error)
    // Final fallback
    if (session.getData().callSid) {
      await playFeedbackViaSay(session.getData().callSid, "Thanks for practicing!")
    }
  }
}

/**
 * Play feedback audio via Twilio using <Play>
 */
async function playFeedbackViaAudio(callSid: string | undefined, audioUrl: string): Promise<void> {
  if (!callSid) {
    console.warn('[Feedback Handler] No callSid available, cannot play audio')
    return
  }

  try {
    const client = getTwilioClient()
    
    // Update the call with new TwiML that plays the audio
    const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Pause length="1"/>
  <Say>Here's your feedback.</Say>
  <Play>${audioUrl}</Play>
</Response>`

    await client.calls(callSid).update({
      twiml: twiml,
    })

    console.log('[Feedback Handler] Updated call with audio playback')
  } catch (error: any) {
    console.error('[Feedback Handler] Error updating call with audio:', error)
    throw error
  }
}

/**
 * Play feedback via Twilio Say (fallback)
 */
async function playFeedbackViaSay(callSid: string | undefined, text: string): Promise<void> {
  if (!callSid) {
    console.warn('[Feedback Handler] No callSid available, cannot play feedback')
    return
  }

  try {
    const client = getTwilioClient()
    
    const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Pause length="1"/>
  <Say>${text}</Say>
</Response>`

    await client.calls(callSid).update({
      twiml: twiml,
    })

    console.log('[Feedback Handler] Updated call with Say fallback')
  } catch (error: any) {
    console.error('[Feedback Handler] Error updating call with Say:', error)
  }
}

function getTwilioClient() {
  const accountSid = process.env.TWILIO_ACCOUNT_SID
  const authToken = process.env.TWILIO_AUTH_TOKEN

  if (!accountSid || !authToken) {
    throw new Error('Twilio credentials not configured')
  }

  return twilio(accountSid, authToken)
}

