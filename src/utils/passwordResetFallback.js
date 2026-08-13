/**
 * Password-reset delivery: which failures are worth retrying down a second
 * path, and what the UI is allowed to say about the result.
 *
 * The branded reset email is sent by the `sendPasswordResetEmail` callable,
 * which mints the link with the Admin SDK and posts it through our own SMTP
 * host. That is one third party (the mail host) and one secret (its
 * credentials) between a locked-out user and their account — and when either
 * is down the user sees "Failed to send reset email. Please try again." on
 * every attempt, forever, with no way through. Firebase Auth's own mailer is
 * a completely independent path: different sender, different infrastructure,
 * no secret of ours involved. It sends a plainer email, which is a trade
 * worth making against sending none.
 *
 * The rules below exist to keep the fallback from giving away what the
 * callable deliberately hides. That endpoint answers identically for sent,
 * unknown-account and rate-limited, so an attacker cannot mine the user base;
 * a fallback that surfaced `auth/user-not-found` would re-open exactly that
 * oracle behind the primary path's back.
 *
 * Pure — no Firebase imports, no DOM — so it tests under bare `node`.
 */

/**
 * Errors that mean "the address you typed is not an address". The one case
 * the UI may name specifically: it is a statement about the string in the
 * box, not about whether an account exists behind it.
 */
const BAD_EMAIL_CODES = new Set([
  'functions/invalid-argument',
  'auth/invalid-email',
  'auth/missing-email',
])

/**
 * Errors from the FALLBACK that must be reported as success. Each one means
 * "no mail was sent, and the reason is none of the caller's business":
 * user-not-found is the enumeration oracle itself, and the throttling codes
 * would confirm an address is real by the mere fact it has been asked for
 * often enough to be limited.
 */
const SILENT_SUCCESS_CODES = new Set([
  'auth/user-not-found',
  'auth/too-many-requests',
  'auth/quota-exceeded',
])

/**
 * Errors caused by the continue URL rather than by the request. Worth
 * retrying WITHOUT one: a reset that lands on Firebase's default page still
 * resets the password, and refusing to send at all because we could not
 * choose the landing page would be the tail wagging the dog.
 */
const CONTINUE_URL_CODES = new Set([
  'auth/unauthorized-continue-uri',
  'auth/invalid-continue-uri',
  'auth/missing-continue-uri',
])

function codeOf(err) {
  return typeof err?.code === 'string' ? err.code : ''
}

/** True when the failure is the user's input, so no retry can help. */
export function isBadEmailError(err) {
  return BAD_EMAIL_CODES.has(codeOf(err))
}

/**
 * Should a failed primary send be retried through Firebase Auth's mailer?
 *
 * Everything except bad input, because everything except bad input is a
 * failure of OUR delivery path — an unset secret, a refusing mail host, a
 * cold-start timeout, a dropped connection — and all of them are exactly
 * what the second path exists to route around. Deciding by allow-list
 * instead would mean the one outage nobody predicted is the one that stays
 * unrecoverable.
 */
export function shouldTryFallback(err) {
  return !!err && !isBadEmailError(err)
}

/** Retry the fallback with no actionCodeSettings? */
export function isContinueUrlError(err) {
  return CONTINUE_URL_CODES.has(codeOf(err))
}

/**
 * What the UI should do when the FALLBACK also failed.
 *
 * - `'ok'`        — report the uniform success message; nothing was sent and
 *                   that is deliberate.
 * - `'bad-email'` — name the problem; it is the typed address.
 * - `'failed'`    — both paths are genuinely down; report the original
 *                   primary failure, which is the one an operator can act on.
 */
export function fallbackOutcome(err) {
  if (SILENT_SUCCESS_CODES.has(codeOf(err))) return 'ok'
  if (isBadEmailError(err)) return 'bad-email'
  return 'failed'
}

/**
 * The landing page a reset link should return to. Kept in step with the
 * server's `resolvePasswordResetContinueUrl` so a user who resets through
 * either path arrives at the same place with the same query flag.
 */
export function resetContinueUrl(origin) {
  const base = typeof origin === 'string' && origin ? origin : 'https://zedexams.com'
  return `${base.replace(/\/+$/, '')}/login?reset=complete`
}

/** The reply shape the callable returns, so both paths resolve alike. */
export function uniformResetReply(via) {
  return {
    data: {
      success: true,
      via,
      message:
        'If an account exists for that email, a password reset link has been sent.',
    },
  }
}
