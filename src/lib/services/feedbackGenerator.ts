import { GoogleGenerativeAI } from '@google/generative-ai'
import { ProcessedCallData } from './dataProcessor'

// Get API key from environment
const getGeminiApiKey = () => {
  const key = process.env.GEMINI_API_KEY
  if (!key || key.trim() === '') {
    throw new Error('GEMINI_API_KEY not configured')
  }
  return key.trim()
}

// Don't initialize genAI at module load - do it lazily when needed
// This prevents errors if env vars aren't loaded yet

export interface FeedbackOptions {
  tone?: 'encouraging' | 'constructive' | 'neutral'
  focus?: 'pronunciation' | 'fluency' | 'pace' | 'all'
}

/**
 * Generate AI feedback using Google Gemini based on call data
 */
export async function generateFeedback(
  data: ProcessedCallData,
  options: FeedbackOptions = {}
): Promise<string> {
  const apiKey = getGeminiApiKey()
  
  // Create a new instance with the API key (lazy initialization)
  const genAI = new GoogleGenerativeAI(apiKey)

  const { tone = 'encouraging', focus = 'all' } = options

  // Build the prompt
  const prompt = `You are a pronunciation and speech coach. Analyze the following speech data and provide 2-3 sentences of specific, actionable feedback.

Speech Data:
- Full Transcript: "${data.fullTranscript}"
- Speaking Pace: ${data.speakingPace.wordsPerMinute} words per minute (${data.speakingPace.totalWords} words in ${data.speakingPace.speakingTime} seconds)
- Filler Words: ${data.fillerWords.count} filler words detected (${data.fillerWords.rate} per minute)
- Pronunciation Scores:
  * Accuracy: ${data.pronunciation.averageAccuracy}%
  * Pronunciation: ${data.pronunciation.averagePronunciation}%
  * Completeness: ${data.pronunciation.averageCompleteness}%
  * Fluency: ${data.pronunciation.averageFluency}%
  * Prosody: ${data.pronunciation.averageProsody}%

${data.pronunciation.problemPhonemes.length > 0 ? `- Problem Phonemes (under 60% accuracy): ${data.pronunciation.problemPhonemes.map(p => `${p.phoneme} in "${p.word}" (${p.accuracy}%)`).join(', ')}` : ''}
${data.pronunciation.problemWords.length > 0 ? `- Problem Words: ${data.pronunciation.problemWords.map(w => `"${w.word}" (${w.accuracy}% - ${w.errorType})`).join(', ')}` : ''}
${data.fillerWords.count > 0 ? `- Filler Words Used: ${data.fillerWords.words.map(f => f.word).join(', ')}` : ''}

Instructions:
- Provide 2-3 sentences of feedback
- Be ${tone} in tone
- Focus on: ${focus === 'all' ? 'pronunciation, fluency, pace, and filler words' : focus}
- Be specific about what to improve
- Mention specific sounds or words if there are problem areas
- Keep it concise and actionable

Feedback:`

  try {
    // Use Gemini 2.5 Flash (works with free tier, fast model)
    const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' })
    
    console.log('[Feedback Generator] Using Gemini API with key:', apiKey.substring(0, 10) + '...')
    
    const result = await model.generateContent(prompt)
    const response = result.response
    const feedback = response.text()

    if (!feedback || feedback.trim().length === 0) {
      throw new Error('Empty response from Gemini')
    }

    return feedback.trim()
  } catch (error: any) {
    console.error('[Feedback Generator] Error:', error)
    throw new Error(`Failed to generate feedback: ${error.message}`)
  }
}

