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
    'content-type': request.headers.get('content-type'),
  })
  
  try {
    // Get callSid from request body (Twilio sends it in the POST body as form data)
    let callSid = ''
    try {
      const formData = await request.formData()
      callSid = formData.get('CallSid')?.toString() || ''
      console.log('[Incoming Call] CallSid from formData:', callSid)
    } catch (formError: any) {
      console.warn('[Incoming Call] FormData parsing failed, trying text body:', formError?.message)
      // Fallback: try to parse as text if formData fails
      try {
        const text = await request.text()
        const params = new URLSearchParams(text)
        callSid = params.get('CallSid') || ''
        console.log('[Incoming Call] CallSid from text body:', callSid)
      } catch (textError) {
        console.warn('[Incoming Call] Text body parsing also failed')
      }
    }
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
    // Pass callSid as query parameter so we can retrieve it in the WebSocket handler
    const mediaStreamUrl = `${wsUrl}/api/media-stream${callSid ? `?callSid=${encodeURIComponent(callSid)}` : ''}`

    console.log('[Incoming Call] Base URL:', baseUrl)
    console.log('[Incoming Call] Media Stream URL:', mediaStreamUrl)
    
    // Warn if using localhost (Twilio can't reach it)
    if (baseUrl.includes('localhost')) {
      console.warn('[Incoming Call] WARNING: baseUrl contains localhost. Twilio cannot reach localhost.')
      console.warn('[Incoming Call] Set NEXT_PUBLIC_BASE_URL to your ngrok/tunnel URL in .env.local')
      console.warn('[Incoming Call] Continuing anyway, but Media Stream may fail to connect...')
    }

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
    console.error('[Incoming Call] Error message:', error?.message)
    console.error('[Incoming Call] Error stack:', error?.stack)
    
    // Return valid TwiML even on error so Twilio doesn't show default error
    const errorTwiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say>We're sorry, an application error has occurred. Goodbye.</Say>
</Response>`
    
    return new NextResponse(errorTwiml, {
      status: 200, // Return 200 so Twilio accepts it
      headers: {
        'Content-Type': 'text/xml; charset=utf-8',
      },
    })
  }
}

// Export runtime config to ensure this route is handled correctly
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

