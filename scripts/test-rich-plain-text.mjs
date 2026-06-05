#!/usr/bin/env node
/**
 * Regression tests for rich-text plain-text extraction
 * (src/editor/richPlainText.js).
 *
 * Guards the "answer options show raw JSON" bug: a stringified Tiptap doc
 * stored as an option/answer must extract to readable text — never leak the
 * raw '{"type":"doc",...}' string into the UI.
 *
 * Run:  npm run test:rich-plain-text
 */

import { getRichPlainText, extractPlainText, unwrapNestedTiptapDoc } from '../src/editor/richPlainText.js'

let passed = 0
const failures = []
function assert(label, cond) {
  if (cond) passed += 1
  else failures.push(label)
}
function eq(label, actual, expected) {
  assert(`${label} — expected "${expected}", got "${actual}"`, actual === expected)
}

// The exact shapes from the reported bug (Grade 7 fraction options stored as
// stringified Tiptap docs).
const fracDocString = JSON.stringify({
  type: 'doc',
  content: [{
    type: 'paragraph',
    attrs: { textAlign: null },
    content: [{ type: 'mathFraction', attrs: { whole: '', num: '1', den: '32' } }],
  }],
})

// ── The core regression: stringified doc → readable text, NOT raw JSON ────
{
  const out = getRichPlainText(fracDocString)
  eq('stringified fraction doc extracts to "1/32"', out, '1/32')
  assert('does NOT leak the raw JSON', !out.includes('"type"') && !out.includes('mathFraction'))
}

// As a real object (not stringified) too.
{
  const out = getRichPlainText({
    type: 'doc',
    content: [{ type: 'paragraph', content: [{ type: 'mathFraction', attrs: { whole: '', num: '3', den: '8' } }] }],
  })
  eq('object fraction doc extracts to "3/8"', out, '3/8')
}

// Mixed number keeps the whole part.
{
  const out = getRichPlainText(JSON.stringify({
    type: 'doc',
    content: [{ type: 'paragraph', content: [{ type: 'mathFraction', attrs: { whole: '1', num: '1', den: '3' } }] }],
  }))
  eq('mixed number extracts to "1 1/3"', out, '1 1/3')
}

// Inline KaTeX, number base, and vertical arithmetic read out sensibly.
{
  const doc = {
    type: 'doc',
    content: [{
      type: 'paragraph',
      content: [
        { type: 'text', text: 'Find ' },
        { type: 'mathInline', attrs: { latex: '\\sqrt{49}' } },
      ],
    }],
  }
  assert('inline math contributes its latex', getRichPlainText(doc).includes('\\sqrt{49}'))
}
{
  const base = getRichPlainText({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'numberBase', attrs: { number: '313', base: '5' } }] }] })
  eq('number base reads as n_b', base, '313_5')
}
{
  const va = getRichPlainText({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'verticalArithmetic', attrs: { operator: '−', lines: ['954751', '362948'], answer: '591803' } }] }] })
  eq('vertical arithmetic reads as a sum', va, '954751 − 362948 = 591803')
}

// ── Plain / HTML / empty values pass through unchanged ────────────────────
eq('plain string is unchanged', getRichPlainText('117 kg'), '117 kg')
eq('empty string → empty', getRichPlainText(''), '')
eq('null → empty', getRichPlainText(null), '')
// A non-doc JSON string (not a Tiptap doc) is returned verbatim, not crashed.
eq('non-doc JSON string passes through', getRichPlainText('{"a":1}'), '{"a":1}')

// ── Nested stringified docs (legacy double-encode bug) are unwrapped ──────
{
  const inner = JSON.stringify({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Lusaka' }] }] })
  const nested = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: inner }] }] }
  const unwrapped = unwrapNestedTiptapDoc(nested)
  eq('nested stringified doc unwraps to inner text', extractPlainText(unwrapped), 'Lusaka')
}

// ── Garbage chars stripped at render time (already-stored data, no migration) ─
// extractPlainText is the plain-text fallback used by PublicQuizRunner /
// QuizRunnerV2 when a question has no Tiptap JSON. It must drop DOCX-to-text
// garbage so e.g. Grade 7 Expressive Arts Q17 reads cleanly. Junk chars are
// built with String.fromCharCode so this file stays pure ASCII.
{
  const FFFD = String.fromCharCode(0xfffd)
  const ZWSP = String.fromCharCode(0x200b)
  const SHY = String.fromCharCode(0x00ad)
  const BEL = String.fromCharCode(0x0007)
  const NEL = String.fromCharCode(0x0085)
  const BOM = String.fromCharCode(0xfeff)

  eq('replacement char stripped from plain string', extractPlainText(`Name the${FFFD} drum`), 'Name the drum')
  eq('zero-width space stripped', extractPlainText(`A${ZWSP}B`), 'AB')
  eq('soft hyphen stripped (Expressive Arts)', extractPlainText(`Ex${SHY}pressive`), 'Expressive')
  eq('C0 + C1 controls + BOM stripped', extractPlainText(`${BOM}Test${BEL}${NEL}After`), 'TestAfter')
  // Junk inside a stringified Tiptap doc is also cleaned.
  const dirtyDoc = JSON.stringify({
    type: 'doc',
    content: [{ type: 'paragraph', content: [{ type: 'text', text: `Mfumu${FFFD} ya${ZWSP} chinyanja` }] }],
  })
  eq('junk inside Tiptap doc text stripped', extractPlainText(dirtyDoc), 'Mfumu ya chinyanja')
  // Legitimate non-ASCII is preserved.
  eq('accented + em-dash + musical preserved', extractPlainText('café — ♪'), 'café — ♪')
}

// ── Summary ───────────────────────────────────────────────────────────────
if (failures.length) {
  console.error(`\n❌ rich-plain-text: ${failures.length} assertion(s) failed:`)
  failures.forEach((f) => console.error(`   • ${f}`))
  process.exit(1)
}
console.log(`✅ rich-plain-text: ${passed} assertions passed`)
