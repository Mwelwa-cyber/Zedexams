/**
 * The gate's own tests (§4.6 slice B).
 *
 * Slice A proved the comparison model. This proves CI cannot bypass or silently
 * rewrite it — which is a different kind of claim, so it is tested two ways:
 *
 *  - the RULES by calling them (gateCore.js);
 *  - the CI CONFIGURATION by parsing the workflow YAML.
 *
 * Neither half proves the other. A perfect rule set is worthless if the workflow
 * grants a fork write access, and a perfectly locked workflow is worthless if
 * the update logic rewrites every baseline.
 *
 * Run: node scripts/visual/gate.test.js
 */

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import yaml from 'js-yaml'
import {
  GATE_MODES, RENDERER_FAMILIES, REQUIRED_ARTEFACTS, FAILURE_ARTEFACTS,
  mayWriteBaseline, validateUpdateRequest, baselineWriteFilter, planBaselineUpdate,
  gateVerdict, summariseGateVerdict, requiredArtefacts, shouldProceedToComparison,
} from './gateCore.js'
import { VISUAL_FIXTURES } from './fixtures.js'

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

const wf = (name) => yaml.load(readFileSync(new URL(`../../.github/workflows/${name}`, import.meta.url), 'utf8'))
const compareWorkflow = wf('visual-regression.yml')
const updateWorkflow = wf('visual-baseline-update.yml')
const FIXTURE_IDS = VISUAL_FIXTURES.map((f) => f.id)

/* ── 1. a changed fixture fails, with artefacts ─────────────────────────── */

console.log('\n— 1. a changed fixture fails —')

test('a page-level difference produces a non-zero verdict', () => {
  const verdict = gateVerdict({
    fixtureId: 'vr-001',
    family: 'docx',
    pageComparisons: [
      { pageNumber: 1, comparison: { changed: true, reasons: ['9 connected ink pixels changed together'] } },
    ],
  })
  assert.equal(verdict.failed, true)
  assert.equal(verdict.visual.length, 1)
  assert.match(summariseGateVerdict(verdict), /^FAILED {2}vr-001 \[docx\]/)
})

test('the expected diff artefacts are demanded, including the UNCHANGED pages', () => {
  // Publishing only the changed pages makes a pagination move un-diagnosable:
  // the explanation is on the pages either side.
  const required = requiredArtefacts()
  for (const a of ['document', 'pages', 'baseline-pages', 'diff', 'summary-json', 'summary-txt']) {
    assert.ok(required.includes(a), `${a} is required`)
  }
  assert.ok(REQUIRED_ARTEFACTS.includes('anchors'), 'the anchor manifest too')
  assert.ok(REQUIRED_ARTEFACTS.includes('page-count'), 'and the recorded page count')
})

test('a generation failure additionally demands stderr and the command', () => {
  const required = requiredArtefacts({ generationFailed: true })
  for (const a of FAILURE_ARTEFACTS) assert.ok(required.includes(a), a)
  // …and a page image is not useful evidence when generation is what broke.
  assert.ok(!requiredArtefacts().includes('stderr'))
})

test('artefacts are uploaded even when the comparison fails', () => {
  const step = compareWorkflow.jobs.compare.steps.find((s) => /upload/i.test(s.name || ''))
  assert.ok(step, 'there is an upload step')
  assert.equal(step.if, 'always()', 'it runs on failure as well as success')
})

/* ── 2. the force input runs the same job ───────────────────────────────── */

console.log('\n— 2. the manual force input —')

test('workflow_dispatch exposes a force input', () => {
  const inputs = compareWorkflow.on.workflow_dispatch?.inputs || {}
  assert.ok(inputs.force, 'the input exists')
  assert.equal(inputs.force.default, true, 'and defaults to running the suite')
})

test('force runs the IDENTICAL job, not a reduced one', () => {
  // The trap: a second, lighter code path for manual runs. Then the thing a
  // reviewer forces is not the thing that gates the merge.
  const jobs = Object.keys(compareWorkflow.jobs)
  assert.deepEqual(jobs, ['compare'], 'there is exactly one job to run')
  const steps = compareWorkflow.jobs.compare.steps
  // No step is conditional on the trigger or on the force input, so a dispatched
  // run executes precisely what a path-triggered run executes.
  for (const step of steps) {
    const cond = String(step.if || '')
    assert.ok(
      !/inputs\.force|github\.event_name/.test(cond),
      `no step branches on the trigger: ${step.name || step.run}`,
    )
  }
  const compareStep = steps.find((s) => /runVisualGate/.test(s.run || ''))
  assert.ok(compareStep, 'the comparison runs through the shared entry point')
  assert.match(compareStep.run, /--mode=compare/)
})

test('editing the gate triggers the gate', () => {
  // Otherwise a pull request could widen a tolerance, drop a fixture or remove a
  // path WITHOUT running the tests that prove the gate is still safe.
  const paths = compareWorkflow.on.pull_request.paths
  assert.ok(paths.includes('.github/workflows/visual-regression.yml'), 'its own workflow')
  assert.ok(paths.includes('.github/workflows/visual-baseline-update.yml'), 'the update workflow')
  assert.ok(paths.includes('scripts/visual/**'), 'the comparison modules and fixtures')
  assert.ok(paths.some((p) => /baselines/.test(p)), 'the baseline metadata')
})

test('the path filter covers every rendering dependency the owner listed', () => {
  const paths = compareWorkflow.on.pull_request.paths.join('\n')
  const required = {
    'assessment renderers': /assessmentToDocx|assessmentPaperLayout/,
    'DOCX generation': /assessmentToDocx/,
    'PDF and print exporters': /assessmentToPdf|htmlToPdf/,
    'paper templates': /PaperBlocks|AssessmentPaperView/,
    'mathematical typesetting': /latexToUnicode|MathFraction|VerticalArithmetic/,
    'diagram code': /components\/diagrams/,
    'print CSS': /print.*css|assessmentStudio\.css/,
    'fonts and print assets': /fonts|assets\/print/,
    'terminology that changes printed output': /paperTerminology/,
    'fixture data': /scripts\/visual/,
  }
  for (const [what, pattern] of Object.entries(required)) {
    assert.ok(pattern.test(paths), `the filter covers ${what}`)
  }
})

/* ── 3. a page-count change fails independently of pixels ───────────────── */

console.log('\n— 3. structural failure survives any tolerance —')

test('a page-count change fails with pixel comparison DISABLED', () => {
  // The owner's point, as an assertion: a small pixel difference can hide a
  // serious pagination regression, so a permissive tolerance must not approve it.
  const verdict = gateVerdict({
    fixtureId: 'vr-006',
    family: 'browser-print',
    pixelTolerance: 'ignore',
    pageComparisons: [{ pageNumber: 1, comparison: { changed: true, reasons: ['ignored'] } }],
    pagination: {
      changed: true,
      pageCountChanged: true,
      findings: [{ kind: 'page_count', message: 'the paper is now 4 pages instead of 3' }],
    },
  })
  assert.equal(verdict.failed, true, 'it still fails')
  assert.equal(verdict.structurallyFailed, true)
  assert.equal(verdict.visual.length, 0, 'with the pixel findings genuinely suppressed')
  assert.equal(verdict.pageCountChanged, true, 'and page count flagged on its own')
})

test('the page count is surfaced separately in the summary', () => {
  const summary = summariseGateVerdict(gateVerdict({
    fixtureId: 'vr-006',
    family: 'docx',
    pagination: {
      changed: true,
      pageCountChanged: true,
      findings: [{ kind: 'page_count', message: 'the paper is now 4 pages instead of 3' }],
    },
  }))
  assert.match(summary, /PAGE COUNT CHANGED/)
  assert.match(summary, /can hide a serious pagination regression/)
})

test('a separated diagram fails structurally too, with tolerance ignored', () => {
  const verdict = gateVerdict({
    fixtureId: 'vr-004',
    family: 'docx',
    pixelTolerance: 'ignore',
    pagination: {
      changed: true,
      pageCountChanged: false,
      findings: [{ kind: 'separated', message: 'diagram_4 separated from question_4' }],
    },
  })
  assert.equal(verdict.structurallyFailed, true)
  assert.match(summariseGateVerdict(verdict), /structural \(separated\)/)
})

test('generation failure stops the run before comparison', () => {
  // Comparing partial output yields a diff that looks like a rendering change
  // and is actually a broken render — and accepting it commits a baseline of a
  // broken paper.
  assert.equal(shouldProceedToComparison({ generationFailed: true }), false)
  assert.equal(shouldProceedToComparison({}), true)
})

/* ── 4. a missing baseline fails and creates nothing ────────────────────── */

console.log('\n— 4. a missing baseline —')

test('a comparison run may never write a baseline, even a missing one', () => {
  // The moment writing is most tempting and most damaging: a new or renamed
  // fixture, which is exactly when a human should be looking.
  assert.equal(mayWriteBaseline({ mode: 'compare' }), false)
  assert.equal(mayWriteBaseline({ mode: 'compare', event: 'workflow_dispatch' }), false)
  for (const mode of GATE_MODES.filter((m) => m !== 'update')) {
    assert.equal(mayWriteBaseline({ mode }), false, mode)
  }
})

test('the comparison workflow never invokes the update mode', () => {
  const runs = compareWorkflow.jobs.compare.steps.map((s) => String(s.run || '')).join('\n')
  assert.ok(/--mode=compare/.test(runs), 'it compares')
  assert.ok(!/--mode=update/.test(runs), 'and never updates')
})

/* ── 5. a normal PR cannot overwrite baselines ──────────────────────────── */

console.log('\n— 5. a pull request cannot write —')

test('the comparison workflow has read-only repository permissions', () => {
  assert.deepEqual(compareWorkflow.permissions, { contents: 'read' })
  assert.deepEqual(compareWorkflow.jobs.compare.permissions, { contents: 'read' })
})

test('a pull_request event can never reach the update path', () => {
  // Belt and braces with the permissions: a pull_request event may run code from
  // a fork, and a fork must not be able to rewrite what it is measured against.
  assert.equal(mayWriteBaseline({ mode: 'update', event: 'pull_request' }), false)
  assert.equal(mayWriteBaseline({ mode: 'update', event: 'pull_request_target' }), false)
  assert.equal(mayWriteBaseline({ mode: 'update', event: 'workflow_dispatch' }), true)
})

test('the two workflows are separate, and only one can write', () => {
  // The security boundary: the workflow that runs untrusted PR code holds no
  // credentials that could update a baseline or push a branch.
  assert.ok(!updateWorkflow.on.pull_request, 'the writer never triggers on a pull request')
  assert.deepEqual(Object.keys(updateWorkflow.on), ['workflow_dispatch'], 'manual only')
  assert.equal(updateWorkflow.jobs.update.permissions.contents, 'write')
  assert.equal(compareWorkflow.jobs.compare.permissions.contents, 'read')
})

test('the update never pushes to the protected default branch', () => {
  const runs = JSON.stringify(updateWorkflow.jobs.update.steps)
  assert.ok(/checkout -b/.test(runs), 'it works on a branch')
  assert.ok(/gh pr create/.test(runs), 'and opens a pull request for review')
  assert.ok(!/push origin main|push -u origin main/.test(runs), 'never straight to main')
})

/* ── 6. a reviewed update changes only one fixture ──────────────────────── */

console.log('\n— 6. one fixture, one family —')

const ALL_BASELINES = [
  'browser-print/vr-001/page-1.png', 'browser-print/vr-001/page-2.png',
  'browser-print/vr-003/page-1.png',
  'browser-print/vr-006/page-1.png', 'browser-print/vr-006/page-2.png',
  'docx/vr-001/page-1.png',
  'docx/vr-003/page-1.png', 'docx/vr-003/page-2.png',
  'docx/vr-006/page-1.png',
]

test('every unselected baseline is left untouched', () => {
  const { replaced, untouched } = planBaselineUpdate(
    ALL_BASELINES, { fixture: 'vr-003', family: 'docx' },
  )
  assert.deepEqual(replaced, ['docx/vr-003/page-1.png', 'docx/vr-003/page-2.png'])
  // Stated as the complement, because "only these were replaced" and "every
  // other one is identical" are different claims and the second is the one that
  // matters.
  assert.equal(untouched.length, ALL_BASELINES.length - 2)
  for (const p of untouched) assert.ok(!p.startsWith('docx/vr-003/'), p)
})

test('a browser update does NOT rewrite the DOCX baseline, or the reverse', () => {
  const browser = planBaselineUpdate(ALL_BASELINES, { fixture: 'vr-001', family: 'browser-print' })
  assert.ok(browser.replaced.every((p) => p.startsWith('browser-print/')))
  assert.ok(browser.untouched.includes('docx/vr-001/page-1.png'), 'the DOCX copy survives')

  const docx = planBaselineUpdate(ALL_BASELINES, { fixture: 'vr-001', family: 'docx' })
  assert.ok(docx.replaced.every((p) => p.startsWith('docx/')))
  assert.ok(docx.untouched.includes('browser-print/vr-001/page-1.png'))
})

test('a fixture ID cannot match a neighbour by prefix', () => {
  const allowed = baselineWriteFilter({ fixture: 'vr-00', family: 'docx' })
  assert.equal(allowed('docx/vr-001/page-1.png'), false, 'a partial ID matches nothing')
  const exact = baselineWriteFilter({ fixture: 'vr-001', family: 'docx' })
  assert.equal(exact('docx/vr-0011/page-1.png'), false, 'and vr-001 is not vr-0011')
  assert.equal(exact('docx/vr-001/page-1.png'), true)
})

test('an update request must carry a reason and a source', () => {
  const good = { fixture: 'vr-003', family: 'docx', reason: 'Fraction bars are now vector', source: '#1932' }
  assert.deepEqual(validateUpdateRequest(good, FIXTURE_IDS), [])

  const cases = {
    'no fixture ID': { ...good, fixture: '' },
    'not a fixture ID': { ...good, fixture: 'fractions' },
    'does not exist': { ...good, fixture: 'vr-999' },
    'no renderer family': { ...good, family: '' },
    'not a renderer family': { ...good, family: 'word' },
    'no reason': { ...good, reason: '' },
    'too short to be a reason': { ...good, reason: 'ok' },
    'no source': { ...good, source: '' },
  }
  for (const [expected, request] of Object.entries(cases)) {
    const problems = validateUpdateRequest(request, FIXTURE_IDS)
    assert.ok(
      problems.some((p) => p.includes(expected)),
      `${expected}: got ${problems.join('; ')}`,
    )
  }
})

test('the update workflow requires all four inputs', () => {
  const inputs = updateWorkflow.on.workflow_dispatch.inputs
  for (const name of ['fixture', 'family', 'reason', 'source']) {
    assert.ok(inputs[name], `${name} is an input`)
    assert.equal(inputs[name].required, true, `${name} is required`)
  }
  // The family is a choice, so a typo cannot silently target nothing.
  assert.deepEqual(inputs.family.options, RENDERER_FAMILIES)
})

test('the update validates the fixture and compares BEFORE replacing', () => {
  const steps = updateWorkflow.jobs.update.steps
  const order = steps.map((s) => String(s.name || ''))
  const validate = order.findIndex((n) => /Validate the fixture/.test(n))
  const record = order.findIndex((n) => /Record what is changing/.test(n))
  const replace = order.findIndex((n) => /Re-record the selected baseline/.test(n))
  assert.ok(validate >= 0 && record >= 0 && replace >= 0, 'all three steps exist')
  assert.ok(validate < replace, 'a fixture that no longer validates is not re-recorded')
  assert.ok(record < replace, 'and the audit records what changed before it changes')
})

test('the update passes the fixture and family through to the writer', () => {
  const step = updateWorkflow.jobs.update.steps.find((s) => /--mode=update/.test(s.run || ''))
  assert.ok(step, 'the update runs through the shared entry point')
  assert.match(step.run, /--fixture=/)
  assert.match(step.run, /--family=/)
  assert.match(step.run, /--reason=/)
  assert.match(step.run, /--source=/)
})

console.log(`\n✓ visual gate — ${passed} tests passed`)
