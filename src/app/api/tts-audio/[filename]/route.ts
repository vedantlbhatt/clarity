import { NextRequest, NextResponse } from 'next/server'
import { readFile } from 'fs/promises'
import { join } from 'path'

/**
 * Serve TTS audio files
 */
export async function GET(
  request: NextRequest,
  { params }: { params: { filename: string } }
) {
  try {
    const filename = params.filename
    if (!filename || !filename.endsWith('.wav')) {
      return new NextResponse('Invalid filename', { status: 400 })
    }

    const audioPath = join(process.cwd(), 'results', 'tts', filename)
    const audioBuffer = await readFile(audioPath)

    return new NextResponse(audioBuffer, {
      status: 200,
      headers: {
        'Content-Type': 'audio/wav',
        'Content-Length': audioBuffer.length.toString(),
        'Cache-Control': 'no-cache',
      },
    })
  } catch (error: any) {
    console.error('[TTS Audio] Error serving file:', error)
    return new NextResponse('File not found', { status: 404 })
  }
}

