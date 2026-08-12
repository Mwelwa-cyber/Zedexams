#!/usr/bin/env node
/* global console, process */
/**
 * Regression test for the prerender render-gate retry.
 *
 * The bug: "Prerender public routes" was the last step failing on main, and it
 * failed on a different single route every time —
 * /blog/how-to-revise-week-by-week (#2005), /games/g/5 (#1987),
 * /blog/ecz-grade-7-past-papers-guide (#1970), /games (#1967) — always with
 * "Waiting failed: 30000ms exceeded" from the render gate. One route out of
 * 23, never twice the same, across unrelated route families: a transient
 * Chromium scheduling stall on the runner, not a broken route.
 *
 * prerender.mjs already had MAX_ROUTE_ATTEMPTS = 2, but the retry only fired
 * for isRecoverableBrowserError() (CDP "Target closed" style failures), so a
 * gate timeout went straight onto the failure list and cost the deploy.
 *
 * This test pins the four behaviours that make the retry safe rather than
 * merely convenient:
 *
 *   1. a gate timeout retries once, and on a FRESH page;
 *   2. a second attempt that succeeds passes the route and writes it;
 *   3. repeated timeouts still fail the build;
 *   4. content / title / canonical validation failures are never retried and
 *      never silently accepted — not even if a later attempt would pass.
 *
 * (4) is the one that matters: a retry that swallowed a bad canonical would
 * quietly hand back the duplicate-canonical SEO regression this whole
 * prerender pipeline exists to prevent.
 *
 * Run: npm run test:prerender-retry (also via npm run test:all)
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import {
  CANONICAL_ORIGIN,
  MAX_ROUTE_ATTEMPTS,
  MIN_ROOT_TEXT,
  classifyRouteError,
  isRecoverableBrowserError,
  isRenderGateTimeout,
  prerenderRouteWithRetry,
  validateSnapshot,
} from './prerenderRetry.mjs'

let pass = 0
let fail = 0
const failures = []

async function test(name, fn) {
  try {
    await fn()
    pass++
    console.log(`  ok ${name}`)
  } catch (err) {
    fail++
    failures.push({ name, message: err.message })
    console.log(`  FAIL ${name}`)
    console.log(`    ${err.message}`)
  }
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg)
}

/** The exact error Puppeteer's waitForFunction throws when the gate stalls. */
function gateTimeout() {
  const err = new Error('Waiting failed: 30000ms exceeded')
  err.name = 'TimeoutError'
  return err
}

/** The exact error page.goto() throws when navigation runs out of budget. */
function navTimeout() {
  const err = new Error('Navigation timeout of 30000 ms exceeded')
  err.name = 'TimeoutError'
  return err
}

/** A snapshot that clears all three gates for the given route. */
function goodSnapshot(route) {
  return {
    html: '<!DOCTYPE html>\n<html><head></head><body></body></html>',
    title: 'Revise week by week — ZedExams',
    canonical: `${CANONICAL_ORIGIN}${route}`,
    rootLen: MIN_ROOT_TEXT + 500,
  }
}

/**
 * A fake renderer plus a recorder.
 *
 * `script` holds one entry per attempt: an Error to throw, or a snapshot to
 * return. Every call takes a brand-new page id, mirroring the real
 * renderRoute() which opens a page at the top and closes it in a finally — so
 * distinct ids across attempts is exactly the "fresh page" property we want to
 * assert. (A source guard further down checks that the real renderRoute really
 * does own its page lifecycle, which is what keeps this proxy honest.)
 */
function harness(script) {
  const rec = { pages: [], attempts: [], written: [], relaunches: 0, warnings: [] }
  let pageSeq = 0
  const deps = {
    renderRoute: async (route, { attempt }) => {
      const page = `page-${(pageSeq += 1)}`
      rec.pages.push(page)
      rec.attempts.push({ attempt, page })
      const step = script[attempt - 1]
      if (step instanceof Error) throw step
      return step
    },
    onSuccess: async (route, snapshot, { attempt }) => {
      rec.written.push({ route, attempt, canonical: snapshot.canonical })
    },
    relaunchBrowser: async () => {
      rec.relaunches += 1
    },
    log: { warn: (message) => rec.warnings.push(message) },
  }
  return { rec, deps }
}

// ── Classification ───────────────────────────────────────────────────────────
console.log('\nerror classification (classifyRouteError)')

await test('a waitForFunction gate timeout is retryable, without a relaunch', () => {
  const d = classifyRouteError(gateTimeout(), { attempt: 1, maxAttempts: 2 })
  assert(d.reason === 'gate-timeout', `reason was "${d.reason}"`)
  assert(d.retry === true, 'a first-attempt gate timeout must be retried — this is the bug')
  assert(
    d.relaunchBrowser === false,
    'a gate timeout leaves the browser healthy; tearing it down wastes ~2s per route',
  )
})

await test('a goto navigation timeout is treated the same way', () => {
  const d = classifyRouteError(navTimeout(), { attempt: 1, maxAttempts: 2 })
  assert(d.reason === 'gate-timeout', `reason was "${d.reason}"`)
  assert(d.retry === true, 'a navigation timeout is just as transient as a gate timeout')
})

await test('a timeout whose TimeoutError name was lost is still recognised', () => {
  assert(
    isRenderGateTimeout(new Error('Waiting failed: 30000ms exceeded')),
    'matching on err.name alone breaks as soon as the error is re-thrown as a plain Error',
  )
})

await test('a dead browser is retryable AND forces a relaunch', () => {
  const err = new Error('Protocol error: Target closed')
  assert(isRecoverableBrowserError(err), 'setup: expected a browser-level error')
  const d = classifyRouteError(err, { attempt: 1, maxAttempts: 2 })
  assert(d.reason === 'browser', `reason was "${d.reason}"`)
  assert(d.retry === true, 'browser-level errors were already retried; that must not regress')
  assert(d.relaunchBrowser === true, 'a dead browser cannot be recovered with a new page')
})

await test('an unrecognised error is fatal and never retried', () => {
  const d = classifyRouteError(new TypeError('boom'), { attempt: 1, maxAttempts: 2 })
  assert(d.reason === 'fatal', `reason was "${d.reason}"`)
  assert(d.retry === false, 'retrying unknown errors would paper over real crashes')
})

await test('the final attempt never retries, not even for a timeout', () => {
  const d = classifyRouteError(gateTimeout(), {
    attempt: MAX_ROUTE_ATTEMPTS,
    maxAttempts: MAX_ROUTE_ATTEMPTS,
  })
  assert(d.retry === false, 'the attempt budget must be a hard stop, or the deploy hangs')
})

// ── (1) + (2) retry once on a fresh page; a good second attempt passes ───────
console.log('\ngate timeout retries once on a fresh page (prerenderRouteWithRetry)')

await test('a gate timeout retries exactly once, on a fresh page', async () => {
  const { rec, deps } = harness([gateTimeout(), goodSnapshot('/games')])
  const failure = await prerenderRouteWithRetry('/games', deps)

  assert(failure === null, `expected the route to pass, got: ${failure}`)
  assert(rec.attempts.length === 2, `expected 2 attempts, got ${rec.attempts.length}`)
  assert(rec.attempts[0].attempt === 1 && rec.attempts[1].attempt === 2, 'attempt numbering')
  assert(
    rec.attempts[0].page !== rec.attempts[1].page,
    'the retry reused the page that stalled — a stalled page is what must be discarded',
  )
  assert(new Set(rec.pages).size === 2, `expected 2 distinct pages, got ${new Set(rec.pages).size}`)
  assert(rec.relaunches === 0, 'a gate timeout must not tear down the whole browser')
  assert(rec.warnings.length === 1, `expected 1 warning, got ${rec.warnings.length}`)
  assert(
    rec.warnings[0].includes('gate-timeout') && rec.warnings[0].includes('/games'),
    `the retry must say what it is retrying and why: "${rec.warnings[0]}"`,
  )
})

await test('the successful second attempt is the one that gets written', async () => {
  const route = '/blog/how-to-revise-week-by-week'
  const { rec, deps } = harness([gateTimeout(), goodSnapshot(route)])
  const failure = await prerenderRouteWithRetry(route, deps)

  assert(failure === null, `expected the route to pass, got: ${failure}`)
  assert(rec.written.length === 1, `expected 1 write, got ${rec.written.length}`)
  assert(rec.written[0].attempt === 2, `written on attempt ${rec.written[0].attempt}, expected 2`)
  assert(
    rec.written[0].canonical === `${CANONICAL_ORIGIN}${route}`,
    `wrong canonical written: "${rec.written[0].canonical}"`,
  )
})

await test('a route that renders first time is not retried at all', async () => {
  const { rec, deps } = harness([goodSnapshot('/pricing')])
  const failure = await prerenderRouteWithRetry('/pricing', deps)

  assert(failure === null, `expected the route to pass, got: ${failure}`)
  assert(rec.attempts.length === 1, `a healthy route renders once, got ${rec.attempts.length}`)
  assert(rec.warnings.length === 0, 'a healthy route must not log a retry warning')
})

await test('a dead browser retries and relaunches exactly once', async () => {
  const browserGone = new Error('Protocol error (Target.createTarget): Target closed')
  const { rec, deps } = harness([browserGone, goodSnapshot('/papers')])
  const failure = await prerenderRouteWithRetry('/papers', deps)

  assert(failure === null, `expected the route to pass, got: ${failure}`)
  assert(rec.relaunches === 1, `expected 1 relaunch, got ${rec.relaunches}`)
  assert(rec.attempts.length === 2, `expected 2 attempts, got ${rec.attempts.length}`)
})

// ── (3) repeated timeouts still fail the build ───────────────────────────────
console.log('\nrepeated timeouts still fail the build')

await test('two gate timeouts fail the route and write nothing', async () => {
  const { rec, deps } = harness([gateTimeout(), gateTimeout()])
  const failure = await prerenderRouteWithRetry('/games', deps)

  assert(typeof failure === 'string', 'a route that never rendered MUST report a failure')
  assert(failure.includes('/games'), `the failure must name the route: "${failure}"`)
  assert(
    failure.includes('30000ms exceeded'),
    `the failure must carry the original error: "${failure}"`,
  )
  assert(rec.written.length === 0, 'nothing may be written for a route that never rendered')
})

await test('the attempt budget is a hard stop — it does not retry forever', async () => {
  const { rec, deps } = harness([gateTimeout(), gateTimeout(), gateTimeout(), gateTimeout()])
  await prerenderRouteWithRetry('/games', deps)
  assert(
    rec.attempts.length === MAX_ROUTE_ATTEMPTS,
    `expected ${MAX_ROUTE_ATTEMPTS} attempts, got ${rec.attempts.length}`,
  )
})

await test('a fatal error fails on the first attempt, with no retry', async () => {
  const { rec, deps } = harness([new TypeError('buildRouteList is not a function')])
  const failure = await prerenderRouteWithRetry('/status', deps)

  assert(typeof failure === 'string', 'a fatal error must fail the route')
  assert(rec.attempts.length === 1, `expected 1 attempt, got ${rec.attempts.length}`)
  assert(rec.warnings.length === 0, 'a fatal error must not be reported as a retry')
})

// ── (4) validation failures are never retried, never accepted ────────────────
console.log('\nvalidation failures are never silently accepted')

await test('too little content fails the route on the first attempt', async () => {
  const thin = { ...goodSnapshot('/grade-12'), rootLen: 12 }
  const { rec, deps } = harness([thin])
  const failure = await prerenderRouteWithRetry('/grade-12', deps)

  assert(typeof failure === 'string', 'an empty shell must fail the build')
  assert(failure.includes('too little content'), `unexpected failure: "${failure}"`)
  assert(rec.written.length === 0, 'an empty shell must never be written')
  assert(rec.attempts.length === 1, 'a validation failure is not transient — do not retry it')
})

await test('a wrong canonical fails the route on the first attempt', async () => {
  const wrong = { ...goodSnapshot('/games'), canonical: `${CANONICAL_ORIGIN}/` }
  const { rec, deps } = harness([wrong])
  const failure = await prerenderRouteWithRetry('/games', deps)

  assert(typeof failure === 'string', 'a wrong canonical is the SEO bug this pipeline prevents')
  assert(failure.includes('canonical'), `unexpected failure: "${failure}"`)
  assert(rec.written.length === 0, 'a snapshot with the wrong canonical must never be written')
  assert(rec.attempts.length === 1, 'a validation failure is not transient — do not retry it')
})

await test('a missing SEO title fails the route on the first attempt', async () => {
  const untitled = { ...goodSnapshot('/terms'), title: 'Terms' }
  const { rec, deps } = harness([untitled])
  const failure = await prerenderRouteWithRetry('/terms', deps)

  assert(typeof failure === 'string', 'a lost SEO title must fail the build')
  assert(failure.includes('missing SEO title'), `unexpected failure: "${failure}"`)
  assert(rec.written.length === 0, 'a snapshot without the SEO title must never be written')
})

await test('a validation failure is NOT rescued by a later good attempt', async () => {
  // The trap the retry must not fall into: if a bad canonical were treated as
  // transient, this route would render wrong once, render right once, and ship
  // green — turning the SEO gate into a coin flip.
  const wrong = { ...goodSnapshot('/games'), canonical: `${CANONICAL_ORIGIN}/` }
  const { rec, deps } = harness([wrong, goodSnapshot('/games')])
  const failure = await prerenderRouteWithRetry('/games', deps)

  assert(typeof failure === 'string', 'a bad canonical must fail even when a retry would pass')
  assert(failure.includes('canonical'), `unexpected failure: "${failure}"`)
  assert(rec.attempts.length === 1, `expected 1 attempt, got ${rec.attempts.length}`)
  assert(rec.written.length === 0, 'nothing may be written after a failed gate')
})

await test('validateSnapshot passes a good snapshot', () => {
  assert(validateSnapshot('/games', goodSnapshot('/games')) === null, 'a good snapshot must pass')
})

await test('a missing snapshot is a failure, not an accepted empty render', () => {
  assert(validateSnapshot('/games', undefined) !== null, 'undefined must not pass the gates')
  assert(validateSnapshot('/games', null) !== null, 'null must not pass the gates')
})

// ── The gates were not weakened, and prerender.mjs really delegates ──────────
console.log('\nthe SEO gate was not weakened')

const __dirname = dirname(fileURLToPath(import.meta.url))
const prerenderSource = readFileSync(join(__dirname, 'prerender.mjs'), 'utf8')

await test('the content floor and attempt budget are unchanged', () => {
  assert(MIN_ROOT_TEXT === 200, `MIN_ROOT_TEXT is ${MIN_ROOT_TEXT}, expected 200`)
  assert(
    MAX_ROUTE_ATTEMPTS === 2,
    `MAX_ROUTE_ATTEMPTS is ${MAX_ROUTE_ATTEMPTS} — a bigger budget hides breakage longer`,
  )
})

await test('the 30s render budget is unchanged', () => {
  assert(
    prerenderSource.includes('const NAV_TIMEOUT_MS = 30_000'),
    'the render budget moved off 30s — the retry was meant to keep it, not extend it',
  )
})

await test('prerender.mjs delegates to the shared retry policy', () => {
  assert(
    prerenderSource.includes("from './prerenderRetry.mjs'"),
    'prerender.mjs no longer imports prerenderRetry.mjs',
  )
  assert(
    prerenderSource.includes('prerenderRouteWithRetry('),
    'prerender.mjs no longer calls prerenderRouteWithRetry — this test would test nothing',
  )
})

await test('prerender.mjs no longer runs its own attempt loop', () => {
  assert(
    !prerenderSource.includes('for (let attempt'),
    'prerender.mjs grew a second attempt loop — the policy must live in one place only',
  )
})

await test('renderRoute owns its page lifecycle, so each attempt is a fresh page', () => {
  const start = prerenderSource.indexOf('const renderRoute = async')
  assert(start > -1, 'renderRoute() is gone from prerender.mjs')
  const end = prerenderSource.indexOf('const writeSnapshot', start)
  assert(end > start, 'writeSnapshot() is gone from prerender.mjs')
  const body = prerenderSource.slice(start, end)
  assert(
    body.includes('await browser.newPage()'),
    'renderRoute must open its own page, or a retry would reuse the stalled one',
  )
  assert(
    /finally \{\s*await page\.close\(\)/.test(body),
    'renderRoute must close its page in a finally, or retries leak pages',
  )
})

await test('the canonical wait is still part of the render gate', () => {
  assert(
    prerenderSource.includes("link[rel=\"canonical\"]") && prerenderSource.includes('MIN_ROOT_TEXT'),
    'the render gate must still wait for BOTH real content and the flushed canonical',
  )
})

// ── Report ───────────────────────────────────────────────────────────────────
console.log('')
console.log(`─── ${pass + fail} tests · ${pass} passed · ${fail} failed ───`)
if (fail > 0) {
  console.log('\nfailures:')
  failures.forEach((f) => console.log(`  × ${f.name}\n    ${f.message}`))
  process.exit(1)
}
