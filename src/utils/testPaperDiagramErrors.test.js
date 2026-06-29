import assert from 'node:assert/strict'
import { messageFromError, messageFromTableError } from './testPaperDiagramErrors.js'

// ─── messageFromError (redraw) ──────────────────────────────────────────────

// Known, mapped codes get their friendly canned lines.
assert.match(
  messageFromError({ code: 'resource-exhausted', message: 'x' }),
  /Monthly diagram limit reached/,
)
assert.match(
  messageFromError({ code: 'permission-denied', message: 'x' }),
  /approved teachers/,
)
assert.match(
  messageFromError({ code: 'unauthenticated', message: 'x' }),
  /sign in/i,
)

// A config/key problem surfaces the server's wording so the admin knows to fix it.
assert.match(
  messageFromError({ code: 'failed-precondition', message: 'Kie key looks invalid — admin needs to rotate KIE_API_KEY in Firebase Secrets.' }),
  /rotate KIE_API_KEY/,
)

// A genuine deadline → friendly "took too long".
assert.match(
  messageFromError({ code: 'deadline-exceeded', message: 'Image generation took too long. Please try again.' }),
  /took too long\. Try again, or keep \/ clean/,
)
// The client-side withTimeout wrapper throws a plain Error (no code).
assert.match(
  messageFromError(new Error('Diagram redraw timed out. Please try again.')),
  /took too long\. Try again/,
)

// A BARE "internal" (platform-killed instance, no reason) → the generic line.
assert.match(
  messageFromError({ code: 'internal', message: 'internal' }),
  /took too long or hit an error/,
)
assert.match(
  messageFromError({ code: 'internal' }),
  /took too long or hit an error/,
)

// REGRESSION: an internal error WITH a descriptive server reason must surface
// that reason (not be hidden behind the vague generic line) so the failure is
// diagnosable. This is the whole point of the 2026-06 rework.
const credits = messageFromError({
  code: 'internal',
  message: 'Diagram redraw failed: Recraft request failed (402): insufficient credits',
})
assert.match(credits, /Recraft request failed \(402\): insufficient credits/, 'real reason is surfaced')
assert.doesNotMatch(credits, /^The diagram service took too long or hit an error/, 'not hidden behind the generic line')
assert.doesNotMatch(credits, /Diagram redraw failed:/, 'internal prefix is stripped')
assert.match(credits, /keep \/ clean the original image instead/, 'still points at the no-cost fallback')

// A descriptive reason on a non-internal code passes through with the fallback hint.
assert.match(
  messageFromError({ code: 'internal', message: 'Diagram redraw failed: The AI returned no diagram. Please try again' }),
  /The AI returned no diagram\. Please try again — or keep \/ clean/,
)

// Empty/garbage input never throws and never returns an empty string.
for (const bad of [undefined, null, {}, { code: '', message: '' }]) {
  const out = messageFromError(bad)
  assert.equal(typeof out, 'string')
  assert.ok(out.length > 0)
}

// ─── messageFromTableError ──────────────────────────────────────────────────

assert.match(
  messageFromTableError({ code: 'failed-precondition', message: 'No table could be read from this figure. Try Redraw instead.' }),
  /No table could be read/,
)
assert.match(
  messageFromTableError({ code: 'internal', message: 'internal' }),
  /choose another option/,
)
assert.match(
  messageFromTableError({ code: 'deadline-exceeded', message: 'timed out' }),
  /took too long/i,
)

console.log('testPaperDiagramErrors.test.js — OK')
