import { NextResponse } from 'next/server'
import { createCall } from '../../../lib/services/callService'

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}))
    const phone = body?.phone?.toString().trim()
    const from = process.env.TWILIO_FROM_NUMBER

    if (!phone) {
      return NextResponse.json({ error: 'Missing phone' }, { status: 400 })
    }
    if (!from) {
      return NextResponse.json({ error: 'TWILIO_FROM_NUMBER not set' }, { status: 500 })
    }

    const result = await createCall({
      to: phone,
      from,
      message: 'Connecting you to the Ultravox agent.',
    })

    return NextResponse.json({
      success: true,
      callSid: result.callSid,
      message: 'Call initiated successfully',
    })
  } catch (error: any) {
    console.error('Error making call:', error)
    return NextResponse.json(
      { error: error.message || 'Failed to make call' },
      { status: 500 }
    )
  }
}


