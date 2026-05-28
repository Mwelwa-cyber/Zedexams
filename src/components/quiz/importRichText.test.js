/**
 * src/components/quiz/importRichText.test.js
 *
 * Unit tests for the import-markup → editor-node-HTML converter.
 *
 * Plain `node` script per repo convention (no test runner): throws on the
 * first failed assertion, prints a summary on success. Wired into
 * `npm run test:import-rich-text` and `npm run test:all`.
 *
 * The converter's whole job is to emit HTML that the editor's parseHTML and
 * the sanitiser allow-lists already accept, so these assertions pin the exact
 * data-* attribute shapes the extensions look for.
 */

import {
  importMarkupToRichHtml,
  importMarkupToOptionHtml,
  convertInline,
  parseVmathToken,
  hasImportMarkup,
} from './importRichText.js'

let passed = 0
const failures = []

function assert(label, condition) {
  if (condition) {
    passed += 1
  } else {
    failures.push(label)
  }
}

function assertIncludes(label, haystack, needle) {
  assert(`${label} — expected to find: ${needle}`, String(haystack).includes(needle))
}

function assertEqual(label, actual, expected) {
  assert(`${label} — expected "${expected}", got "${actual}"`, actual === expected)
}

/* ── hasImportMarkup ───────────────────────────────────────────────────── */

assert('plain prose has no markup', !hasImportMarkup('What is the capital of Zambia?'))
assert('detects \\frac', hasImportMarkup('What is \\frac{3}{4} of 200?'))
assert('detects $math$', hasImportMarkup('Find $\\sqrt{49}$.'))
assert('detects vmath token', hasImportMarkup('[[vmath op=- lines=10,3]]'))
assert(
  'detects markdown table',
  hasImportMarkup('| A | B |\n| --- | --- |\n| 1 | 2 |'),
)
assert('a stray pipe is not a table', !hasImportMarkup('Choose A | B for the answer'))

/* ── Stacked fractions ─────────────────────────────────────────────────── */

{
  const html = convertInline('What is \\frac{3}{4} of 200?')
  assertIncludes('proper fraction → math-frac', html, 'class="math-frac"')
  assertIncludes('proper fraction num', html, 'data-num="3"')
  assertIncludes('proper fraction den', html, 'data-den="4"')
  assertIncludes('proper fraction empty whole', html, 'data-whole=""')
  assertIncludes('proper fraction carries marker attr', html, 'data-math-fraction="1"')
  assert('proper fraction keeps trailing text', html.includes('of 200?'))
}

{
  // Mixed number: the integer directly before \frac folds into data-whole.
  const html = convertInline('Add 1\\frac{1}{3} and 2.')
  assertIncludes('mixed number whole', html, 'data-whole="1"')
  assertIncludes('mixed number num', html, 'data-num="1"')
  assertIncludes('mixed number den', html, 'data-den="3"')
  assert('mixed number does not leave a stray 1', !/1<span class="math-frac"/.test(html.replace('data-whole="1"', '')) )
}

{
  // $ \frac{a}{b} $ should still prefer the stacked fraction node.
  const html = convertInline('Compute $\\frac{7}{4}$ now.')
  assertIncludes('dollar-wrapped simple fraction → math-frac', html, 'class="math-frac"')
  assert('dollar-wrapped fraction is not inline KaTeX', !html.includes('class="mnode"'))
}

/* ── Inline KaTeX math ─────────────────────────────────────────────────── */

{
  const html = convertInline('Find $\\sqrt{49}$ exactly.')
  assertIncludes('sqrt → mnode', html, 'class="mnode"')
  assertIncludes('sqrt latex preserved', html, 'data-latex="\\sqrt{49}"')
}

{
  const html = convertInline('Simplify $x^2 + y^2$.')
  assertIncludes('exponent latex preserved', html, 'data-latex="x^2 + y^2"')
}

{
  // \( … \) delimiters.
  const html = convertInline('Area is \\(\\pi r^2\\) units.')
  assertIncludes('paren-delimited math → mnode', html, 'class="mnode"')
  assertIncludes('paren-delimited latex', html, 'data-latex="\\pi r^2"')
}

{
  // A complex fraction (non-integer) stays as KaTeX, never a broken math-frac.
  const html = convertInline('$\\frac{x+1}{2}$')
  assertIncludes('complex fraction stays KaTeX', html, 'class="mnode"')
  assert('complex fraction is not a stacked node', !html.includes('class="math-frac"'))
}

/* ── HTML escaping / XSS safety ────────────────────────────────────────── */

{
  const html = convertInline('5 < 6 and 7 > 2 & true')
  assertIncludes('escapes <', html, '&lt;')
  assertIncludes('escapes >', html, '&gt;')
  assertIncludes('escapes &', html, '&amp;')
}

{
  const html = convertInline('<script>alert(1)</script>')
  assert('no raw script tag survives', !html.includes('<script>'))
  assertIncludes('script escaped', html, '&lt;script&gt;')
}

{
  // A quote inside latex must be attribute-escaped so it cannot break out.
  const html = convertInline('$a"onmouseover="x$')
  assert('no raw double-quote breaks the attribute', !html.includes('"onmouseover="x'))
  assertIncludes('quote escaped to entity', html, '&quot;')
}

/* ── Vertical arithmetic ───────────────────────────────────────────────── */

{
  const attrs = parseVmathToken(' op=- lines=954751,362948 answer=591803 working=false ')
  assertEqual('vmath operator normalised to minus glyph', attrs.operator, '−')
  assertEqual('vmath lines parsed', attrs.lines.join('|'), '954751|362948')
  assertEqual('vmath answer parsed', attrs.answer, '591803')
  assertEqual('vmath working parsed', attrs.working, false)
}

{
  const attrs = parseVmathToken('op=* lines="13.29,2.1"')
  assertEqual('asterisk → multiplication glyph', attrs.operator, '×')
  assertEqual('quoted lines parsed', attrs.lines.join('|'), '13.29|2.1')
}

{
  const html = importMarkupToRichHtml('Work it out:\n[[vmath op=- lines=2376,1154]]')
  assertIncludes('vmath → vert-arith div', html, 'class="vert-arith"')
  assertIncludes('vmath marker attr', html, 'data-vertical-arithmetic="1"')
  assertIncludes('vmath operator attr', html, 'data-operator="−"')
  assertIncludes('vmath lines pipe-joined', html, 'data-lines="2376|1154"')
  assertIncludes('vmath working attr', html, 'data-working="false"')
  assertIncludes('text before vmath kept as paragraph', html, '<p>Work it out:</p>')
}

/* ── Tables ────────────────────────────────────────────────────────────── */

{
  const md = '| Animal | Legs |\n| --- | --- |\n| Dog | 4 |\n| Spider | 8 |'
  const html = importMarkupToRichHtml(md)
  assertIncludes('table element emitted', html, '<table>')
  assertIncludes('header cell', html, '<th>Animal</th>')
  assertIncludes('body cell', html, '<td>Dog</td>')
  assertIncludes('second body row', html, '<td>Spider</td>')
  assertIncludes('closes table', html, '</table>')
}

{
  // A fraction inside a table cell is converted too.
  const md = '| Item | Share |\n|---|---|\n| Maize | \\frac{1}{2} |'
  const html = importMarkupToRichHtml(md)
  assertIncludes('fraction inside table cell', html, 'class="math-frac"')
}

{
  // Text, then a table, then more text — all three survive.
  const doc = 'Study the table.\n\n| X | Y |\n| --- | --- |\n| 1 | 2 |\n\nWhat is X?'
  const html = importMarkupToRichHtml(doc)
  assertIncludes('lead paragraph', html, '<p>Study the table.</p>')
  assertIncludes('table in the middle', html, '<table>')
  assertIncludes('trailing paragraph', html, '<p>What is X?</p>')
}

/* ── Whole-field behaviour ─────────────────────────────────────────────── */

assertEqual(
  'plain question text passes through unchanged',
  importMarkupToRichHtml('Which city is the capital of Zambia?'),
  'Which city is the capital of Zambia?',
)

assertEqual('empty stays empty', importMarkupToRichHtml(''), '')

{
  const html = importMarkupToRichHtml('Line one\nLine two')
  // No markup at all → untouched (no <p> wrapping, no behaviour change).
  assertEqual('plain multiline untouched', html, 'Line one\nLine two')
}

/* ── Options ───────────────────────────────────────────────────────────── */

assertEqual('plain option unchanged', importMarkupToOptionHtml('117 kg'), '117 kg')

{
  const html = importMarkupToOptionHtml('\\frac{11}{100}')
  assertIncludes('option fraction → math-frac', html, 'class="math-frac"')
  assertIncludes('option fraction num', html, 'data-num="11"')
  assertIncludes('option fraction den', html, 'data-den="100"')
  assert('option has no block paragraph wrapper', !html.includes('<p>'))
}

/* ── Summary ───────────────────────────────────────────────────────────── */

if (failures.length) {
  console.error(`\n❌ importRichText: ${failures.length} assertion(s) failed:`)
  failures.forEach((f) => console.error(`   • ${f}`))
  process.exit(1)
}
console.log(`✅ importRichText: ${passed} assertions passed`)
