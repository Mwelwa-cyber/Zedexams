/**
 * Every `alias.member(...)` call in `functions/index.js` names a real export.
 *
 * ## The failure this exists to catch
 *
 * `deletionExecutionSweep`'s inline body called
 * `deletionFlow.runScheduledDeletionExecution()`. `functions/deletionFlow/`
 * exports `runDeletionExecutionSweep`; the older name had been renamed during
 * the restructure and the one call site was missed. Nothing caught it:
 *
 *   - The frozen-surface manifest reads the export TABLE — the builder, region,
 *     secrets and options. `deletionExecutionSweep` is an INLINE handler, so its
 *     body was never followed and the dead name sat inside it.
 *   - `deletionSweeps.test.js` exercises `runDeletionExecutionSweep` directly,
 *     so the sweep itself was green the whole time.
 *   - No test calls a scheduled entry point, and a cron failure is a 500 in a
 *     log nobody reads.
 *
 * The result: `deletionExecutionSweep` threw `TypeError: ... is not a function`
 * on every run from the day of the rename. Deletion REQUESTS were still being
 * recorded (that sweep's call site was correct), so the 30-day executions
 * silently stopped while the intake kept working — the worst shape this bug
 * could have taken.
 *
 * ## What is checked
 *
 * For each `const alias = require("./relative")` binding in index.js, every
 * `alias.member(` in the file must resolve to something the module exports.
 * Only relative specifiers are followed — `admin.firestore()` and friends are
 * not ours to police.
 *
 * Plain text analysis, plain node, no dependencies: `functions/node_modules`
 * does not exist when the suite runs, so nothing here may `require` a
 * functions module.
 */
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { readFileSync } from 'node:fs'
import { createModuleReader, stripComments } from './lib/functionsManifest.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const FUNCTIONS_DIR = path.join(ROOT, 'functions')
const readModule = createModuleReader(FUNCTIONS_DIR)

const indexSource = stripComments(readFileSync(path.join(FUNCTIONS_DIR, 'index.js'), 'utf8'))

// ── alias → relative module specifier ───────────────────────────────────────
const aliases = new Map()
const bindingRe = /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*require\(\s*['"](\.[^'"]+)['"]\s*\)\s*;?/g
for (const m of indexSource.matchAll(bindingRe)) aliases.set(m[1], m[2])

/**
 * The export names a module offers, or null when the shape is not statically
 * readable (a spread, a computed key, `module.exports = someExpression`).
 * Null means "cannot tell" and is never reported as a failure — a guard that
 * cries wolf on an unreadable module gets switched off.
 */
function exportNames(source) {
  const src = stripComments(source)
  const names = new Set()
  for (const m of src.matchAll(/(?:^|\n)\s*(?:module\.)?exports\.([A-Za-z_$][\w$]*)\s*=/g)) names.add(m[1])

  const start = src.search(/module\.exports\s*=\s*\{/)
  if (start >= 0) {
    const open = src.indexOf('{', start)
    let depth = 0, end = -1
    for (let i = open; i < src.length; i++) {
      if (src[i] === '{') depth++
      else if (src[i] === '}') { depth--; if (depth === 0) { end = i; break } }
    }
    if (end < 0) return null
    const body = src.slice(open + 1, end)
    if (body.includes('...') || /\[[^\]]+\]\s*:/.test(body)) return null
    for (const part of body.split(',')) {
      const key = part.split(':')[0].trim()
      if (/^[A-Za-z_$][\w$]*$/.test(key)) names.add(key)
    }
  } else if (/module\.exports\s*=\s*[A-Za-z_$]/.test(src)) {
    return null // re-exports another object wholesale
  }
  return names.size ? names : null
}

let failures = 0
const cache = new Map()

for (const [alias, specifier] of aliases) {
  const callRe = new RegExp(`\\b${alias}\\.([A-Za-z_$][\\w$]*)\\s*\\(`, 'g')
  const called = new Set(Array.from(indexSource.matchAll(callRe), (m) => m[1]))
  if (!called.size) continue

  if (!cache.has(specifier)) cache.set(specifier, readModule(specifier))
  const mod = cache.get(specifier)
  if (!mod) { console.log(`  skip ${alias} -> ${specifier} (not readable)`); continue }

  const names = exportNames(mod.source)
  if (!names) { console.log(`  skip ${alias} -> ${specifier} (export shape not static)`); continue }

  for (const member of called) {
    if (names.has(member)) continue
    failures++
    console.error(
      `  FAIL ${alias}.${member}() — "${specifier}" does not export "${member}".\n` +
      `       It exports: ${[...names].sort().join(', ')}`,
    )
  }
}

if (failures) {
  console.error(`\n${failures} dead call site(s) in functions/index.js.`)
  process.exit(1)
}
console.log('  ok  every alias.member() call in functions/index.js names a real export')
