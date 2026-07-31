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
  // Embeddings reach a provider and cost money. This entry is the one the
  // registry guard found: the list previously said `createEmbedding`, a name
  // that appears nowhere in the repo, while the real export — used by Qix's
  // semantic dedup in agents/questionReview.js — went unregistered. A phantom
  // entry and a genuine miss, and neither was visible by reading the list.
  'embedText',
])

/**
 * Exports of the provider modules that do NOT reach a model.
 *
 * Every export of every provider module must appear either here or in
 * PROVIDER_CALLS. That is what makes the registry self-guarding: adding a new
 * wrapper fails `test:ai-generator-inventory` until someone says which of the
 * two it is, rather than silently widening the un-scanned surface.
 *
 * Keep the reason attached. "Why is this not a model call" is the question a
 * reviewer actually has, and a bare name cannot answer it.
 */
export const NOT_A_MODEL_CALL = Object.freeze({
  // aiService.js — prompt assembly, parsing and role helpers
  LIMITS: 'daily-limit constants',
  assertDailyLimit: 'quota check; no provider call',
  buildAnthropicChat: 'message assembly',
  buildChatMessages: 'message assembly',
  buildEditQuestionMessages: 'message assembly',
  buildExplainMessages: 'message assembly',
  buildImportStructureMessages: 'message assembly',
  buildQuizMessages: 'message assembly',
  cleanContext: 'input sanitisation',
  cleanChatHistory: 'input sanitisation',
  cleanString: 'input sanitisation',
  getAnthropicApiKey: 'secret access',
  getApiKey: 'secret access',
  getUserRole: 'role lookup',
  isAdminRole: 'role predicate',
  isEditQuestionAction: 'action predicate',
  isStaffRole: 'role predicate',
  parseEditedQuestion: 'response parsing',
  parseStructuredImport: 'response parsing',
  parseGeneratedQuiz: 'response parsing',
  stripJsonFences: 'response parsing',
  toAnthropicShape: 'response shaping',
  // openaiClient.js / geminiImageClient.js / geminiClient.js — config
  ALLOWED_OPENAI_SIZES: 'config constant',
  DEFAULT_OPENAI_IMAGE_MODEL: 'config constant',
  DEFAULT_IMAGE_MODEL: 'config constant',
  DEFAULT_MODEL: 'config constant',
  EMBED_MODEL: 'config constant',
  // teacherTools/anthropicClient.js — retry machinery around callClaude
  FALLBACK_MODEL: 'config constant',
  buildModelLadder: 'chooses which model callClaude retries with',
  attemptWithFallback: 'retry wrapper; reaches a provider only via callClaude',
  isDeliverableRetry: 'retry predicate',
  // anthropicFetch.js
  isRateLimitError: 'error predicate',
})

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
])

/**
 * Files that are not scanned as CALL SITES.
 *
 * The provider modules, plus `aiCostTracking.js`, which names the provider
 * functions in its rate tables without calling any of them — it would otherwise
 * report as a bypass, and the fix for that is to not scan it rather than to
 * pretend it is a wrapper.
 *
 * Kept separate from PROVIDER_MODULES on purpose: that list defines the
 * REGISTRY (every export must be classified as a model call or not), and
 * aiCostTracking has thirty exports that have nothing to do with reaching a
 * provider. Conflating the two made the registry guard demand a classification
 * for `monthKeyUtc`.
 */
export const NOT_SCANNED = Object.freeze([
  ...PROVIDER_MODULES,
  'aiCostTracking.js',
])

const SKIP_DIRS = new Set(['node_modules', '.git', 'lib', 'coverage'])

/** Markers of the operation layer and its neighbouring guarantees. */
const MARKERS = Object.freeze({
  canonicalEntry: 'requireAndReserveAiOperation',
  reserve: 'reserveAiOperation',
  complete: 'completeAiOperation',
  fail: 'failAiOperation',
  idempotencyOptional: 'isValidIdempotencyKey',
  usageMeter: 'assertAndIncrement',
  usageRefund: 'refundGeneration',
  curriculum: 'resolveCbcContext',
  // A call to any `validate<Name>Inputs(...)` — the document generators call the
  // local `validateInputs(inputs)`, regenerateAssessmentQuestion calls the shared
  // `validateRegenerateInputs(inputs)`. Matching the call (not `function
  // validateInputs`) proves the check runs on this path and covers validators
  // that live in a shared core.
  inputValidation: /\bvalidate\w*Inputs\s*\(/,
  // The shared fail-closed source-curriculum gate a transformation must route
  // through (functions/teacherTools/sourceCurriculum.js).
  sourceCurriculum: 'checkSourceCurriculum',
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
  // `enforced` now means one specific thing: entry through the canonical
  // `requireAndReserveAiOperation`, which refuses a missing or malformed key
  // before usage charging, provider access or result creation.
  //
  // Keying on that single call is what lets a marker-based scan mean what it
  // claims. The old rule — "reserves and has no isValidIdempotencyKey guard" —
  // inferred a sequence it could not see, so a generator that reserved AFTER
  // its provider call would have read as enforced.
  if (text.includes(MARKERS.canonicalEntry)) return 'enforced'
  if (!text.includes(MARKERS.reserve)) return 'none'
  // Reserves, but by hand. Whether the guard is present or not, this is a
  // generator that wrote its own entry sequence and can drift from the others.
  return 'optional'
}

/** Scan one file. Returns null when it makes no direct model call. */
export function scanFile(absPath, root) {
  const rel = relative(root, absPath).split('\\').join('/')
  if (NOT_SCANNED.some((m) => rel === `functions/${m}`)) return null

  const text = stripComments(readFileSync(absPath, 'utf8'))
  const calls = PROVIDER_CALLS.filter((c) => new RegExp(`\\b${c}\\s*\\(`).test(text))
  if (calls.length === 0) return null

  return {
    file: rel,
    calls,
    idempotency: idempotencyPosture(text),
    // Result identity. `keyedResultDoc` alone is not enough: the partial
    // generators have BOTH, chosen by a ternary, so the auto-id branch is the
    // one that runs for a keyless request. A generator is only deterministic
    // when the auto-id branch does not exist.
    keyedResultDoc: /\.doc\(\s*idempotencyKey\s*\)/.test(text),
    autoIdResultDoc: /collection\(\s*["']aiGenerations["']\s*\)\s*\.\s*doc\(\s*\)/.test(text),
    meteredUsage: text.includes(MARKERS.usageMeter),
    refundsUsage: text.includes(MARKERS.usageRefund),
    curriculumGrounded: text.includes(MARKERS.curriculum),
    // A TRANSFORMATION op (revise/suggest/explain) does not originate curriculum
    // content, so it cannot resolveCbcContext against a fresh topic. Instead it
    // must PRESERVE the source item's curriculum via the shared fail-closed gate
    // — checkSourceCurriculum — which refuses a request that cannot name its own
    // curriculum. This marker proves the generator routes through that gate.
    preservesSourceCurriculum: text.includes(MARKERS.sourceCurriculum),
    // Input validation, recognised by the CALL rather than a local declaration:
    // the document generators define `function validateInputs`, but a generator
    // whose validation lives in a shared core (regenerateAssessmentQuestion →
    // `validateRegenerateInputs`) is validating just as strictly. `validate…Inputs(`
    // matches both — and it is the call, not the definition, that proves the
    // check actually runs on this path.
    validatesInput: MARKERS.inputValidation.test(text),
    settlesOperation: text.includes(MARKERS.complete) && text.includes(MARKERS.fail),
  }
}

/**
 * The identifiers each provider module exports.
 *
 * Read from `module.exports = { … }` rather than by importing, because these
 * are CommonJS modules that pull in firebase-functions at load time — the whole
 * point of the `*Core.js` split in this repo is that plain-node tests do not
 * have to boot that.
 *
 * Returns a map of module path → exported names. Shorthand (`callClaude`) and
 * renamed (`EMBED_MODEL: DEFAULT_MODEL`) both yield the EXPORTED name, which is
 * the one a caller writes.
 */
export function readProviderExports(root) {
  const out = new Map()
  for (const mod of PROVIDER_MODULES) {
    const path = join(root, 'functions', mod)
    const text = stripComments(readFileSync(path, 'utf8'))
    const start = text.indexOf('module.exports')
    if (start === -1) { out.set(mod, []); continue }
    const open = text.indexOf('{', start)
    if (open === -1) { out.set(mod, []); continue }
    // Balanced scan, so a nested object in an export does not truncate the list.
    let depth = 0
    let end = open
    for (let i = open; i < text.length; i += 1) {
      if (text[i] === '{') depth += 1
      else if (text[i] === '}') { depth -= 1; if (depth === 0) { end = i; break } }
    }
    const names = text.slice(open + 1, end)
      .split(',')
      .map((part) => part.split(':')[0].trim())
      .filter((n) => /^[A-Za-z_]\w*$/.test(n))
    out.set(mod, names)
  }
  return out
}

/** Every direct model call site under `functions/`, sorted by path. */
export function scanModelCallSites(root) {
  return walk(join(root, 'functions'))
    .map((f) => scanFile(f, root))
    .filter(Boolean)
    .sort((a, b) => a.file.localeCompare(b.file))
}
