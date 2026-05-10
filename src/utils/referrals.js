/**
 * Referrals — audit C7 PR 1 (foundations).
 *
 * Each user gets a stable 8-char referralCode at signup. New users
 * who arrive at /register?ref=CODE have that code captured as their
 * `referredBy` value, which is once-write at the user-doc level (the
 * Firestore rules block any subsequent mutation).
 *
 * What's NOT in this PR:
 *   - Credit redemption at checkout (PR 2). When a referee subscribes
 *     to Pro, both the referee and the referrer get a free month.
 *     That requires touching the MoMo callback success path; lands
 *     separately so it can be reviewed in isolation.
 *   - Anti-fraud: same IP / same device flagging, max-credit cap per
 *     referrer, etc. PR 2 territory.
 *
 * Code format:
 *   - 8 chars from a 32-char alphabet (no 0/O, 1/I/L) → ~10^12 combos.
 *     Collision risk negligible at our scale; we re-roll on the rare
 *     `referralCodes/{code}` write rejection.
 *   - All-caps, voice-friendly so "tell me your code" works on a phone
 *     call when the parent and learner are in the same room.
 */

import {
  doc,
  getDoc,
  setDoc,
  serverTimestamp,
} from 'firebase/firestore'
import { db } from '../firebase/config'

// Same alphabet as class invite codes — readable + voice-friendly.
const REFERRAL_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'
const REFERRAL_CODE_LENGTH = 8

const REFERRAL_QUERY_PARAM = 'ref'
const REFERRAL_STORAGE_KEY = 'zedexams:pending-referral'
const REFERRAL_CODE_RE = new RegExp(`^[${REFERRAL_ALPHABET}]{${REFERRAL_CODE_LENGTH}}$`)

/**
 * Generate a fresh referral code. Tries a few times before giving up
 * — the namespace is huge (32^8 ~= 1.1 trillion) so a single attempt
 * is essentially always unique, but we retry on the off chance.
 *
 * Uses crypto.getRandomValues when available (browser + modern node),
 * falls back to Math.random for the rare environment that lacks it.
 * Codes are user-readable, not security tokens — Math.random is fine
 * as a fallback.
 */
export function generateReferralCode() {
  const bytes = new Uint8Array(REFERRAL_CODE_LENGTH)
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    crypto.getRandomValues(bytes)
  } else {
    for (let i = 0; i < bytes.length; i += 1) {
      bytes[i] = Math.floor(Math.random() * 256)
    }
  }
  let code = ''
  for (let i = 0; i < REFERRAL_CODE_LENGTH; i += 1) {
    code += REFERRAL_ALPHABET[bytes[i] % REFERRAL_ALPHABET.length]
  }
  return code
}

/**
 * Validate an external-input referral code. Strips whitespace,
 * uppercases, then checks the format. Returns null on anything
 * malformed so callers can short-circuit without throwing.
 */
export function normaliseReferralCode(raw) {
  const cleaned = String(raw || '').trim().toUpperCase()
  if (!REFERRAL_CODE_RE.test(cleaned)) return null
  return cleaned
}

/**
 * Mint a fresh referral code, write the lookup doc, and return the
 * code. Retries on the rare collision (lookup doc already exists).
 *
 * The lookup doc — `referralCodes/{code}` — is what makes referrer
 * resolution at credit-redemption time O(1). Without it we'd need
 * a Firestore query to find the user behind a code, which costs a
 * read budget per signup.
 *
 * Caller passes `uid`. The lookup doc is created with
 * `request.auth.uid == uid` — a tampered client cannot mint a code
 * that points at someone else's uid.
 */
export async function mintAndPersistReferralCode(uid) {
  if (!uid) throw new Error('mintAndPersistReferralCode: uid is required')
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const code = generateReferralCode()
    const lookupRef = doc(db, 'referralCodes', code)
    try {
      await setDoc(lookupRef, {
        uid,
        createdAt: serverTimestamp(),
      })
      return code
    } catch (err) {
      // Most likely cause: rules-rejected because the code already
      // exists (rules forbid overwrite). Try again with a new code.
      // After 6 failed mints we give up — at our scale this should
      // never trigger.
      if (attempt === 5) {
        console.error('[referrals] mint exhausted retries', err)
        throw err
      }
    }
  }
  // unreachable
  throw new Error('mintAndPersistReferralCode: exhausted attempts')
}

/**
 * Read the referral code stashed in localStorage (set at /register
 * page mount when ?ref= was present in the URL). Validates the format
 * before returning so a tampered localStorage can't inject garbage
 * into someone else's user doc.
 */
export function readPendingReferral() {
  if (typeof window === 'undefined' || !window.localStorage) return null
  const raw = window.localStorage.getItem(REFERRAL_STORAGE_KEY)
  return normaliseReferralCode(raw)
}

export function setPendingReferral(code) {
  if (typeof window === 'undefined' || !window.localStorage) return
  const cleaned = normaliseReferralCode(code)
  if (cleaned) {
    window.localStorage.setItem(REFERRAL_STORAGE_KEY, cleaned)
  }
}

export function clearPendingReferral() {
  if (typeof window === 'undefined' || !window.localStorage) return
  window.localStorage.removeItem(REFERRAL_STORAGE_KEY)
}

/**
 * On /register page mount, read `?ref=ABC12345` from the URL and
 * stash it in localStorage so it survives the OAuth round-trip if
 * the user signs up via Google. Returns the captured code (or null).
 */
export function captureReferralFromUrl(searchParams) {
  if (!searchParams) return null
  const raw = searchParams.get(REFERRAL_QUERY_PARAM)
  if (!raw) return null
  const cleaned = normaliseReferralCode(raw)
  if (!cleaned) return null
  setPendingReferral(cleaned)
  return cleaned
}

/**
 * Look up the uid behind a referral code. Returns null if no such
 * code exists. Public read (rules allow signed-in users to read
 * the lookup doc) so PR 2's redeem-at-checkout path can resolve
 * referrer → uid.
 */
export async function resolveReferralCode(code) {
  const cleaned = normaliseReferralCode(code)
  if (!cleaned) return null
  try {
    const snap = await getDoc(doc(db, 'referralCodes', cleaned))
    if (!snap.exists()) return null
    return snap.data()?.uid || null
  } catch (err) {
    console.warn('[referrals] resolveReferralCode failed', err)
    return null
  }
}

/**
 * Build the share URL that points at /register?ref=<code>.
 * Used by the share buttons on /profile.
 */
export function buildReferralShareUrl(code, { baseUrl = 'https://zedexams.com' } = {}) {
  const cleaned = normaliseReferralCode(code)
  if (!cleaned) return null
  return `${baseUrl}/register?${REFERRAL_QUERY_PARAM}=${cleaned}`
}

/**
 * Build the WhatsApp deep-link with a pre-filled message.
 */
export function buildReferralWhatsAppUrl(code, displayName) {
  const url = buildReferralShareUrl(code)
  if (!url) return null
  const greeting = displayName ? `${displayName} on ZedExams` : 'me on ZedExams'
  const message = `Join ${greeting} — Zambian CBC quizzes, lessons, and ECZ past papers. Sign up with my code and we both get a free month of Pro: ${url}`
  return `https://wa.me/?text=${encodeURIComponent(message)}`
}

export const REFERRAL_CONSTANTS = {
  CODE_LENGTH: REFERRAL_CODE_LENGTH,
  ALPHABET: REFERRAL_ALPHABET,
  QUERY_PARAM: REFERRAL_QUERY_PARAM,
  STORAGE_KEY: REFERRAL_STORAGE_KEY,
}
