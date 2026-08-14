/**
 * parentDigestService — the admin's on-demand trigger for the weekly parent
 * digest cron, used by the Developer-tools panel on `/admin`.
 *
 * ## Why this is here and not in `features/parentPortal`
 *
 * It was `triggerWeeklyParentDigest` in `src/utils/parentShares.js`, whose own
 * docblock already marked it *"Admin-only: run the weekly digest cron body on
 * demand"* — the odd one out in a file otherwise about a learner sharing their
 * progress with a parent.
 *
 * When the admin dashboard's freeze lifted (Wave 4 slice 4), that file had
 * readers in two features: `parentPortal` for the share flow, and this one for
 * the digest trigger. Moving it whole into `parentPortal` — which is what the
 * pin note anticipated — would have made `adminHome` import another feature,
 * adding a CROSS-FEATURE entry to a list that only shrinks. Splitting it along
 * the seam the docblock already described costs nothing and adds no entry.
 *
 * The verb here is the point: this does not read or write a parent share. It
 * asks the server to run a scheduled job now, so an operator can verify the
 * Meta WhatsApp wiring without waiting for Sunday's tick. That is an ops
 * action, and it belongs beside the ops panel that performs it.
 */

import app from '../../../firebase/config'
import { getFunctions, httpsCallable } from 'firebase/functions'

const fns = getFunctions(app, 'us-central1')

const triggerWeeklyParentDigestCallable = httpsCallable(fns, 'triggerWeeklyParentDigest', {
  // The cron body can run for up to 9 minutes when iterating 200 shares;
  // a one-share manual run finishes in seconds, but pad the timeout so
  // a slow Meta response doesn't abort.
  timeout: 540000,
})

/**
 * Admin-only: run the weekly digest cron body on demand. Used to
 * verify Meta WhatsApp wiring without waiting for Sunday's tick.
 *
 * @param {Object} opts
 * @param {boolean} [opts.force]            Bypass the 5-day idempotency
 *                                          stamp (the stamp itself is
 *                                          NOT bumped on forced runs so
 *                                          Sunday's real cron still fires).
 * @param {string[]} [opts.targetTokens]    Limit to specific share tokens
 *                                          (cap 10). When omitted the run
 *                                          processes the full union of
 *                                          email + phone candidates.
 * @returns {Promise<Object>} The cron's run summary — sharesScanned,
 *                            sent.{email|whatsapp}, skipped.*, failed.*,
 *                            errors[], whatsAppReady, smtpReady.
 */
export async function triggerWeeklyParentDigest({ force = false, targetTokens = null } = {}) {
  const result = await triggerWeeklyParentDigestCallable({
    force: Boolean(force),
    targetTokens: Array.isArray(targetTokens) && targetTokens.length > 0 ? targetTokens : null,
  })
  return result.data
}
