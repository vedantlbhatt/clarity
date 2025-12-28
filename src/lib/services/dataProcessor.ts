import { CallSessionData } from '../session/callSession'
import { PronunciationAssessmentResult } from '../external/azureSpeech'

export interface ProcessedCallData {
  fullTranscript: string
  speakingPace: {
    wordsPerMinute: number
    totalWords: number
    speakingTime: number // in seconds
  }
  fillerWords: {
    count: number
    words: Array<{ word: string; timestamp: number }>
    rate: number // fillers per minute
  }
  pronunciation: {
    averageAccuracy: number
    averagePronunciation: number
    averageCompleteness: number
    averageFluency: number
    averageProsody: number
    problemPhonemes: Array<{
      phoneme: string
      word: string
      accuracy: number
    }>
    problemWords: Array<{
      word: string
      accuracy: number
      errorType: string
    }>
  }
  summary: {
    totalAzureResults: number
    totalTranscripts: number
    callDuration: number
  }
}

/**
 * Process call session data into structured format for LLM feedback
 */
export function processCallData(sessionData: CallSessionData): ProcessedCallData {
  const finalTranscripts = sessionData.transcripts.filter((t) => t.isFinal)
  const fullTranscript = finalTranscripts.map((t) => t.text).join(' ').trim()

  // Calculate speaking pace
  const totalWords = fullTranscript.split(/\s+/).filter((w) => w.length > 0).length
  const callDuration = (Date.now() - sessionData.startTime) / 1000 // seconds
  const speakingTime = callDuration // Approximate - could be refined with word timestamps
  const wordsPerMinute = speakingTime > 0 ? (totalWords / speakingTime) * 60 : 0

  // Process filler words
  const fillerCount = sessionData.fillerWords.length
  const fillerRate = speakingTime > 0 ? (fillerCount / speakingTime) * 60 : 0

  // Process Azure pronunciation results
  const azureResults = sessionData.azureResults
  let totalAccuracy = 0
  let totalPronunciation = 0
  let totalCompleteness = 0
  let totalFluency = 0
  let totalProsody = 0

  const problemPhonemes: Array<{ phoneme: string; word: string; accuracy: number }> = []
  const problemWords: Array<{ word: string; accuracy: number; errorType: string }> = []

  azureResults.forEach(({ result }) => {
    totalAccuracy += result.accuracyScore
    totalPronunciation += result.pronunciationScore
    totalCompleteness += result.completenessScore
    totalFluency += result.fluencyScore
    totalProsody += result.prosodyScore

    // Find problem phonemes (under 60% accuracy)
    if (result.words) {
      result.words.forEach((word) => {
        if (word.accuracyScore < 70) {
          problemWords.push({
            word: word.word,
            accuracy: word.accuracyScore,
            errorType: word.errorType || 'Unknown',
          })
        }

        if (word.phonemes) {
          word.phonemes.forEach((phoneme) => {
            if (phoneme.accuracyScore < 80) {
              problemPhonemes.push({
                phoneme: phoneme.phoneme,
                word: word.word,
                accuracy: phoneme.accuracyScore,
              })
            }
          })
        }
      })
    }
  })

  const resultCount = azureResults.length || 1 // Avoid division by zero
  const averageAccuracy = totalAccuracy / resultCount
  const averagePronunciation = totalPronunciation / resultCount
  const averageCompleteness = totalCompleteness / resultCount
  const averageFluency = totalFluency / resultCount
  const averageProsody = totalProsody / resultCount

  return {
    fullTranscript,
    speakingPace: {
      wordsPerMinute: Math.round(wordsPerMinute),
      totalWords,
      speakingTime: Math.round(speakingTime),
    },
    fillerWords: {
      count: fillerCount,
      words: sessionData.fillerWords,
      rate: Math.round(fillerRate * 10) / 10, // Round to 1 decimal
    },
    pronunciation: {
      averageAccuracy: Math.round(averageAccuracy * 10) / 10,
      averagePronunciation: Math.round(averagePronunciation * 10) / 10,
      averageCompleteness: Math.round(averageCompleteness * 10) / 10,
      averageFluency: Math.round(averageFluency * 10) / 10,
      averageProsody: Math.round(averageProsody * 10) / 10,
      problemPhonemes,
      problemWords,
    },
    summary: {
      totalAzureResults: azureResults.length,
      totalTranscripts: finalTranscripts.length,
      callDuration: Math.round(callDuration),
    },
  }
}



