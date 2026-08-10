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
import path from 'node:path'

const BUILDERS = [
  'onCall', 'onRequest', 'onSchedule',
  'onDocumentCreated', 'onDocumentUpdated', 'onDocumentDeleted', 'onDocumentWritten',
  // Storage triggers. `parseSyllabusUpload` is the only one today, and it was
  // the sole reason its manifest row read "no builder" — the follower reached
  // the right file and did not recognise what it found. A builder the list
  // omits is invisible in exactly the way a builder that does not exist is,
  // which is why this list is checked against the tree rather than assumed:
  //   grep -rE '=[[:space:]]*on[A-Z][A-Za-z]*[[:space:]]*\(' functions --include=*.js
  'onObjectFinalized',
]

/**
 * Read a functions-relative module, refusing anything outside `functions/`.
 *
 * ONE copy, imported by both the generator and the drift guard. It was
 * duplicated verbatim in the two, which for path-containment code is the worst
 * possible thing to duplicate: a fix to one leaves the other reading whatever a
 * require specifier names.
 *
 * Containment: a require specifier is source text, and the follower reads
 * whatever it names. `../../../.env.production` would resolve fine and hand
 * this script a credentials file to parse (github-actions security review on
 * #2197). Anything resolving outside functions/ is refused — the follower's job
 * is reading OUR modules, and a specifier that leaves the tree is a finding in
 * its own right, not a path to follow.
 *
 * @returns {{source: string, dir: string}|null} `dir` is where a RELATIVE
 *   require *inside* that module resolves from, in the same functions-relative
 *   form this reader takes. It is not cosmetic: `./storageCleanup` resolves to
 *   `storageCleanup/index.js`, so its own `./onLessonChange` means
 *   `storageCleanup/onLessonChange` — resolving that against `functions/`
 *   instead would silently read a different file, or none.
 */
export function createModuleReader(functionsDir) {
  return function readModule(specifier) {
    const base = path.resolve(functionsDir, String(specifier).replace(/^\.\//, ''))
    if (base !== functionsDir && !base.startsWith(functionsDir + path.sep)) return null
    for (const candidate of [base, `${base}.js`, path.join(base, 'index.js')]) {
      try {
        const source = readFileSync(candidate, 'utf8')
        return { source, dir: path.relative(functionsDir, path.dirname(candidate)) || '.' }
      } catch { /* next candidate */ }
    }
    return null
  }
}

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

/**
 * Top-level `key: value` pairs of an object literal, values normalised.
 *
 * A SPREAD (`...COMMON_OPTS`) is recorded under its own token as a key rather
 * than dropped. It has no `:`, so the original loop committed nothing for it
 * and an options object whose entire content arrived by spread parsed as `{}` —
 * "resolved, nothing to freeze", which is the exact false green this whole
 * follower exists to prevent. Callers that can see the surrounding module
 * expand these (`expandSpreads`); the ones that cannot at least record that a
 * spread is there, so replacing it with a different one is visible drift.
 */
export function parseOptions(objectText) {
  const inner = stripComments(objectText).slice(1, -1)
  const pairs = {}
  let depth = 0
  let key = null
  let buf = ''
  const commit = () => {
    if (key === null && buf.trim().startsWith('...')) pairs[normalise(buf)] = normalise(buf)
    else if (key !== null && buf.trim()) pairs[key.trim()] = normalise(buf)
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
    // `require("./mod").name` matches the `name(` call shape, so the original
    // test filed it as a factory — which is how apiTrackVisit's 128MiB memory
    // setting stayed outside the guard. It is a plain delegation with a
    // perfectly readable target, and is now treated as one.
    const isInlineRequire = /^require\(\s*['"][^'"]+['"]\s*\)\.[A-Za-z0-9_]+$/.test(expr)
    const isFactory = !isInlineRequire && /^[A-Za-z0-9_.]+\s*\(/.test(expr)
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
 * Follow a delegated export INTO the module that builds it, and read the
 * builder options there.
 *
 * Codex P1 on #2194: an export like `exports.apiImageProxy =
 * imageProxy.apiImageProxy` records an empty options map, so the onRequest
 * kind, region, timeout, memory and cors that actually live in
 * `imageProxy.js:46` were outside the guard entirely — 157 of 201 exports
 * were frozen in name only.
 *
 * Two-step: map `const alias = require("./mod")` in index.js, then find the
 * builder that produces the named binding in that module. Whatever cannot be
 * followed is reported as UNRESOLVED rather than as empty — a guard that
 * cannot see something must say so, not imply there is nothing to see.
 */
export function followDelegation(target, indexSource, readModule) {
  const raw = String(target).trim()

  // Shape A — `require("./mod").name`, written inline in the export. The module
  // path and the binding are both right there; nothing needs looking up.
  const inline = /^require\(\s*['"]([^'"]+)['"]\s*\)\.([A-Za-z0-9_]+)$/.exec(raw)
  if (inline) return followIntoModule(inline[1], inline[2], readModule)

  const [alias, member] = raw.split('.')
  const binding = member ?? alias

  // Shape B — `const alias = require("./mod")`, then `alias.name`.
  const requireRe = new RegExp(`(?:const|let|var)\\s+${alias}\\s*=\\s*require\\(\\s*['"]([^'"]+)['"]`)
  const hit = indexSource.match(requireRe)

  // Shape C — `const {name} = require("./mod")`, then `exports.x = name`. The
  // commonest shape in this file by a wide margin, and the one the original
  // follower did not model at all: it looked only for a whole-module alias, so
  // 54 exports reported "no require()" while their module path was sitting in a
  // destructuring pattern two lines up. Handles renames (`{orig: alias}`) by
  // following the ORIGINAL name, since that is what the module exports.
  if (!hit) {
    const destructured = findDestructuredRequire(indexSource, alias)
    if (destructured) return followIntoModule(destructured.modulePath, destructured.binding, readModule)
    return { unresolved: `no require() for "${alias}" in index.js` }
  }

  return followIntoModule(hit[1], binding, readModule)
}

/**
 * `const { a, b: c } = require("./mod")` in index.js — find which module
 * provides `wanted`, and under what name inside that module.
 *
 * Comments are stripped first: a commented-out require would otherwise resolve
 * a binding that does not exist at runtime, which is the reverse of the failure
 * this whole guard is for.
 */
function findDestructuredRequire(indexSource, wanted) {
  const src = stripComments(indexSource)
  const re = /(?:const|let|var)\s*\{([^}]*)\}\s*=\s*require\(\s*['"]([^'"]+)['"]\s*\)/g
  let m
  while ((m = re.exec(src)) !== null) {
    const [, names, modulePath] = m
    for (const part of names.split(',')) {
      const [orig, alias] = part.split(':').map((x) => x.trim())
      if (!orig) continue
      // `{orig: alias}` — index.js knows it as `alias`, the module exports
      // `orig`, and the builder is defined under `orig`.
      if ((alias || orig) === wanted) return { modulePath, binding: orig }
    }
  }
  return null
}

/**
 * Read a module and pull the builder options for one binding out of it,
 * hopping through re-export barrels on the way.
 *
 * `functions/storageCleanup/index.js` is a barrel: it destructures nine
 * Firestore triggers out of sibling files and re-exports them, defining no
 * builder itself. The follower stopped there and reported "no builder", so the
 * `africa-south1` pin on every storage-cleanup trigger — the one option
 * CLAUDE.md singles out as routing-critical, because a Firestore trigger in the
 * wrong region takes a cross-region Eventarc hop on every event — sat outside
 * the guard. A barrel is a normal way to organise a module, not an unreadable
 * one; the follower now takes the extra hop.
 *
 * `seen` is not defensive decoration: `a` re-exporting from `b` re-exporting
 * from `a` is a stack overflow, and a guard that crashes on a source pattern
 * fails the whole suite rather than reporting the one export it cannot read.
 */
function followIntoModule(modulePath, binding, readModule, seen = new Set()) {
  const key = `${modulePath}::${binding}`
  if (seen.has(key)) return { unresolved: `circular re-export of "${binding}" through ${modulePath}` }
  seen.add(key)

  const read = readModule(modulePath)
  if (read == null) return { unresolved: `cannot read module ${modulePath}` }
  const { source, dir } = read

  const defRe = new RegExp(
    `(?:(?:const|let|var)\\s+${binding}\\s*=|exports\\.${binding}\\s*=)\\s*` +
    `(${BUILDERS.join('|')})\\s*\\(`)
  const def = source.match(defRe)
  if (!def) {
    const hop = findDestructuredRequire(source, binding)
    // Relative specifiers only. A binding re-exported out of a package
    // (`firebase-functions`, a node_module) is not ours to freeze, and
    // following one would walk this reader into dependency source.
    if (hop && hop.modulePath.startsWith('.')) {
      const nested = dir === '.' ? hop.modulePath : path.posix.join(dir, hop.modulePath)
      return followIntoModule(nested, hop.binding, readModule, seen)
    }
    // Say WHICH kind of unreadable. The baseline these messages land in is a
    // work list, and "no builder" reads as "the follower is broken" when the
    // truth is that the module builds it in a shape this reader does not model
    // — a different, and differently sized, piece of work.
    const clean = stripComments(source)
    const viaFactory = new RegExp(`\\b${binding}\\s*:\\s*([A-Za-z0-9_]+)\\s*\\(`).exec(clean)
    if (viaFactory) return { unresolved: `built by the local factory ${viaFactory[1]}(…) in ${modulePath}` }
    if (new RegExp(`(?:const|let|var)\\s+${binding}\\s*=\\s*functions\\s*\\n?\\s*\\.`).test(clean)) {
      return { unresolved: `v1 chained builder (functions.region().runWith()…) in ${modulePath}` }
    }
    return { unresolved: `no builder for "${binding}" in ${modulePath}` }
  }

  const callStart = def.index + def[0].length - 1
  const args = readOptionsArgument(source, callStart, modulePath)
  if (args.unresolved) return args
  return { options: args.options, kind: def[1], from: modulePath }
}

/** The `const NAME = { … }` object literal declared in `source`, or null. */
function readConstObject(source, name) {
  const decl = source.match(new RegExp(`(?:const|let|var)\\s+${name}\\s*=\\s*\\{`))
  if (!decl) return null
  const objText = sliceBalanced(source, decl.index + decl[0].length - 1)
  return objText ? parseOptions(objText) : null
}

/** Replace every `...NAME` entry with the pairs of that const, recursively. */
function expandSpreads(pairs, source, modulePath, seen = new Set()) {
  const out = {}
  for (const [key, value] of Object.entries(pairs)) {
    if (!key.startsWith('...')) { out[key] = value; continue }
    const name = key.slice(3).trim()
    if (!/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name) || seen.has(name)) {
      // A computed or self-referential spread: keep the token so the drift
      // guard still sees it change, but do not claim to have read it.
      out[key] = value
      continue
    }
    const inner = readConstObject(source, name)
    if (!inner) { out[key] = value; continue }
    seen.add(name)
    Object.assign(out, expandSpreads(inner, source, modulePath, seen))
  }
  return out
}

/**
 * The options argument of a builder call: an object literal, an identifier
 * naming one, or a bare cron string.
 *
 * The identifier form is not exotic — eighteen exports use it, `agents/cron.js`
 * alone accounting for eleven (`onSchedule(HOURLY_MONITOR_OPTS, …)`), and
 * `storageCleanup/onLessonChange.js`'s two triggers share one `COMMON_OPTS`
 * carrying the `africa-south1` pin. Reading only object literals recorded every
 * one of them as `{}` with nothing marked unresolved, so the guard reported a
 * frozen surface of NO options for functions that bind eight secrets. An
 * identifier this cannot resolve is reported unresolved; it is never flattened
 * to empty.
 */
function readOptionsArgument(source, callStart, modulePath) {
  const afterParen = source.slice(callStart + 1)
  const trimmed = afterParen.replace(/^\s+/, '')

  if (trimmed.startsWith('{')) {
    const objStart = callStart + 1 + (afterParen.length - trimmed.length)
    const objText = sliceBalanced(source, objStart)
    if (!objText) return { unresolved: `unbalanced options object in ${modulePath}` }
    return { options: expandSpreads(parseOptions(objText), source, modulePath) }
  }

  // v1-style `onSchedule("every day 05:00", …)`: the cron IS the options.
  if (trimmed.startsWith('"') || trimmed.startsWith("'")) {
    return { options: { schedule: normalise(trimmed.slice(0, trimmed.indexOf(trimmed[0], 1) + 1)) } }
  }

  const ident = /^([A-Za-z_$][A-Za-z0-9_$]*)\s*,/.exec(trimmed)
  if (!ident) return { options: {} }
  const resolved = readConstObject(source, ident[1])
  if (!resolved) return { unresolved: `options are the identifier ${ident[1]}, not a const object literal in ${modulePath}` }
  return { options: expandSpreads(resolved, source, modulePath) }
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

/**
 * Everything about ONE export's frozen options that needs looking beyond its
 * own `exports.x = …` line: where the options are declared, what they are, and
 * the builder kind that actually runs.
 *
 * This exists because the generator and the drift guard were each doing it,
 * separately, in slightly different places — and the guard's copy ran BEFORE
 * the follow, so it classified every delegated export from an empty options
 * map. One function, called by both, is the only way "the seed the manifest was
 * written with" and "the seed the guard checks it against" cannot drift apart.
 *
 * @returns {{options: object, optionsFrom: string|null,
 *            optionsUnresolved: string|null, kind: string}}
 */
export function resolveExport(entry, indexSource, readModule) {
  if (entry.kind === 'factory') {
    return {
      options: {},
      optionsFrom: null,
      optionsUnresolved: 'factory-built: options are arguments, guarded by the factory\'s own tests',
      kind: entry.kind,
    }
  }
  if (entry.kind === 'delegated') {
    if (!entry.target) {
      return { options: {}, optionsFrom: null, optionsUnresolved: 'delegated with no target expression', kind: entry.kind }
    }
    const followed = followDelegation(entry.target, indexSource, readModule)
    if (followed.unresolved) {
      return { options: {}, optionsFrom: null, optionsUnresolved: followed.unresolved, kind: entry.kind }
    }
    // The FOLLOWED kind, not `delegated`: an export that reaches an onRequest
    // in its own module is an HTTP surface wherever the builder is written.
    return { options: followed.options, optionsFrom: followed.from, optionsUnresolved: null, kind: followed.kind }
  }
  // A BUILDER declares its options in index.js whether or not its body is
  // still inline — which is precisely the extraction shape batch 1a uses.
  // Keying this on `inline` meant an extracted handler's region became
  // unguarded the moment its body moved.
  return { options: entry.options, optionsFrom: 'index.js', optionsUnresolved: null, kind: entry.kind }
}

/** Risk order: a hand classification may move UP this list, never down. */
export const RISK_RANK = Object.freeze({ mechanical: 0, 'secrets-bound': 1, 'audit-surface': 2, 'payment-webhook': 3 })

/**
 * The rule seed for an export whose options have been RESOLVED — the floor a
 * hand classification may rise above but not fall below.
 *
 * Classifying from the raw `exports.x = mod.y` line answers two of the three
 * rules with no information: the kind reads `delegated` rather than
 * `onRequest`, and the options map is empty, so a `secrets:` binding declared
 * in the module is invisible. Every delegated export therefore seeded
 * `mechanical` unless its NAME happened to match. That is the same blind spot
 * the follower was written to close, one layer up.
 */
export function seedClassification(entry, rewritePaths, resolved) {
  return classify({ ...entry, kind: resolved.kind, options: resolved.options }, rewritePaths)
}

/** Risk classification seed — reviewed by hand in the manifest, seeded by rule. */
export function classify(entry, rewritePaths) {
  if (/lenco|payment|subscription|invoice|premium|play|billing|purchase|adminPayments/i.test(entry.name)
    || /adminPayments\./.test(entry.target ?? '')) return 'payment-webhook'
  if (entry.kind === 'onRequest' || /webhook/i.test(entry.name)
    || Object.values(rewritePaths).some((r) => (r.functionId ?? r) === entry.name)) return 'audit-surface'
  if (/secrets\s*:/.test(JSON.stringify(entry.options)) || 'secrets' in entry.options) return 'secrets-bound'
  return 'mechanical'
}
