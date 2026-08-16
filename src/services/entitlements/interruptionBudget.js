/**
 * interruptionBudget — permission to interrupt, asked before every upsell.
 *
 * The caps in the design document are not guidelines, and the way they stop
 * being guidelines is that no surface renders itself: each one asks
 * `canShow({ tier, surface, context })` first, and a `false` is final. A rule
 * enforced by each surface remembering to check it is a rule that lasts until
 * the next surface.
 *
 * ── Why suppression is an EVENT and not a silence ──────────────────────
 *
 * Every refusal fires `interruption_suppressed` with the reason. Caps that
 * cannot be observed cannot be trusted: a surface that stopped appearing
 * because of a bug and a surface that stopped appearing because the cap fired
 * look identical in the funnel, and the first one is usually discovered months
 * later by someone wondering why conversion moved.
 *
 * ── What is persisted and what is not ──────────────────────────────────
 *
 * Persisted (localStorage always; mirrored onto `users/{uid}.interruptions`
 * when signed in): session count, first-seen time, last dismissal, per-surface
 * dismissal tallies, last guardian request. These carry the 24h / 7d / 72h
 * promises ACROSS devices — a cooldown that resets when the learner opens the
 * app on their mother's phone is not a cooldown. localStorage is the primary
 * copy because it works offline and for a signed-out visitor, which the
 * public past-paper routes have plenty of; the profile field is the mirror,
 * installed by UnlockSheetHost via `setRemoteSync`.
 *
 * A single profile FIELD rather than a subcollection, because the profile's
 * self-update rule is a blocklist — a new key needs no rules change, and
 * AuthContext already subscribes to the document.
 *
 * In-memory only: the app-open timestamp, whether a tier-3 modal has fired
 * this session, and the activity stack. All three are session facts by
 * definition, and writing them would mean a Firestore round-trip on every
 * screen the learner opens.
 *
 * The guardian rate limit is ALSO enforced server-side. This copy exists to
 * keep the button honest; the server's copy is the one that matters, because
 * this one runs on the attacker's machine.
 */

import { TIER } from './gates.js'

export const SUPPRESSION = Object.freeze({
  BLOCKED_CONTEXT: 'blocked_context',
  APP_OPEN_QUIET: 'app_open_quiet',
  NEW_ACCOUNT_GRACE: 'new_account_grace',
  SESSION_CAP: 'session_cap',
  DISMISSAL_COOLDOWN: 'dismissal_cooldown',
  SURFACE_COOLDOWN: 'surface_cooldown',
  GUARDIAN_RATE_LIMIT: 'guardian_rate_limit',
})

const MS_PER_HOUR = 60 * 60 * 1000
const MS_PER_DAY = 24 * MS_PER_HOUR

export const LIMITS = Object.freeze({
  /** Full-screen (tier 3) modals per session. */
  tier3PerSession: 1,
  /** Quiet period after ANY dismissal, across all surfaces. */
  dismissalCooldownMs: 24 * MS_PER_HOUR,
  /** Dismissals of one surface before it goes quiet for a week. */
  surfaceDismissalsBeforeLongCooldown: 3,
  surfaceCooldownMs: 7 * MS_PER_DAY,
  /** New-account grace: 3 sessions OR 48h, whichever is LONGER. */
  newAccountSessions: 3,
  newAccountMs: 48 * MS_PER_HOUR,
  /** Nothing interrupts in the first 10 seconds after the app opens. */
  appOpenQuietMs: 10 * 1000,
  /** Guardian requests per learner. Mirrored server-side. */
  guardianRequestCooldownMs: 72 * MS_PER_HOUR,
})

/**
 * Contexts in which nothing may interrupt. These are activities, not routes:
 * a learner mid-quiz is mid-quiz whether the URL says so or not, which is why
 * the screens push and pop rather than the budget matching pathnames.
 */
export const BLOCKED_CONTEXTS = Object.freeze([
  'quiz_active',
  'game_active',
  'live_challenge_active',
  'paper_reading',
  'ai_generating',
])

export function isBlockedContext(context) {
  return BLOCKED_CONTEXTS.includes(context)
}

function ts(value) {
  if (!value) return null
  const d = value instanceof Date ? value : new Date(value)
  return Number.isNaN(d.getTime()) ? null : d.getTime()
}

/**
 * The whole decision, as a pure function.
 *
 * @param {object} state    persisted + session state (see `snapshot()`)
 * @param {object} request  { tier, surface, context }
 * @param {number} nowMs
 * @returns {{ allowed: boolean, reason: string|null }}
 */
export function decideCanShow(state = {}, request = {}, nowMs = Date.now()) {
  const { tier = TIER.CONTEXTUAL, surface = 'unknown', context = null } = request

  // Tier 0 (the ambient chip) and tier 1 (an inline lock badge) are not
  // interruptions — they are the page. They are never suppressed, and asking
  // permission for them would make a padlock on a card disappear during a
  // cooldown, which is the opposite of the design: a lock the learner cannot
  // see converts nobody.
  if (tier <= TIER.INLINE) return { allowed: true, reason: null }

  const activeContexts = Array.isArray(state.activeContexts) ? state.activeContexts : []
  const blocking = [context, ...activeContexts].find((c) => c && isBlockedContext(c))
  if (blocking) return { allowed: false, reason: SUPPRESSION.BLOCKED_CONTEXT }

  const appOpenAt = ts(state.appOpenAt)
  if (appOpenAt != null && nowMs - appOpenAt < LIMITS.appOpenQuietMs) {
    return { allowed: false, reason: SUPPRESSION.APP_OPEN_QUIET }
  }

  // New-account grace: BOTH conditions must be satisfied to leave it, which is
  // what "whichever is longer" means. Three sessions in one evening does not
  // end it, and neither does two days of not opening the app.
  const firstSeenAt = ts(state.firstSeenAt)
  const sessions = Number(state.sessions || 0)
  const withinFirstSessions = sessions <= LIMITS.newAccountSessions
  const withinFirstHours = firstSeenAt != null && nowMs - firstSeenAt < LIMITS.newAccountMs
  if (withinFirstSessions || withinFirstHours) {
    return { allowed: false, reason: SUPPRESSION.NEW_ACCOUNT_GRACE }
  }

  if (tier >= TIER.FULL_SCREEN && Number(state.tier3ShownThisSession || 0) >= LIMITS.tier3PerSession) {
    return { allowed: false, reason: SUPPRESSION.SESSION_CAP }
  }

  const perSurface = state.dismissals?.[surface] || null
  if (perSurface && Number(perSurface.count || 0) >= LIMITS.surfaceDismissalsBeforeLongCooldown) {
    const lastAt = ts(perSurface.lastAt)
    if (lastAt != null && nowMs - lastAt < LIMITS.surfaceCooldownMs) {
      return { allowed: false, reason: SUPPRESSION.SURFACE_COOLDOWN }
    }
  }

  const lastDismissedAt = ts(state.lastDismissedAt)
  if (lastDismissedAt != null && nowMs - lastDismissedAt < LIMITS.dismissalCooldownMs) {
    return { allowed: false, reason: SUPPRESSION.DISMISSAL_COOLDOWN }
  }

  return { allowed: true, reason: null }
}

/** Pure: may a guardian request be sent? Mirrored by the callable server-side. */
export function decideCanRequestGuardian(state = {}, nowMs = Date.now()) {
  const lastAt = ts(state.lastGuardianRequestAt)
  if (lastAt != null && nowMs - lastAt < LIMITS.guardianRequestCooldownMs) {
    return {
      allowed: false,
      reason: SUPPRESSION.GUARDIAN_RATE_LIMIT,
      retryAfterMs: LIMITS.guardianRequestCooldownMs - (nowMs - lastAt),
    }
  }
  return { allowed: true, reason: null, retryAfterMs: 0 }
}

/** Pure: fold a dismissal into the persisted state. */
export function applyDismissal(state = {}, surface = 'unknown', nowMs = Date.now()) {
  const prev = state.dismissals?.[surface] || { count: 0, lastAt: null }
  return {
    ...state,
    lastDismissedAt: new Date(nowMs).toISOString(),
    dismissals: {
      ...(state.dismissals || {}),
      [surface]: { count: Number(prev.count || 0) + 1, lastAt: new Date(nowMs).toISOString() },
    },
  }
}

// ── The live singleton ──────────────────────────────────────────────────

const STORAGE_KEY = 'zedexams:interruptions'

const EMPTY = Object.freeze({
  sessions: 0,
  firstSeenAt: null,
  lastDismissedAt: null,
  dismissals: {},
  lastGuardianRequestAt: null,
})

function readStorage() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return { ...EMPTY }
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' ? { ...EMPTY, ...parsed } : { ...EMPTY }
  } catch {
    return { ...EMPTY }
  }
}

function writeStorage(state) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      sessions: state.sessions,
      firstSeenAt: state.firstSeenAt,
      lastDismissedAt: state.lastDismissedAt,
      dismissals: state.dismissals,
      lastGuardianRequestAt: state.lastGuardianRequestAt,
    }))
  } catch { /* private mode — the in-memory copy still holds this session */ }
}

let persisted = null
let session = {
  appOpenAt: null,
  tier3ShownThisSession: 0,
  activeContexts: [],
}
let remoteSync = null   // injected writer: (patch) => Promise<void>
const listeners = new Set()

function ensureLoaded() {
  if (!persisted) {
    persisted = readStorage()
    // A session is counted the first time the budget is consulted in this tab,
    // and `appOpenAt` is stamped with it so the 10-second quiet period is
    // measured from the app actually opening rather than from module import
    // (which happens during the bundle parse, before anything is on screen).
    persisted.sessions = Number(persisted.sessions || 0) + 1
    if (!persisted.firstSeenAt) persisted.firstSeenAt = new Date().toISOString()
    // Only if it has not already been seeded — `__reset` lets a test say the
    // app opened a minute ago, and re-stamping here would silently put every
    // such test back inside the 10-second quiet period.
    if (session.appOpenAt == null) session.appOpenAt = Date.now()
    writeStorage(persisted)
  }
  return persisted
}

function emit() {
  listeners.forEach((fn) => { try { fn(snapshot()) } catch { /* listener's problem */ } })
}

function persist(next) {
  persisted = next
  writeStorage(next)
  if (remoteSync) {
    Promise.resolve(remoteSync({
      sessions: next.sessions,
      firstSeenAt: next.firstSeenAt,
      lastDismissedAt: next.lastDismissedAt,
      dismissals: next.dismissals,
      lastGuardianRequestAt: next.lastGuardianRequestAt,
    })).catch(() => { /* offline — localStorage carries it until reconnect */ })
  }
  emit()
}

export function snapshot() {
  return { ...ensureLoaded(), ...session }
}

export const interruptionBudget = {
  /**
   * The one question every upsell surface asks.
   * @returns {boolean} — the reason for a refusal is reported through
   *   `onSuppressed`, so a caller gets a plain boolean and the funnel still
   *   learns why.
   */
  canShow(request = {}) {
    const verdict = decideCanShow(snapshot(), request, Date.now())
    if (!verdict.allowed) {
      suppressedListeners.forEach((fn) => {
        try { fn({ surface: request.surface, tier: request.tier, reason: verdict.reason }) } catch { /* ignore */ }
      })
    }
    return verdict.allowed
  },

  /** Same question, with the reason — for callers that want to log it. */
  evaluate(request = {}) {
    return decideCanShow(snapshot(), request, Date.now())
  },

  /** Record that a tier-3 modal actually rendered. */
  recordShown({ tier } = {}) {
    ensureLoaded()
    if (tier >= TIER.FULL_SCREEN) session.tier3ShownThisSession += 1
    emit()
  },

  /** Record a dismissal — this is what arms the 24h and 7-day cooldowns. */
  recordDismissal(surface = 'unknown') {
    persist(applyDismissal(ensureLoaded(), surface, Date.now()))
  },

  canRequestGuardian() {
    return decideCanRequestGuardian(snapshot(), Date.now())
  },

  recordGuardianRequest() {
    persist({ ...ensureLoaded(), lastGuardianRequestAt: new Date().toISOString() })
  },

  /** Push/pop an activity. Returns the pop function so callers cannot leak one. */
  pushContext(context) {
    ensureLoaded()
    session.activeContexts = [...session.activeContexts, context]
    emit()
    let popped = false
    return () => {
      if (popped) return
      popped = true
      const i = session.activeContexts.lastIndexOf(context)
      if (i >= 0) session.activeContexts = session.activeContexts.filter((_, idx) => idx !== i)
      emit()
    }
  },

  activeContexts() {
    return [...session.activeContexts]
  },

  /**
   * Hydrate from the server copy. Takes the LATER of each timestamp and the
   * HIGHER of each count, because both copies are legitimate observations of
   * the same user and a merge that lets one overwrite the other would let a
   * fresh device reset every cooldown just by signing in.
   */
  hydrate(remote) {
    if (!remote || typeof remote !== 'object') return
    const local = ensureLoaded()
    const laterOf = (a, b) => {
      const ta = ts(a); const tb = ts(b)
      if (ta == null) return b || null
      if (tb == null) return a || null
      return ta >= tb ? a : b
    }
    const dismissals = { ...(local.dismissals || {}) }
    for (const [surface, entry] of Object.entries(remote.dismissals || {})) {
      const mine = dismissals[surface] || { count: 0, lastAt: null }
      dismissals[surface] = {
        count: Math.max(Number(mine.count || 0), Number(entry?.count || 0)),
        lastAt: laterOf(mine.lastAt, entry?.lastAt),
      }
    }
    persisted = {
      ...local,
      sessions: Math.max(Number(local.sessions || 0), Number(remote.sessions || 0)),
      firstSeenAt: (() => {
        const ta = ts(local.firstSeenAt); const tb = ts(remote.firstSeenAt)
        if (ta == null) return remote.firstSeenAt || null
        if (tb == null) return local.firstSeenAt
        // EARLIEST first-seen: the account is as old as its oldest sighting.
        return ta <= tb ? local.firstSeenAt : remote.firstSeenAt
      })(),
      lastDismissedAt: laterOf(local.lastDismissedAt, remote.lastDismissedAt),
      lastGuardianRequestAt: laterOf(local.lastGuardianRequestAt, remote.lastGuardianRequestAt),
      dismissals,
    }
    writeStorage(persisted)
    emit()
  },

  /** Install the Firestore writer. Called once by the provider. */
  setRemoteSync(fn) {
    remoteSync = typeof fn === 'function' ? fn : null
  },

  subscribe(fn) {
    listeners.add(fn)
    fn(snapshot())
    return () => listeners.delete(fn)
  },

  /**
   * Test seam — resets both halves of the state.
   *
   * `appOpenAt` seeds the session clock so a test can describe an app that
   * opened a minute ago rather than one opening this instant, which is
   * otherwise inside the 10-second quiet period and refuses everything.
   */
  __reset({ appOpenAt = null } = {}) {
    persisted = null
    session = { appOpenAt, tier3ShownThisSession: 0, activeContexts: [] }
    remoteSync = null
    try { localStorage.removeItem(STORAGE_KEY) } catch { /* ignore */ }
  },
}

const suppressedListeners = new Set()

/** Subscribe to refusals — `analytics` wires `interruption_suppressed` here. */
export function onSuppressed(fn) {
  suppressedListeners.add(fn)
  return () => suppressedListeners.delete(fn)
}
