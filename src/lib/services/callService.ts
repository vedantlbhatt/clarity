import { makeCall, type MakeCallParams, type MakeCallResult } from '../external/twilio'

export interface CreateCallParams extends MakeCallParams {}

export interface CreateCallResult extends MakeCallResult {}

export async function createCall(params: CreateCallParams): Promise<CreateCallResult> { // Promise bc async, call await in api route
  //
  return makeCall(params)
}

