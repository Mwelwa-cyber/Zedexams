#!/usr/bin/env node
/**
 * Isolation test for the learner-AI pipeline.
 *
 * Hard rule from the foundation plan: NO file under
 * functions/agents/learnerAi/ may write to the existing learner
 * publishing flow (`quizzes` collection) or the teacher AI store
 * (`aiGenerations`). The learner-AI pipeline must stay parallel.
 *
 * Firestore rules cannot enforce this — admin SDK writes from Cloud
 * Functions bypass rules. So we enforce it here, in CI, by greping
 * every learner-AI file for `collection("quizzes")` / `aiGenerations`.
 *
 * Run: npm run test:learner-ai-isolation  (also via npm run test:all)
 */

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..', 'functions', 'agents', 'learnerAi')

function walk(dir) {
  const out = []
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    const st = statSync(full)
    if (st.isDirectory()) out.push(...walk(full))
    else if (st.isFile() && /\.(js|mjs|cjs)$/.test(entry)) out.push(full)
  }
  return out
}

const FORBIDDEN_PATTERNS = [
  { needle: 'collection("quizzes")',
    why: 'learner-AI pipeline must not write to the existing `quizzes` collection' },
  { needle: "collection('quizzes')",
    why: 'learner-AI pipeline must not write to the existing `quizzes` collection' },
  { needle: 'collection("aiGenerations")',
    why: 'learner-AI pipeline must not write to the teacher `aiGenerations` collection — use `learnerAiGenerations`' },
  { needle: "collection('aiGenerations')",
    why: 'learner-AI pipeline must not write to the teacher `aiGenerations` collection — use `learnerAiGenerations`' },
]

let pass = 0, fail = 0
const failures = []

function fileTest(name, fn) {
  try { fn(); pass++; console.log(`  ok  ${name}`) }
  catch (err) { fail++; failures.push({name, message: err.message}); console.log(`  FAIL ${name}\n       ${err.message}`) }
}

const files = walk(ROOT)
fileTest('learner-AI directory contains source files', () => {
  if (!files.length) throw new Error('no JS files found under functions/agents/learnerAi/')
})

for (const file of files) {
  const rel = file.slice(ROOT.length + 1)
  const body = readFileSync(file, 'utf8')
  for (const {needle, why} of FORBIDDEN_PATTERNS) {
    fileTest(`${rel} :: forbids '${needle}'`, () => {
      if (body.includes(needle)) {
        throw new Error(`${rel} contains forbidden pattern '${needle}' — ${why}`)
      }
    })
  }
}

console.log(`\n${pass} passed, ${fail} failed`)
if (fail > 0) {
  console.log('\nfailures:')
  for (const f of failures) console.log(`  ${f.name}: ${f.message}`)
  process.exit(1)
}
