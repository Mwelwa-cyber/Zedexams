// src/features/learnerHome/services/guardianControlsService.js
//
// The only client path to a guardian control. `users/{uid}.guardianControls`
// is on the self-update blocklist in firestore.rules, so there is no direct
// write to fall back to — this callable is it.
//
// The server decides everything: whether the account has an approved
// guardian, whether the key is a real control, whether the value is a
// boolean, whether anything actually changed. This module only carries the
// call and turns a Firebase error into a sentence a parent can read.

import { getFunctions, httpsCallable } from 'firebase/functions'
import app from '../../../firebase/config'

// The callable is deployed to us-central1 (HTTP/callable functions have no
// regional trigger — see CLAUDE.md's region note).
const functions = getFunctions(app, 'us-central1')

/**
 * @param {string} key    A control key (see functions/shared/guardian/).
 * @param {boolean} value
 * @returns {Promise<{ok: boolean, changed: boolean, notified: boolean}>}
 */
export async function setGuardianControl(key, value) {
  try {
    const call = httpsCallable(functions, 'setGuardianControl')
    const res = await call({ key, value })
    return res?.data || { ok: true, changed: false, notified: false }
  } catch (err) {
    // The callable's own messages are already written for a parent
    // ("Only a parent or guardian who has approved this account…"), so
    // pass them through; only a transport failure needs wording here.
    const message = err?.message && !/internal/i.test(err.message)
      ? err.message
      : 'We could not save that just now. Check your connection and try again.'
    const wrapped = new Error(message)
    wrapped.code = err?.code
    throw wrapped
  }
}
