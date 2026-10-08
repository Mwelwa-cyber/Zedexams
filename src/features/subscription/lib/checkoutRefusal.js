/**
 * checkoutRefusal — the server's own words when it refuses a purchase.
 *
 * `getUpgradeQuote` and `initiateLencoPayment` both refuse an under-18 learner
 * whose guardian has not approved the account (`assertLearnerCapability`).
 * The server's message is written for the child and says what to do next —
 * "Ask your parent or guardian to check their messages and approve your
 * account." The generic error mapping would replace it with "You don't have
 * permission to access this feature", and a quote failure would read as a
 * price problem with a Try again button that can never work.
 *
 * Only a `permission-denied` carries it: every other failure is a real fault
 * and keeps its ordinary wording.
 */

const MAX_LENGTH = 300

/**
 * @param {unknown} err  whatever a callable rejected with
 * @returns {string} the server's message, or '' when this is not a refusal
 */
export function checkoutRefusalMessage(err) {
  const code = typeof err?.code === 'string' ? err.code : ''
  if (code !== 'permission-denied' && code !== 'functions/permission-denied') return ''
  const message = typeof err?.message === 'string' ? err.message.trim() : ''
  return message ? message.slice(0, MAX_LENGTH) : ''
}

export default checkoutRefusalMessage
