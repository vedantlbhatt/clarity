import { NextResponse } from 'next/server'
import twilio from 'twilio'

export async function POST() {
  try {
    const accountSid = process.env.TWILIO_ACCOUNT_SID
    const authToken = process.env.TWILIO_AUTH_TOKEN

    if (!accountSid || !authToken) {
      return NextResponse.json(
        { error: 'Twilio credentials not configured' },
        { status: 500 }
      )
    }

    const client = twilio(accountSid, authToken)

    const call = await client.calls.create({
      twiml: '<Response><Say>Sigmamundo!</Say></Response>',
      to: '+14043331778',
      from: '+18668961216',
    })

    return NextResponse.json({ 
      success: true, 
      callSid: call.sid,
      message: 'Call initiated successfully'
    })
  } catch (error: any) {
    console.error('Error making call:', error)
    return NextResponse.json(
      { error: error.message || 'Failed to make call' },
      { status: 500 }
    )
  }
}

