/**
 * appCheckHealth — admin-only Firestore reads for the App Check
 * readiness dashboard.
 *
 * Cloud Functions write per-day rollups to appCheckHealth/{YYYY-MM-DD}
 * in soft-verify mode (functions/index.js: softVerifyAppCheckHttp /
 * recordAppCheckCallable). Each gated endpoint contributes four
 * counters keyed by its label:
 *
 *   {label}_attempts  — total calls
 *   {label}_valid     — calls with a verified App Check token
 *   {label}_missing   — calls with no token at all
 *   {label}_invalid   — calls with a token that failed verification
 *                        (HTTP path only; callables can't distinguish
 *                        missing vs invalid, so they fold into _missing)
 *
 * This data is the readiness signal for flipping APPCHECK_ENFORCE=1:
 * enforcement hard-denies every call that isn't `valid`, so it's only
 * safe once `missing`+`invalid` from real clients is ~0.
 *
 * All reads are gated to admin role by Firestore rules — calling these
 * from a non-admin context resolves to permission-denied.
 */

import { collection, getDocs, orderBy, query, where, limit as fsLimit } from 'firebase/firestore'
import { db } from '../firebase/config'

const COLLECTION = 'appCheckHealth'
const ONE_DAY_MS = 24 * 60 * 60 * 1000
const COUNTERS = ['attempts', 'valid', 'missing', 'invalid']

function isoDate(d) { return d.toISOString().slice(0, 10) }

/** Last `days` day-rollup docs, oldest → newest. */
export async function listAppCheckHealth({ days = 14 } = {}) {
  const since = isoDate(new Date(Date.now() - (days - 1) * ONE_DAY_MS))
  const q = query(
    collection(db, COLLECTION),
    where('__name__', '>=', since),
    orderBy('__name__', 'asc'),
    fsLimit(days + 5),
  )
  const snap = await getDocs(q)
  return snap.docs.map((d) => ({ date: d.id, ...d.data() }))
}

/**
 * Discover endpoint labels present in a set of raw day docs. Labels are
 * inferred from `<label>_attempts` keys so a newly-gated endpoint shows
 * up here with no dashboard change.
 */
export function discoverLabels(rawDays) {
  const labels = new Set()
  for (const day of rawDays) {
    for (const key of Object.keys(day)) {
      const m = /^(.+)_attempts$/.exec(key)
      if (m) labels.add(m[1])
    }
  }
  return [...labels].sort()
}

function pct(valid, attempts) {
  if (!attempts) return null
  return Math.round((valid / attempts) * 1000) / 10
}

/**
 * Collapse `rawDays` into one row per endpoint label, summing each
 * counter across the window. `validPct` is null when there were no
 * attempts (so the UI can show "—" rather than a misleading 0%).
 */
export function summarise(rawDays) {
  const labels = discoverLabels(rawDays)
  const rows = labels.map((label) => {
    const totals = { attempts: 0, valid: 0, missing: 0, invalid: 0 }
    for (const day of rawDays) {
      for (const c of COUNTERS) {
        const v = day[`${label}_${c}`]
        if (typeof v === 'number') totals[c] += v
      }
    }
    return {
      label,
      ...totals,
      unattested: totals.missing + totals.invalid,
      validPct: pct(totals.valid, totals.attempts),
    }
  })
  const overall = rows.reduce((acc, r) => ({
    attempts: acc.attempts + r.attempts,
    valid: acc.valid + r.valid,
    missing: acc.missing + r.missing,
    invalid: acc.invalid + r.invalid,
  }), { attempts: 0, valid: 0, missing: 0, invalid: 0 })
  return {
    rows,
    overall: {
      ...overall,
      unattested: overall.missing + overall.invalid,
      validPct: pct(overall.valid, overall.attempts),
    },
  }
}

/**
 * Readiness verdict for hard enforcement over the summarised window.
 *
 * Enforcement denies every non-`valid` call, so the gate is:
 *   - enough traffic observed to trust the sample, AND
 *   - no endpoint with unattested (missing+invalid) calls remaining.
 *
 * A single endpoint still seeing unattested traffic blocks readiness —
 * that's the one that breaks for real users on the flip.
 */
/**
 * Classify the "this device" self-test into one actionable verdict.
 *
 * The server-side counters say HOW MUCH traffic is unattested but not WHY —
 * a missing build key, a crashed reCAPTCHA, an unconfigured Play Integrity,
 * and a console-side key mismatch all land in the same "missing" bucket.
 * This runs in the admin's own session where each of those is separable.
 *
 * @param {object} p
 * @param {boolean} p.native — running inside the Capacitor wrapper
 * @param {boolean} p.recaptchaKeyConfigured — web site key baked into this build
 * @param {boolean} p.initialized — App Check init completed on this platform
 * @param {'real'|'placeholder'|'none'} p.tokenKind — what getAppCheckToken() minted
 * @param {boolean|null} p.attested — appCheckPing verdict (null = ping unreachable)
 * @returns {{tone:'good'|'warn'|'block', title:string, detail:string}}
 */
export function classifyDeviceAttestation({ native, recaptchaKeyConfigured, initialized, tokenKind, attested }) {
  if (attested === true) {
    return {
      tone: 'good',
      title: 'This device is attesting',
      detail: 'The server verified this session’s App Check token. Calls from this device count as valid.',
    }
  }
  if (!native && !recaptchaKeyConfigured) {
    return {
      tone: 'block',
      title: 'No reCAPTCHA key in this build',
      detail: 'This deploy shipped without VITE_FIREBASE_APPCHECK_RECAPTCHA_KEY, so no web client can mint a token. Set the GitHub Actions secret and redeploy hosting.',
    }
  }
  if (!initialized) {
    return {
      tone: 'warn',
      title: 'App Check did not initialise',
      detail: native
        ? 'The FirebaseAppCheck Capacitor plugin is not registered in this build — rebuild after npx cap sync android.'
        : 'The deferred App Check init has not completed in this session. Re-run the test; if it persists, check the console for [appCheck] warnings.',
    }
  }
  if (tokenKind === 'placeholder') {
    return {
      tone: 'block',
      title: native ? 'Play Integrity is not attesting' : 'reCAPTCHA is not attesting',
      detail: native
        ? 'Token minting fails, so the fail-open placeholder is sent — counted as unattested. Finish the Firebase/Play Console setup in docs/B3-PLAY-INTEGRITY-SETUP.md.'
        : 'reCAPTCHA is unreachable or crashing, so the fail-open placeholder is sent — counted as unattested. Check that the site key is valid for this domain.',
    }
  }
  if (tokenKind === 'none') {
    return {
      tone: 'warn',
      title: 'No token minted',
      detail: 'App Check initialised but returned no token. Re-run the test; if it persists, check the console for [appCheck] warnings.',
    }
  }
  if (attested === false) {
    return {
      tone: 'block',
      title: 'Server rejected this device’s token',
      detail: 'A real-looking token was minted but verification failed — the reCAPTCHA site key (web) or Play Integrity registration (Android) in Firebase Console → App Check does not match this app.',
    }
  }
  return {
    tone: 'warn',
    title: 'Server verdict unavailable',
    detail: 'A token was minted but the appCheckPing call failed, so the server verdict is unknown. Check connectivity and retry.',
  }
}

export function enforcementReadiness(summary, { minAttempts = 200 } = {}) {
  const { overall, rows } = summary
  if (overall.attempts < minAttempts) {
    return {
      ready: false,
      tone: 'wait',
      reason: `Only ${overall.attempts} calls observed — collect more soft-mode traffic before judging (target ≥ ${minAttempts}).`,
    }
  }
  const blocking = rows
    .filter((r) => r.attempts > 0 && r.unattested > 0)
    .sort((a, b) => b.unattested - a.unattested)
  if (blocking.length === 0) {
    return {
      ready: true,
      tone: 'ready',
      reason: `All ${overall.attempts} observed calls carried a valid App Check token. Enforcing should not break current clients.`,
    }
  }
  const worst = blocking[0]
  return {
    ready: false,
    tone: 'block',
    reason: `${blocking.length} endpoint(s) still see unattested traffic — worst: "${worst.label}" with ${worst.unattested} unattested of ${worst.attempts}. Enforcing now would hard-deny those clients.`,
  }
}
