// Plain-node guard for the Cloud Functions cold-start budget.
// Run: node scripts/test-cold-start-budget.mjs
//
// Every Cloud Function instance loads the whole of functions/index.js before it
// serves its first request — all ~196 exports share one module graph. So a
// MODULE-SCOPE `require` of a heavy package anywhere reachable from index.js is
// paid by every callable, trigger and cron in the codebase, including the ones
// that will never call it.
//
// The failure that makes this worth a guard is a silent one. Memory kills and
// timeouts on cold-starting instances were the whole of the #2230 outage, and
// the platform kills the container without running any error handler — so it
// arrives as a 503 with no stack trace, invisible to Sentry by construction
// (see the functionErrorWatch notes in CLAUDE.md). Nothing in lint or the build
// says a word when a heavy require lands back on the startup path.
//
// ── Why this reads SOURCE instead of requiring index.js ──────────────────
//
// The obvious version of this test requires index.js and inspects
// require.cache. It cannot run here: ci.yml's `tests` and `functions-coverage`
// jobs both install the ROOT workspace only, and the functions-coverage job
// documents the invariant that the plain-node backend tests "never require
// firebase-admin/firebase-functions at load time". Requiring index.js needs
// functions/node_modules and breaks that rule outright.
//
// So this walks the relative-require graph as text, the same way
// scripts/test-function-regions.mjs reads index.js with readFileSync rather
// than loading it. It needs no node_modules at all and is deterministic.
//
// Known limitation, stated rather than papered over: a static scan sees
// literal `require("pkg")` calls. A require built from a computed path, or one
// reached through a package that itself pulls a heavy dependency, is invisible
// to it. This catches the mistake people actually make — adding a normal
// top-level require — not every conceivable route back onto the startup path.

import assert from 'node:assert'
import { readFileSync, existsSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve, relative } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const ENTRY = join(root, 'functions/index.js')

let passed = 0
function ok(name, cond) {
  assert.ok(cond, name)
  passed += 1
  console.log(`  ok  ${name}`)
}

// Packages that must NOT be required at module scope on the startup path, with
// the surface that legitimately uses each and the cost measured when it was
// moved off. Removing an entry is a decision to let it load on every cold
// start — say why in the PR rather than weakening the check.
const MUST_STAY_LAZY = [
  ['@google-cloud/text-to-speech', 'apiTextToSpeech only', '37.5 MiB / 181 ms'],
  ['exceljs', 'parseSyllabusUpload storage trigger only', '27.5 MiB / 160 ms'],
  ['mammoth', 'past-paper .docx import only', '18.2 MiB / 78 ms'],
  ['@simplewebauthn/server', 'the four passkey callables only', '17.7 MiB / 114 ms'],
  ['nodemailer', 'the email senders only', '17.8 MiB / 47 ms'],
]

/**
 * Normalise a source file for analysis, preserving length so offsets still line
 * up with the original. Two jobs, and they pull in opposite directions:
 *
 *   - Comment bodies are blanked entirely, so a `require("exceljs")` written
 *     inside a docblock — which several of these files now have, explaining
 *     why the require is lazy — is not read as a real call.
 *   - Inside string literals only `{` and `}` are blanked. Braces in a string
 *     would corrupt the brace-depth count that tells module scope from function
 *     scope, but the rest of the content has to survive: the thing being
 *     matched, `require("nodemailer")`, has its package name in a string.
 */
function sanitize(src) {
  const out = src.split('')
  const blank = (from, to) => {
    for (let k = from; k < to && k < out.length; k += 1) {
      if (out[k] !== '\n') out[k] = ' '
    }
  }
  let i = 0
  while (i < src.length) {
    const two = src.slice(i, i + 2)
    if (two === '//') {
      const end = src.indexOf('\n', i)
      const stop = end === -1 ? src.length : end
      blank(i, stop); i = stop; continue
    }
    if (two === '/*') {
      const end = src.indexOf('*/', i + 2)
      const stop = end === -1 ? src.length : end + 2
      blank(i, stop); i = stop; continue
    }
    const c = src[i]
    if (c === '"' || c === "'" || c === '`') {
      let j = i + 1
      while (j < src.length) {
        if (src[j] === '\\') { j += 2; continue }
        if (src[j] === c) break
        if (src[j] === '{' || src[j] === '}') out[j] = ' '
        j += 1
      }
      i = j + 1; continue
    }
    i += 1
  }
  return out.join('')
}

/** Brace depth at each require match; 0 means module scope. */
function moduleScopeRequires(src, pkg) {
  const code = sanitize(src)
  const needle = new RegExp(`require\\(\\s*['"]${pkg.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}['"]\\s*\\)`, 'g')
  const hits = []
  let m
  while ((m = needle.exec(code))) hits.push(m.index)
  if (!hits.length) return []

  const found = []
  let depth = 0
  let next = 0
  for (let i = 0; i < code.length && next < hits.length; i += 1) {
    if (i === hits[next]) {
      if (depth === 0) found.push(i)
      next += 1
    }
    const c = code[i]
    if (c === '{') depth += 1
    else if (c === '}') depth -= 1
  }
  return found
}

function resolveRelative(spec, fromFile) {
  if (!spec.startsWith('.')) return null
  const base = resolve(dirname(fromFile), spec)
  for (const cand of [base, `${base}.js`, join(base, 'index.js')]) {
    if (existsSync(cand) && statSync(cand).isFile()) return cand
  }
  return null
}

// Walk the startup graph: index.js plus everything it reaches through relative
// requires, at any depth. A lazy require inside a function still puts that FILE
// on the graph, which is correct — we care whether the heavy package loads, and
// a nested module's own top-level require would.
const graph = new Set([ENTRY])
const queue = [ENTRY]
const sources = new Map()
while (queue.length) {
  const file = queue.shift()
  let src
  try { src = readFileSync(file, 'utf8') } catch { continue }
  sources.set(file, src)
  const code = sanitize(src)
  for (const m of code.matchAll(/require\(\s*['"](\.[^'"]*)['"]\s*\)/g)) {
    const dep = resolveRelative(m[1], file)
    if (dep && !graph.has(dep)) { graph.add(dep); queue.push(dep) }
  }
}

console.log('cold-start budget')
ok(`startup graph resolves from functions/index.js (${graph.size} files)`, graph.size > 100)

for (const [pkg, usedBy, cost] of MUST_STAY_LAZY) {
  const offenders = []
  for (const [file, src] of sources) {
    if (moduleScopeRequires(src, pkg).length) offenders.push(relative(root, file))
  }
  ok(
    `${pkg} is not required at module scope on the startup path ` +
      `(${usedBy}; ${cost})${offenders.length ? ` — found in ${offenders.join(', ')}` : ''}`,
    offenders.length === 0,
  )
}

// The guard is only meaningful if it can actually fail, so prove the detector
// fires on a module-scope require and stays quiet for a lazy one.
const POSITIVE = 'const nodemailer = require("nodemailer");\n'
const NEGATIVE = 'function send() {\n  const nodemailer = require("nodemailer");\n}\n'
const IN_COMMENT = '// nodemailer is required lazily — see require("nodemailer") below.\n'
ok('detector flags a module-scope require', moduleScopeRequires(POSITIVE, 'nodemailer').length === 1)
ok('detector ignores a require inside a function', moduleScopeRequires(NEGATIVE, 'nodemailer').length === 0)
ok('detector ignores a require named in a comment', moduleScopeRequires(IN_COMMENT, 'nodemailer').length === 0)

console.log(`\n─── ${passed} assertions · all passed ───`)
