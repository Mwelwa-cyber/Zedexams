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
  GATE_MODES, RENDERER_FAMILIES, UPDATABLE_FAMILIES, REQUIRED_ARTEFACTS, FAILURE_ARTEFACTS,
  mayWriteBaseline, validateUpdateRequest, baselineWriteFilter, planBaselineUpdate,
  validateBootstrapRequest, planBaselineBootstrap,
  validateSweepUpdateRequest, assertBaselineDestination,
  gateVerdict, summariseGateVerdict, requiredArtefacts, shouldProceedToComparison,
} from './gateCore.js'
import { VISUAL_FIXTURES } from './fixtures.js'
import { PRINT_AFFECTING_PATHS } from './printAffectingPaths.js'

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
const bootstrapWorkflow = wf('visual-baseline-bootstrap.yml')
// Every workflow that can write a baseline. Asserted as a set rather than one at
// a time: the claim that matters is about ALL writers, so a third one added
// later is covered by these tests on the day it appears, not the day somebody
// remembers to extend them.
const WRITERS = { 'visual-baseline-update.yml': updateWorkflow, 'visual-baseline-bootstrap.yml': bootstrapWorkflow }
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
  const step = compareWorkflow.jobs.visual.steps.find((s) => /upload/i.test(s.name || ''))
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

test('force runs the IDENTICAL comparison, not a reduced one', () => {
  // The trap: a second, lighter code path for manual runs. Then the thing a
  // reviewer forces is not the thing that gates the merge.
  //
  // There are three jobs now (scope → visual → gate) because the gate has to
  // report on EVERY pull request to be requirable, but only ONE of them
  // renders, and `force` reaches it the same way a path-affecting change does:
  // through the scope job's `requires_visual` output. No step inside the
  // rendering job branches on the trigger.
  const steps = compareWorkflow.jobs.visual.steps
  for (const step of steps) {
    const cond = String(step.if || '')
    assert.ok(
      !/inputs\.force|github\.event_name/.test(cond),
      `no rendering step branches on the trigger: ${step.name || step.run}`,
    )
  }
  const compareStep = steps.find((s) => /runVisualGate/.test(s.run || ''))
  assert.ok(compareStep, 'the comparison runs through the shared entry point')
  assert.match(compareStep.run, /--mode=compare/)
  // Force is honoured in exactly one place, and it is the scope decision.
  const scopeStep = compareWorkflow.jobs.scope.steps.find((st) => /resolveGateScope/.test(st.run || ''))
  assert.ok(scopeStep, 'the scope job resolves through the shared resolver')
  assert.match(JSON.stringify(scopeStep.env || {}), /inputs\.force/)
})

test('the gate reports on every pull request, under one stable name', () => {
  // The property that makes it requirable at all. A `paths:` filter would leave
  // the check MISSING on an unrelated pull request, and branch protection holds
  // a pull request open forever waiting for a result that never arrives.
  assert.ok(!compareWorkflow.on.pull_request.paths,
    'the workflow must start on every pull request, not on a path filter')
  assert.equal(compareWorkflow.jobs.gate.name, 'Visual regression gate',
    'the required check name is stable')
  assert.equal(compareWorkflow.jobs.gate.if, 'always()',
    'the gate reports whatever the other jobs did')
  // Both render families report through this one check. A second required
  // check would need a second branch-protection entry with the same wedging
  // risk, and the question a pull request needs answered is one question.
  assert.deepEqual(compareWorkflow.jobs.gate.needs, ['scope', 'visual', 'screen'])
  // And the expensive jobs are NOT the ones to require: they legitimately skip.
  assert.equal(compareWorkflow.jobs.visual.if, "needs.scope.outputs.requires_visual == 'true'")
  assert.equal(compareWorkflow.jobs.screen.if, "needs.scope.outputs.requires_screen == 'true'")
  // Neither expensive job may acquire a path filter of its own either: the gate
  // reads their results, so a filtered job is an absence the gate must judge
  // rather than a job that quietly did not matter.
  for (const job of ['visual', 'screen']) {
    assert.ok(!compareWorkflow.jobs[job].paths, `${job} must not filter by path`)
  }
})

test('the screen job asserts only the tools it actually needs', () => {
  // It renders in Chromium and does not install LibreOffice. Asserting the
  // paper toolchain there fails a job that has everything it needs — which is
  // what happened on this job's first run, reporting "LibreOffice not
  // available" for a render that never wanted it.
  const steps = compareWorkflow.jobs.screen.steps
  const env = steps.find((st) => /reportEnvironment/.test(st.run || ''))
  assert.ok(env, 'the screen job records its rendering environment')
  assert.match(env.run, /--stages=screen/,
    'the screen job must assert the SCREEN toolchain, not the paper one')
  assert.ok(!steps.some((st) => /libreoffice|soffice/i.test(st.run || '')),
    'the screen family renders in Chromium only — installing LibreOffice here buys nothing '
    + 'and asserting it fails the job')
})

test('the gate\u2019s verdict is a tested module, not an untestable expression', () => {
  // Every way this can be wrong is silent — passing on a cancelled render, on a
  // skip it should have refused, or when scope resolution failed and nothing
  // ran. A GitHub `if:` expression cannot be tested.
  const decide = compareWorkflow.jobs.gate.steps.find((st) => /gateVerdict/.test(st.run || ''))
  assert.ok(decide, 'the gate decides through gateVerdict.js')
  for (const key of ['SCOPE_RESULT', 'VISUAL_RESULT', 'REQUIRES_VISUAL',
    'SCREEN_RESULT', 'REQUIRES_SCREEN']) {
    assert.ok(key in (decide.env || {}), `the verdict is given ${key}`)
  }
})

test('editing the gate triggers the gate', () => {
  // Otherwise a pull request could widen a tolerance, drop a fixture or remove a
  // path WITHOUT running the tests that prove the gate is still safe. The list
  // moved out of the YAML into a module so it could be tested; the property it
  // has to keep is unchanged.
  assert.ok(PRINT_AFFECTING_PATHS.includes('.github/workflows/visual-regression.yml'), 'its own workflow')
  assert.ok(PRINT_AFFECTING_PATHS.includes('.github/workflows/visual-baseline-update.yml'), 'the update workflow')
  assert.ok(PRINT_AFFECTING_PATHS.includes('scripts/visual/**'), 'the comparison modules and fixtures')
  assert.ok(PRINT_AFFECTING_PATHS.some((p) => /baselines/.test(p)), 'the baseline metadata')
})

test('the path list covers every rendering dependency the owner listed', () => {
  const paths = PRINT_AFFECTING_PATHS.join('\n')
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
  const runs = compareWorkflow.jobs.visual.steps.map((s) => String(s.run || '')).join('\n')
  assert.ok(/--mode=compare/.test(runs), 'it compares')
  assert.ok(!/--mode=update/.test(runs), 'and never updates')
})

/* ── 5. a normal PR cannot overwrite baselines ──────────────────────────── */

console.log('\n— 5. a pull request cannot write —')

test('the comparison workflow has read-only repository permissions', () => {
  assert.deepEqual(compareWorkflow.permissions, { contents: 'read' })
  for (const job of ['scope', 'visual', 'gate']) {
    assert.deepEqual(compareWorkflow.jobs[job].permissions, { contents: 'read' }, job)
  }
})

test('a pull_request event can never reach the update path', () => {
  // Belt and braces with the permissions: a pull_request event may run code from
  // a fork, and a fork must not be able to rewrite what it is measured against.
  assert.equal(mayWriteBaseline({ mode: 'update', event: 'pull_request' }), false)
  assert.equal(mayWriteBaseline({ mode: 'update', event: 'pull_request_target' }), false)
  assert.equal(mayWriteBaseline({ mode: 'update', event: 'workflow_dispatch' }), true)
})

test('the writers are separate from the comparison, and it can never write', () => {
  // The security boundary: the workflow that runs untrusted PR code holds no
  // credentials that could write a baseline or push a branch.
  assert.equal(compareWorkflow.jobs.visual.permissions.contents, 'read')
  for (const [name, workflow] of Object.entries(WRITERS)) {
    assert.ok(!workflow.on.pull_request, `${name} never triggers on a pull request`)
    assert.deepEqual(Object.keys(workflow.on), ['workflow_dispatch'], `${name} is manual only`)
    // Found by what it DOES, not by position. The bootstrap now has three jobs
    // and the writing one is last; anchoring on `jobs[0]` silently moved this
    // assertion onto a job that holds no credentials, which is the shape of a
    // security test that passes while checking nothing.
    const writers = Object.entries(workflow.jobs)
      .filter(([, job]) => job.permissions?.contents === 'write')
    assert.equal(writers.length, 1, `${name} grants write to EXACTLY one job`)
    const [writerName, writer] = writers[0]
    assert.ok(
      (writer.steps || []).some((st) => /gh pr create/.test(st.run || '')),
      `${name}: the job that can write (${writerName}) is the one that opens the pull request`,
    )
    // Every OTHER job — including the recorders, which run render code — is
    // read-only. They render and upload; they never touch the repository.
    for (const [other, job] of Object.entries(workflow.jobs)) {
      if (other === writerName) continue
      assert.equal(job.permissions?.contents, 'read',
        `${name}: ${other} renders but must not be able to write`)
    }
    // Scoped to the job: the workflow-level default stays read, so a step added
    // outside that job cannot inherit the ability to write.
    assert.deepEqual(workflow.permissions, { contents: 'read' }, `${name} defaults to read`)
  }
})

test('no writer pushes to the protected default branch', () => {
  for (const [name, workflow] of Object.entries(WRITERS)) {
    // The job that pushes, wherever it sits in the file.
    const pusher = Object.values(workflow.jobs)
      .find((job) => (job.steps || []).some((st) => /git push/.test(st.run || '')))
    assert.ok(pusher, `${name} has a job that pushes`)
    const runs = JSON.stringify(pusher.steps)
    assert.ok(/checkout -b/.test(runs), `${name} works on a branch`)
    assert.ok(/gh pr create/.test(runs), `${name} opens a pull request for review`)
    assert.ok(/--draft/.test(runs), `${name} opens it as a draft`)
    assert.ok(!/push origin main|push -u origin main/.test(runs), `${name} never goes straight to main`)
  }
})

test('the writers cannot run at the same time', () => {
  // Both commit to tests/visual/baselines. Concurrent runs would each branch
  // from a tree the other was changing, and the loser's pull request would
  // quietly drop the winner's pages.
  const groups = Object.values(WRITERS).map((w) => w.concurrency?.group)
  assert.ok(groups.every(Boolean), 'every writer declares a concurrency group')
  assert.equal(new Set(groups).size, 1, 'and they all share one, so the writes serialise')
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

test('the update workflow always requires a reason and a source', () => {
  const inputs = updateWorkflow.on.workflow_dispatch.inputs
  for (const name of ['scope', 'reason', 'source']) {
    assert.ok(inputs[name], `${name} is an input`)
    assert.equal(inputs[name].required, true, `${name} is required`)
  }
  // The family is a choice, so a typo cannot silently target nothing. The empty
  // option is the sweep's "every family" and is only reachable there — the
  // validator below refuses it for a one-baseline update.
  // The UPDATABLE subset, not every family. Replacing goes through the sweep
  // path, which is not routed to the screen runner — an option reaching an
  // unrouted path would silently record nothing while reporting success.
  assert.deepEqual(inputs.family.options, ['', ...UPDATABLE_FAMILIES])
})

test('fixture and family are optional to the WORKFLOW and required by the RECORDER', () => {
  // They stopped being `required: true` in the YAML when the sweep arrived,
  // because a sweep legitimately names neither. The guarantee they carried —
  // a one-baseline update cannot silently target nothing — did not move to
  // trust, it moved to validateUpdateRequest, which is the thing that actually
  // decides. This test is what says those two facts belong together.
  const inputs = updateWorkflow.on.workflow_dispatch.inputs
  assert.notEqual(inputs.fixture.required, true, 'a sweep names no fixture')
  assert.notEqual(inputs.family.required, true, 'a sweep names no family')

  const noFixture = validateUpdateRequest(
    { family: 'docx', reason: 'a stated reason that is long enough', source: '1995' },
    FIXTURE_IDS,
  )
  assert.ok(noFixture.some((p) => p.includes('no fixture ID given')))
  const noFamily = validateUpdateRequest(
    { fixture: 'vr-003', reason: 'a stated reason that is long enough', source: '1995' },
    FIXTURE_IDS,
  )
  assert.ok(noFamily.some((p) => p.includes('no renderer family given')))
})

test('a sweep commits to the branch; a one-baseline update opens its own PR', () => {
  const steps = updateWorkflow.jobs.update.steps
  const commit = steps.find((st) => /Commit the baselines to this pull request/.test(String(st.name || '')))
  const openPr = steps.find((st) => /Open a pull request/.test(String(st.name || '')))
  assert.ok(commit, 'the sweep has a commit step')
  assert.ok(openPr, 'the one-baseline path still opens a pull request')
  // Mutually exclusive, so a run can never both push to the branch AND open a
  // second pull request carrying the same baselines.
  assert.match(String(commit.if), /every-moved-baseline/)
  assert.match(String(openPr.if), /!=\s*'every-moved-baseline'/)
  // The push names the dispatched branch and refuses the default one. Checked
  // as text because the step is shell, and this is the guarantee that keeps a
  // baseline out of main.
  assert.match(String(commit.run), /github\.ref_name/)
  assert.match(String(commit.run), /default_branch/)
  assert.match(String(commit.run), /Refusing to push baselines to the default branch/)
  assert.ok(!/--base main/.test(String(commit.run)), 'the sweep does not open a PR to main')
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

/* ── 7. a bootstrap creates, and never replaces ─────────────────────────── */

console.log('\n— 7. the first recording —')

// Two families × two fixtures, one of which is already recorded. Shaped like the
// runner's own targets so the planner is tested on what it actually receives.
const BOOTSTRAP_TARGETS = [
  { fixture: 'vr-001', family: 'browser-print', copy: 'paper', hasBaseline: false },
  { fixture: 'vr-001', family: 'docx', copy: 'paper', hasBaseline: false },
  { fixture: 'vr-004', family: 'browser-print', copy: 'paper', hasBaseline: true },
  { fixture: 'vr-004', family: 'browser-print', copy: 'scheme', hasBaseline: false },
  { fixture: 'vr-004', family: 'docx', copy: 'paper', hasBaseline: true },
]

test('a bootstrap records only what has no baseline', () => {
  const { record, skipped } = planBaselineBootstrap(BOOTSTRAP_TARGETS)
  assert.equal(record.length, 3)
  assert.ok(record.every((t) => !t.hasBaseline))
  // The complement, because "these were recorded" and "every existing baseline
  // survived" are different claims and the second is the one that matters.
  assert.equal(skipped.length, 2)
  assert.ok(skipped.every((t) => t.hasBaseline))
})

test('an existing baseline is never replaced, whatever the narrowing says', () => {
  // Naming the fixture is the strongest possible request to touch it, and it
  // still does not authorise a replacement — that is the update path's job.
  const { record, skipped } = planBaselineBootstrap(
    BOOTSTRAP_TARGETS, { fixture: 'vr-004', family: 'browser-print' },
  )
  assert.deepEqual(record.map((t) => t.copy), ['scheme'], 'only the copy with no baseline')
  const kept = skipped.find((t) => t.fixture === 'vr-004' && t.copy === 'paper' && t.family === 'browser-print')
  assert.match(kept.why, /a baseline already exists/)
})

test('the narrowing options shrink the run and say why each target was left', () => {
  const { record, skipped } = planBaselineBootstrap(BOOTSTRAP_TARGETS, { family: 'docx' })
  assert.deepEqual(record.map((t) => t.fixture), ['vr-001'])
  assert.ok(
    skipped.filter((t) => t.family !== 'docx').every((t) => /outside the renderer family/.test(t.why)),
    'a target outside the family says so, rather than being silently absent',
  )
  const byFixture = planBaselineBootstrap(BOOTSTRAP_TARGETS, { fixture: 'vr-001' })
  assert.equal(byFixture.record.length, 2)
  assert.ok(byFixture.skipped.every((t) => t.fixture !== 'vr-001'))
})

test('a bootstrap still requires a reason and a source', () => {
  const good = { reason: 'First recording of the §4.6 baselines', source: '#1933' }
  assert.deepEqual(validateBootstrapRequest(good, FIXTURE_IDS), [])
  // Unlike an update, the fixture and family are optional — they narrow, they do
  // not authorise. Everything else is as strict.
  assert.deepEqual(validateBootstrapRequest({ ...good, fixture: '', family: '' }, FIXTURE_IDS), [])
  for (const [expected, request] of Object.entries({
    'no reason': { ...good, reason: '' },
    'too short to be a reason': { ...good, reason: 'ok' },
    'no source': { ...good, source: '' },
  })) {
    const problems = validateBootstrapRequest(request, FIXTURE_IDS)
    assert.ok(problems.some((p) => p.includes(expected)), `${expected}: got ${problems.join('; ')}`)
  }
})

test('a narrowing option that is given but wrong is an error, not an ignored typo', () => {
  // The failure this prevents: a mistyped fixture silently records all eight
  // while the operator believes one was selected.
  const good = { reason: 'First recording of the §4.6 baselines', source: '#1933' }
  for (const [expected, request] of Object.entries({
    'not a fixture ID': { ...good, fixture: 'fractions' },
    'does not exist': { ...good, fixture: 'vr-999' },
    'not a renderer family': { ...good, family: 'word' },
  })) {
    const problems = validateBootstrapRequest(request, FIXTURE_IDS)
    assert.ok(problems.some((p) => p.includes(expected)), `${expected}: got ${problems.join('; ')}`)
  }
})

test('a bootstrap is governed by the same writer permission as an update', () => {
  // It is --mode=update, so it inherits mayWriteBaseline rather than opening a
  // second door. A pull_request event can no more bootstrap than re-record.
  assert.equal(mayWriteBaseline({ mode: 'update', event: 'workflow_dispatch' }), true)
  assert.equal(mayWriteBaseline({ mode: 'update', event: 'pull_request' }), false)
  assert.ok(!GATE_MODES.includes('bootstrap'), 'bootstrap is a scope, not a mode that bypasses the rules')
})

test('the bootstrap workflow requires a reason and a source, and nothing else', () => {
  const inputs = bootstrapWorkflow.on.workflow_dispatch.inputs
  for (const name of ['reason', 'source']) {
    assert.ok(inputs[name], `${name} is an input`)
    assert.equal(inputs[name].required, true, `${name} is required`)
  }
  for (const name of ['fixture', 'family']) {
    assert.equal(inputs[name].required, false, `${name} narrows, so it is optional`)
  }
  // `all` is the default and every real family is offered, so narrowing cannot
  // silently target nothing through a typo.
  assert.deepEqual(inputs.family.options, ['all', ...RENDERER_FAMILIES])
  assert.equal(inputs.family.default, 'all')
})

/** The bootstrap's two recorders. Split because the families need
 *  incompatible environments — see the LibreOffice test below. */
const RECORDERS = {
  'record-paper': bootstrapWorkflow.jobs['record-paper'],
  'record-screen': bootstrapWorkflow.jobs['record-screen'],
}

test('the bootstrap validates fixtures BEFORE recording them', () => {
  for (const [name, job] of Object.entries(RECORDERS)) {
    const order = job.steps.map((s) => String(s.name || ''))
    const validate = order.findIndex((n) => /^Validate the .*fixtures/i.test(n))
    const record = order.findIndex((n) => /^Record the missing/i.test(n))
    assert.ok(validate >= 0 && record >= 0, `${name}: both steps exist`)
    assert.ok(validate < record, `${name}: a fixture that no longer validates is not recorded`)
  }
})

test('every recorder passes the flag that makes it non-destructive', () => {
  for (const [name, job] of Object.entries(RECORDERS)) {
    const step = job.steps.find((s) => /--mode=update/.test(s.run || ''))
    assert.ok(step, `${name}: runs through the shared entry point, not a second harness`)
    assert.match(step.run, /--bootstrap-missing/, name)
    assert.match(step.run, /--reason=/, name)
    assert.match(step.run, /--source=/, name)
    // Not continue-on-error: a run that could not render must stop before the
    // pull-request step, so nothing is committed from an incomplete recording.
    assert.ok(!step['continue-on-error'], `${name}: an incomplete recording fails the job`)
  }
})

test('the SCREEN recorder never installs LibreOffice', () => {
  // The bug this splits the workflow to fix. One job installed LibreOffice for
  // the paper families and then recorded screen baselines in the same
  // environment, which stamped `libreoffice: 24.2.7.2` and a font digest
  // shifted by `fonts-liberation` into all sixteen. Both are compared by
  // `assertComparableEnvironment`, and the comparing job in
  // visual-regression.yml installs neither — so those baselines were
  // irreproducible by construction, and #2137 is red for exactly that.
  //
  // Matched against the whole job, not just a step called "Install
  // LibreOffice": the way this comes back is somebody adding `soffice` to an
  // existing apt line.
  const screen = JSON.stringify(RECORDERS['record-screen'])
  assert.ok(!/libreoffice|soffice/i.test(screen),
    'the screen recorder installs or references LibreOffice — a screen baseline recorded '
    + 'beside it can never be reproduced by the comparing job, which installs neither it '
    + 'nor the fonts it brings')
  // …and the paper recorder still DOES, or the docx family cannot render at all.
  assert.match(JSON.stringify(RECORDERS['record-paper']), /libreoffice/i,
    'the paper recorder lost its LibreOffice install')
})

test('the pull-request job needs both recorders and tolerates a skipped one', () => {
  const job = bootstrapWorkflow.jobs['open-pull-request']
  assert.deepEqual(job.needs, ['record-paper', 'record-screen'])
  const cond = String(job.if)
  // A narrowed dispatch skips one recorder; that must not block the review.
  for (const recorder of ['record-paper', 'record-screen']) {
    assert.ok(cond.includes(`needs.${recorder}.result == 'skipped'`), `${recorder} skipping is tolerated`)
    assert.ok(cond.includes(`needs.${recorder}.result == 'success'`), `${recorder} succeeding is required`)
  }
  // But a FAILED recorder must not produce a pull request — the old single
  // job's "not continue-on-error" rule, kept across the split.
  assert.ok(!/failure/.test(cond), 'a failed recording must not open a pull request')
  assert.ok(cond.includes('!cancelled()'), 'a cancelled run must not open a pull request')
  // Both skipped means nothing was recorded at all.
  assert.ok(/!\(needs\.record-paper\.result == 'skipped' && needs\.record-screen\.result == 'skipped'\)/.test(cond),
    'a run that recorded nothing must not open a pull request')
})

test('the recordings reach the pull-request job as artifacts', () => {
  // They no longer share a workspace, so a recorder that renders and uploads
  // nothing would leave the PR job opening an empty pull request.
  for (const [name, job] of Object.entries(RECORDERS)) {
    const upload = job.steps.find((s) => /upload-artifact/.test(s.uses || ''))
    assert.ok(upload, `${name}: hands its recording on`)
    assert.match(String(upload.with.name), /^bootstrap-recording-/, `${name}: artifact name is matchable`)
    assert.match(String(upload.with.path), /tests\/visual\/baselines/, `${name}: uploads the baselines it wrote`)
  }
  const download = bootstrapWorkflow.jobs['open-pull-request'].steps
    .find((s) => /download-artifact/.test(s.uses || ''))
  assert.ok(download, 'the pull-request job collects them')
  assert.equal(download.with.pattern, 'bootstrap-recording-*',
    'it must collect BOTH recorders by pattern rather than naming one')
})

test('each recorder publishes what it wrote as a JOB OUTPUT, not inside the artifact', () => {
  // The handoff invariant's channel, and the reason it is this channel.
  //
  // Run 31094944867 uploaded 4,990,794 bytes of correct renders and collected
  // zero of them, because `upload-artifact@v4` roots the archive at the least
  // common ancestor of its search paths and the collector looked one level too
  // deep. Nothing failed: it reported "nothing to commit" — the message for a
  // completely different, legitimate outcome — and exited 0.
  //
  // A count packed INTO the artifact would have been lost by the same bug and
  // agreed with itself at zero. It therefore leaves through the Actions API.
  for (const [name, job] of Object.entries(RECORDERS)) {
    assert.equal(job.outputs?.recorded, '${{ steps.record.outputs.recorded }}',
      `${name}: publishes its recorded count for the pull-request job`)
    const record = (job.steps || []).find((s) => s.id === 'record')
    assert.ok(record, `${name}: the step producing that output is identified`)
    assert.match(String(record.run), /runVisualGate\.mjs|runScreenGate\.mjs/,
      `${name}: the count comes from the recorder itself, not a later re-count`)
  }
})

test('both recorders actually WRITE the count the workflow re-exports', () => {
  // The other half of the assertion above, and it has to be stated separately:
  // `outputs.recorded` resolves to an empty string when the step never writes
  // one, and YAML that declares an output no runner produces looks identical to
  // YAML that works. The failure would then land at the far end as
  // "HANDOFF UNREPORTED" — loudly, but a whole render later.
  for (const runner of ['runVisualGate.mjs', 'screen/runScreenGate.mjs']) {
    const src = readFileSync(new URL(`./${runner}`, import.meta.url), 'utf8')
    assert.match(src, /writeRecordedCount\(/, `${runner}: publishes what it recorded`)
    assert.match(src, /process\.env\.GITHUB_OUTPUT/, `${runner}: to the job-output channel`)
  }
})

test('the collector is handed each recorder\'s RESULT as well as its count', () => {
  // Both, because they answer different questions: a `skipped` family
  // contributes zero correctly, while a `success` that reported no count means
  // the invariant itself went missing and must fail rather than default to 0.
  const step = bootstrapWorkflow.jobs['open-pull-request'].steps
    .find((s) => /collectBootstrapRecordings/.test(s.run || ''))
  assert.ok(step, 'the pull-request job collects through the script, not inline YAML')
  const env = step.env || {}
  assert.equal(env.PAPER_RESULT, '${{ needs.record-paper.result }}')
  assert.equal(env.PAPER_RECORDED, '${{ needs.record-paper.outputs.recorded }}')
  assert.equal(env.SCREEN_RESULT, '${{ needs.record-screen.result }}')
  assert.equal(env.SCREEN_RECORDED, '${{ needs.record-screen.outputs.recorded }}')
})

test('every writer takes its review sheet from the recorder, not from YAML', () => {
  // The sheet lists the environment, page count, anchors, figure proof and file
  // hashes. A shell heredoc is where such a list quietly loses an item — and on
  // the bootstrap path it must describe EVERY baseline recorded, not the last.
  for (const [name, workflow] of Object.entries(WRITERS)) {
    // Searched across EVERY job, not `jobs[0]`: the bootstrap now records in
    // two jobs and opens the pull request in a third, so "the first job" stopped
    // being the one that creates it.
    const step = Object.values(workflow.jobs)
      .flatMap((job) => job.steps || [])
      .find((s) => /gh pr create/.test(s.run || ''))
    assert.match(step.run, /--body-file/, `${name} uses the recorder's sheet`)
    assert.ok(!/--body ["']/.test(step.run), `${name} does not assemble a body inline`)
    assert.match(step.run, /baseline-summary\.md/, `${name} reads the file the recorder writes`)
    // A missing sheet is a hard stop, not a pull request with an empty body.
    assert.match(step.run, /exit 1/, `${name} refuses to open an unreviewable pull request`)
  }
})

test('every RECORDER produces the sheet its workflow demands', () => {
  // The twin of the test above, and the one that was missing.
  //
  // The workflow-side half was asserted from the day the bootstrap landed: each
  // writer reads `baseline-summary.md` and exits 1 without it. The recorder-side
  // half — that a recorder capable of writing a baseline actually WRITES that
  // file — was true of `runVisualGate.mjs` and untested, so when a second
  // recorder arrived it did not write one and nothing failed. A `family=screen`
  // dispatch then rendered 16 baselines, committed them, pushed the branch, and
  // died at `gh pr create`: recording worked, the review sheet did not exist,
  // and the images were stranded on an orphan branch.
  //
  // Read as source rather than imported: these are top-level scripts that render
  // on import. What is asserted is narrow and load-bearing — the recorder reaches
  // the ONE writer, so a third family gets the sheet by construction instead of
  // by somebody remembering.
  const RECORDERS = ['runVisualGate.mjs', 'screen/runScreenGate.mjs']
  for (const name of RECORDERS) {
    const src = readFileSync(new URL(`./${name}`, import.meta.url), 'utf8')
    assert.match(src, /from '\.{1,2}\/baselineSummary\.js'/,
      `${name} does not use the shared review-sheet writer`)
    assert.match(src, /appendBaselineSummaryEntry\(/,
      `${name} imports the writer but never calls it — a recorder that writes baselines and no sheet `
      + 'makes the bootstrap workflow fail after it has already pushed them')
  }
})

test('editing a writer workflow runs the gate that proves it is still safe', () => {
  for (const name of Object.keys(WRITERS)) {
    assert.ok(PRINT_AFFECTING_PATHS.includes(`.github/workflows/${name}`), `${name} is watched`)
  }
})

/* ── The sweep update ─────────────────────────────────────────────────────
   Re-recording every baseline a change moved, onto the pull request that moved
   them. The one-fixture rule is right for a one-off; a change that legitimately
   moves all eight fixtures turns it into sixteen dispatches, which is how a gate
   ends up permanently red. What replaces the rule is a set of conditions, and
   these are the tests that they hold. */

const sweep = {
  reason: 'the grade now prints as typed (§9) and Word uses the paper margins (§2)',
  source: '1995',
  pullRequest: '1995',
}

test('a sweep names its pull request, its reason and its source', () => {
  assert.deepEqual(validateSweepUpdateRequest(sweep, FIXTURE_IDS), [])
})

test('a sweep with no pull request is refused — that is where the review happens', () => {
  const problems = validateSweepUpdateRequest({ ...sweep, pullRequest: '' }, FIXTURE_IDS)
  assert.equal(problems.length, 1)
  assert.match(problems[0], /no pull request given/)
})

test('a pull request that is not a number is refused rather than coerced', () => {
  assert.match(validateSweepUpdateRequest({ ...sweep, pullRequest: 'my-branch' }, FIXTURE_IDS)[0], /not a pull request number/)
})

test('a sweep still has to say why, and the reason still has to be one', () => {
  assert.ok(validateSweepUpdateRequest({ ...sweep, reason: '' }, FIXTURE_IDS).length > 0)
  assert.ok(validateSweepUpdateRequest({ ...sweep, reason: 'fix' }, FIXTURE_IDS).length > 0)
  assert.ok(validateSweepUpdateRequest({ ...sweep, source: '' }, FIXTURE_IDS).length > 0)
})

test('fixture and family stay narrowing, and a typo is still an error', () => {
  assert.deepEqual(validateSweepUpdateRequest({ ...sweep, fixture: 'vr-003' }, FIXTURE_IDS), [])
  assert.deepEqual(validateSweepUpdateRequest({ ...sweep, family: 'docx' }, FIXTURE_IDS), [])
  assert.ok(validateSweepUpdateRequest({ ...sweep, fixture: 'vr-999' }, FIXTURE_IDS).length > 0)
  assert.ok(validateSweepUpdateRequest({ ...sweep, family: 'pdf' }, FIXTURE_IDS).length > 0)
})

test('baselines may never be written to the default branch', () => {
  assert.deepEqual(assertBaselineDestination('claude/some-branch'), [])
  assert.match(assertBaselineDestination('main')[0], /refusing to write baselines/)
  assert.match(assertBaselineDestination('refs/heads/main')[0], /refusing to write baselines/)
  assert.match(assertBaselineDestination('trunk', 'trunk')[0], /refusing to write baselines/)
})

test('a write with no destination at all is refused, not defaulted', () => {
  assert.match(assertBaselineDestination('')[0], /no destination branch/)
  assert.match(assertBaselineDestination(undefined)[0], /no destination branch/)
})

console.log(`\n✓ visual gate — ${passed} tests passed`)
