/**
 * parentNotificationView — the pure view model behind the parent inbox.
 *
 * Visual source: the parent prototype's Notifications screen (`.pn-item`,
 * `.pn-ic`, the Today/Earlier heads, "Mark all read"). Everything on that
 * screen that is a DECISION — which tile a notification gets, which day
 * bucket it falls in, how its age reads, and whether its tap target may be
 * navigated to — lives here so it can be tested under plain `node`, with no
 * jsdom and no Firestore.
 *
 * ── One feed, a parent-shaped reading of it ─────────────────────────────
 *
 * There is no parent notification collection. A parent has a uid, so their
 * notifications are the ordinary `notifications/{uid}/feed` docs that
 * `createNotification` writes and `NotificationContext` streams. This module
 * adds no storage and no second source of truth; it decides how that feed
 * READS to an adult looking after a child.
 *
 * ── The tile is keyed on `type` first, `category` second ────────────────
 *
 * The prototype draws seven visually distinct notifications, but the feed
 * carries only seven CATEGORIES — so category alone cannot tell "your child
 * is asking you to unlock something" from "your payment went through". The
 * override table below therefore names the fine-grained `type`s, and the
 * category map is the floor under it: an unrecognised type still renders a
 * sensible tile rather than a bare card, which is what a notification the
 * product has not met yet must do.
 *
 * Only types the backend actually writes are listed. A table full of
 * aspirational keys would read as coverage the product does not have.
 *
 * ── The lhx classes are deliberate ─────────────────────────────────────
 *
 * The parent and learner prototypes are one design system with two palettes
 * of the same tokens — `.i-appr` and `.lhx-ni-streak` are the same radial
 * gradient, byte for byte, and so are the other five. Reusing the shared
 * stylesheet's names is therefore not borrowing the learner's look; it is
 * declining to write a second copy of it under parent-flavoured names.
 */

/** The six tile gradients the shared stylesheet defines (learnerTheme.css). */
export const TILES = Object.freeze({
  /** amber — something is being asked OF the parent */
  ask: { cls: 'lhx-ni-streak', emoji: '🔓' },
  /** coral/pink — attention, a child who may need support, a failed payment */
  alert: { cls: 'lhx-ni-exam', emoji: '🛟' },
  /** blue — a report, a summary, information */
  report: { cls: 'lhx-ni-quiz', emoji: '📈' },
  /** gold — a win worth telling a parent about */
  win: { cls: 'lhx-ni-badge', emoji: '🔥' },
  /** green — money settled, access granted */
  money: { cls: 'lhx-ni-ok', emoji: '💳' },
  /** purple — dated, calendar-shaped */
  dated: { cls: 'lhx-ni-duel', emoji: '📅' },
})

/**
 * Fine-grained overrides, keyed on the `type` written server-side. Every key
 * here corresponds to a live `createNotification` call:
 *
 *   child_unlock_request  functions/guardianUnlock/index.js
 *   payment_success       functions/subscriptionActivation.js
 *   payment_failed        functions/subscriptionActivation.js
 *   subscription_expiry   functions/notifications/reminderCrons.js
 *   streak_milestone      functions/notifications/onLearnerStatsWritten.js
 *   announcement          functions/notifications/onAnnouncementWritten.js
 */
const TYPE_TILE = Object.freeze({
  child_unlock_request: { ...TILES.ask, emoji: '🔓' },
  payment_success: { ...TILES.money, emoji: '✅' },
  payment_failed: { ...TILES.alert, emoji: '⚠️' },
  subscription_expiry: { ...TILES.ask, emoji: '💳' },
  streak_milestone: { ...TILES.win, emoji: '🔥' },
  announcement: { ...TILES.report, emoji: '📣' },
})

/** The floor: every category resolves, so no notification renders bare. */
const CATEGORY_TILE = Object.freeze({
  learning: { ...TILES.report, emoji: '📈' },
  lessonPlans: { ...TILES.dated, emoji: '📘' },
  assessments: { ...TILES.dated, emoji: '📅' },
  payments: { ...TILES.money, emoji: '💳' },
  account: { ...TILES.money, emoji: '🛡️' },
  system: { ...TILES.report, emoji: '⚙️' },
  announcements: { ...TILES.report, emoji: '📣' },
})

const FALLBACK_TILE = Object.freeze({ ...TILES.report, emoji: '🔔' })

/**
 * Which tile does this notification wear?
 * @param {{type?: string, category?: string}} n
 * @returns {{cls: string, emoji: string}}
 */
export function tileFor(n) {
  const byType = n && n.type ? TYPE_TILE[n.type] : null
  if (byType) return byType
  const byCategory = n && n.category ? CATEGORY_TILE[n.category] : null
  return byCategory || FALLBACK_TILE
}

/** Firestore Timestamp | {seconds} | {toMillis} | Date | number → ms, or 0. */
export function toMillis(ts) {
  if (!ts) return 0
  if (typeof ts.toMillis === 'function') return ts.toMillis()
  if (typeof ts.toDate === 'function') {
    const d = ts.toDate()
    return d instanceof Date && !Number.isNaN(d.getTime()) ? d.getTime() : 0
  }
  if (ts instanceof Date) return Number.isNaN(ts.getTime()) ? 0 : ts.getTime()
  if (typeof ts.seconds === 'number') return ts.seconds * 1000
  if (typeof ts === 'number' && Number.isFinite(ts)) return ts
  return 0
}

function startOfDay(ms) {
  const d = new Date(ms)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

/**
 * Split the feed into the prototype's two heads. Order within each bucket is
 * preserved — the context already streams newest-first, and re-sorting here
 * would silently disagree with the live page it renders.
 *
 * A notification with no readable timestamp sorts into `today`: an item we
 * cannot date is one that just arrived far more often than it is an old one,
 * and burying it under "Earlier" is the failure that matters.
 *
 * @param {Array<object>} notifications
 * @param {number} [now]
 * @returns {{today: Array<object>, earlier: Array<object>}}
 */
export function groupForInbox(notifications, now = Date.now()) {
  const cutoff = startOfDay(now)
  const today = []
  const earlier = []
  for (const n of notifications || []) {
    const ms = toMillis(n && n.createdAt)
    if (ms === 0 || ms >= cutoff) today.push(n)
    else earlier.push(n)
  }
  return { today, earlier }
}

/**
 * How old, in the parent prototype's voice — which is wordier than the
 * learner's ("2 days ago", not "2d ago"), because this screen is read by an
 * adult a few times a week rather than by a child several times a day.
 *
 * @param {*} ts        a Firestore timestamp (or anything toMillis reads)
 * @param {number} [now]
 */
export function ageLabel(ts, now = Date.now()) {
  const ms = toMillis(ts)
  if (!ms) return 'Just now'
  const diff = now - ms
  if (diff < 60_000) return 'Just now'

  const mins = Math.floor(diff / 60_000)
  if (mins < 60) return `${mins}m ago`

  const dayStart = startOfDay(now)
  if (ms >= dayStart) {
    const hrs = Math.max(1, Math.floor(mins / 60))
    return `${hrs}h ago`
  }
  const DAY = 24 * 60 * 60 * 1000
  if (ms >= dayStart - DAY) return 'Yesterday'

  const days = Math.round((dayStart - startOfDay(ms)) / DAY)
  if (days < 7) return `${days} days ago`
  return new Date(ms).toLocaleDateString()
}

/**
 * The tap target, or null when there isn't a safe one.
 *
 * `action.url` is written server-side and is meant to be an in-app path, but
 * "starts with a slash" is not the same test as "is in-app": `//evil.example`
 * starts with a slash and is a protocol-relative URL to another origin, and
 * `/\evil.example` is treated as one by several browsers. Both are rejected
 * here, so the parent inbox cannot become a way to walk a signed-in guardian
 * off the product.
 *
 * @param {{action?: {url?: string}}} n
 * @returns {string|null}
 */
export function inAppPath(n) {
  const raw = n && n.action && typeof n.action.url === 'string' ? n.action.url.trim() : ''
  if (!raw.startsWith('/')) return null
  if (raw.startsWith('//') || raw.startsWith('/\\')) return null
  return raw
}
