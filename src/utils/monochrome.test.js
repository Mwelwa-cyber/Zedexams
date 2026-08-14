/**
 * monochrome tests — and the ink audit that keeps the paper printable (§4.2).
 *
 * Two halves.
 *
 * The first tests the arithmetic: parsing a colour, reducing it to the grey a
 * printer renders, and comparing two of them.
 *
 * The second is the part with teeth. It SCANS the three renderers for every
 * colour they print in and checks each one against a declared role. A colour
 * that is not declared fails the test — so the way to add one is to say what it
 * is for, and CI answers whether it will survive the printer. A hand-kept list
 * would have drifted the first time someone added a colour; this cannot.
 *
 * Why it matters here in particular: most Zambian schools print monochrome, and
 * a class set is usually one printed master photocopied thirty times. Each
 * generation loses contrast. A mid-grey that reads fine on a screen can be
 * close to invisible on the sheet a learner actually receives.
 *
 * Run: node src/utils/monochrome.test.js
 */

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  parseColor, relativeLuminance, printedGrey, contrastRatio, inkSurvivesPrint,
  printContrastWarning, TEXT_MIN_RATIO, LINE_MIN_RATIO,
} from './monochrome.js'

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

/* ── the arithmetic ─────────────────────────────────────────────────────── */

console.log('\n— reading a colour —')

test('every notation the three renderers actually use is understood', () => {
  // docx wants a bare hex, CSS wants a #, and the preview uses both plus rgb().
  assert.deepEqual(parseColor('#047857'), [4, 120, 87])
  assert.deepEqual(parseColor('047857'), [4, 120, 87])
  assert.deepEqual(parseColor('#fff'), [255, 255, 255])
  assert.deepEqual(parseColor('rgb(4, 120, 87)'), [4, 120, 87])
  assert.deepEqual(parseColor('rgba(4,120,87,0.5)'), [4, 120, 87])
})

test('a colour we cannot measure reports so instead of guessing', () => {
  // Treating `rebeccapurple` as black would pass a check it was never tested
  // against, which is worse than admitting we do not know.
  for (const bad of ['rebeccapurple', 'currentColor', '', null, undefined, 'var(--ink)']) {
    assert.equal(parseColor(bad), null, String(bad))
    assert.equal(relativeLuminance(bad), null, String(bad))
    assert.equal(contrastRatio(bad, '#fff'), null, String(bad))
  }
})

console.log('\n— what the printer does to it —')

test('black and white sit at the ends', () => {
  assert.equal(relativeLuminance('#000'), 0)
  assert.equal(relativeLuminance('#fff'), 1)
  assert.equal(Math.round(contrastRatio('#000', '#fff')), 21)
  assert.equal(printedGrey('#000'), 0)
  assert.equal(printedGrey('#fff'), 255)
})

test('a saturated green prints far lighter than a blue of the same "darkness"', () => {
  // The eye is most sensitive to green, so a printer renders it pale. This is
  // the trap the whole module exists for: two colours a teacher would call
  // equally dark come out nothing alike.
  const green = printedGrey('#00ff00')
  const blue = printedGrey('#0000ff')
  assert.ok(green > blue + 60, `green ${green} vs blue ${blue}`)
})

test('contrast is symmetric — which colour you name first cannot matter', () => {
  const a = contrastRatio('#047857', '#ffffff')
  const b = contrastRatio('#ffffff', '#047857')
  assert.equal(a, b)
})

console.log('\n— the verdict —')

test('a line may be fainter than a letter, because it is easier to see', () => {
  // #888888 is 3.54:1 — fine as a rule, not fine as 8pt text.
  assert.equal(inkSurvivesPrint({ color: '#888888', role: 'line' }).ok, true)
  assert.equal(inkSurvivesPrint({ color: '#888888', role: 'text' }).ok, false)
})

test('the background is taken into account, not assumed to be white', () => {
  // #777 on the off-white diagram box is worse than #777 on the sheet.
  const onWhite = inkSurvivesPrint({ color: '#777777', on: '#ffffff' })
  const onBox = inkSurvivesPrint({ color: '#777777', on: '#fafafa' })
  assert.ok(onBox.ratio < onWhite.ratio, `${onBox.ratio} < ${onWhite.ratio}`)
})

test('an unmeasurable colour is not counted as a pass', () => {
  const r = inkSurvivesPrint({ color: 'currentColor' })
  assert.equal(r.ok, false)
  assert.equal(r.measurable, false)
  assert.match(printContrastWarning(r, 'The heading'), /could not be checked/)
})

test('the warning talks about the photocopier, not about luminance', () => {
  const r = inkSurvivesPrint({ color: '#bbbbbb' })
  assert.equal(r.ok, false)
  const warning = printContrastWarning(r, 'The footer')
  assert.match(warning, /The footer/)
  assert.match(warning, /photocopying/)
  assert.ok(!/ratio|luminance|WCAG|contrast|sRGB/i.test(warning), warning)
  assert.equal(printContrastWarning(inkSurvivesPrint({ color: '#000' })), '')
})

/* ── the audit ──────────────────────────────────────────────────────────── */

/**
 * Every colour the paper prints in, and what it is for.
 *
 * `role` decides the floor: 'text' 4.5:1, 'largeText' 3:1, 'line' 3:1.
 * `on` is what it sits on when that is not the sheet.
 * `background` marks a colour used as a FILL rather than as ink — it is checked
 * from the other side, as something ink must remain readable against.
 */
const INK = {
  ffffff: { role: 'background', why: 'the sheet, and label pill fills' },
  fafafa: { role: 'background', why: 'the empty-diagram placeholder box' },
  '000000': { role: 'text', why: 'question text, markers, leader lines' },
  '1c1612': { role: 'line', why: 'library diagram strokes' },
  '047857': { role: 'text', why: 'marking-key answers' },
  b91c1c: { role: 'text', why: 'the could-not-embed figure placeholder' },
  '6b7280': { role: 'text', on: '#fafafa', why: 'marking-key notes, empty-diagram placeholder text' },
  '4b5563': { role: 'text', why: 'muted paper metadata' },
  555555: { role: 'text', why: 'end-of-paper and school footer lines' },
  888888: {
    role: 'line',
    why: 'every rule on the paper — table borders, option boxes, matching and '
      + 'sequence separators, blank answer lines, the placeholder box',
  },
  111111: { role: 'text', why: 'body text' },
  333333: { role: 'text', why: 'section instructions and the footer' },
  ecfdf5: { role: 'background', why: 'the marking-key answer callout' },
  f1f5f9: { role: 'background', why: 'table header cells' },
  '94a3b8': { role: 'line', why: 'the studio-only page-break marker (never printed)', screenOnly: true },
}

const SOURCES = [
  'src/utils/assessmentToDocx.js',
  'src/utils/assessmentToPdf.js',
  'src/engines/paper-render/PaperBlocks.jsx',
]

/** Every 6-digit hex literal in a file, lowercased. */
function inkIn(file) {
  const src = readFileSync(new URL(`../../${file}`, import.meta.url), 'utf8')
  const found = new Set()
  for (const m of src.matchAll(/['"#]([0-9a-fA-F]{6})['"\s;,)]/g)) found.add(m[1].toLowerCase())
  // Three-digit CSS shorthand expands to the same colour.
  for (const m of src.matchAll(/#([0-9a-fA-F]{3})\b/g)) {
    const [r, g, b] = m[1].toLowerCase()
    found.add(`${r}${r}${g}${g}${b}${b}`)
  }
  return found
}

console.log('\n— the ink the paper actually prints in —')

test('every colour in the three renderers is declared', () => {
  // An undeclared colour is not a style question, it is an unanswered one:
  // nobody has said whether it survives the printer. Declaring it is how you
  // find out.
  const undeclared = []
  for (const file of SOURCES) {
    for (const hex of inkIn(file)) {
      if (!INK[hex]) undeclared.push(`#${hex} (${file})`)
    }
  }
  assert.deepEqual(
    undeclared, [],
    `undeclared ink — add it to INK in this file with its role:\n  ${undeclared.join('\n  ')}`,
  )
})

test('every declared ink survives black-and-white printing', () => {
  // THE assertion. A failure here means a real paper prints something a learner
  // cannot read.
  const failures = []
  for (const [hex, spec] of Object.entries(INK)) {
    if (spec.role === 'background' || spec.screenOnly) continue
    const result = inkSurvivesPrint({ color: `#${hex}`, on: spec.on, role: spec.role })
    if (!result.ok) {
      failures.push(
        `#${hex} (${spec.why}) — ${result.ratio}:1 against ${spec.on || 'the sheet'}, ` +
        `needs ${result.required}:1; prints as grey ${result.grey}`,
      )
    }
  }
  assert.deepEqual(failures, [], `ink that will not print legibly:\n  ${failures.join('\n  ')}`)
})

test('the fills are light enough for dark ink to sit on', () => {
  for (const [hex, spec] of Object.entries(INK)) {
    if (spec.role !== 'background') continue
    const result = inkSurvivesPrint({ color: '#000000', on: `#${hex}` })
    assert.ok(result.ok, `black on #${hex} (${spec.why}) is ${result.ratio}:1`)
  }
})

test('the thresholds are the ones this file says they are', () => {
  // Guards against someone "fixing" a failure by lowering the bar.
  assert.equal(TEXT_MIN_RATIO, 4.5)
  assert.equal(LINE_MIN_RATIO, 3)
})

console.log(`\n✓ monochrome — ${passed} tests passed`)
