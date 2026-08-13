/**
 * appCheckHealthCore — how App Check readiness is JUDGED. Pure: no
 * Firestore, no React, no DOM.
 *
 * The reads that feed it live in `../services/appCheckHealthService.js`
 * (§14.2 — a feature touches Firebase in exactly one place). This file was
 * `src/utils/appCheckHealth.js` and did both; the split is why it moved.
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
 * The reads are gated to admin role by Firestore rules, so a non-admin
 * context resolves to permission-denied before any of this runs.
 */

export const COLLECTION = 'appCheckHealth'
export const ONE_DAY_MS = 24 * 60 * 60 * 1000
const COUNTERS = ['attempts', 'valid', 'missing', 'invalid']

/** `2026-08-13` — the day-doc key the Cloud Functions writer uses. */
export function isoDate(d) { return d.toISOString().slice(0, 10) }

/** The `days` day-keys ending today, oldest first — the window to read. */
export function healthWindowDates({days = 14, now = Date.now()} = {}) {
  const dates = []
  for (let i = days - 1; i >= 0; i -= 1) {
    dates.push(isoDate(new Date(now - i * ONE_DAY_MS)))
  }
  return dates
}

/**
 * Merge a legacy day doc + its shard docs into one flat day row, summing
 * every numeric counter. Legacy single-doc days (pre-migration) live on
 * the parent doc; new days (post-migration) live only in the `shards`
 * subcollection — a given date has data in exactly one shape, so summing
 * both never double-counts. Exported for unit tests.
 */
export function mergeDayCounters(date, docs) {
  const merged = { date }
  for (const d of docs) {
    if (!d) continue
    for (const [k, v] of Object.entries(d)) {
      if (k === 'date' || k === 'updatedAt') continue
      if (typeof v === 'number' && Number.isFinite(v)) {
        merged[k] = (merged[k] || 0) + v
      }
    }
  }
  return merged
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
 * Observed sampling rate for a label/window, DERIVED from the counters we
 * already store: `_attempts` is weighted (each sampled write adds 1/rate),
 * `_sampled` is the raw write count, so sampled/attempts == the active rate.
 * null when there were no attempts. Returns a fraction in (0, 1].
 */
function sampleRateOf(sampled, attempts) {
  if (!attempts || !sampled) return null
  return Math.min(1, Math.round((sampled / attempts) * 1000) / 1000)
}

/**
 * Collapse `rawDays` into one row per endpoint label, summing each
 * counter across the window. `validPct` is null when there were no
 * attempts (so the UI can show "—" rather than a misleading 0%).
 * `attempts`/`valid`/`missing`/`invalid` are WEIGHTED estimates when
 * sampling is active; `sampled` is the raw sampled-write count and
 * `sampleRate` (= sampled/attempts) exposes the active rate so the UI can
 * label the totals as estimates.
 */
export function summarise(rawDays) {
  const labels = discoverLabels(rawDays)
  const rows = labels.map((label) => {
    const totals = { attempts: 0, valid: 0, missing: 0, invalid: 0 }
    let sampled = 0
    for (const day of rawDays) {
      for (const c of COUNTERS) {
        const v = day[`${label}_${c}`]
        if (typeof v === 'number') totals[c] += v
      }
      const s = day[`${label}_sampled`]
      if (typeof s === 'number') sampled += s
    }
    return {
      label,
      ...totals,
      sampled,
      sampleRate: sampleRateOf(sampled, totals.attempts),
      unattested: totals.missing + totals.invalid,
      validPct: pct(totals.valid, totals.attempts),
    }
  })
  const overall = rows.reduce((acc, r) => ({
    attempts: acc.attempts + r.attempts,
    valid: acc.valid + r.valid,
    missing: acc.missing + r.missing,
    invalid: acc.invalid + r.invalid,
    sampled: acc.sampled + r.sampled,
  }), { attempts: 0, valid: 0, missing: 0, invalid: 0, sampled: 0 })
  return {
    rows,
    overall: {
      ...overall,
      unattested: overall.missing + overall.invalid,
      validPct: pct(overall.valid, overall.attempts),
      sampleRate: sampleRateOf(overall.sampled, overall.attempts),
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
 * @param {string|{code?:string}|null} [p.pingError] — the error that made the
 *   ping unreachable (Firebase callable code, e.g. 'functions/not-found'), so
 *   the attested===null branch can say WHY rather than "check connectivity".
 * @returns {{tone:'good'|'warn'|'block', title:string, detail:string}}
 */
export function classifyDeviceAttestation({ native, recaptchaKeyConfigured, initialized, tokenKind, attested, pingError }) {
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
  // attested === null → the appCheckPing call itself threw, so we never got a
  // verdict. The captured error code separates the causes that otherwise all
  // read as a vague "check connectivity": a not-yet-deployed diagnostic, a
  // stale auth session, or a genuine network failure.
  const code = (typeof pingError === 'string' ? pingError : pingError?.code || '')
    .replace(/^functions\//, '')
  if (code === 'not-found') {
    return {
      tone: 'warn',
      title: 'Diagnostic not deployed here',
      detail: 'appCheckPing returned not-found — this build calls the self-test before the function exists in this environment. Deploy Cloud Functions (or update to a build that ships it). The per-endpoint counters below are unaffected.',
    }
  }
  if (code === 'unauthenticated') {
    return {
      tone: 'warn',
      title: 'Session not authenticated',
      detail: 'appCheckPing rejected this session as unauthenticated. Sign out and back in, then re-run the test.',
    }
  }
  if (code) {
    return {
      tone: 'warn',
      title: 'Server verdict unavailable',
      detail: `The appCheckPing call failed (${code}) before the server could return a verdict. Check connectivity and retry; if it persists, check the function logs.`,
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
