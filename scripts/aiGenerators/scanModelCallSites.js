/**
 * Every place in `functions/` that talks to a model provider directly.
 *
 * ## Why this is a scanner and not a list
 *
 * Phase 6's goal is "no direct model call remaining outside the operation
 * layer". A hand-kept list of call sites cannot show that: it records what
 * someone remembered to write down, and a generator added next month is absent
 * from it in exactly the same way a generator that was correctly migrated is.
 * The two states have to be distinguishable, so the set is DERIVED from the
 * source and the inventory is checked against it.
 *
 * That inverts the usual failure. Adding a new direct model call does not
 * quietly widen the un-migrated surface — it fails `test:ai-generator-inventory`
 * until someone records what the new call site is and which posture it has.
 *
 * ## What counts as a direct model call
 *
 * A call to one of the provider primitives in PROVIDER_CALLS. The client
 * modules that WRAP those providers are excluded (PROVIDER_MODULES) — they are
 * the layer every call is supposed to go through, so counting them would report
 * the destination as a bypass.
 *
 * This is deliberately textual rather than an AST parse. The names are
 * unambiguous in this repo, and the failure mode of a regex here is a FALSE
 * POSITIVE (a commented-out call reported as real), which surfaces as a test
 * failure someone reads — not a false negative that hides a bypass.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

/**
 * The provider primitives. A file calling any of these reaches a model.
 *
 * `callClaude` earns its place the hard way: the teacher-tool generators do not
 * call `callAnthropic`, they call `teacherTools/anthropicClient.js`'s
 * `callClaude`. A first version of this scanner omitted it and reported 18 call
 * sites with every generator absent — the file that motivated Phase 6 did not
 * appear in the scan of Phase 6's own subject. Adding a provider wrapper without
 * adding it here makes the surface it serves invisible.
 */
export const PROVIDER_CALLS = Object.freeze([
  'callAnthropic',
  'callAnthropicStream',
  'callClaude',
  'callClaudeStream',
  'callOpenAI',
  'callOpenAIStream',
  'callGemini',
  'anthropicFetch',
  // Image generation is a model call too. These were missed by the first pass
  // for a subtler reason than callClaude: `callOpenAIImage` does not match a
  // `callOpenAI(` pattern, so the image generators — which produce the figures
  // printed on a paper — read as making no model call at all.
  'callOpenAIImage',
  'callGeminiImage',
  'generateGeminiImage',
  'createEmbedding',
])

/**
 * The modules that IMPLEMENT the provider calls. They are the intended
 * destination, not a bypass, so a hit inside them means nothing.
 */
export const PROVIDER_MODULES = Object.freeze([
  'aiService.js',
  'anthropicFetch.js',
  'openaiClient.js',
  'geminiClient.js',
  'geminiImageClient.js',
  'openaiEmbeddings.js',
  'teacherTools/anthropicClient.js',
  'aiCostTracking.js', // prices the calls; names them in rate tables
])

const SKIP_DIRS = new Set(['node_modules', '.git', 'lib', 'coverage'])

/** Markers of the operation layer and its neighbouring guarantees. */
const MARKERS = Object.freeze({
  reserve: 'reserveAiOperation',
  complete: 'completeAiOperation',
  fail: 'failAiOperation',
  idempotencyOptional: 'isValidIdempotencyKey',
  usageMeter: 'assertAndIncrement',
  usageRefund: 'refundGeneration',
  curriculum: 'resolveCbcContext',
  inputValidation: 'function validateInputs',
})

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) walk(full, out)
    else if (entry.endsWith('.js') && !entry.endsWith('.test.js')) out.push(full)
  }
  return out
}

/**
 * Strip line and block comments before looking for a call.
 *
 * Without this a commented-out `callAnthropic` reads as a live bypass, and the
 * person who tidied it up gets a test failure they cannot act on.
 */
function stripComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '')
}

/**
 * Which idempotency posture a call site has.
 *
 * The three are genuinely different guarantees and the difference is invisible
 * from the outside, which is why it is named rather than reduced to a boolean:
 *
 *   'enforced'  reserveAiOperation is called unconditionally, so a request with
 *               no idempotency key is REFUSED. Duplicate protection cannot be
 *               opted out of.
 *   'optional'  the reservation sits behind an isValidIdempotencyKey guard, so
 *               a request without a key runs the old unprotected path and
 *               nothing records that it did.
 *   'none'      no reservation at all.
 */
export function idempotencyPosture(text) {
  if (!text.includes(MARKERS.reserve)) return 'none'
  return text.includes(MARKERS.idempotencyOptional) ? 'optional' : 'enforced'
}

/** Scan one file. Returns null when it makes no direct model call. */
export function scanFile(absPath, root) {
  const rel = relative(root, absPath).split('\\').join('/')
  if (PROVIDER_MODULES.some((m) => rel === `functions/${m}`)) return null

  const text = stripComments(readFileSync(absPath, 'utf8'))
  const calls = PROVIDER_CALLS.filter((c) => new RegExp(`\\b${c}\\s*\\(`).test(text))
  if (calls.length === 0) return null

  return {
    file: rel,
    calls,
    idempotency: idempotencyPosture(text),
    meteredUsage: text.includes(MARKERS.usageMeter),
    refundsUsage: text.includes(MARKERS.usageRefund),
    curriculumGrounded: text.includes(MARKERS.curriculum),
    validatesInput: text.includes(MARKERS.inputValidation),
    settlesOperation: text.includes(MARKERS.complete) && text.includes(MARKERS.fail),
  }
}

/** Every direct model call site under `functions/`, sorted by path. */
export function scanModelCallSites(root) {
  return walk(join(root, 'functions'))
    .map((f) => scanFile(f, root))
    .filter(Boolean)
    .sort((a, b) => a.file.localeCompare(b.file))
}
