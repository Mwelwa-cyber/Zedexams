/**
 * latexToUnicode tests — the formula on the paper, not the one on the screen.
 *
 * §4.2 of the upgrade brief: "A paper that looks correct in Preview and breaks in
 * Word is a failed paper." The preview renders maths and chemistry with KaTeX;
 * the print window and the Word export do not run KaTeX, so this converter's
 * output IS what a teacher prints and what a learner sits.
 *
 * Two real failures motivated it, both of which produced a WRONG paper rather
 * than an ugly one, and both of which are pinned below:
 *
 *   - `\frac{-b \pm \sqrt{b^2-4ac}}{2a}` lost its fraction bar, so the quadratic
 *     formula printed as a product.
 *   - `\ce{}` was not handled at all: no subscripts, an ASCII arrow, and the
 *     precipitate marker printed as the letter "v" beside a formula.
 *
 * Run: node src/utils/latexToUnicode.test.js
 */

import assert from 'node:assert/strict'
import {
  latexToUnicode, latexToSegments, segmentsToUnicode, chemToSegments, isChemistry,
  latexToMathTree, needsEquation,
} from './latexToUnicode.js'

let passed = 0
function test(name, fn) {
  try {
    fn()
    passed += 1
  } catch (err) {
    console.error(`✗ ${name}\n  ${err.message}`)
    process.exitCode = 1
  }
}

/** Assert a LaTeX fragment renders to exactly this text. */
function renders(tex, want, note = '') {
  test(`${tex}  →  ${want}${note ? `  (${note})` : ''}`, () => {
    assert.equal(latexToUnicode(tex), want)
  })
}

/* ── the fraction that was wrong ────────────────────────────────────────── */

console.log('\n— fractions —')
renders(String.raw`\frac{3}{4}`, '3/4', 'no brackets where none are needed')
renders(String.raw`\frac{y}{x}`, 'y/x')
renders(String.raw`\frac{1}{2a}`, '1/(2a)', 'a multi-token denominator binds')
renders(
  String.raw`x = \frac{-b \pm \sqrt{b^2-4ac}}{2a}`,
  'x = (-b ± √(b²-4ac))/(2a)',
  'THE regression: the bar used to vanish entirely',
)
renders(String.raw`\frac{\frac{1}{2}}{3}`, '(1/2)/3', 'nested fractions')
renders(String.raw`\dfrac{a+b}{c}`, '(a+b)/c', 'dfrac is a fraction too')
renders(String.raw`\frac{1}{2} + \frac{1}{3}`, '1/2 + 1/3', 'two fractions in one line')

test('a fraction missing its second argument does not throw', () => {
  assert.doesNotThrow(() => latexToUnicode(String.raw`\frac{1}`))
  assert.doesNotThrow(() => latexToUnicode(String.raw`\frac`))
})

test('an unbalanced brace does not hang or throw', () => {
  assert.doesNotThrow(() => latexToUnicode(String.raw`\frac{1}{2`))
  assert.doesNotThrow(() => latexToUnicode('{{{{'))
})

/* ── roots, powers, symbols ─────────────────────────────────────────────── */

console.log('\n— maths —')
renders('x^2', 'x²')
renders('x^{10}', 'x¹⁰', 'a multi-digit power')
renders('H_2O', 'H₂O')
renders(String.raw`\sqrt{16}`, '√(16)')
renders(String.raw`\sqrt[3]{27}`, '∛(27)', 'a cube root has its own glyph')
renders(String.raw`4 \div 2 \times 3`, '4 ÷ 2 × 3')
renders(String.raw`5 \geq 3`, '5 ≥ 3')
renders(String.raw`\pi r^2`, 'πr²', 'the space ending a command name is syntax, not a space')
renders(String.raw`2 \times 3`, '2 × 3', '…but an operator keeps its spacing')
renders(String.raw`a\times b`, 'a × b', '…and gains it when the source had none')
renders(String.raw`30\circ`, '30°')
renders(String.raw`\text{speed} = \frac{d}{t}`, 'speed = d/t', 'text passes through')
renders('18', '18', 'plain text is untouched')
renders('', '', 'nothing in, nothing out')

test('an unknown command contributes nothing rather than its own name', () => {
  // "\foo" printed on a paper is noise a learner cannot act on.
  assert.equal(latexToUnicode(String.raw`2 \foo 3`), '2 3')
})

test('a script with no Unicode glyph falls back to the caret form', () => {
  // Half-converting ("H₂SOq") would read worse than "^q" — the reader could not
  // tell which characters were meant to be small.
  assert.equal(latexToUnicode('x^{qz}'), 'x^qz')
})

/* ── chemistry: the path that did not exist ─────────────────────────────── */

console.log('\n— chemistry (mhchem) —')
renders(String.raw`\ce{H2SO4}`, 'H₂SO₄', 'digits after an element are subscripts')
renders(String.raw`\ce{NaCl}`, 'NaCl', 'no digits, nothing to subscript')
renders(String.raw`\ce{Ca(OH)2}`, 'Ca(OH)₂', 'a group subscript follows the bracket')
renders(String.raw`\ce{CO3^2-}`, 'CO₃²⁻', 'a charge is superscript')
renders(String.raw`\ce{Na+}`, 'Na⁺')
renders(String.raw`\ce{SO4^2-}`, 'SO₄²⁻')
renders(
  String.raw`\ce{2H2 + O2 -> 2H2O}`,
  '2H₂ + O₂ → 2H₂O',
  'THE rule: a leading digit is a coefficient, a following digit is a subscript',
)
renders(
  String.raw`\ce{N2(g) + 3H2(g) <=> 2NH3(g)}`,
  'N₂(g) + 3H₂(g) ⇌ 2NH₃(g)',
  'state symbols and a reversible arrow',
)
renders(
  String.raw`\ce{AgNO3 + NaCl -> AgCl v + NaNO3}`,
  'AgNO₃ + NaCl → AgCl↓ + NaNO₃',
  'the precipitate marker used to print as the letter "v"',
)
renders(String.raw`\ce{CaCO3 -> CaO + CO2 ^}`, 'CaCO₃ → CaO + CO₂↑', 'a gas marker')
renders(String.raw`\pu{22.4 L/mol}`, '22.4 L/mol', 'units pass through')

test('a coefficient is never mistaken for a subscript', () => {
  // If this inverted, the equation would say something different — 2H₂O and
  // ₂H₂O are not the same statement.
  assert.equal(segmentsToUnicode(chemToSegments('2H2O')), '2H₂O')
  const scripted = chemToSegments('2H2O').filter((s) => s.script === 'sub')
  assert.equal(scripted.length, 1, 'exactly one digit is a subscript')
  assert.equal(scripted[0].text, '2', 'and it is the one after the H')
})

test('chemistry is recognised as chemistry', () => {
  assert.equal(isChemistry(String.raw`\ce{H2O}`), true)
  assert.equal(isChemistry(String.raw`\pu{5 m}`), true)
  assert.equal(isChemistry(String.raw`\frac{1}{2}`), false)
  assert.equal(isChemistry(''), false)
})

/* ── segments: what the Word export consumes ────────────────────────────── */

console.log('\n— segments —')

test('a formula becomes text plus scripted runs, not one flat string', () => {
  // This is what lets the Word export emit REAL subscript runs rather than
  // relying on the reader's font having a ₂ glyph.
  const segments = latexToSegments(String.raw`\ce{H2SO4}`)
  assert.deepEqual(segments, [
    { text: 'H', script: null },
    { text: '2', script: 'sub' },
    { text: 'SO', script: null },
    { text: '4', script: 'sub' },
  ])
})

test('adjacent segments with the same script are merged', () => {
  // One run per character would bloat the .docx and break Word's line breaking.
  const segments = latexToSegments('abc')
  assert.equal(segments.length, 1)
  assert.equal(segments[0].text, 'abc')
})

test('segments and the string form always agree', () => {
  for (const tex of [
    String.raw`\ce{H2SO4}`, String.raw`\ce{2H2 + O2 -> 2H2O}`,
    String.raw`\frac{1}{2}`, 'x^2 + y_1', String.raw`\sqrt{2}`,
  ]) {
    assert.equal(
      segmentsToUnicode(latexToSegments(tex)).replace(/\s+/g, ' ').trim(),
      latexToUnicode(tex),
      tex,
    )
  }
})

test('empty and rubbish input produce no segments rather than throwing', () => {
  assert.deepEqual(latexToSegments(''), [])
  assert.deepEqual(latexToSegments(null), [])
  assert.deepEqual(latexToSegments(undefined), [])
  assert.doesNotThrow(() => latexToSegments('\\'))
})

/* ── the structural form, for Word equations (§4.2) ─────────────────────── */

console.log('\n— the math tree —')

test('a fraction keeps its two dimensions instead of collapsing to a slash', () => {
  // The linear form has one line to work with; Word does not, and §4.2 asks for
  // the real equation.
  const tree = latexToMathTree(String.raw`\frac{1}{2}`)
  assert.equal(tree.length, 1)
  assert.equal(tree[0].type, 'frac')
  assert.deepEqual(tree[0].numerator, [{ type: 'run', text: '1' }])
  assert.deepEqual(tree[0].denominator, [{ type: 'run', text: '2' }])
})

test('a radical carries its radicand, and its degree when it has one', () => {
  assert.equal(latexToMathTree(String.raw`\sqrt{16}`)[0].type, 'radical')
  assert.equal(latexToMathTree(String.raw`\sqrt{16}`)[0].degree, null)
  const cube = latexToMathTree(String.raw`\sqrt[3]{27}`)[0]
  assert.deepEqual(cube.degree, [{ type: 'run', text: '3' }])
})

test('a power bases on the symbol before it, not the whole expression', () => {
  // "3x + x^2" squares the last x, not "3x + x".
  const tree = latexToMathTree('3x + x^2')
  const sup = tree.find((n) => n.type === 'sup')
  assert.deepEqual(sup.base, [{ type: 'run', text: 'x' }])
  assert.deepEqual(sup.script, [{ type: 'run', text: '2' }])
  assert.equal(tree[0].text, '3x + ')
})

test('the quadratic formula nests correctly all the way down', () => {
  const [, frac] = latexToMathTree(String.raw`x = \frac{-b \pm \sqrt{b^2-4ac}}{2a}`)
  assert.equal(frac.type, 'frac')
  const radical = frac.numerator.find((n) => n.type === 'radical')
  assert.ok(radical, 'the root is inside the numerator')
  assert.ok(radical.radicand.some((n) => n.type === 'sup'), 'b² is inside the root')
  assert.deepEqual(frac.denominator, [{ type: 'run', text: '2a' }])
})

test('adjacent runs merge and doubled spaces collapse', () => {
  // Operator padding leaves them behind, and Word shows every one.
  for (const node of latexToMathTree(String.raw`a \times b \div c`)) {
    if (node.type === 'run') assert.ok(!/ {2}/.test(node.text), node.text)
  }
})

test('rubbish input produces an empty tree rather than throwing', () => {
  assert.deepEqual(latexToMathTree(''), [])
  assert.deepEqual(latexToMathTree(null), [])
  assert.doesNotThrow(() => latexToMathTree(String.raw`\frac{1`))
  assert.doesNotThrow(() => latexToMathTree('^'))
})

console.log('\n— which formulas earn a Word equation —')

test('a stacked construct needs a real equation', () => {
  assert.equal(needsEquation(latexToMathTree(String.raw`\frac{1}{2}`)), true)
  assert.equal(needsEquation(latexToMathTree(String.raw`\sqrt{2}`)), true)
})

test('an inline power does NOT — it is better as a superscript run', () => {
  // Word renders a superscript run perfectly and a teacher can still edit it as
  // text; an equation object around "x²" is a worse artefact than the text.
  assert.equal(needsEquation(latexToMathTree('x^2')), false)
  assert.equal(needsEquation(latexToMathTree('H_2O')), false)
})

test('chemistry never becomes an equation object', () => {
  // \ce{} is runs with scripts, not two-dimensional. Wrapping H₂SO₄ in an
  // equation makes it uneditable as text for no gain.
  const tree = latexToMathTree(String.raw`\ce{H2SO4}`)
  assert.equal(needsEquation(tree), false)
  assert.equal(tree[0].text, 'H₂SO₄')
})

test('plain arithmetic does not become an equation either', () => {
  assert.equal(needsEquation(latexToMathTree('2 + 2 = 4')), false)
})

console.log(`\n✓ latex → unicode — ${passed} tests passed`)
