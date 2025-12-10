import { NextResponse } from 'next/server'
import { createCall } from '../../../lib/services/callService'

export async function POST() {
  try {
    // Thin API route: validate and delegate to service layer
    const result = await createCall({
      to: '+14043331778',
      from: '+18668961216',
      message: 'Sigmamundo!',
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


