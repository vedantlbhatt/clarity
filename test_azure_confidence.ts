import * as fs from 'fs'
import * as sdk from 'microsoft-cognitiveservices-speech-sdk'
import { AzureSpeechRecognizer } from './src/lib/external/azureSpeech'
import * as dotenv from 'dotenv'

// Load environment variables
dotenv.config({ path: '.env.local' })

async function testAzureConfidence() {
  console.log('=== Testing Azure Speech Word-Level Confidence ===\n')

  // Check credentials
  const subscriptionKey = process.env.AZURE_SPEECH_KEY
  const region = process.env.AZURE_SPEECH_REGION

  if (!subscriptionKey || !region) {
    console.error('Error: AZURE_SPEECH_KEY and AZURE_SPEECH_REGION must be set in .env.local')
    process.exit(1)
  }

  // Read audio file
  const audioFile = 'test_audio.wav'
  if (!fs.existsSync(audioFile)) {
    console.error(`Error: ${audioFile} not found`)
    process.exit(1)
  }

  console.log(`Reading audio file: ${audioFile}`)
  const audioData = fs.readFileSync(audioFile)
  console.log(`Audio file size: ${audioData.length} bytes\n`)

  // Create speech config with detailed output
  const speechConfig = sdk.SpeechConfig.fromSubscription(subscriptionKey, region)
  speechConfig.speechRecognitionLanguage = 'en-US'
  speechConfig.setProperty(sdk.PropertyId.SpeechServiceResponse_RequestWordLevelTimestamps, "true")
  speechConfig.outputFormat = sdk.OutputFormat.Detailed

  // Create push audio stream and read WAV file
  // Note: WAV files are typically 16kHz, but we'll try to detect the format
  const audioFormat = sdk.AudioStreamFormat.getWaveFormatPCM(16000, 16, 1) // 16kHz, 16-bit, mono
  const pushStream = sdk.AudioInputStream.createPushStream(audioFormat)
  const audioConfig = sdk.AudioConfig.fromStreamInput(pushStream)
  
  // Read WAV file and extract PCM data
  // WAV files have a 44-byte header, then PCM data
  const wavBuffer = fs.readFileSync(audioFile)
  // Skip WAV header (typically 44 bytes, but could vary)
  // For simplicity, we'll try to find the data chunk
  let dataStart = 44 // Standard WAV header size
  // Look for 'data' chunk marker
  const dataMarker = wavBuffer.indexOf(Buffer.from('data'))
  if (dataMarker !== -1) {
    dataStart = dataMarker + 8 // 'data' (4) + chunk size (4) = 8 bytes
  }
  
  const pcmData = wavBuffer.slice(dataStart)
  console.log(`Extracted PCM data: ${pcmData.length} bytes (skipped ${dataStart} byte header)\n`)
  
  // Push audio data to stream
  pushStream.write(pcmData.buffer.slice(pcmData.byteOffset, pcmData.byteOffset + pcmData.byteLength) as ArrayBuffer)
  pushStream.close()

  // Create recognizer
  const recognizer = new sdk.SpeechRecognizer(speechConfig, audioConfig)

  // Set up pronunciation assessment (unscripted mode)
  const pronunciationConfig = new sdk.PronunciationAssessmentConfig(
    "", // Empty string for unscripted mode
    sdk.PronunciationAssessmentGradingSystem.HundredMark,
    sdk.PronunciationAssessmentGranularity.Phoneme,
    false // miscue detection disabled for unscripted
  )
  pronunciationConfig.enableProsodyAssessment = true
  pronunciationConfig.applyTo(recognizer)

  console.log('Starting recognition...\n')

  // Promise to handle results
  return new Promise<void>((resolve, reject) => {
    let resultReceived = false

    recognizer.recognized = (s, e) => {
      if (e.result.reason === sdk.ResultReason.RecognizedSpeech && e.result.text) {
        resultReceived = true
        const text = e.result.text.trim()
        console.log(`Recognized text: "${text}"\n`)

        // Get JSON result
        const jsonResult = (e.result as any).properties?.getProperty?.(sdk.PropertyId.SpeechServiceResponse_JsonResult)
        
        if (jsonResult) {
          try {
            const jsonData = typeof jsonResult === 'string' ? JSON.parse(jsonResult) : jsonResult
            
            console.log('=== JSON Result Analysis ===')
            console.log(`Overall Confidence: ${jsonData?.NBest?.[0]?.Confidence || 'N/A'}\n`)
            
            if (jsonData?.NBest?.[0]?.Words) {
              console.log('Word-Level Details:')
              console.log('─'.repeat(60))
              jsonData.NBest[0].Words.forEach((word: any, idx: number) => {
                const confidence = word.Confidence !== undefined ? word.Confidence : 'NOT AVAILABLE'
                console.log(`${idx + 1}. Word: "${word.Word}"`)
                console.log(`   Confidence: ${confidence}`)
                console.log(`   Offset: ${word.Offset}ns`)
                console.log(`   Duration: ${word.Duration}ns`)
                if (word.PronunciationAssessment) {
                  console.log(`   Pronunciation Accuracy: ${word.PronunciationAssessment.AccuracyScore}%`)
                }
                console.log('')
              })
            } else {
              console.log('No Words array found in NBest[0]')
            }

            // Try to get pronunciation assessment
            try {
              const pronunciationResult = sdk.PronunciationAssessmentResult.fromResult(e.result)
              console.log('=== Pronunciation Assessment ===')
              console.log(`Accuracy: ${pronunciationResult.accuracyScore}%`)
              console.log(`Pronunciation: ${pronunciationResult.pronunciationScore}%`)
              console.log(`Completeness: ${pronunciationResult.completenessScore}%`)
              console.log(`Fluency: ${pronunciationResult.fluencyScore}%`)
              console.log(`Prosody: ${pronunciationResult.prosodyScore}%\n`)
            } catch (err) {
              console.log('Pronunciation assessment not available\n')
            }

          } catch (parseError) {
            console.error('Failed to parse JSON:', parseError)
          }
        } else {
          console.log('No JSON result available')
        }

        recognizer.stopContinuousRecognitionAsync(
          () => {
            console.log('Recognition stopped')
            resolve()
          },
          (error) => {
            console.error('Error stopping:', error)
            reject(error)
          }
        )
      }
    }

    recognizer.canceled = (s, e) => {
      if (e.errorCode !== sdk.CancellationErrorCode.NoError) {
        console.error('Recognition canceled:', e.errorDetails)
        reject(new Error(e.errorDetails))
      }
    }

    recognizer.sessionStopped = () => {
      if (!resultReceived) {
        console.log('Session stopped without result')
        resolve()
      }
    }

    // Start recognition
    recognizer.startContinuousRecognitionAsync(
      () => {
        console.log('Recognition started, waiting for results...\n')
      },
      (error) => {
        console.error('Failed to start recognition:', error)
        reject(error)
      }
    )

    // Timeout after 10 seconds
    setTimeout(() => {
      if (!resultReceived) {
        console.log('Timeout: No result received')
        recognizer.stopContinuousRecognitionAsync(() => {}, () => {})
        resolve()
      }
    }, 10000)
  })
}

// Run the test
testAzureConfidence()
  .then(() => {
    console.log('\n=== Test Complete ===')
    process.exit(0)
  })
  .catch((error) => {
    console.error('\n=== Test Failed ===')
    console.error(error)
    process.exit(1)
  })

