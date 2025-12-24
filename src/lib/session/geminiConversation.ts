import { GoogleGenerativeAI } from '@google/generative-ai'

const getGeminiApiKey = () => {
  const key = process.env.GEMINI_API_KEY
  if (!key || key.trim() === '') {
    throw new Error('GEMINI_API_KEY not configured')
  }
  return key.trim()
}

export interface ConversationMessage {
  role: 'user' | 'model'
  parts: Array<{ text: string }>
}

/**
 * Generate AI conversation response using Gemini
 * @param history - Conversation history (past messages)
 * @param currentMessage - Current user message
 * @param systemPrompt - Optional system prompt to set AI personality
 */
export async function generateConversationResponse(
  history: ConversationMessage[],
  currentMessage: string,
  systemPrompt?: string
): Promise<string> {
  const apiKey = getGeminiApiKey()
  const genAI = new GoogleGenerativeAI(apiKey)
  
  // Use Gemini 2.5 Flash (fast, works with free tier)
  const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' })
  
  try {
    const defaultSystemPrompt = 'You are a friendly English pronunciation tutor. Have natural, helpful conversations with students to help them practice speaking English. Keep responses concise (1-2 sentences) for phone conversations.'
    const systemInstructionText = systemPrompt || defaultSystemPrompt
    
    console.log('[Gemini Conversation] Sending to Gemini:', {
      historyLength: history.length,
      currentMessage: currentMessage.substring(0, 50) + '...',
      hasSystemPrompt: !!systemInstructionText
    })
    
    // Build chat history - include system prompt in first message if no history exists
    let chatHistory = history
    
    // If no history, prepend system prompt to first user message
    if (history.length === 0) {
      const firstMessage = `${systemInstructionText}\n\nUser: ${currentMessage}\n\nRemember: MAXIMUM 15 WORDS. One short sentence only.`
      
      const chat = model.startChat({
        history: [],
      })
      
      const result = await chat.sendMessage(firstMessage)
      const response = result.response
      const text = response.text()
      
      if (!text || text.trim().length === 0) {
        throw new Error('Empty response from Gemini')
      }
      
      console.log('[Gemini Conversation] Received response:', text.substring(0, 50) + '...')
      return text.trim()
    } else {
      // If we have history, start chat with it and send current message
      const chat = model.startChat({
        history: chatHistory,
      })
      
      // Send current message with reminder to keep it short
      const messageWithReminder = `${currentMessage}\n\n[Remember: MAXIMUM 15 WORDS. One short sentence only.]`
      const result = await chat.sendMessage(messageWithReminder)
      const response = result.response
      const text = response.text()
      
      if (!text || text.trim().length === 0) {
        throw new Error('Empty response from Gemini')
      }
      
      console.log('[Gemini Conversation] Received response:', text.substring(0, 50) + '...')
      return text.trim()
    }
  } catch (error: any) {
    console.error('[Gemini Conversation] Error:', error)
    throw new Error(`Failed to generate conversation response: ${error.message}`)
  }
}