import { NextRequest, NextResponse } from 'next/server'

/**
 * Twilio webhook handler for incoming calls
 * Returns TwiML that connects the call to Media Streams
 */
export async function POST(request: NextRequest) {
  console.log('[Incoming Call] Webhook received')
  console.log('[Incoming Call] Headers:', {
    host: request.headers.get('host'),
    'user-agent': request.headers.get('user-agent'),
    'x-forwarded-proto': request.headers.get('x-forwarded-proto'),
  })
  
  try {
    // Get base URL for Media Stream WebSocket
    // Priority: Request headers (from ngrok/proxy) > NEXT_PUBLIC_BASE_URL > VERCEL_URL
    let baseUrl = process.env.NEXT_PUBLIC_BASE_URL
    
    // Try to get from request headers first (most reliable when behind ngrok/proxy)
    const host = request.headers.get('host')
    const protocol = request.headers.get('x-forwarded-proto') || 
                     (request.headers.get('x-forwarded-ssl') === 'on' ? 'https' : 'http')
    
    if (host && !host.includes('localhost')) {
      baseUrl = `${protocol}://${host}`
      console.log('[Incoming Call] Using host from headers:', baseUrl)
    } else if (!baseUrl) {
      if (process.env.VERCEL_URL) {
        baseUrl = `https://${process.env.VERCEL_URL}`
      } else {
        baseUrl = 'http://localhost:3000'
        console.warn('[WARNING] No NEXT_PUBLIC_BASE_URL set and no host header. Twilio cannot reach localhost. Use a tunnel (ngrok/localtunnel) and set NEXT_PUBLIC_BASE_URL to the tunnel URL.')
      }
    }

    // Convert HTTP/HTTPS to WS/WSS for WebSocket
    const wsUrl = baseUrl
      .replace('http://', 'ws://')
      .replace('https://', 'wss://')
    const mediaStreamUrl = `${wsUrl}/api/media-stream`

    console.log('[Incoming Call] Base URL:', baseUrl)
    console.log('[Incoming Call] Media Stream URL:', mediaStreamUrl)

    // Generate TwiML with Media Stream
    // Use <Start><Stream> for Media Streams (not <Connect>)
    // track="inbound" filters to only get the caller's audio (not Twilio's voice)
    const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Start>
    <Stream url="${mediaStreamUrl}" track="inbound" />
  </Start>
  <Say>Please speak now. I'll assess your pronunciation.</Say>
  <Pause length="300"/>
  <Say>Thank you for your call. Goodbye.</Say>
</Response>`

    console.log('[Incoming Call] Returning TwiML')
    return new NextResponse(twiml, {
      status: 200,
      headers: {
        'Content-Type': 'text/xml',
      },
    })
  } catch (error: any) {
    console.error('[Incoming Call] Error:', error)
    console.error('[Incoming Call] Error stack:', error?.stack)
    return new NextResponse(
      `<?xml version="1.0" encoding="UTF-8"?><Response><Say>An error occurred. Goodbye.</Say></Response>`,
      {
        status: 500,
        headers: {
          'Content-Type': 'text/xml',
        },
      }
    )
  }
}

