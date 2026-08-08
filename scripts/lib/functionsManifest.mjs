/**
 * Phase 5's frozen-surface extractor — the one reader of `functions/index.js`'s
 * export table (docs/phase5-plan.md).
 *
 * For every `exports.<name> = …` it records what the architecture doc freezes
 * (§ Phase 5): the export name, the builder kind, the region, the secrets
 * bindings, and the runtime options — plus whether the handler body is INLINE
 * (extraction work) or already DELEGATED to a module (no extraction; its
 * options live where it is defined, guarded by that module's own tests).
 *
 * ## What "semantic, not formatting" means here
 *
 * Option values are compared as whitespace-normalised token text, keyed by
 * option name — so reindenting an options object, reordering its keys, or
 * rewrapping a line changes nothing, while `region: "us-central1"` becoming
 * `"africa-south1"`, a secret leaving the array, or `timeoutSeconds: 60`
 * becoming 300 is a drift. This is deliberately NOT a JS evaluator: secrets
 * are recorded as the identifiers the source names (`openaiApiKey`), which is
 * exactly the granularity a reviewer freezes.
 *
 * Plain node, no dependencies — it must run in the test suite on every PR.
 */
import { readFileSync } from 'node:fs'

const BUILDERS = [
  'onCall', 'onRequest', 'onSchedule',
  'onDocumentCreated', 'onDocumentUpdated', 'onDocumentDeleted', 'onDocumentWritten',
]

const normalise = (text) => text.replace(/\s+/g, ' ').trim()

/**
 * Strip `//` and `/* *\/` comments, string-aware — a `//` inside a string
 * literal (a CORS origin, a URL) is content, not a comment. Without this, a
 * comment INSIDE an options object glues itself onto the next key (or eats
 * it: structureScannedQuiz's timeoutSeconds vanished behind its own
 * explanatory comment), which both mis-classifies the entry and turns
 * comment rewording into false drift.
 */
export function stripComments(text) {
  let out = ''
  let inString = null
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i]
    if (inString) {
      out += ch
      if (ch === '\\') { out += text[i + 1] ?? ''; i += 1; continue }
      if (ch === inString) inString = null
      continue
    }
    if (ch === '"' || ch === "'" || ch === '`') { inString = ch; out += ch; continue }
    if (ch === '/' && text[i + 1] === '/') {
      const nl = text.indexOf('\n', i)
      i = nl === -1 ? text.length : nl - 1
      continue
    }
    if (ch === '/' && text[i + 1] === '*') {
      const end = text.indexOf('*/', i + 2)
      i = end === -1 ? text.length : end + 1
      continue
    }
    out += ch
  }
  return out
}

/** The `{…}` literal starting at `start` (which must be `{`), brace-aware. */
function sliceBalanced(source, start, open = '{', close = '}') {
  let depth = 0
  for (let i = start; i < source.length; i += 1) {
    const ch = source[i]
    if (ch === open) depth += 1
    else if (ch === close) {
      depth -= 1
      if (depth === 0) return source.slice(start, i + 1)
    }
  }
  return null
}

/** Top-level `key: value` pairs of an object literal, values normalised. */
export function parseOptions(objectText) {
  const inner = stripComments(objectText).slice(1, -1)
  const pairs = {}
  let depth = 0
  let key = null
  let buf = ''
  const commit = () => {
    if (key !== null && buf.trim()) pairs[key.trim()] = normalise(buf)
    key = null
    buf = ''
  }
  for (let i = 0; i < inner.length; i += 1) {
    const ch = inner[i]
    if ('{[('.includes(ch)) depth += 1
    if ('}])'.includes(ch)) depth -= 1
    if (depth === 0 && ch === ':' && key === null) { key = buf; buf = ''; continue }
    if (depth === 0 && ch === ',') { commit(); continue }
    buf += ch
  }
  commit()
  return pairs
}

/**
 * Every export in the file, with its frozen surface.
 *
 * @returns {Array<{name: string, kind: string, options: object, inline: boolean,
 *                  target: string|null}>}
 */
export function extractExports(indexSource) {
  const out = []
  const re = /^exports\.([A-Za-z0-9_]+)\s*=\s*/gm
  let m
  while ((m = re.exec(indexSource)) !== null) {
    const name = m[1]
    const rest = indexSource.slice(m.index + m[0].length)

    const builder = BUILDERS.find((b) =>
      new RegExp(`^(?:functions\\.[A-Za-z.]+\\.)?${b}\\s*\\(`).test(rest))
    const v1Auth = /^functions\.auth\./.test(rest)

    if (builder) {
      const parenAt = rest.indexOf('(')
      const afterParen = rest.slice(parenAt + 1)
      const trimmed = afterParen.replace(/^\s+/, '')
      let options = {}
      if (trimmed.startsWith('{')) {
        const objStart = parenAt + 1 + (afterParen.length - trimmed.length)
        const objText = sliceBalanced(rest, objStart)
        if (objText) options = parseOptions(objText)
      } else if (trimmed.startsWith('"') || trimmed.startsWith("'")) {
        // v1-style onSchedule("cron", …)
        options = { schedule: normalise(trimmed.slice(0, trimmed.indexOf(trimmed[0], 1) + 1)) }
      }
      // Inline when a function body is defined in this call — a paren-level
      // arrow or `function`/`async` keyword rather than a bare identifier.
      const callText = sliceBalanced(rest, parenAt, '(', ')') ?? ''
      const afterOptions = callText.replace(/^\([^{]*\{[\s\S]*?\}\s*,/, '(')
      const inline = /(=>|\bfunction\b|\basync\b)/.test(afterOptions)
      out.push({ name, kind: builder, options, inline, target: null })
      continue
    }

    if (v1Auth) {
      // onCreate vs onDelete is the whole meaning of a v1 auth trigger —
      // collapsing them let setUserRole silently become a deletion hook
      // (Codex P1 on #2194). The full builder chain is the frozen kind.
      const chain = normalise((rest.match(/^functions\.auth\.[A-Za-z().]*\.on[A-Za-z]+/) ?? ['functions.auth'])[0])
      out.push({ name, kind: 'authTrigger', options: { event: chain }, inline: true, target: null })
      continue
    }

    // Everything else: a delegation — a bare identifier / member expression /
    // require(...) re-export, or a factory call that builds the function in a
    // module. Its frozen surface is the TARGET expression: rebinding the
    // export to something else is a drift.
    const stmtEnd = rest.search(/;\s*$/m)
    const expr = normalise(rest.slice(0, stmtEnd === -1 ? 200 : stmtEnd))
    const isFactory = /^[A-Za-z0-9_.]+\s*\(/.test(expr)
    out.push({
      name,
      kind: isFactory ? 'factory' : 'delegated',
      options: {},
      inline: false,
      // The head of the expression is the stable identity; factory ARGUMENTS
      // (config objects, secret lists) are part of the surface too, so the
      // whole normalised expression is kept for factories.
      target: isFactory ? expr : expr.replace(/\s*;.*$/, ''),
    })
  }
  return out
}

/**
 * The `firebase.json` rewrites that point at functions, as path → name.
 * `function` comes in two spellings — a bare name, or the v2 object form
 * `{ functionId, region, … }` — and both are live in this file; reading only
 * the string form silently dropped /consent and /api/image-proxy.
 */
export function extractRewrites(firebaseJsonSource) {
  const rewrites = JSON.parse(firebaseJsonSource).hosting?.rewrites ?? []
  const map = {}
  for (const r of rewrites) {
    // The rewrite's REGION is routing-critical: /api/ai/chat moving to
    // africa-south1 routes Hosting to a different regional function, so it is
    // part of the frozen surface, not an implementation detail (Codex P1 on
    // #2194).
    if (typeof r.function === 'string') map[r.source] = { functionId: r.function, region: null }
    else if (r.function?.functionId) map[r.source] = { functionId: r.function.functionId, region: r.function.region ?? null }
  }
  return map
}

/** Risk order: a hand classification may move UP this list, never down. */
export const RISK_RANK = Object.freeze({ mechanical: 0, 'secrets-bound': 1, 'audit-surface': 2, 'payment-webhook': 3 })

/** Risk classification seed — reviewed by hand in the manifest, seeded by rule. */
export function classify(entry, rewritePaths) {
  if (/lenco|payment|subscription|invoice|premium|play|billing|purchase|adminPayments/i.test(entry.name)
    || /adminPayments\./.test(entry.target ?? '')) return 'payment-webhook'
  if (entry.kind === 'onRequest' || /webhook/i.test(entry.name)
    || Object.values(rewritePaths).some((r) => (r.functionId ?? r) === entry.name)) return 'audit-surface'
  if (/secrets\s*:/.test(JSON.stringify(entry.options)) || 'secrets' in entry.options) return 'secrets-bound'
  return 'mechanical'
}
