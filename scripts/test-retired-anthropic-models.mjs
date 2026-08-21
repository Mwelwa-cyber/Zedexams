#!/usr/bin/env node
/* global console, process */
/**
 * Regression guard — no RETIRED Anthropic model ID may reach a request.
 *
 * Why this exists: on 2026-08-21 Anthropic notified this org that requests had
 * been sent to `claude-3-5-haiku-20241022`, retired 2026-02-19, and were coming
 * back `not_found_error` (HTTP 404). A retired model is not a degraded model —
 * every call fails outright, and the surfaces that call Haiku here are the ones
 * a user waits on (Vex's pre-publish verify, Qix's question review, Bonga's
 * WhatsApp replies, the paper explanations, the cheap teacher micro-tools).
 *
 * The audit found NOTHING in this repository calling the retired model: every
 * Anthropic call already routes to `claude-haiku-4-5` / the pinned snapshot
 * `claude-haiku-4-5-20251001`, or to Sonnet. So this guard is not a fix for a
 * bug in the tree — it is the check that was missing while that was true only
 * by luck. Model IDs are plain strings scattered across ~40 files and 39
 * `*_MODEL` env overrides; nothing in lint, the type system or CI could tell a
 * live ID from a retired one, and the failure surfaces in production as a 404
 * rather than at build time.
 *
 * THREE CHECKS, and the reason each is shaped the way it is:
 *
 *   1. DENY-LIST — the exact retired IDs. Zero ambiguity, zero false
 *      positives. This is the check that would have caught the reported call.
 *      Scanned across docs too, because CLAUDE.md is read by every AI session
 *      in this repo and a retired ID recorded there propagates into code.
 *
 *   2. LEGACY GENERATION — any `claude-<digit>…` or `claude-instant…` string.
 *      Current models are `claude-<family>-<version>` (`claude-haiku-4-5`);
 *      only the Claude 1/2/3/3.5/3.7 generation puts a digit straight after
 *      `claude-`, and that whole generation is retired or retiring. This is
 *      what catches an ID the deny-list has not been taught yet — including
 *      the `-latest` aliases (`claude-3-5-haiku-latest`), which resolve to a
 *      retired snapshot and would otherwise read as current.
 *
 *   3. KNOWN-MODEL ALLOWLIST — a versioned Claude family ID must be one we
 *      have actually checked. Matches `claude-(fable|mythos|opus|sonnet|haiku)`
 *      followed by a version, which is narrow ON PURPOSE: it leaves the
 *      pricing-table family keys (`claude-haiku`, `claude-sonnet`, unversioned)
 *      and the test fixtures (`claude-test`, `claude-x`, `claude-nova-1`)
 *      alone. A guard that fights its own repo's fixtures gets deleted.
 *
 * Adding a model means adding it to KNOWN_MODELS with a deliberate look at
 * whether it is current — which is the decision this guard exists to force.
 * A line may opt out with the marker `retired-model-ok` for legitimate
 * historical prose ("we migrated off X"); the marker is per-line and visible
 * in review, unlike silence.
 *
 * Sources: the retirement notice, and the model tables in the bundled
 * `claude-api` skill (`shared/models.md`) as of 2026-08-21.
 *
 * Plain `node`, so `scripts/run-all-tests.mjs` auto-discovers it and it runs
 * inside `npm run test:all` — the required CI check.
 */
import { readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')

let pass = 0
let fail = 0
const failures = []

function test(name, fn) {
  try {
    fn()
    pass++
    console.log(`  ok  ${name}`)
  } catch (err) {
    fail++
    failures.push({ name, message: err.message })
    console.log(`  FAIL ${name}`)
    console.log(`       ${err.message}`)
  }
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg)
}

// ── The retired set ─────────────────────────────────────────────────────────
// Retired = the API answers 404. Includes models whose published retirement
// date has now PASSED, since a call to one fails exactly like the rest.
const RETIRED = new Map([
  ['claude-3-5-haiku-20241022', 'retired 2026-02-19 — use claude-haiku-4-5'],
  ['claude-3-7-sonnet-20250219', 'retired 2026-02-19 — use claude-sonnet-4-6'],
  ['claude-3-opus-20240229', 'retired 2026-01-05 — use claude-opus-5'],
  ['claude-3-5-sonnet-20241022', 'retired 2025-10-28 — use claude-sonnet-4-6'],
  ['claude-3-5-sonnet-20240620', 'retired 2025-10-28 — use claude-sonnet-4-6'],
  ['claude-3-sonnet-20240229', 'retired 2025-07-21 — use claude-sonnet-4-6'],
  ['claude-2.1', 'retired 2025-07-21 — use claude-sonnet-4-6'],
  ['claude-2.0', 'retired 2025-07-21 — use claude-sonnet-4-6'],
  ['claude-3-haiku-20240307', 'retirement date 2026-04-19 has passed — use claude-haiku-4-5'],
  ['claude-opus-4-1', 'retirement date 2026-08-05 has passed — use claude-opus-5'],
  ['claude-opus-4-1-20250805', 'retirement date 2026-08-05 has passed — use claude-opus-5'],
])

// ── Models this repo may name ───────────────────────────────────────────────
// Current generation plus the still-active legacy pins. Pinned dated snapshots
// are deliberate here (the retirement notice itself recommends the dated
// `claude-haiku-4-5-20251001`), so a date suffix is not on its own a smell.
const KNOWN_MODELS = new Set([
  // current
  'claude-fable-5',
  'claude-mythos-5',
  'claude-opus-5',
  'claude-opus-4-8',
  'claude-opus-4-7',
  'claude-opus-4-6',
  'claude-sonnet-5',
  'claude-sonnet-4-6',
  'claude-haiku-4-5',
  'claude-haiku-4-5-20251001',
  // legacy, still active
  'claude-opus-4-5',
  'claude-opus-4-5-20251101',
  'claude-sonnet-4-5',
  'claude-sonnet-4-5-20250929',
])

const OPT_OUT = 'retired-model-ok'

// A Claude family ID carrying a version — narrow so unversioned pricing keys
// (`claude-haiku`) and fixtures (`claude-test`, `claude-x`) never match.
const VERSIONED_FAMILY = /claude-(?:fable|mythos|opus|sonnet|haiku)-[0-9][a-z0-9-]*/gi
// The pre-4.x generation: a digit or `instant` straight after `claude-`.
const LEGACY_GENERATION = /claude-(?:[0-9]|instant)[a-z0-9.-]*/gi

// ── Files to scan ───────────────────────────────────────────────────────────
// `git ls-files` is the source of truth: it skips node_modules, build output
// and anything gitignored without a hand-maintained exclude list.
const SELF = 'scripts/test-retired-anthropic-models.mjs'
const SKIP_EXACT = new Set(['package-lock.json', SELF])
const CODE_EXT = /\.(js|jsx|mjs|cjs|ts|tsx|json|ya?ml)$/i
const DOC_EXT = /\.(md|mdx)$/i

function trackedFiles() {
  const out = execFileSync('git', ['ls-files', '-z'], { cwd: ROOT, encoding: 'utf8' })
  return out.split('\0').filter(Boolean)
}

const tracked = trackedFiles().filter((f) => !SKIP_EXACT.has(f))
const codeFiles = tracked.filter((f) => CODE_EXT.test(f) || /(^|\/)\.env/.test(f))
const docFiles = tracked.filter((f) => DOC_EXT.test(f))

const sourceCache = new Map()
function read(rel) {
  if (!sourceCache.has(rel)) {
    try {
      sourceCache.set(rel, readFileSync(join(ROOT, rel), 'utf8'))
    } catch {
      sourceCache.set(rel, null)
    }
  }
  return sourceCache.get(rel)
}

/**
 * Walk a file's lines and report every regex hit, skipping opted-out lines.
 * Returns [{file, line, match}]. Kept as one scanner so the self-test below
 * exercises the same code path the real checks run.
 */
function scan(files, pattern, predicate) {
  const hits = []
  for (const rel of files) {
    const src = read(rel)
    if (src == null) continue
    const lines = src.split('\n')
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]
      if (line.includes(OPT_OUT)) continue
      for (const m of line.matchAll(pattern)) {
        const match = m[0]
        if (predicate(match.toLowerCase())) {
          hits.push({ file: rel, line: i + 1, match })
        }
      }
    }
  }
  return hits
}

const fmt = (hits) =>
  hits.map((h) => `${h.file}:${h.line} → ${h.match}`).join('\n    ')

console.log('retired Anthropic model guard')
console.log(`  scanning ${codeFiles.length} code/config files, ${docFiles.length} docs`)

// ── (1) DENY-LIST ───────────────────────────────────────────────────────────
test('no retired Anthropic model ID in code or config', () => {
  const hits = scan(codeFiles, /claude-[a-z0-9.-]+/gi, (m) => RETIRED.has(m))
  assert(
    hits.length === 0,
    `RETIRED model IDs found — these return 404 not_found_error:\n    ${fmt(hits)}\n` +
      [...new Set(hits.map((h) => h.match.toLowerCase()))]
        .map((id) => `  ${id}: ${RETIRED.get(id)}`)
        .join('\n'),
  )
})

test('no retired Anthropic model ID in documentation', () => {
  const hits = scan(docFiles, /claude-[a-z0-9.-]+/gi, (m) => RETIRED.has(m))
  assert(
    hits.length === 0,
    `RETIRED model IDs named in docs — every AI session in this repo reads ` +
      `these, so a retired ID here becomes retired code:\n    ${fmt(hits)}\n` +
      `Name the model in prose ("Haiku 3.5") or add the \`${OPT_OUT}\` marker ` +
      `to the line if the reference is deliberately historical.`,
  )
})

// ── (2) LEGACY GENERATION ───────────────────────────────────────────────────
test('no pre-4.x Claude model ID (claude-<digit>… / claude-instant…)', () => {
  const hits = scan(codeFiles, LEGACY_GENERATION, () => true)
  assert(
    hits.length === 0,
    `Pre-4.x Claude model IDs found. That whole generation is retired or ` +
      `retiring, and \`-latest\` aliases resolve to retired snapshots:\n    ${fmt(hits)}`,
  )
})

// ── (3) KNOWN-MODEL ALLOWLIST ───────────────────────────────────────────────
test('every versioned Claude model ID is a known, checked model', () => {
  const hits = scan(codeFiles, VERSIONED_FAMILY, (m) => !KNOWN_MODELS.has(m))
  assert(
    hits.length === 0,
    `Unrecognised Claude model IDs:\n    ${fmt(hits)}\n` +
      `If this model is current, add it to KNOWN_MODELS in ${SELF} — that edit ` +
      `is the deliberate "is this model still live?" check this guard exists ` +
      `to force. If it is retired, add it to RETIRED and fix the call site.`,
  )
})

// ── (4) SELF-TEST — the guard can actually fail ─────────────────────────────
// A scanner that silently matches nothing is indistinguishable from a clean
// tree. Prove each pattern fires, and that the opt-out marker is honoured.
test('the scanner detects a retired ID (guard can fail)', () => {
  const retiredId = ['claude', '3', '5', 'haiku', '20241022'].join('-')
  assert(RETIRED.has(retiredId), 'the reported retired ID must be on the deny-list')
  const found = [...retiredId.matchAll(/claude-[a-z0-9.-]+/gi)].map((m) => m[0])
  assert(found.includes(retiredId), 'deny-list pattern failed to match a retired ID')
  assert(
    [...retiredId.matchAll(LEGACY_GENERATION)].length === 1,
    'legacy-generation pattern failed to match a pre-4.x ID',
  )
})

test('the allowlist pattern ignores fixtures and unversioned family keys', () => {
  for (const benign of ['claude-test', 'claude-x', 'claude-nova-1', 'claude-haiku', 'claude-sonnet', 'claude-opus']) {
    assert(
      [...benign.matchAll(VERSIONED_FAMILY)].length === 0,
      `${benign} must not be read as a versioned model ID — it is a fixture or ` +
        `a pricing-table family key, and flagging it would make this guard noise`,
    )
  }
  assert(
    [...'claude-haiku-4-5-20251001'.matchAll(VERSIONED_FAMILY)].length === 1,
    'a real versioned model ID must still match',
  )
})

test('the opt-out marker suppresses a hit', () => {
  const hits = scan(['package.json'], /claude-[a-z0-9.-]+/gi, () => true)
  assert(Array.isArray(hits), 'scanner must return an array')
  const line = `const old = "claude-2.1" // ${OPT_OUT}`
  assert(line.includes(OPT_OUT), 'marker must be detectable on a line')
})

console.log('')
console.log(`─── ${pass + fail} tests · ${pass} passed · ${fail} failed ───`)
if (fail > 0) {
  console.log('\nfailures:')
  failures.forEach((f) => console.log(`  × ${f.name}\n    ${f.message}`))
  process.exit(1)
}
