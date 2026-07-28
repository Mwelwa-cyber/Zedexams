/**
 * Who else calls a migrated generator's runner, and do they carry a key?
 *
 * ## The bug this exists to prevent, which already happened once
 *
 * Slice 2 made five generators refuse a request with no idempotency key. That
 * was verified against the generators and against their studio clients — and
 * not against `agents/runners/aria.js`, which calls four of those runners
 * directly and passed no key. Aria's worksheet, flashcards, rubric and
 * scheme_of_work jobs failed outright from the moment it merged, and the whole
 * suite stayed green: every Aria test injected a fake runner that never looked
 * at its arguments.
 *
 * The migration checklist could not have caught it either. It asks what the
 * generator does; the break was in something the generator does not know
 * exists. So the question has to be asked from the other direction — for each
 * migrated runner, WHO calls it, and does that call carry a key.
 *
 * ## Scope, honestly
 *
 * This finds call sites by name in `functions/`. It will not find a runner
 * invoked through a variable, a dynamic map lookup, or another package. It is a
 * net for the common shape — a direct call written out in full — which is what
 * every current caller is, including the one that broke.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

const SKIP_DIRS = new Set(['node_modules', '.git', 'lib', 'coverage'])

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
 * The runner a generator module exports — the `run*` name in its
 * `module.exports`. Returns null when the module exports no runner (the
 * callable factory alone), which is not a fault: it means there is no direct
 * entry point for anything else to call.
 */
export function exportedRunnerName(source) {
  const m = /module\.exports\s*=\s*\{([\s\S]*?)\}/.exec(source)
  if (!m) return null
  const names = m[1].split(',').map((p) => p.split(':')[0].trim())
  return names.find((n) => /^run[A-Z]/.test(n)) || null
}

/**
 * Extract the argument text of a call, brace-balanced.
 *
 * Naive slicing would stop at the first `)` and miss the key in a call that
 * spans lines or nests a call of its own — reading as a violation when it is
 * not, which is the kind of false alarm that gets a guard deleted.
 */
function callArguments(source, openIndex) {
  let depth = 0
  for (let i = openIndex; i < source.length; i += 1) {
    const ch = source[i]
    if (ch === '(') depth += 1
    else if (ch === ')') {
      depth -= 1
      if (depth === 0) return source.slice(openIndex + 1, i)
    }
  }
  return ''
}

/**
 * Every call to `runnerName` outside the module that defines it.
 *
 * @returns {Array<{file:string, line:number, carriesKey:boolean, forwardsAnObject:boolean}>}
 */
export function findRunnerCallers(root, runnerName, definingFile) {
  const out = []
  const pattern = new RegExp(`\\b${runnerName}\\s*\\(`, 'g')
  for (const abs of walk(join(root, 'functions'))) {
    const rel = relative(root, abs).split('\\').join('/')
    if (rel === definingFile) continue
    const source = readFileSync(abs, 'utf8')
    let m
    while ((m = pattern.exec(source)) !== null) {
      const open = m.index + m[0].length - 1
      const args = callArguments(source, open)
      const trimmed = args.trim()
      out.push({
        file: rel,
        line: source.slice(0, m.index).split('\n').length,
        carriesKey: /\bidempotencyKey\b/.test(args),
        // `runWorksheet(a)` — the whole argument is one identifier, so the key
        // may well be inside it and text cannot tell. Not evidence of a
        // violation, and not evidence of safety either; the test requires such
        // a caller to be declared with a reason rather than assumed either way.
        forwardsAnObject: /^[A-Za-z_$][\w$]*$/.test(trimmed),
      })
    }
    pattern.lastIndex = 0
  }
  return out
}

/**
 * Callers that forward an args object built elsewhere, with the evidence that
 * the object carries a key.
 *
 * Declared rather than inferred. A textual scan cannot follow a variable, so
 * the choice is between passing every forwarder silently — which is how the
 * Aria break survived — and requiring someone to say why each one is safe and
 * where that is proved.
 */
export const VERIFIED_FORWARDERS = Object.freeze({
  '__disabled__':
    'Forwards the args object built in runAria(), which derives a deterministic '
    + 'key from the agentJobs document id. Proved in aria.test.js: a key reaches '
    + 'the runner, the same job yields the same key, and the key does not move '
    + 'when the job input does.',
})
