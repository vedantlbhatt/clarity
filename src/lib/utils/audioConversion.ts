import { mulaw } from 'alawmulaw'

/**
 * Convert μ-law (G.711) encoded audio to PCM
 * Twilio Media Streams send audio as μ-law encoded base64 strings
 */
export function convertMulawToPcm(mulawBuffer: Buffer): Buffer {
  // μ-law is 8-bit, PCM is 16-bit
  const pcmBuffer = Buffer.allocUnsafe(mulawBuffer.length * 2)
  
  // Debug: log first few μ-law bytes and their decoded values
  if (mulawBuffer.length > 0) {
    const firstFew = Math.min(10, mulawBuffer.length)
    const sampleBytes: number[] = []
    const decodedValues: number[] = []
    for (let i = 0; i < firstFew; i++) {
      sampleBytes.push(mulawBuffer[i])
      const decoded = mulaw.decodeSample(mulawBuffer[i])
      decodedValues.push(decoded)
    }
   
  }
  
  for (let i = 0; i < mulawBuffer.length; i++) {
    // Decode μ-law to linear PCM
    // mulaw.decodeSample returns a signed 16-bit integer (-32768 to 32767)
    const pcmValue = mulaw.decodeSample(mulawBuffer[i])
    // Convert to 16-bit signed integer (little-endian)
    pcmBuffer.writeInt16LE(pcmValue, i * 2)
  }
  
  return pcmBuffer
}

/**
 * Convert base64 μ-law string from Twilio to PCM Buffer
 */
export function convertTwilioAudioToPcm(base64Mulaw: string): Buffer {
  const mulawBuffer = Buffer.from(base64Mulaw, 'base64')
  return convertMulawToPcm(mulawBuffer)
}

/**
 * Convert PCM audio to μ-law (G.711) encoded audio
 * Used for sending audio TO Twilio (opposite of convertMulawToPcm)
 * @param pcmBuffer - PCM audio buffer (16-bit signed, little-endian)
 * @returns μ-law encoded buffer (8-bit)
 */
export function convertPcmToMulaw(pcmBuffer: Buffer): Buffer {
  const mulawBuffer = Buffer.allocUnsafe(pcmBuffer.length / 2)
  
  // Process every 2 bytes (16-bit sample) and convert to μ-law
  for (let i = 0; i < pcmBuffer.length; i += 2) {
    // Read 16-bit signed integer (little-endian)
    const pcmSample = pcmBuffer.readInt16LE(i)
    // Encode to μ-law (8-bit)
    const mulawSample = mulaw.encodeSample(pcmSample)
    mulawBuffer[i / 2] = mulawSample
  }
  
  return mulawBuffer
}

/**
 * Extract PCM audio from WAV file buffer
 * Azure TTS returns WAV format, we need to extract the PCM data
 * @param wavBuffer - WAV file buffer
 * @returns PCM audio buffer (16-bit signed, little-endian)
 */
export function extractPcmFromWav(wavBuffer: Buffer): Buffer {
  // WAV file structure:
  // - Bytes 0-3: "RIFF"
  // - Bytes 4-7: File size
  // - Bytes 8-11: "WAVE"
  // - Bytes 12-15: "fmt "
  // - Then format chunk...
  // - Then "data" chunk with actual PCM samples
  
  // Find "data" chunk
  let dataOffset = -1
  for (let i = 0; i < wavBuffer.length - 4; i++) {
    if (wavBuffer.toString('ascii', i, i + 4) === 'data') {
      dataOffset = i + 8 // Skip "data" (4 bytes) and chunk size (4 bytes)
      break
    }
  }
  
  if (dataOffset === -1) {
    throw new Error('Could not find data chunk in WAV file')
  }
  
  // Extract PCM data (everything after data chunk header)
  return wavBuffer.slice(dataOffset)
}

/**
 * Downsample PCM audio from 16kHz to 8kHz
 * Simple decimation: take every other sample
 * @param pcmBuffer - PCM audio buffer (16-bit, 16kHz)
 * @returns PCM audio buffer (16-bit, 8kHz) - half the size
 */
export function downsample16kTo8k(pcmBuffer: Buffer): Buffer {
  // Simple decimation: take every other sample
  // This works because we're halving the sample rate
  const inputSampleCount = pcmBuffer.length / 2 // Number of 16-bit samples
  const outputSampleCount = Math.floor(inputSampleCount / 2) // Half the samples
  const outputBuffer = Buffer.allocUnsafe(outputSampleCount * 2) // 2 bytes per sample
  
  // Copy every other sample
  for (let i = 0; i < outputSampleCount; i++) {
    const inputIndex = i * 2 * 2 // Skip every other sample (2 bytes per sample)
    const outputIndex = i * 2
    const sample = pcmBuffer.readInt16LE(inputIndex)
    outputBuffer.writeInt16LE(sample, outputIndex)
  }
  
  return outputBuffer
}

