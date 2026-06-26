#!/usr/bin/env node
/**
 * Regression test for the Lesson Plan Studio writing-style + auto-diagram
 * upgrades (public/studio/06-generate.js).
 *
 * Guards three behaviours added in 2026-06:
 *   1. buildStyleBlock — maps the teacher's Language level (Simple /
 *      Professional / Detailed Teacher Language) + Lesson plan type
 *      (Simplified / Detailed) selectors onto explicit instruction text,
 *      defaulting to Professional / Simplified.
 *   2. buildDiagramBlock — only asks for diagrams when auto-diagrams is on
 *      AND the subject is Maths/Science; lists only renderable diagram types.
 *   3. stageDiagramsHtml — matches model-supplied diagram specs to the right
 *      stage (tolerant of "Activity n" suffixes and case), coerces array
 *      params to comma strings, and skips unknown/garbage specs.
 *
 * The studio files are plain browser scripts that attach to `window`; we eval
 * the source against a stub window + stub DOM globals and read the helpers
 * back off it (same approach as test-studio-curated-topics.mjs).
 *
 * Run: npm run test:lesson-studio-style
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const src = fs.readFileSync(
  path.join(__dirname, '..', 'public', 'studio', '06-generate.js'),
  'utf8',
)

// Minimal DOM/global stubs the evaluated helpers reach for at call time.
const esc = (s = '') => String(s).replace(/[&<>"']/g, (c) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[c]))
globalThis.esc = esc
globalThis.document = { documentElement: {} }
globalThis.getComputedStyle = () => ({ getPropertyValue: () => '#0a5454' })

// A fake diagram catalog standing in for 11-diagrams.js. Each render echoes
// its params so the test can assert coercion + caption handling.
const fakeCatalog = {
  venn2: {
    name: '2-Set Venn',
    defaults: { a: 'A', b: 'B', cap: 'Venn' },
    render: (p) => `<svg data-a="${esc(p.a)}" data-b="${esc(p.b)}"></svg>`,
  },
  barchart: {
    name: 'Bar Chart',
    defaults: { labels: 'x', values: '1', cap: 'Bar' },
    render: (p) => `<svg data-values="${esc(p.values)}"></svg>`,
  },
}

// Eval the studio script against a stub window. Pre-seed the rebinder array
// and the diagram catalog the helper reads from window.
const win = { __studioRebinders: [], __studioDiagrams: fakeCatalog }
new Function('window', src)(win)

const buildStyleBlock = win.__studioBuildStyleBlock
const buildDiagramBlock = win.__studioBuildDiagramBlock
const stageDiagramsHtml = win.__studioStageDiagramsHtml

let pass = 0
let fail = 0
const failures = []

function test(name, fn) {
  try {
    fn()
    pass++
    console.log(`  ok  ${name}`)
  } catch (err) {
    fail++
    failures.push({ name, message: err.message })
    console.log(`  FAIL ${name}`)
    console.log(`       ${err.message}`)
  }
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg)
}

// ── exposure ────────────────────────────────────────────────────────────────
test('exposes the three helpers on window', () => {
  assert(typeof buildStyleBlock === 'function', 'buildStyleBlock not exposed')
  assert(typeof buildDiagramBlock === 'function', 'buildDiagramBlock not exposed')
  assert(typeof stageDiagramsHtml === 'function', 'stageDiagramsHtml not exposed')
})

// ── buildStyleBlock ───────────────────────────────────────────────────────────
test('style block honours explicit language + lesson plan type', () => {
  const b = buildStyleBlock({ languageLevel: 'simple', detailLevel: 'detailed' })
  assert(/Language level: Simple/.test(b), 'missing Simple language guidance')
  assert(/Lesson plan type: Detailed/.test(b), 'missing Detailed guidance')
})

test('style block supports all three language levels', () => {
  assert(/Language level: Simple/.test(buildStyleBlock({ languageLevel: 'simple' })), 'simple not wired')
  assert(/Language level: Professional/.test(buildStyleBlock({ languageLevel: 'professional' })), 'professional not wired')
  assert(/Language level: Detailed Teacher Language/.test(buildStyleBlock({ languageLevel: 'teacher' })), 'teacher not wired')
})

test('style block uses the "Lesson plan type" label, not "Level of detail"', () => {
  const b = buildStyleBlock({ detailLevel: 'simplified' })
  assert(/Lesson plan type:/.test(b), 'expected the "Lesson plan type" label')
  assert(!/Level of detail:/.test(b), 'stale "Level of detail" label still present')
})

test('style block defaults to Professional + Simplified', () => {
  const b = buildStyleBlock({})
  assert(/Language level: Professional/.test(b), `expected Professional default, got: ${b}`)
  assert(/Lesson plan type: Simplified/.test(b), 'expected Simplified default')
})

test('style block tolerates odd casing on the keys', () => {
  const b = buildStyleBlock({ languageLevel: 'TEACHER', detailLevel: 'Detailed' })
  assert(/Language level: Detailed Teacher Language/.test(b), 'uppercase key not normalised')
  assert(/Lesson plan type: Detailed/.test(b), 'uppercase detail key not normalised')
})

// ── buildDiagramBlock ─────────────────────────────────────────────────────────
test('diagram block fires for Mathematics when auto-diagrams on', () => {
  const b = buildDiagramBlock({ autoDiagrams: true, subject: 'Mathematics' })
  assert(b.length > 0, 'expected a diagram block for Mathematics')
  assert(/venn2/.test(b) && /numberline/.test(b), 'supported types not listed')
  assert(/"diagrams" array/.test(b), 'does not mention the diagrams array')
})

test('diagram block fires for combined Mathematics and Science', () => {
  const b = buildDiagramBlock({ autoDiagrams: true, subject: 'Mathematics and Science' })
  assert(b.length > 0, 'expected a diagram block for the combined ECE subject')
})

test('diagram block fires for Integrated Science', () => {
  const b = buildDiagramBlock({ autoDiagrams: true, subject: 'Integrated Science' })
  assert(b.length > 0, 'expected a diagram block for Integrated Science')
})

test('diagram block is empty for a non-science subject', () => {
  const b = buildDiagramBlock({ autoDiagrams: true, subject: 'English Language' })
  assert(b === '', `English must not request diagrams, got: ${b}`)
})

test('diagram block is empty when the toggle is off', () => {
  const b = buildDiagramBlock({ autoDiagrams: false, subject: 'Mathematics' })
  assert(b === '', 'toggle off must suppress the diagram block')
})

// ── stageDiagramsHtml ─────────────────────────────────────────────────────────
test('renders a diagram attached to a matching stage', () => {
  const html = stageDiagramsHtml('EXERCISE / ASSESSMENT', [
    { stage: 'EXERCISE / ASSESSMENT', type: 'venn2', params: { a: 'Animals', b: 'Plants' }, caption: 'Grouping things' },
  ])
  assert(/diagram-wrap/.test(html), 'no diagram-wrap emitted')
  assert(/data-a="Animals"/.test(html), 'params not passed to renderer')
  assert(/Grouping things/.test(html), 'caption not rendered')
})

test('matches a stage even when it carries an "Activity n" suffix', () => {
  const html = stageDiagramsHtml('LESSON DEVELOPMENT — Activity 1: Sets', [
    { stage: 'LESSON DEVELOPMENT', type: 'venn2', params: {} },
  ])
  assert(/diagram-wrap/.test(html), 'activity-suffixed stage did not match')
})

test('stage matching is case/separator tolerant', () => {
  const html = stageDiagramsHtml('EXERCISE / ASSESSMENT', [
    { stage: 'exercise', type: 'venn2', params: {} },
  ])
  assert(/diagram-wrap/.test(html), 'lowercase partial stage did not match')
})

test('does not render a spec aimed at a different stage', () => {
  const html = stageDiagramsHtml('HOMEWORK', [
    { stage: 'INTRODUCTION', type: 'venn2', params: {} },
  ])
  assert(html === '', `expected no output for a non-matching stage, got: ${html}`)
})

test('coerces array params to comma-separated strings', () => {
  const html = stageDiagramsHtml('LESSON DEVELOPMENT', [
    { stage: 'LESSON DEVELOPMENT', type: 'barchart', params: { values: [1, 2, 3] } },
  ])
  assert(/data-values="1,2,3"/.test(html), 'array params not joined with commas')
})

test('skips unknown diagram types', () => {
  const html = stageDiagramsHtml('LESSON DEVELOPMENT', [
    { stage: 'LESSON DEVELOPMENT', type: 'definitely-not-a-real-type', params: {} },
  ])
  assert(html === '', 'unknown type should produce no output')
})

test('returns empty for non-array / empty specs', () => {
  assert(stageDiagramsHtml('LESSON DEVELOPMENT', null) === '', 'null specs should be empty')
  assert(stageDiagramsHtml('LESSON DEVELOPMENT', []) === '', 'empty specs should be empty')
  assert(stageDiagramsHtml('LESSON DEVELOPMENT', undefined) === '', 'undefined specs should be empty')
})

console.log(`\n${pass} passed, ${fail} failed`)
if (fail > 0) {
  for (const f of failures) console.log(`  - ${f.name}: ${f.message}`)
  process.exit(1)
}
