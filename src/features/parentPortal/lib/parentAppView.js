/**
 * parentAppView — the parent app's presentation decisions, kept pure so
 * they can be tested without a DOM.
 *
 * The server decides the facts (whose child, which role, what happened
 * and when); this file decides only how they read. The split matters
 * because the two change for different reasons: a copy tweak should
 * never need an emulator, and an authorisation change should never be
 * possible by editing a label.
 */

/** First name only — the parent app never prints a child's full name in a list. */
export function firstNameOf(name) {
  return String(name || '').trim().split(/\s+/)[0] || ''
}

/** Initial for an avatar bubble; 'Z' when there is nothing to take one from. */
export function initialOf(name) {
  const first = firstNameOf(name)
  return (first[0] || 'Z').toUpperCase()
}

/**
 * Time-of-day greeting, from an explicit hour so it is testable and so
 * it can be computed in the reader's own clock rather than the server's.
 */
export function greetingFor(hour) {
  const h = Number(hour)
  if (!Number.isFinite(h)) return 'Hello'
  if (h < 12) return 'Good morning'
  if (h < 17) return 'Good afternoon'
  return 'Good evening'
}

/**
 * The status pill's words and tone. The server names the status; this
 * turns it into something a parent reads at a glance.
 *
 * `tone` is a class suffix, not a colour — Night mode has to work, so no
 * component may pick a hex.
 */
export function statusPill(status) {
  switch (status) {
    case 'on_track':
      return { label: 'On track', tone: 'ok' }
    case 'needs_nudge':
      return { label: 'Needs a nudge', tone: 'warn' }
    case 'quiet':
      return { label: 'Not been on lately', tone: 'warn' }
    default:
      return { label: 'Not started yet', tone: 'idle' }
  }
}

/**
 * What a locked feature is called when a child asks for it.
 *
 * The gate ids come from the server's REQUESTABLE_GATES allow-list. An
 * id this build does not recognise falls back to a neutral phrase rather
 * than being printed raw — a parent should never be shown
 * "PAPER_CONTINUE" in a sentence about their child.
 */
const FEATURE_LABELS = {
  FULL_ACCESS: 'everything on ZedExams',
  PAPER_CONTINUE: 'to finish a past paper',
  PAPER_OPEN: 'to open more past papers',
  PAPER_OFFLINE: 'to save papers for offline',
  AUTO_MARKING: 'full marking and review',
  NOTES_OTHER_TERMS: 'notes for the other terms',
  LIVE_CHALLENGE: 'live challenges',
}

export function describeFeature(gateId) {
  return FEATURE_LABELS[gateId] || 'more of ZedExams'
}

/**
 * The one-line summary under a request in the approval feed.
 *
 * The price is included because this side of the app is where prices
 * belong — the child never saw one (see the paywall rules in
 * src/services/entitlements), and the parent deciding cannot decide
 * without it.
 */
export function describeRequest(request) {
  const what = describeFeature(request?.feature)
  const price = Number(request?.priceZMW)
  return Number.isFinite(price) && price > 0 ?
    `Wants ${what} · from K${price}` :
    `Wants ${what}`
}

/**
 * Relative day phrasing for a request's age ("today", "3 days ago").
 * Returns '' when the time is unknown, so a caller renders nothing
 * rather than "NaN days ago".
 */
export function agoInDays(then, now) {
  const t = Number(then)
  const ref = Number(now)
  if (!Number.isFinite(t) || !Number.isFinite(ref) || t <= 0) return ''
  const days = Math.floor(Math.max(0, ref - t) / 86_400_000)
  if (days === 0) return 'today'
  if (days === 1) return 'yesterday'
  return `${days} days ago`
}

/**
 * Sort children for the overview: the ones needing attention first, then
 * alphabetically. A parent opening the app should not have to read past
 * the child who is fine to find the one who is not.
 */
const STATUS_ORDER = { quiet: 0, needs_nudge: 1, not_started: 2, on_track: 3 }

export function sortChildren(children) {
  return [...(Array.isArray(children) ? children : [])].sort((a, b) => {
    const ao = STATUS_ORDER[a?.status] ?? 9
    const bo = STATUS_ORDER[b?.status] ?? 9
    if (ao !== bo) return ao - bo
    return String(a?.displayName || '').localeCompare(String(b?.displayName || ''))
  })
}

/**
 * How a child's guardian-consent record reads on /family/account/consent.
 *
 * `unknown` is the one that needed care. Every learner account created
 * before the consent flow existed carries no record at all, and the
 * honest sentence for those is "we do not have one", not "not approved" —
 * a guardian told their child is unapproved because of a migration will
 * either panic or stop believing the screen. The five statuses come from
 * functions/shared/consent/guardianConsentCore.js; anything outside that
 * vocabulary is treated as unknown for the same reason a status nobody
 * defined is not evidence of approval.
 *
 * `tone` is a class suffix rather than a colour, so Night mode keeps
 * working.
 */
export function consentView(consent) {
  const status = String(consent?.status || 'unknown')
  switch (status) {
    case 'granted':
      return {
        status,
        label: 'Approved',
        tone: 'ok',
        detail: 'You have approved this account.',
        canWithdraw: true,
        canGrant: false,
      }
    case 'denied':
      return {
        status,
        label: 'Withdrawn',
        tone: 'warn',
        detail: 'This account is suspended and will be deleted.',
        canWithdraw: false,
        canGrant: true,
      }
    case 'pending':
      return {
        status,
        label: 'Waiting',
        tone: 'idle',
        detail: 'We have asked a guardian to approve this account.',
        canWithdraw: false,
        canGrant: true,
      }
    case 'expired':
      return {
        status,
        label: 'Link expired',
        tone: 'idle',
        detail: 'The approval link ran out before anyone used it.',
        canWithdraw: false,
        canGrant: true,
      }
    default:
      return {
        status: 'unknown',
        label: 'No record yet',
        tone: 'idle',
        detail: 'This account predates our consent record. Approving it now writes one.',
        canWithdraw: false,
        canGrant: true,
      }
  }
}

/** "approved by family code" / "approved by email link", or ''. */
export function consentViaLabel(via) {
  switch (via) {
    case 'code': return 'by family code'
    case 'link': return 'by email link'
    case 'parent_app': return 'in the family app'
    default: return ''
  }
}
