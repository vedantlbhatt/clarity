import twilio from 'twilio'

type TwilioClient = ReturnType<typeof twilio>

function getTwilioClient(): TwilioClient {
  const accountSid = process.env.TWILIO_ACCOUNT_SID
  const authToken = process.env.TWILIO_AUTH_TOKEN

  if (!accountSid || !authToken) {
    throw new Error('Twilio credentials not configured')
  }

  return twilio(accountSid, authToken)
}

export interface MakeCallParams {
  to: string
  from: string
  message?: string
}

export interface MakeCallResult {
  callSid: string
  status: string
}

export async function makeCall(params: MakeCallParams): Promise<MakeCallResult> {
  const client = getTwilioClient()
  const message = params.message || 'Sigmamundo!'

  const call = await client.calls.create({
    twiml: `<Response><Say>${message}</Say></Response>`,
    to: params.to,
    from: params.from,
  })

  return {
    callSid: call.sid,
    status: call.status,
  }
}

