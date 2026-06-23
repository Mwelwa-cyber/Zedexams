/**
 * Tests for scripts/migrate-sanitize-generations.mjs — the one-off cleanup that
 * scrubs XML-illegal characters out of stored aiGenerations artifacts.
 *
 * Exercises the pure cleaning logic only (no Firestore): deep string sanitising,
 * the per-doc patch builder, idempotency, and that legal content is preserved.
 *
 * The illegal characters are built via fromCharCode so this source file stays
 * free of raw control bytes / lone surrogate units.
 *
 * Run: node scripts/test-migrate-sanitize-generations.mjs
 */

import { deepSanitizeStrings, cleanGenerationXml } from './migrate-sanitize-generations.mjs'

let failures = 0
function assert(cond, msg) {
  if (cond) {
    console.log(`  ✓ ${msg}`)
  } else {
    failures += 1
    console.error(`  ✗ ${msg}`)
  }
}

const cc = (n) => String.fromCharCode(n)
const NUL = cc(0x00)
const US = cc(0x1f)
const VT = cc(0x0b)
const HI = cc(0xd83e) // high surrogate of 🦅
const LO = cc(0xdd85) // low surrogate of 🦅
const ILLEGAL_RE = new RegExp(
  `[${cc(0x00)}-${cc(0x08)}${cc(0x0b)}${cc(0x0c)}${cc(0x0e)}-${cc(0x1f)}${cc(0xfffe)}${cc(0xffff)}]`
  + `|[${cc(0xd800)}-${cc(0xdbff)}](?![${cc(0xdc00)}-${cc(0xdfff)}])`
  + `|(?<![${cc(0xd800)}-${cc(0xdbff)}])[${cc(0xdc00)}-${cc(0xdfff)}]`,
)

console.log('deepSanitizeStrings — nested structures')
{
  const dirty = {
    header: { subject: `Math${NUL}`, topic: 'Clean' },
    stages: [{ name: `Intro${US}`, acts: [`do${VT}this`, 'and that'] }],
    count: 5,
    flag: true,
  }
  const r = deepSanitizeStrings(dirty)
  assert(r.changed === true, 'reports changed when a nested string was dirty')
  assert(r.count === 3, 'counts each altered string (subject, name, acts[0])')
  assert(r.value.header.subject === 'Math', 'strips control byte in a deeply nested field')
  assert(r.value.stages[0].name === 'Intro', 'strips control byte in an array-of-objects field')
  assert(r.value.stages[0].acts[0] === 'dothis', 'strips control byte inside a nested string array')
  assert(r.value.stages[0].acts[1] === 'and that', 'leaves an already-clean sibling untouched')
  assert(r.value.count === 5 && r.value.flag === true, 'non-string values pass through unchanged')
  assert(!ILLEGAL_RE.test(JSON.stringify(r.value)), 'no XML-illegal characters remain anywhere')
}

console.log('\ndeepSanitizeStrings — keeps legal content')
{
  const clean = { a: 'tab\tnewline\nCR\r', emoji: `eagle ${HI}${LO}`, n: 1 }
  const r = deepSanitizeStrings(clean)
  assert(r.changed === false && r.count === 0, 'clean input is a no-op')
  assert(r.value === clean, 'unchanged input returns the same object identity')
}

console.log('\ndeepSanitizeStrings — lone surrogate handling')
{
  const r = deepSanitizeStrings({ s: `trunc${HI}` })
  assert(r.changed === true && r.value.s === 'trunc', 'lone high surrogate stripped')
  const keep = deepSanitizeStrings({ s: `keep ${HI}${LO}` })
  assert(keep.changed === false, 'a whole emoji (surrogate pair) is preserved')
}

console.log('\ncleanGenerationXml — per-doc patch builder')
{
  const doc = {
    tool: 'lesson_plan',
    output: { header: { subject: `Mathematics${NUL}` }, stages: [{ name: `Intro${US}` }] },
    outputText: `raw${US} text`,
    createdAt: 'KEEP-ME',
  }
  const res = cleanGenerationXml(doc)
  assert(res !== null, 'returns a patch when illegal chars are present')
  assert(res.count === 3, 'counts strings across output + outputText')
  assert(Object.keys(res.patch).sort().join(',') === 'output,outputText', 'patch contains only the changed fields')
  assert(res.patch.output.header.subject === 'Mathematics', 'output is sanitised in the patch')
  assert(res.patch.outputText === 'raw text', 'outputText is sanitised in the patch')
  assert(!('tool' in res.patch) && !('createdAt' in res.patch), 'metadata fields are never in the patch')
}

console.log('\ncleanGenerationXml — no-ops and idempotency')
{
  assert(cleanGenerationXml({ tool: 'flashcards', status: 'generating' }) === null, 'doc with no output/outputText → null')
  assert(cleanGenerationXml({ output: { a: 'clean' }, outputText: 'fine' }) === null, 'already-clean doc → null')
  assert(cleanGenerationXml(null) === null && cleanGenerationXml('x') === null, 'non-object input → null')

  const dirty = { output: { s: `bad${NUL}` }, outputText: `bad${US}` }
  const first = cleanGenerationXml(dirty)
  assert(first !== null, 'dirty doc cleaned on first pass')
  // Apply the patch, then re-run — must be a no-op (idempotent).
  const applied = { ...dirty, ...first.patch }
  assert(cleanGenerationXml(applied) === null, 're-running on the cleaned doc is a no-op')
}

if (failures > 0) {
  console.error(`\n${failures} assertion(s) failed.`)
  process.exit(1)
}
console.log('\nAll migrate-sanitize-generations tests passed.')
