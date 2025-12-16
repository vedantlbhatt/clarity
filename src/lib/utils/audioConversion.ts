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
    console.log(`[Audio Conversion] First ${firstFew} μ-law bytes:`, sampleBytes)
    console.log(`[Audio Conversion] Decoded PCM values:`, decodedValues)
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

