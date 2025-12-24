import { NextRequest, NextResponse } from 'next/server'

/**
 * Twilio webhook handler for incoming calls
 * Returns TwiML that connects the call to Media Streams
 */
export async function POST(request: NextRequest) {
  try {
    console.log('[Incoming Call] Webhook received')
    console.log('[Incoming Call] Request URL:', request.url)
    console.log('[Incoming Call] Headers:', Object.fromEntries(request.headers.entries()))
    
    // Get callSid from request body (Twilio sends it in the POST body as form data)
    let callSid = ''
    try {
      const formData = await request.formData()
      callSid = formData.get('CallSid')?.toString() || ''
      console.log('[Incoming Call] CallSid from formData:', callSid)
    } catch (formError: any) {
      // If formData fails, just continue without callSid - it's not critical
      console.warn('[Incoming Call] FormData parsing failed (non-critical):', formError?.message)
    }
    
    // Get base URL for Media Stream WebSocket
    // Priority: NEXT_PUBLIC_BASE_URL > Request headers > VERCEL_URL
    let baseUrl = process.env.NEXT_PUBLIC_BASE_URL || ''
    
    // If no baseUrl from env, try to get from request headers
    if (!baseUrl) {
      const host = request.headers.get('host') || ''
      const protocol = request.headers.get('x-forwarded-proto') || 
                       (request.headers.get('x-forwarded-ssl') === 'on' ? 'https' : 'http')
      
      if (host && !host.includes('localhost')) {
        baseUrl = `${protocol}://${host}`
        console.log('[Incoming Call] Using host from headers:', baseUrl)
      } else if (process.env.VERCEL_URL) {
        baseUrl = `https://${process.env.VERCEL_URL}`
      } else {
        baseUrl = 'http://localhost:3000'
        console.warn('[WARNING] No NEXT_PUBLIC_BASE_URL set. Twilio cannot reach localhost.')
      }
    }

    // Convert HTTP/HTTPS to WS/WSS for WebSocket
    const wsUrl = baseUrl.replace('http://', 'ws://').replace('https://', 'wss://')
    
    // Build media stream URL
    let mediaStreamUrl = wsUrl + '/api/media-stream'
    if (callSid) {
      mediaStreamUrl = mediaStreamUrl + '?callSid=' + encodeURIComponent(callSid)
    }

    console.log('[Incoming Call] Base URL:', baseUrl)
    console.log('[Incoming Call] Media Stream URL:', mediaStreamUrl)

    // Generate TwiML with Media Stream - use <Connect><Stream> for bidirectional audio (call-gpt approach)
    const escapedUrl = mediaStreamUrl.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
    const twiml = '<?xml version="1.0" encoding="UTF-8"?>\n' +
      '<Response>\n' +
      '  <Connect>\n' +
      '    <Stream url="' + escapedUrl + '" />\n' +
      '  </Connect>\n' +
      '</Response>'

    console.log('[Incoming Call] Returning TwiML')
    return new NextResponse(twiml, {
      status: 200,
      headers: {
        'Content-Type': 'text/xml',
      },
    })
  } catch (error: any) {
    console.error('[Incoming Call] ERROR:', error)
    console.error('[Incoming Call] Error message:', error?.message)
    console.error('[Incoming Call] Error stack:', error?.stack)
    
    // Return valid TwiML even on error
    const errorTwiml = '<?xml version="1.0" encoding="UTF-8"?>\n' +
      '<Response>\n' +
      '  <Say>We\'re sorry, an application error has occurred. Goodbye.</Say>\n' +
      '</Response>'
    
    return new NextResponse(errorTwiml, {
      status: 200,
      headers: {
        'Content-Type': 'text/xml; charset=utf-8',
      },
    })
  }
}

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
