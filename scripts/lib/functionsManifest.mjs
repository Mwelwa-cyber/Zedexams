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
 * Two entry forms have no `:` and were therefore committed as nothing at all,
 * which is the exact false green this whole follower exists to prevent —
 * "resolved, nothing to freeze":
 *
 * - A SPREAD (`...COMMON_OPTS`) is recorded under its own token as a key.
 *   Callers that can see the surrounding module expand these
 *   (`expandSpreads`); the ones that cannot at least record that a spread is
 *   there, so replacing it with a different one is visible drift.
 * - A SHORTHAND property (`{secrets, timeoutSeconds: 300}`) is recorded as
 *   `secrets: secrets`, which is what it means. `createGenerateSlideNotes`
 *   builds its secrets array in a local and passes it shorthand, so
 *   `generateVisualNotes` recorded a timeout and a memory limit and NO secrets
 *   binding — populated enough to look like a clean read.
 */
export function parseOptions(objectText) {
  const inner = stripComments(objectText).slice(1, -1)
  const pairs = {}
  let depth = 0
  let key = null
  let buf = ''
  const commit = () => {
    const text = buf.trim()
    if (key === null && text.startsWith('...')) pairs[normalise(buf)] = normalise(buf)
    else if (key === null && /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(text)) pairs[text] = text
    else if (key !== null && text) pairs[key.trim()] = normalise(buf)
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
    // MODULE-LOCAL FACTORY — `onQuizQuestionDeleted: makeDeletedTrigger("…")`
    // in this module's own `module.exports`. Unlike an index.js factory, the
    // call site is INSIDE the module, so nothing freezes its arguments: the
    // manifest's `target` records `storageCleanup.onQuizQuestionDeleted` and
    // stops there. That is why the argument is bound to the parameter below
    // rather than left as the parameter's name — otherwise the `document` path
    // deciding WHICH collection the trigger fires on would be frozen nowhere
    // at all.
    const clean = masked(source)
    const viaFactory = new RegExp(`\\b${binding}\\s*:\\s*([A-Za-z0-9_$]+)\\s*\\(`).exec(clean)
    if (viaFactory) {
      const built = readFactoryBody(source, viaFactory[1], modulePath, { readModule, dir })
      if (built.unresolved) return built
      const callStart = viaFactory.index + viaFactory[0].length - 1
      const args = sliceBalanced(clean, callStart, '(', ')')
      return {
        options: bindFactoryArguments(built.options, source, viaFactory[1], args),
        noOptions: built.noOptions,
        kind: built.kind,
        from: built.from,
      }
    }

    // v1 CHAINED BUILDER — `functions.region(…).runWith({…}).auth.user().onDelete(…)`.
    const chained = readV1Chain(source, binding, modulePath)
    if (chained) return chained

    // Say WHICH kind of unreadable. The baseline these messages land in is a
    // work list, and "no builder" reads as "the follower is broken" when the
    // truth is that the module builds it in a shape this reader does not model
    // — a different, and differently sized, piece of work.
    return { unresolved: `no builder for "${binding}" in ${modulePath}` }
  }

  const callStart = def.index + def[0].length - 1
  const args = readOptionsArgument(source, callStart, modulePath, { readModule, dir })
  if (args.unresolved) return args
  return { options: args.options, noOptions: !!args.noOptions, kind: def[1], from: modulePath }
}

/**
 * Comments blanked to spaces rather than removed, so every offset in the
 * returned string still indexes the SAME character of the original.
 *
 * `stripComments` shortens the text, which is fine for parsing a slice you
 * already located but wrong for LOCATING one: the factory reader searches for
 * a builder call and then hands the offset back to functions that read the raw
 * source. Searching stripped text and slicing raw text reads from the wrong
 * place — silently, and further off with every comment above it.
 */
const MASK_CACHE = new Map()

/** `maskComments`, memoised — the same module source is masked many times. */
function masked(source) {
  let hit = MASK_CACHE.get(source)
  if (hit === undefined) {
    hit = maskComments(source)
    MASK_CACHE.set(source, hit)
  }
  return hit
}

function maskComments(text) {
  const stripped = stripComments(text)
  if (stripped.length === text.length) return text
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
      const end = nl === -1 ? text.length : nl
      out += ' '.repeat(end - i)
      i = end - 1
      continue
    }
    if (ch === '/' && text[i + 1] === '*') {
      const close = text.indexOf('*/', i + 2)
      const end = close === -1 ? text.length : close + 2
      // Newlines are preserved so line numbers in any future error message
      // still line up; everything else becomes a space.
      out += text.slice(i, end).replace(/[^\n]/g, ' ')
      i = end - 1
      continue
    }
    out += ch
  }
  return out
}

/**
 * Follow a FACTORY-built export — `exports.generateQuiz =
 * createGenerateQuiz(anthropicApiKey)` — into the function that builds it, and
 * read the builder options declared in that function's body.
 *
 * 49 of the 54 exports the guard could not read are this one shape, and the
 * previous message for them — *"factory-built: options are arguments, guarded
 * by the factory's own tests"* — was half true and wholly misleading. The
 * ARGUMENTS are at the call site; the OPTIONS are an object literal inside the
 * factory, and no test in this repo asserts on them. `createGenerateQuiz` binds
 * `anthropicApiKey`, sets a 120s timeout and 512MiB, and every one of those was
 * outside the frozen surface.
 *
 * ## What is frozen where, and why both halves are needed
 *
 * - **The options object in the factory body** — read here. It may name the
 *   factory's own PARAMETERS (`secrets: [anthropicApiKeySecret]`), and that is
 *   recorded as written, because the parameter is what the factory declares.
 * - **The argument expression at the call site** — already frozen, verbatim, in
 *   the manifest's `target` (`createGenerateQuiz(anthropicApiKey)`).
 *
 * Together those catch all three ways this surface moves: swapping the secret
 * passed in (target drifts), changing the timeout inside the factory (options
 * drift), and rebinding which parameter feeds `secrets` (options drift). Either
 * half alone leaves one of the three invisible.
 *
 * A factory whose body contains no builder, or more than one, is reported
 * unresolved. Picking the first of several would be a guess, and a guess that
 * reads as a clean answer is the failure this whole follower is built against.
 */
export function followFactory(target, indexSource, readModule) {
  const raw = String(target).trim()

  // `require("./mod").createX(…)` — module and name are both inline.
  const inlineReq = /^require\(\s*['"]([^'"]+)['"]\s*\)\.([A-Za-z0-9_]+)\s*\(/.exec(raw)
  if (inlineReq) {
    const read = readModule(inlineReq[1])
    if (!read) return { unresolved: `cannot read module ${inlineReq[1]}` }
    return readFactoryBody(read.source, inlineReq[2], inlineReq[1], { readModule, dir: read.dir })
  }

  const call = /^([A-Za-z_$][A-Za-z0-9_$]*)\s*\(/.exec(raw)
  if (!call) return { unresolved: `not a simple factory call: ${raw}` }
  const head = call[1]

  // index.js defines some of its own factories (`makeStreamingEndpoint`,
  // `passkeyRegionalCallable`). Look here BEFORE chasing a require: a local
  // definition is the one that runs.
  if (findFunctionDeclaration(indexSource, head)) {
    return readFactoryBody(indexSource, head, 'index.js', { readModule, dir: '.' })
  }

  const destructured = findDestructuredRequire(indexSource, head)
  if (destructured) {
    const read = readModule(destructured.modulePath)
    if (!read) return { unresolved: `cannot read module ${destructured.modulePath}` }
    return readFactoryBody(read.source, destructured.binding, destructured.modulePath, { readModule, dir: read.dir })
  }
  return { unresolved: `no definition or require() for factory "${head}" in index.js` }
}

/**
 * `function NAME(…) {` / `const NAME = (…) => {` / `const NAME = function(…) {`
 * — returns the offset of the `(` opening its parameter list, or null.
 */
function findFunctionDeclaration(source, name) {
  const masked = maskComments(source)
  const patterns = [
    new RegExp(`function\\s+${name}\\s*\\(`),
    new RegExp(`(?:const|let|var)\\s+${name}\\s*=\\s*(?:async\\s+)?function\\s*\\w*\\s*\\(`),
    new RegExp(`(?:const|let|var)\\s+${name}\\s*=\\s*(?:async\\s+)?\\(`),
  ]
  for (const re of patterns) {
    const m = masked.match(re)
    if (m) return m.index + m[0].length - 1
  }
  return null
}

/**
 * Substitute a factory's PARAMETERS with the ARGUMENTS it was called with.
 *
 * Only for a module-local factory binding, and the distinction is the point.
 * An index.js factory's arguments are frozen verbatim in the manifest's
 * `target` (`createGenerateQuiz(anthropicApiKey)`), so its options keep naming
 * the parameter — that is what the factory declares, and the argument is
 * guarded next door. A module-local factory has no such record: `target` is
 * `storageCleanup.onQuizQuestionDeleted` and the call site is inside the
 * module. Leave `document: documentPath` there and the collection path a
 * Firestore trigger fires on — quizzes vs assessments — is frozen NOWHERE.
 *
 * Positional only, and a parameter with no matching argument is left as its
 * name rather than guessed at.
 */
function bindFactoryArguments(options, source, factoryName, argsText) {
  const parenAt = findFunctionDeclaration(masked(source), factoryName)
  if (parenAt == null || !argsText) return options
  const params = sliceBalanced(masked(source), parenAt, '(', ')')
  if (!params) return options
  const names = params.slice(1, -1).split(',').map((p) => p.trim().split('=')[0].trim()).filter(Boolean)
  const args = splitTopLevel(argsText.slice(1, -1))
  const bound = {}
  for (const [key, value] of Object.entries(options)) {
    const at = names.indexOf(value)
    bound[key] = at !== -1 && args[at] !== undefined ? normalise(args[at]) : value
  }
  return bound
}

/** Split an argument list on top-level commas. */
function splitTopLevel(text) {
  const out = []
  let depth = 0
  let inString = null
  let buf = ''
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i]
    if (inString) {
      buf += ch
      if (ch === '\\') { buf += text[i + 1] ?? ''; i += 1; continue }
      if (ch === inString) inString = null
      continue
    }
    if (ch === '"' || ch === "'" || ch === '`') { inString = ch; buf += ch; continue }
    if ('([{'.includes(ch)) depth += 1
    else if (')]}'.includes(ch)) depth -= 1
    if (depth === 0 && ch === ',') { out.push(buf.trim()); buf = ''; continue }
    buf += ch
  }
  if (buf.trim()) out.push(buf.trim())
  return out
}

/**
 * A v1 chained builder — `functions.region("us-central1")
 * .runWith({timeoutSeconds: 300, memory: "256MB"}).auth.user().onDelete(…)`.
 *
 * `onUserDeleted` is the last of these in the tree and the only export the
 * follower could not read at all. Its frozen surface is spread across the
 * chain rather than gathered in one options object: the region is an argument
 * to `.region()`, the runtime options are the `.runWith({…})` literal, and the
 * EVENT — `auth.user().onDelete` — is the whole meaning of the trigger. All
 * three are recorded, the event under the same `event` key `extractExports`
 * already uses for index.js's v1 auth triggers, so the two spellings of the
 * same thing compare alike.
 *
 * Returns null when `binding` is not a v1 chain, so callers fall through to
 * their own reporting.
 */
function readV1Chain(source, binding, modulePath) {
  const text = masked(source)
  const decl = text.match(new RegExp(`(?:const|let|var)\\s+${binding}\\s*=\\s*functions\\s*\\.`))
  if (!decl) return null

  // From the declaration itself, not from a computed offset into it: the
  // matched text is `functions\n  .`, so subtracting the length of the string
  // "functions." landed three characters late and cut the word in half.
  const chain = text.slice(decl.index, decl.index + 4000)

  const options = {}
  const region = /\.region\(\s*([^)]*?)\s*\)/.exec(chain)
  if (region) options.region = normalise(region[1])
  const runWith = /\.runWith\s*\(/.exec(chain)
  if (runWith) {
    const objAt = chain.indexOf('{', runWith.index)
    const objText = objAt === -1 ? null : sliceBalanced(chain, objAt)
    if (objText) Object.assign(options, parseOptions(objText))
  }
  // onCreate vs onDelete is the whole meaning of a v1 auth trigger; collapsing
  // them let setUserRole silently become a deletion hook (Codex P1 on #2194).
  //
  // Matched from the NAMESPACE rather than from `functions.`, because the
  // chain reaches the event through `.region("us-central1")` and a
  // `.runWith({…})` object — quotes, hyphens and braces that a path-shaped
  // pattern anchored at `functions.` cannot cross. The result is canonicalised
  // to the spelling `extractExports` produces for index.js's v1 triggers
  // (`functions.auth.user().onDelete`), so the same trigger written either way
  // compares alike.
  // `\s*` between every segment: the chain is written one call per line, so a
  // pattern that allows no whitespace matches nothing on the only file it has
  // to read.
  const event = /\.(auth|firestore|database|pubsub|storage|https|analytics|remoteConfig|testLab)\s*((?:\.\s*[A-Za-z]+\s*(?:\([^)]*\))?\s*)*?)\.\s*on([A-Za-z]+)\s*\(/.exec(chain)
  if (!event) return { unresolved: `v1 chain for "${binding}" in ${modulePath} names no event` }
  options.event = normalise(`functions.${event[1]}${event[2]}.on${event[3]}`).replace(/\s+/g, '')
  return { options, kind: 'authTrigger', from: modulePath }
}

/** The single builder call inside a factory's body, with its options. */
function readFactoryBody(source, name, from, ctx) {
  const parenAt = findFunctionDeclaration(source, name)
  if (parenAt == null) return { unresolved: `no factory function "${name}" in ${from}` }

  const masked = maskComments(source)
  const params = sliceBalanced(masked, parenAt, '(', ')')
  if (!params) return { unresolved: `unbalanced parameter list for "${name}" in ${from}` }
  const bodyStart = masked.indexOf('{', parenAt + params.length)
  if (bodyStart === -1) return { unresolved: `no body for factory "${name}" in ${from}` }
  const body = sliceBalanced(masked, bodyStart)
  if (!body) return { unresolved: `unbalanced body for factory "${name}" in ${from}` }

  const builderRe = new RegExp(`\\b(${BUILDERS.join('|')})\\s*\\(`, 'g')
  const hits = [...body.matchAll(builderRe)]
  if (hits.length === 0) return { unresolved: `factory "${name}" in ${from} builds no recognised function` }
  if (hits.length > 1) {
    const kinds = hits.map((h) => h[1]).join(', ')
    return { unresolved: `factory "${name}" in ${from} contains ${hits.length} builder calls (${kinds}) — which one is the export is a guess` }
  }

  // Absolute offset in the ORIGINAL source, so the const/spread lookups below
  // still see the whole module rather than the sliced body.
  const callStart = bodyStart + hits[0].index + hits[0][0].length - 1
  const args = readOptionsArgument(source, callStart, from, ctx)
  if (args.unresolved) return args
  return {
    options: args.options,
    noOptions: !!args.noOptions,
    kind: hits[0][1],
    from: `${from} (factory ${name})`,
  }
}

/**
 * The `const NAME = { … }` object literal declared in `source`, or null.
 *
 * `Object.freeze({ … })` counts — `passkeys/passkeyRegions.js` declares its
 * shared runtime options that way, and a wrapper that changes nothing about
 * the literal should not decide whether the guard can read it.
 *
 * With a `ctx`, a name this source does not declare is chased into the module
 * it is imported from. That is not a nicety: `PASSKEY_CALLABLE_RUNTIME` is
 * spread into the four regional passkey callables from another file, and
 * without the hop their timeout and memory would be recorded as the literal
 * token `...PASSKEY_CALLABLE_RUNTIME` — visible if SWAPPED for a different
 * const, invisible if its contents change.
 */
function readConstObject(source, name, ctx) {
  const text = masked(source)
  const decl = text.match(new RegExp(`(?:const|let|var)\\s+${name}\\s*=\\s*(?:Object\\.freeze\\(\\s*)?\\{`))
  if (decl) {
    const objText = sliceBalanced(text, decl.index + decl[0].length - 1)
    return objText ? parseOptions(objText) : null
  }
  if (!ctx?.readModule) return null
  const imported = findDestructuredRequire(text, name)
  if (!imported || !imported.modulePath.startsWith('.')) return null
  const spec = ctx.dir && ctx.dir !== '.' ? path.posix.join(ctx.dir, imported.modulePath) : imported.modulePath
  const read = ctx.readModule(spec)
  if (!read) return null
  // No ctx on the recursive call: one import hop is enough for every shape in
  // this tree, and an unbounded chase needs cycle tracking to be safe.
  return readConstObject(read.source, imported.binding)
}

/** Replace every `...NAME` entry with the pairs of that const, recursively. */
function expandSpreads(pairs, source, modulePath, ctx, seen = new Set()) {
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
    const inner = readConstObject(source, name, ctx)
    if (!inner) { out[key] = value; continue }
    seen.add(name)
    Object.assign(out, expandSpreads(inner, source, modulePath, ctx, seen))
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
 *
 * It reads the COMMENT-MASKED source, not the raw text. `createGenerateSlideNotes`
 * writes its rationale between `onCall(` and the options object, so trimming
 * whitespace alone left this looking at `//` — not `{`, not a quote, not an
 * identifier — and it returned `{}`: a third false green, of the same family as
 * the two above, found by the test written for them.
 */
function readOptionsArgument(source, callStart, modulePath, ctx) {
  const text = masked(source)
  const afterParen = text.slice(callStart + 1)
  const trimmed = afterParen.replace(/^\s+/, '')

  if (trimmed.startsWith('{')) {
    const objStart = callStart + 1 + (afterParen.length - trimmed.length)
    const objText = sliceBalanced(text, objStart)
    if (!objText) return { unresolved: `unbalanced options object in ${modulePath}` }
    return { options: expandSpreads(parseOptions(objText), text, modulePath, ctx) }
  }

  // v1-style `onSchedule("every day 05:00", …)`: the cron IS the options.
  if (trimmed.startsWith('"') || trimmed.startsWith("'")) {
    return { options: { schedule: normalise(trimmed.slice(0, trimmed.indexOf(trimmed[0], 1) + 1)) } }
  }

  // No options ARGUMENT at all — `onCall(async (request) => {…})`. That is a
  // real answer, not a failed read, and the difference matters: an empty
  // options map otherwise reads identically to "we followed and recorded
  // nothing", which is the false green the guard is built against. Say which.
  const ident = /^([A-Za-z_$][A-Za-z0-9_$]*)\s*,/.exec(trimmed)
  if (!ident) return { options: {}, noOptions: true }
  const resolved = readConstObject(text, ident[1], ctx)
  if (!resolved) return { unresolved: `options are the identifier ${ident[1]}, not a const object literal in ${modulePath}` }
  return { options: expandSpreads(resolved, text, modulePath, ctx) }
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
    // The old blanket message here — "factory-built: options are arguments,
    // guarded by the factory's own tests" — was half true and wholly
    // misleading. The arguments are at the call site (frozen in `target`); the
    // OPTIONS are an object literal inside the factory, and no test asserts on
    // them. See followFactory.
    const built = followFactory(entry.target, indexSource, readModule)
    if (built.unresolved) {
      return { options: {}, optionsFrom: null, optionsUnresolved: built.unresolved, kind: entry.kind }
    }
    return {
      options: built.options,
      optionsFrom: built.from,
      optionsUnresolved: null,
      noOptionsDeclared: !!built.noOptions,
      kind: built.kind,
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
    return {
      options: followed.options,
      optionsFrom: followed.from,
      optionsUnresolved: null,
      noOptionsDeclared: !!followed.noOptions,
      kind: followed.kind,
    }
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
