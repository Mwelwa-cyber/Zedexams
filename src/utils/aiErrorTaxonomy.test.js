// AI error taxonomy — plain `node` assertion tests (no Firebase, no React).
// Run: node src/utils/aiErrorTaxonomy.test.js
// Wired into test:all via the `test:ai-error-taxonomy` npm script.

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { AI_ERROR_REASON } from './aiErrorReasons.js'
import { mapAiError, isRetryableAiError } from './aiErrorTaxonomy.js'

let passed = 0
function ok(name, cond) { assert.ok(cond, name); passed++; console.log(`  ok  ${name}`) }

console.log('aiErrorTaxonomy')

// Firebase callable error shape: { code: 'functions/<code>', message, details }
const fbErr = (code, details) => ({ code: `functions/${code}`, message: 'x', details })

// ── burst throttle: retryable, "try again in Ns", NOT "tomorrow" ───────────
{
  const m = mapAiError(fbErr('resource-exhausted',
    { reason: AI_ERROR_REASON.BURST_RATE_LIMIT, retryAfterSec: 35, action: 'checkShortAnswer' }))
  ok('burst → category burst + retryable', m.category === 'burst' && m.retryable === true)
  ok('burst → retryAfterSec surfaced', m.retryAfterSec === 35)
  ok('burst message says "in 35 seconds"', /35 seconds/.test(m.userMessage))
  ok('burst message does NOT say tomorrow', !/tomorrow/i.test(m.userMessage))
}

// ── daily quota: terminal, "try again tomorrow" ────────────────────────────
{
  const m = mapAiError(fbErr('resource-exhausted', { reason: AI_ERROR_REASON.DAILY_QUOTA_EXHAUSTED }))
  ok('daily → category daily + NOT retryable', m.category === 'daily' && m.retryable === false)
  ok('daily message says tomorrow', /tomorrow/i.test(m.userMessage))
}

// ── monthly budget: terminal ───────────────────────────────────────────────
{
  const m = mapAiError(fbErr('resource-exhausted', { reason: AI_ERROR_REASON.MONTHLY_BUDGET_EXHAUSTED }))
  ok('budget → category budget + NOT retryable', m.category === 'budget' && m.retryable === false)
  ok('budget message does NOT say tomorrow', !/tomorrow/i.test(m.userMessage))
}

// ── provider timeout / unavailable: retryable ──────────────────────────────
{
  ok('local timeout marker → provider + retryable',
    mapAiError({ code: 'timeout', message: 'AI_TIMEOUT' }).category === 'provider')
  ok('deadline-exceeded → provider + retryable',
    mapAiError(fbErr('deadline-exceeded', {})).retryable === true)
  ok('unavailable → provider',
    mapAiError(fbErr('unavailable', {})).category === 'provider')
}

// ── resource-exhausted with NO reason (older backend) → treat as burst ─────
{
  const m = mapAiError(fbErr('resource-exhausted', {}))
  ok('bare resource-exhausted → burst (retryable), never "tomorrow"',
    m.category === 'burst' && m.retryable === true && !/tomorrow/i.test(m.userMessage))
}

// ── unknown error → not retryable, generic message ─────────────────────────
{
  const m = mapAiError(new Error('boom'))
  ok('unknown → category unknown + NOT retryable', m.category === 'unknown' && m.retryable === false)
  ok('isRetryableAiError helper agrees', isRetryableAiError(new Error('boom')) === false)
}

// ── drift guard: frontend reasons match the backend source of truth ────────
{
  const here = dirname(fileURLToPath(import.meta.url))
  const backend = readFileSync(join(here, '../../functions/aiErrorReasons.js'), 'utf8')
  for (const value of Object.values(AI_ERROR_REASON)) {
    assert.ok(backend.includes(`"${value}"`), `backend must define reason "${value}"`)
  }
  ok('every frontend reason code exists in functions/aiErrorReasons.js', true)
}

console.log(`aiErrorTaxonomy: ${passed} checks passed`)
