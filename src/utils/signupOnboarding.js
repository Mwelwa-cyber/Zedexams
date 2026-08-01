/**
 * signupOnboarding — where the sign-up flow's answers live between screens.
 *
 * Two stores, because they answer two different questions and have two
 * different lifetimes:
 *
 *   sessionStorage `zedexams:signup` — the IN-PROGRESS flow (role, date of
 *     birth, minor status). It has to survive a Google sign-in round trip:
 *     on the native Android shell and on any browser that falls back to a
 *     redirect, the page is torn down and rebuilt between tapping "Sign up
 *     with Google" and coming back signed in. React state does not survive
 *     that; a learner would return to a rebuilt page with no date on file and
 *     an account already created. It is cleared the moment the account exists.
 *
 *   localStorage `zedexams:age-answer` — the FIRST age answer, held for 24
 *     hours per device. This is the "you cannot back out and try a different
 *     birthday" rule. It outlives the session on purpose: closing the tab is
 *     the obvious way to get a fresh session, so a session-scoped lock would
 *     be no lock at all.
 *
 * Everything is defensive about storage being unavailable — Safari private
 * mode, disabled cookies, the Android WebView with storage cleared. The
 * chosen direction on failure is always "let a real person sign up": a
 * missing lock costs a retry the server-side cooldown still sees, while a
 * thrown error costs an account.
 */

import { AGE_ANSWER_TTL_MS, isFreshAgeAnswer } from './signupFlowCore'

const FLOW_KEY = 'zedexams:signup'
const ANSWER_KEY = 'zedexams:age-answer'

function safeSession() {
  try {
    return typeof sessionStorage !== 'undefined' ? sessionStorage : null
  } catch { return null }
}

function safeLocal() {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null
  } catch { return null }
}

function readJson(store, key) {
  if (!store) return null
  try {
    const raw = store.getItem(key)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' ? parsed : null
  } catch { return null }
}

function writeJson(store, key, value) {
  if (!store) return
  try {
    store.setItem(key, JSON.stringify(value))
  } catch { /* quota, private mode — the flow still works in memory */ }
}

function remove(store, key) {
  if (!store) return
  try { store.removeItem(key) } catch { /* ignore */ }
}

/** The in-progress flow state, or an empty object. */
export function readSignupFlow() {
  return readJson(safeSession(), FLOW_KEY) || {}
}

/** Merge into the in-progress flow state. */
export function writeSignupFlow(patch) {
  const next = { ...readSignupFlow(), ...patch }
  writeJson(safeSession(), FLOW_KEY, next)
  return next
}

/**
 * Forget the in-progress flow.
 *
 * Called on successful account creation and when the user abandons sign-up.
 * It deliberately does NOT clear the age answer: the account that was just
 * created carries the date, and a fresh visitor on the same device within the
 * window is still held to the first answer.
 */
export function clearSignupFlow() {
  remove(safeSession(), FLOW_KEY)
}

/**
 * The date of birth this device is currently held to, or null.
 *
 * Returns null for a stale, missing or malformed record — see
 * isFreshAgeAnswer for why a broken record must not lock someone out.
 */
export function readLockedAgeAnswer(now = Date.now()) {
  const record = readJson(safeLocal(), ANSWER_KEY)
  if (!isFreshAgeAnswer(record, now)) {
    if (record) remove(safeLocal(), ANSWER_KEY)
    return null
  }
  return String(record.dob)
}

/**
 * Record the FIRST age answer. Subsequent calls are ignored while the first
 * is still fresh — that is the whole mechanism, so it lives here rather than
 * at the call site where a later screen could forget to check.
 */
export function lockAgeAnswer(dob, now = Date.now()) {
  if (typeof dob !== 'string' || !dob.trim()) return
  if (readLockedAgeAnswer(now)) return
  writeJson(safeLocal(), ANSWER_KEY, { dob, at: now })
}

/**
 * Explicit abandonment: clear both stores.
 *
 * Not wired to a timer or to unmount — a learner who navigates to the Terms
 * page and back has not abandoned anything. The TTL is what expires an answer
 * nobody came back to.
 */
export function clearAgeAnswer() {
  remove(safeLocal(), ANSWER_KEY)
}

export { AGE_ANSWER_TTL_MS }
