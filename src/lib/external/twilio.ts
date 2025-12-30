import twilio from 'twilio'

export type MakeCallParams = {
  to: string
  from: string
  message?: string
  twimlUrl?: string
}

export type MakeCallResult = {
  callSid: string
}

const getClient = () => {
  const accountSid = process.env.TWILIO_ACCOUNT_SID
  const authToken = process.env.TWILIO_AUTH_TOKEN
  if (!accountSid || !authToken) {
    throw new Error('TWILIO_ACCOUNT_SID or TWILIO_AUTH_TOKEN missing')
  }
  return twilio(accountSid, authToken)
}

export async function makeCall(params: MakeCallParams): Promise<MakeCallResult> {
  const client = getClient()
  const { to, from, message = 'Connecting you to the agent.', twimlUrl } = params

  const call = await client.calls.create(
    twimlUrl
      ? {
          to,
          from,
          url: twimlUrl,
        }
      : {
          to,
          from,
          twiml: `<Response><Say>${message}</Say></Response>`,
        }
  )

  return { callSid: call.sid }
}

