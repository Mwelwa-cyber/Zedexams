/**
 * Tests for the fixture contract and the render guards (§4.6).
 *
 * Two failure modes are covered, and both are quiet ones — which is why they
 * need tests rather than review:
 *
 *  1. A fixture whose purpose has been deleted from its data. A paper with no
 *     long division in it renders perfectly consistently, so the long-division
 *     fixture goes green while watching nothing at all.
 *
 *  2. A renderer that exits 0 having produced partial output. Partial output also
 *     compares consistently — the same missing page every run — so the suite
 *     goes green, or a reviewer accepts the diff and a baseline of a broken paper
 *     becomes the reference.
 *
 * Run: node scripts/visual/fixtures.test.js
 */

import assert from 'node:assert/strict'
import {
  VISUAL_FIXTURES, RENDER_TARGETS, fixtureById, validateFixture, validateAllFixtures,
} from './fixtures.js'
import {
  RenderIncompleteError, assertRenderComplete, assertBaselineExists,
  isInfrastructureFailure, MIN_PDF_BYTES,
} from './renderGuards.js'
import { RenderEnvironmentError } from './renderEnvironment.js'

/**
 * Clone a fixture for mutation, keeping its `requires` predicates.
 *
 * structuredClone cannot clone functions, and the predicates are the whole point
 * of these tests — a clone that dropped them would test the contract without the
 * self-validation it exists for.
 */
function cloneFixture(fixture) {
  const { requires, ...data } = fixture
  return { ...structuredClone(data), requires }
}

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

/* ── the set as shipped ─────────────────────────────────────────────────── */

console.log('\n— the eight fixtures —')

test('all eight are present and every one validates', () => {
  assert.equal(VISUAL_FIXTURES.length, 8)
  assert.deepEqual(validateAllFixtures(), {})
})

test('IDs are permanent and unique, and lookups use them', () => {
  // Baselines and update commands key on the ID, so a fixture can be retitled
  // without orphaning its baselines.
  const ids = VISUAL_FIXTURES.map((f) => f.id)
  assert.deepEqual(ids, ['vr-001', 'vr-002', 'vr-003', 'vr-004', 'vr-005', 'vr-006', 'vr-007', 'vr-008'])
  assert.equal(new Set(ids).size, 8)
  assert.equal(fixtureById('vr-003').title, 'Vertical arithmetic')
  assert.equal(fixtureById('nope'), null)
})

test('the set covers everything the owner listed', () => {
  const protects = VISUAL_FIXTURES.flatMap((f) => f.protects).join(' | ').toLowerCase()
  for (const feature of [
    'fraction', 'mixed number', 'division bracket', 'remainder',
    'carrying', 'regrouping', 'decimal', 'partial product',
    'leader line', 'arrowhead', 'small diagram label',
    'axis label', 'plotted point', 'angle mark',
    'section boundar', 'answer space', 'page numbering',
    'logo', 'grayscale', 'enlarged svg',
  ]) {
    assert.ok(protects.includes(feature), `something protects "${feature}"`)
  }
})

test('one fixture carries the learner paper AND the marking scheme', () => {
  const both = VISUAL_FIXTURES.filter((f) => f.renderBothModes)
  assert.ok(both.length >= 1, 'at least one renders both copies')
  // …and asserts identity across them, which is the reason to render both.
  assert.ok(
    both.some((f) => (f.together || []).some(([a, b]) => /^answer_/.test(a) && /^question_/.test(b))),
    'an answer is tied to its question',
  )
})

test('every fixture declares a rendering target we can actually drive', () => {
  for (const f of VISUAL_FIXTURES) {
    assert.ok(f.targets.length > 0, f.id)
    for (const t of f.targets) assert.ok(RENDER_TARGETS.includes(t), `${f.id}: ${t}`)
  }
})

test('exactly one fixture is grayscale, and it is the photocopy one', () => {
  const grey = VISUAL_FIXTURES.filter((f) => f.grayscale)
  assert.equal(grey.length, 1)
  assert.equal(grey[0].id, 'vr-008')
  assert.equal(grey[0].requiresGrayscaleLegibility, true)
})

test('the multi-page fixture really expects more than one page', () => {
  const multi = fixtureById('vr-006')
  assert.ok(multi.expectedPageCount > 1)
  assert.ok(Object.keys(multi.expectedAnchorPages).length >= 2, 'with declared page membership')
})

/* ── a fixture that stopped testing anything ────────────────────────────── */

console.log('\n— a fixture whose purpose was deleted —')

test('removing the long-division block FAILS validation', () => {
  // THE case this contract exists for. A paper with no long division renders
  // just as consistently as one with it, so without this the fixture would stay
  // green while watching nothing.
  const broken = cloneFixture(fixtureById('vr-002'))
  broken.questions = broken.questions.map((q) => ({ ...q, richContent: '<p>Divide 852 by 4.</p>' }))
  const problems = validateFixture(broken)
  assert.ok(problems.length > 0, 'it fails')
  assert.ok(
    problems.some((p) => /division layout/.test(p)),
    `and says which purpose went missing: ${problems.join('; ')}`,
  )
  assert.ok(problems.some((p) => /would render consistently while testing nothing/.test(p)))
})

test('removing the fractions FAILS the fractions fixture', () => {
  const broken = cloneFixture(fixtureById('vr-001'))
  broken.questions = broken.questions.map((q) => ({ ...q, text: '<p>Simplify 6/8.</p>' }))
  assert.ok(validateFixture(broken).some((p) => /stacked fraction/.test(p)))
})

test('removing the logo FAILS the branded-header fixture', () => {
  const broken = cloneFixture(fixtureById('vr-007'))
  delete broken.assessment.schoolLogoUrl
  assert.ok(validateFixture(broken).some((p) => /logo/.test(p)))
})

test('removing the enlarged figure FAILS the vector fixture', () => {
  const broken = cloneFixture(fixtureById('vr-008'))
  broken.questions[0].imageWidth = 'small'
  assert.ok(validateFixture(broken).some((p) => /enlarged vector figure/.test(p)))
})

test('a fixture that reaches the network FAILS', () => {
  // Offline is a correctness requirement: a fetched asset can fail and still
  // produce a perfectly consistent baseline of a paper missing its figure.
  const broken = cloneFixture(fixtureById('vr-007'))
  broken.assessment.schoolLogoUrl = 'https://example.test/logo.png'
  const problems = validateFixture(broken)
  assert.ok(problems.some((p) => /reaches the network/.test(p)), problems.join('; '))
  assert.ok(problems.some((p) => /LOCAL logo/.test(p)))
})

test('a fixture without a fixed date FAILS', () => {
  // A paper printing today's date would need a new baseline every day.
  const broken = cloneFixture(fixtureById('vr-001'))
  broken.assessment.date = ''
  assert.ok(validateFixture(broken).some((p) => /fixed literal date/.test(p)))
})

test('the contract requires each declaration, not just the data', () => {
  const base = fixtureById('vr-001')
  const cases = {
    'permanent vr-NNN': { id: 'fractions' },
    'no expected page count': { expectedPageCount: 0 },
    'trailing blank page': { forbidTrailingBlankPage: undefined },
    'grayscale mode': { grayscale: undefined },
    'no printed feature': { protects: [] },
    'no rendering target': { targets: [] },
  }
  for (const [expected, override] of Object.entries(cases)) {
    const problems = validateFixture({ ...cloneFixture(base), ...override })
    assert.ok(
      problems.some((p) => p.includes(expected.split(' ').slice(-2).join(' '))
        || p.toLowerCase().includes(expected.toLowerCase())),
      `${expected}: got ${problems.join('; ')}`,
    )
  }
})

test('a duplicate ID is caught across the set', () => {
  const dup = [fixtureById('vr-001'), { ...cloneFixture(fixtureById('vr-002')), id: 'vr-001' }]
  const problems = validateAllFixtures(dup)
  assert.ok(Object.values(problems).flat().some((p) => /duplicate fixture id/.test(p)))
})

/* ── exit code 0 is not proof of a render ───────────────────────────────── */

console.log('\n— a renderer that lied about succeeding —')

const goodRender = (over = {}) => ({
  fixtureId: 'vr-006',
  stage: 'docx',
  exitCode: 0,
  stderr: '',
  documentBytes: 40000,
  declaredPageCount: 3,
  pages: [
    { pageNumber: 1, bytes: 9000, width: 1240, height: 1754 },
    { pageNumber: 2, bytes: 9000, width: 1240, height: 1754 },
    { pageNumber: 3, bytes: 9000, width: 1240, height: 1754 },
  ],
  anchors: [{ id: 'question_1', page: 1 }, { id: 'question_8', page: 2 }, { id: 'question_14', page: 3 }],
  assetFailures: [],
  ...over,
})

const expectations = {
  pageWidthPx: 1240,
  pageHeightPx: 1754,
  requiresAnchors: true,
  expectedAnchorPages: { question_1: 1, question_8: 2, question_14: 3 },
}

test('a complete render passes', () => {
  assert.equal(assertRenderComplete(goodRender(), expectations), true)
})

test('a DOCX claiming five pages with four rendered FAILS', () => {
  assert.throws(
    () => assertRenderComplete(goodRender({ declaredPageCount: 5 }), expectations),
    (err) => err instanceof RenderIncompleteError
      && /says it has 5 pages but 3 were rendered/.test(err.message)
      && /incomplete, not different/.test(err.message),
  )
})

test('a zero-byte PDF FAILS even at exit 0', () => {
  assert.throws(
    () => assertRenderComplete(goodRender({ documentBytes: 0 }), expectations),
    (err) => /produced no document/.test(err.message),
  )
  assert.throws(
    () => assertRenderComplete(goodRender({ documentBytes: MIN_PDF_BYTES - 1 }), expectations),
    (err) => /empty in practice/.test(err.message),
  )
})

test('a PDF missing its final page FAILS', () => {
  const short = goodRender()
  short.pages = short.pages.slice(0, 2)
  assert.throws(() => assertRenderComplete(short, expectations), RenderIncompleteError)
})

test('anchor extraction returning nothing FAILS', () => {
  // Without anchors every structural pagination check silently has nothing to
  // compare, which is indistinguishable from passing.
  assert.throws(
    () => assertRenderComplete(goodRender({ anchors: [] }), expectations),
    (err) => /silently have nothing to compare/.test(err.message),
  )
})

test('a missing EXPECTED anchor FAILS even when others were found', () => {
  const partial = goodRender({ anchors: [{ id: 'question_1', page: 1 }] })
  assert.throws(
    () => assertRenderComplete(partial, expectations),
    (err) => /expects anchor question_8/.test(err.message),
  )
})

test('an asset that failed to load FAILS, though rendering completed', () => {
  // The quietest of the lot: the paper renders around the gap and looks fine.
  assert.throws(
    () => assertRenderComplete(goodRender({ assetFailures: ['school-logo.png'] }), expectations),
    (err) => /rendered around the gap/.test(err.message),
  )
})

test('an unexpected page size is REFUSED, not resized', () => {
  const wrong = goodRender()
  wrong.pages[1] = { pageNumber: 2, bytes: 9000, width: 1240, height: 1800 }
  assert.throws(
    () => assertRenderComplete(wrong, expectations),
    (err) => /refusing to resize/.test(err.message)
      && /may be the regression itself/.test(err.message),
  )
})

test('duplicate or non-contiguous page numbers FAIL', () => {
  const dup = goodRender()
  dup.pages[2] = { ...dup.pages[2], pageNumber: 2 }
  assert.throws(() => assertRenderComplete(dup, expectations), (e) => /same page number/.test(e.message))

  const gap = goodRender()
  gap.pages[2] = { ...gap.pages[2], pageNumber: 4 }
  assert.throws(() => assertRenderComplete(gap, expectations), (e) => /not 1\.\.3/.test(e.message))
})

test('a blank individual page FAILS', () => {
  const blank = goodRender()
  blank.pages[1] = { ...blank.pages[1], bytes: 10 }
  assert.throws(() => assertRenderComplete(blank, expectations), (e) => /which is blank/.test(e.message))
})

test('stderr is preserved on the error for the report', () => {
  try {
    assertRenderComplete(goodRender({ documentBytes: 0, stderr: 'soffice: I/O warning' }), expectations)
    assert.fail('should have thrown')
  } catch (err) {
    assert.equal(err.detail.stderr, 'soffice: I/O warning')
    assert.equal(err.detail.fixtureId, 'vr-006')
    assert.equal(err.detail.stage, 'docx')
  }
})

test('a non-zero exit still fails, but it is the weakest of the checks', () => {
  assert.throws(() => assertRenderComplete(goodRender({ exitCode: 1 }), expectations), RenderIncompleteError)
  // The point of the module: everything above passes exitCode 0 and still fails.
})

/* ── a comparison run never creates a baseline ──────────────────────────── */

console.log('\n— a missing baseline is not a licence to write one —')

test('a missing baseline FAILS rather than being created', () => {
  // The most damaging convenience a visual suite can have. Writing a baseline on
  // first sight converts "nobody has reviewed this" into "this is correct" —
  // exactly when a fixture is new or renamed and a human should be looking.
  assert.throws(
    () => assertBaselineExists('vr-004', 'docx', false),
    (err) => err instanceof RenderIncompleteError
      && /never creates one/.test(err.message)
      && /approved by a person/.test(err.message),
  )
})

test('an existing baseline is fine, and the reviewed workflow may create', () => {
  assert.equal(assertBaselineExists('vr-004', 'docx', true), true)
  assert.equal(assertBaselineExists('vr-004', 'docx', false, { allowCreate: true }), false)
})

test('every guard failure is classified as infrastructure, not a visual finding', () => {
  // So a reviewer never responds to one by updating a baseline.
  assert.equal(isInfrastructureFailure(new RenderIncompleteError('x')), true)
  assert.equal(isInfrastructureFailure(new RenderEnvironmentError('x')), true)
  assert.equal(isInfrastructureFailure(new Error('x')), false)
})

console.log(`\n✓ visual fixtures and render guards — ${passed} tests passed`)
