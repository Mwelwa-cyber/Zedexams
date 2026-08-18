/**
 * Every surface that redirects to /login on auth state must wait for
 * `authReady` before it does.
 *
 * ## Why this is a static scan and not a behaviour test
 *
 * The bug this repository just fixed was not one guard being wrong. It was
 * FOUR, and they were found one at a time: `ProtectedRoute` is the obvious one,
 * but `ParentAppRoute` (App.jsx — reachable by ADMINS, not just parents),
 * `ZedChatPage`, `PastPaperPractice` and `VerifyEmail` each read auth state and
 * redirect themselves. A behaviour test proves the guards someone remembered to
 * write a test for; it says nothing about the fifth one added next quarter,
 * which is exactly how this became a production incident.
 *
 * ## The rule
 *
 * `loading === false && currentUser === null` is NOT evidence of a signed-out
 * visitor. The restoration watchdog drops `loading` on a timer WITHOUT knowing
 * who the user is, so a guard that redirects on that pair sends a learner
 * holding a valid refresh token to /login and leaves them there. Only
 * `authReady` — set solely by `onAuthStateChanged` — separates "Firebase said
 * there is no user" from "Firebase has not spoken yet".
 *
 * So: a file that reads auth state from `useAuth()` AND navigates to /login
 * must also read `authReady`. The scan is deliberately coarse — it proves the
 * signal is consulted, not that it is consulted correctly — because the failure
 * it exists to catch is a new guard that never considered the question at all.
 * Correctness of each individual guard is covered by its own spec.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

const ROOT = new URL('..', import.meta.url).pathname
const SRC = join(ROOT, 'src')

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) walk(full, out)
    else if (/\.(jsx?|tsx?)$/.test(entry) && !/\.(spec|test)\./.test(entry)) out.push(full)
  }
  return out
}

// A GUARD VERDICT: a declarative redirect rendered in place of the page.
//   <Navigate to="/login" replace …>    <Navigate to={`/login?next=${x}`} …>
//
// Deliberately NOT the imperative `navigate('/login')`. In this codebase that
// form is a sign-out handler or a click handler — eleven of them — and every
// one is correct as written: a user who pressed "Sign out" SHOULD be sent to
// /login regardless of what auth thinks. Flagging those would bury the four
// real guards in noise and train everyone to skip this check. The guard form
// here is always declarative, because a guard renders a redirect instead of
// the page rather than firing one from an event.
const REDIRECTS_TO_LOGIN = /<Navigate\s[^>]{0,200}?to=\s*[{'"`][^\n]{0,80}\/login/
// Reads auth state from the context (as opposed to merely linking to /login,
// which every sign-in call-to-action does and which is not a guard).
const READS_AUTH = /useAuth\s*\(\s*\)/
// What makes a /login redirect a GUARD rather than a sign-out: it is
// conditioned on the ABSENCE of a user. Without this the scan also flags every
// `logout().then(() => navigate('/login'))` handler in the app — eleven of
// them — which are correct as written and would train everyone to ignore this
// check. A sign-out redirect is deliberate; a guard redirect is a verdict.
const TESTS_FOR_NO_USER = /!\s*currentUser\b|currentUser\s*===\s*null|!\s*hasUser\b/
const READS_AUTH_READY = /\bauthReady\b/

const offenders = []
let scanned = 0
let guards = 0

for (const file of walk(SRC)) {
  const source = readFileSync(file, 'utf8')
  scanned += 1
  if (!READS_AUTH.test(source)) continue
  if (!REDIRECTS_TO_LOGIN.test(source)) continue
  if (!TESTS_FOR_NO_USER.test(source)) continue
  guards += 1
  if (!READS_AUTH_READY.test(source)) offenders.push(relative(ROOT, file))
}

if (guards === 0) {
  // A scan that matches nothing is indistinguishable from a scan that found
  // nothing wrong. Fail loudly rather than reporting a green tick for a
  // pattern that has silently stopped matching the codebase.
  console.error('FAIL: found no /login guards at all — the detection pattern has drifted.')
  process.exit(1)
}

if (offenders.length > 0) {
  console.error(
    `FAIL: ${offenders.length} surface(s) redirect to /login on auth state without waiting for authReady:\n` +
    offenders.map((f) => `  • ${f}`).join('\n') +
    '\n\n`loading === false && currentUser === null` is not "signed out" — the restoration\n' +
    'watchdog drops `loading` on a timer without knowing who the user is. Gate the redirect\n' +
    'on `authReady` (see src/app/guards/ProtectedRoute.jsx), or compose <ProtectedRoute>.',
  )
  process.exit(1)
}

console.log(`ok — ${guards} /login guard(s) across ${scanned} files all wait for authReady`)
