/**
 * Google Play anti-steering, as a build guard.
 *
 * Inside the Android app, ZedExams may not describe or point at a payment
 * method other than Google Play. That is not a style preference — it is
 * the rule the app is reviewed against, and the surfaces most likely to
 * break it are the ones nobody thinks of as payment code: a marketing FAQ
 * answer, a row of Airtel/MTN logos, a reassuring sentence under a button.
 *
 * ── What this proves, and what it does not ──────────────────────────
 *
 * It is a SOURCE scan, so it proves the native gates still exist and that
 * the parent checkout carries no banned words. It cannot prove that what
 * renders at runtime is clean — that is what the component specs do
 * (ParentPlayCheckout.spec.jsx, ParentPlanStatus.spec.jsx and
 * ParentPlan.rails.spec.jsx all assert over rendered text). The two
 * layers answer different questions and neither replaces the other.
 *
 * Run: node scripts/test-play-steering-copy.mjs
 */

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8')

let passed = 0
function test(name, fn) {
  try {
    fn()
    passed += 1
    console.log(`  ok  ${name}`)
  } catch (err) {
    console.error(`  ✗   ${name}\n      ${err.message}`)
    process.exitCode = 1
  }
}

console.log('play steering copy')

// ── The parent checkout that renders inside the Android app ──────────
// This file has no web branch: everything in it ships to Play.
const BANNED = [
  [/\blenco\b/i, 'names our web payment provider'],
  [/mobile money/i, 'names an alternative payment method'],
  [/\bairtel\b/i, 'names an alternative payment method'],
  [/\bMTN\b/, 'names an alternative payment method'],
  [/\bzamtel\b/i, 'names an alternative payment method'],
  [/zedexams\.com/i, 'points the buyer at the website'],
  [/\bK\d/, 'prints a ZMW price literal — Play sets the price on this rail'],
]

test('the Android parent checkout carries no steering copy', () => {
  // Comments legitimately explain WHY these words are banned, so the scan
  // is over code and literals only.
  const code = read('src/features/parentPortal/components/ParentPlayCheckout.jsx')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1')
  for (const [pattern, why] of BANNED) {
    const hit = code.match(pattern)
    assert.ok(!hit, `ParentPlayCheckout.jsx contains "${hit?.[0]}" — it ${why}`)
  }
})

// ── The marketing pages' native gates ────────────────────────────────
// Both pages render inside the Android WebView, and both carry
// mobile-money copy for web visitors. The gates below are what keep that
// copy off the native build; each has already been correct once and is
// exactly the kind of thing a later edit removes without noticing.
test('/pricing swaps its FAQ for a Play-safe one natively', () => {
  const src = read('src/features/marketing/pages/Plans.jsx')
  assert.ok(/const FAQ_NATIVE\s*=/.test(src),
    'Plans.jsx no longer defines FAQ_NATIVE')
  assert.ok(/native \? FAQ_NATIVE : FAQ/.test(src),
    'Plans.jsx no longer chooses FAQ_NATIVE on the native build')
})

test('/pricing hides the mobile-money brand row natively', () => {
  const src = read('src/features/marketing/pages/Plans.jsx')
  assert.ok(/\{!native && <Section[^>]*>[\s\S]{0,400}PAYMENT_METHODS\.map/.test(src),
    'the PAYMENT_METHODS row is no longer behind a !native gate')
})

test('the homepage swaps its cost answer for a Play-safe one natively', () => {
  const src = read('src/features/marketing/pages/Marketing.jsx')
  assert.ok(/const FAQ_NATIVE\s*=/.test(src),
    'Marketing.jsx no longer defines FAQ_NATIVE')
  assert.ok(/native \? FAQ_NATIVE : FAQ/.test(src),
    'Marketing.jsx no longer chooses FAQ_NATIVE on the native build')
  assert.ok(/priceNative/.test(src) && /noteNative/.test(src),
    'Marketing.jsx no longer carries native price copy')
})

test('the native cost answer names Google Play and nothing else', () => {
  const src = read('src/features/marketing/pages/Marketing.jsx')
  const block = src.slice(src.indexOf('const FAQ_NATIVE'))
    .slice(0, src.slice(src.indexOf('const FAQ_NATIVE')).indexOf('\n)'))
  assert.ok(/Google Play/.test(block), 'the native cost answer no longer names Google Play')
  for (const [pattern] of BANNED.slice(0, 5)) {
    const hit = block.match(pattern)
    assert.ok(!hit, `the native cost answer contains "${hit?.[0]}"`)
  }
})

// ── The web copy must not promise mobile money "in the app" ──────────
// True on the website, false in the Android app, and read by the same
// Zambian parent who will install it.
test('web payment copy is scoped to the website, not to "the app"', () => {
  for (const file of [
    'src/features/marketing/pages/Marketing.jsx',
    'src/features/marketing/pages/Plans.jsx',
  ]) {
    const src = read(file)
    const claim = /(Airtel Money|MTN MoMo)[^`"']{0,120}right inside the app/i
    assert.ok(!claim.test(src),
      `${file} promises mobile money "right inside the app" — untrue on Android`)
  }
})

console.log(`\n${passed} passed`)
