/**
 * guardianLinkPay — the client half of paying from the guardian pay link with
 * NO login (functions/guardianUnlock/linkPayment.js).
 *
 * The one-time token from the URL is the only credential, so it travels on
 * every call and is never kept anywhere. The server decides the plan, the
 * amount and the account from the stored request; what the client supplies is
 * a phone number and a network, so this module deliberately offers nothing
 * else to send.
 */

import { getFunctions, httpsCallable } from 'firebase/functions'
import app from '../../../firebase/config'

const fns = getFunctions(app, 'us-central1')
const payCallable = httpsCallable(fns, 'guardianLinkPay')
const otpCallable = httpsCallable(fns, 'guardianLinkPayOtp')
const statusCallable = httpsCallable(fns, 'guardianLinkPayStatus')

/**
 * The same three operations GuardianCheckout drives for a signed-in payer,
 * bound to one token. Shape matches `DEFAULT_API` in GuardianCheckout.
 */
export function makeGuardianLinkApi(token) {
  return {
    initiate: async ({ phone, operator }) => (await payCallable({ token, phone, operator })).data,
    submitOtp: async ({ paymentId, otp }) => (await otpCallable({ token, paymentId, otp })).data,
    fetchStatus: async (paymentId) => (await statusCallable({ token, paymentId })).data,
  }
}
