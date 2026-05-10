/**
 * Client wrapper for the C6 newsletter signup callable.
 *
 * The Cloud Function does the heavy lifting (validation, dedupe,
 * rate-limit, honeypot). This file just thinly wraps the callable
 * so React components don't import firebase/functions directly.
 */

import { getFunctions, httpsCallable } from 'firebase/functions'
import app from '../firebase/config'

const fns = getFunctions(app, 'us-central1')
const subscribeCallable = httpsCallable(fns, 'subscribeToNewsletter', {
  timeout: 20000,
})

/**
 * Subscribe an email to the newsletter list.
 *
 * @param {Object} args
 * @param {string} args.email                  Required.
 * @param {string} [args.source]               Where the form lives.
 * @param {string} [args.companyWebsite]       Honeypot — pass through.
 * @returns {Promise<{ok: true, alreadySubscribed?: boolean}>}
 */
export async function subscribeToNewsletter({ email, source = 'unknown', companyWebsite }) {
  const result = await subscribeCallable({
    email,
    source,
    companyWebsite: companyWebsite || '',
  })
  return result.data
}
