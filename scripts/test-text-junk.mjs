#!/usr/bin/env node
/**
 * Regression tests for the shared junk-character stripper
 * (src/utils/textJunk.js).
 *
 * This is the single source of truth used by the import-time cleaner
 * (cleanImportedText) and the render-time paths (extractPlainText,
 * sanitizeHTML, sanitizeQuizRichHTML, richTextToPlainText). It fixes the
 * "stray symbols keep showing up" bug on imported ECZ past papers — first
 * reported on Grade 7 Expressive Arts Q17.
 *
 * Junk inputs are built with String.fromCharCode so this test file (and the
 * module under test) stay pure ASCII — the very control / invisible chars we
 * target can never sneak into the source.
 *
 * Run:  npm run test:text-junk
 */

import { stripImportJunkChars } from '../src/utils/textJunk.js'

let passed = 0
const failures = []
function eq(label, actual, expected) {
  if (actual === expected) passed += 1
  else failures.push(`${label} — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`)
}

const cc = (n) => String.fromCharCode(n)

// ── Each junk class is removed ────────────────────────────────────────────
eq('U+FFFD replacement char removed', stripImportJunkChars(`a${cc(0xfffd)}b`), 'ab')
eq('U+FEFF BOM removed', stripImportJunkChars(`${cc(0xfeff)}Title`), 'Title')
eq('U+200B zero-width space removed', stripImportJunkChars(`a${cc(0x200b)}b`), 'ab')
eq('U+200C zero-width non-joiner removed', stripImportJunkChars(`a${cc(0x200c)}b`), 'ab')
eq('U+200D zero-width joiner removed', stripImportJunkChars(`a${cc(0x200d)}b`), 'ab')
eq('U+2060 word joiner removed', stripImportJunkChars(`a${cc(0x2060)}b`), 'ab')
eq('U+2064 invisible plus removed', stripImportJunkChars(`a${cc(0x2064)}b`), 'ab')
eq('U+00AD soft hyphen removed', stripImportJunkChars(`Ex${cc(0x00ad)}pressive`), 'Expressive')
eq('U+0000 NUL removed', stripImportJunkChars(`a${cc(0x0000)}b`), 'ab')
eq('U+0007 BEL removed', stripImportJunkChars(`a${cc(0x0007)}b`), 'ab')
eq('U+001F unit separator removed', stripImportJunkChars(`a${cc(0x001f)}b`), 'ab')
eq('U+007F DEL removed', stripImportJunkChars(`a${cc(0x007f)}b`), 'ab')
eq('U+0085 NEL (C1) removed', stripImportJunkChars(`a${cc(0x0085)}b`), 'ab')
eq('U+009F (C1) removed', stripImportJunkChars(`a${cc(0x009f)}b`), 'ab')

// ── Whitespace that must SURVIVE (handled by callers, not junk) ────────────
eq('tab preserved', stripImportJunkChars(`a${cc(0x0009)}b`), `a${cc(0x0009)}b`)
eq('newline preserved', stripImportJunkChars(`a${cc(0x000a)}b`), `a${cc(0x000a)}b`)
eq('carriage return preserved', stripImportJunkChars(`a${cc(0x000d)}b`), `a${cc(0x000d)}b`)
eq('non-breaking space NOT stripped (callers normalise it)', stripImportJunkChars(`a${cc(0x00a0)}b`), `a${cc(0x00a0)}b`)

// ── Legitimate non-ASCII MUST be preserved (no over-stripping) ─────────────
eq('accented letters preserved', stripImportJunkChars('café résumé'), 'café résumé')
eq('em-dash preserved', stripImportJunkChars('a — b'), 'a — b')
eq('Cinyanja phrase preserved', stripImportJunkChars('Nsonga ya uluzi'), 'Nsonga ya uluzi')
eq('musical / art glyphs preserved', stripImportJunkChars('♪ ♥ ☼'), '♪ ♥ ☼')
eq('emoji (surrogate pair) preserved', stripImportJunkChars('art 🎨 class'), 'art 🎨 class')

// ── Edge cases ────────────────────────────────────────────────────────────
eq('clean string returned as-is', stripImportJunkChars('Question 17'), 'Question 17')
eq('null → empty', stripImportJunkChars(null), '')
eq('undefined → empty', stripImportJunkChars(undefined), '')
eq('number coerced', stripImportJunkChars(17), '17')
eq('multiple junk chars in a burst removed', stripImportJunkChars(`${cc(0xfffd)}${cc(0x200b)}${cc(0x0007)}X`), 'X')

if (failures.length) {
  console.error(`\n❌ text-junk: ${failures.length} assertion(s) failed:`)
  failures.forEach((f) => console.error(`   • ${f}`))
  process.exit(1)
}
console.log(`✅ text-junk: ${passed} assertions passed`)
