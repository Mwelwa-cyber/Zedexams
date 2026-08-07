/**
 * runVisualGate — the entry point both §4.6 workflows invoke.
 *
 *   node scripts/visual/runVisualGate.mjs --mode=compare
 *   node scripts/visual/runVisualGate.mjs --mode=compare --fixture=vr-003 --family=docx
 *   node scripts/visual/runVisualGate.mjs --mode=update  --fixture=vr-003 --family=docx \
 *        --reason="..." --source="#1934"
 *   node scripts/visual/runVisualGate.mjs --mode=update  --bootstrap-missing \
 *        --reason="..." --source="#1933"
 *
 * ONE implementation for both. The comparison workflow and the baseline-update
 * workflow differ in what they are ALLOWED to do — and that permission is
 * decided by `gateCore.mayWriteBaseline`, not by a second copy of the harness.
 * A separate "update" implementation could drift from the one that produced the
 * failure, and then a reviewer would be approving an appearance nobody measured.
 *
 * ## What it will not do
 *
 *  - write a baseline in compare mode, including when one is missing
 *  - touch a baseline outside the single fixture and family an update names
 *  - replace an existing baseline from a bootstrap run, at all
 *  - compare anything when the render was incomplete
 *  - report success for a fixture it could not render
 *
 * `--bootstrap-missing` exists because the FIRST recording is not the same act
 * as replacing an approved appearance. It is still `--mode=update`, so the same
 * writer permission governs it; it creates only what is absent, and a target
 * that already has a baseline is kept and reported, never overwritten.
 *
 * Exit codes: 0 = the gate passed (or an update completed), 1 = a visual or
 * structural difference, 2 = an infrastructure or generation failure. The last is
 * kept distinct because the response to it is to fix the renderer, never to
 * accept a new baseline.
 */

import fs from 'node:fs'
import { createHash } from 'node:crypto'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { VISUAL_FIXTURES, fixtureById, validateFixture, printedExpectations } from './fixtures.js'
import {
  captureRenderEnvironment, assertComparableEnvironment, assertToolchain,
  baselineIdentity, resolveRenderChromium, RENDER_SETTINGS,
} from './renderEnvironment.js'
import {
  assertRenderComplete, assertBaselineExists, isInfrastructureFailure, RenderIncompleteError,
} from './renderGuards.js'
import { appendBaselineSummaryEntry } from './baselineSummary.js'
import { paperBaselinePaths } from './baselinePaths.js'
import { RECORDED_COUNT_OUTPUT, writeRecordedCount } from './handoffInvariant.js'
import { comparePages, summarisePageComparison } from './compareRender.js'
import { comparePagination } from './comparePagination.js'
import {
  resolveStrictRegions, expectedAnchorsFor, declaredPageMismatches, labelDocumentLines,
  fixtureCopies, renderTarget,
} from './anchors.js'
import { renderFixture, decodePng, encodePng, assertLibreOfficeCanConvert } from './renderStages.js'
import {
  GATE_MODES, RENDERER_FAMILIES, mayWriteBaseline, validateUpdateRequest,
  validateBootstrapRequest, planBaselineBootstrap,
  validateSweepUpdateRequest, assertBaselineDestination,
  baselineWriteFilter, gateVerdict, summariseGateVerdict,
} from './gateCore.js'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '..', '..')
const BASELINE_DIR = path.join(ROOT, 'tests', 'visual', 'baselines')
const OUTPUT_DIR = path.join(ROOT, 'tests', 'visual', 'output')

const EXIT_OK = 0
const EXIT_DIFFERENT = 1
const EXIT_INFRASTRUCTURE = 2

const arg = (name, fallback = '') => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`))
  return hit ? hit.slice(name.length + 3) : fallback
}
const flag = (name) => process.argv.includes(`--${name}`)

const gateMode = arg('mode', 'compare')
const onlyFixture = arg('fixture')
const onlyFamily = arg('family')
const allowFailure = flag('allow-failure')
// The first recording. Still `--mode=update`, so it is governed by exactly the
// same writer rules — a comparison run and a pull_request event can no more
// bootstrap than they can re-record. What it changes is the SCOPE: it creates
// baselines that are absent and refuses to touch one that exists.
const bootstrapping = flag('bootstrap-missing')
// A SWEEP re-records every baseline a change moved, onto the pull request that
// moved them. Same `--mode=update`, so the writer rules are identical; what it
// relaxes is the one-fixture requirement, and what it requires in exchange is a
// pull request to be reviewed on. See validateSweepUpdateRequest.
const sweeping = flag('sweep')

if (!GATE_MODES.includes(gateMode)) {
  console.error(`✗ --mode must be one of ${GATE_MODES.join(', ')}`)
  process.exit(EXIT_INFRASTRUCTURE)
}

/* ── selection ──────────────────────────────────────────────────────────── */

const fixtures = onlyFixture ? [fixtureById(onlyFixture)].filter(Boolean) : VISUAL_FIXTURES
if (onlyFixture && !fixtures.length) {
  console.error(`✗ no fixture "${onlyFixture}"`)
  process.exit(EXIT_INFRASTRUCTURE)
}
if (onlyFamily && !RENDERER_FAMILIES.includes(onlyFamily)) {
  console.error(`✗ --family must be one of ${RENDERER_FAMILIES.join(', ')}`)
  process.exit(EXIT_INFRASTRUCTURE)
}

/* ── the update request is checked before anything renders ──────────────── */

const writing = mayWriteBaseline({ mode: gateMode, event: process.env.GITHUB_EVENT_NAME })
if (gateMode === 'update') {
  if (!writing) {
    console.error(
      '✗ this run may not write a baseline. A pull-request event can run code from '
      + 'a fork, and a fork must not be able to rewrite what it is measured against.',
    )
    process.exit(EXIT_INFRASTRUCTURE)
  }
  const request = {
    fixture: onlyFixture,
    family: onlyFamily,
    reason: arg('reason'),
    source: arg('source'),
    pullRequest: arg('pull-request'),
  }
  const knownIds = VISUAL_FIXTURES.map((f) => f.id)
  // Where the baselines will land. Checked BEFORE anything renders, because a
  // run that discovers its destination is the default branch after twenty
  // minutes of rendering has already wasted the twenty minutes — and because a
  // guard that runs last is one an edit can reorder past.
  const destinationProblems = sweeping
    ? assertBaselineDestination(arg('branch', process.env.GITHUB_REF_NAME || ''))
    : []
  const problems = [
    ...destinationProblems,
    ...(bootstrapping
      ? validateBootstrapRequest(request, knownIds)
      : sweeping
        ? validateSweepUpdateRequest(request, knownIds)
        : validateUpdateRequest(request, knownIds)),
  ]
  if (problems.length) {
    const kind = bootstrapping ? 'bootstrap' : sweeping ? 'sweep' : 'update'
    console.error(`✗ this baseline ${kind} is not permitted:`)
    for (const p of problems) console.error(`    ${p}`)
    process.exit(EXIT_INFRASTRUCTURE)
  }
}

/* ── environment ────────────────────────────────────────────────────────── */

const stages = [...new Set(fixtures.flatMap((f) => f.targets))]
  .filter((s) => !onlyFamily || s === onlyFamily)

let environment
let chromiumPath = ''
try {
  chromiumPath = await resolveRenderChromium()
  environment = captureRenderEnvironment({ chromiumPath })
  assertToolchain(stages, environment)
  if (stages.includes('docx')) await assertLibreOfficeCanConvert()
} catch (err) {
  console.error(`✗ ${err.message}`)
  process.exit(EXIT_INFRASTRUCTURE)
}

// A comparison run starts from a clean slate; an update run PRESERVES what is
// already there.
//
// The baseline workflow compares before it replaces, precisely so the audit
// record can say what changed rather than only that something was replaced — and
// wiping the directory here deleted that comparison a second before the
// replacement was written. The evidence moves aside instead, so a reviewer sees
// the old appearance, the new one, and the difference between them.
if (fs.existsSync(OUTPUT_DIR) && gateMode === 'update') {
  const before = path.join(OUTPUT_DIR, 'before-update')
  fs.rmSync(before, { recursive: true, force: true })
  fs.mkdirSync(before, { recursive: true })
  for (const entry of fs.readdirSync(OUTPUT_DIR)) {
    if (entry === 'before-update') continue
    fs.renameSync(path.join(OUTPUT_DIR, entry), path.join(before, entry))
  }
} else {
  fs.rmSync(OUTPUT_DIR, { recursive: true, force: true })
}
fs.mkdirSync(OUTPUT_DIR, { recursive: true })
fs.writeFileSync(path.join(OUTPUT_DIR, 'environment.json'), JSON.stringify(environment, null, 2))

console.log(`Visual gate — mode=${gateMode}`)
console.log(`  Chromium ${environment.chromium || '(absent)'}  LibreOffice ${environment.libreoffice || '(absent)'}`)
console.log(`  fonts ${environment.fonts.count} (digest ${environment.fonts.digest})`)
console.log(`  ${fixtures.length} fixture(s), stages: ${stages.join(', ')}\n`)

/* ── run ────────────────────────────────────────────────────────────────── */

const verdicts = []
const infrastructure = []
let browser = null

try {
  const puppeteer = (await import('puppeteer')).default
  const { chromiumLaunchFlags } = await import('./pdfPages.js')
  // Launched with the binary whose version was just recorded, so the identity on
  // every baseline is the identity of the browser that drew it.
  browser = await puppeteer.launch({ args: chromiumLaunchFlags(), executablePath: chromiumPath })

  for (const fixture of fixtures) {
    const problems = validateFixture(fixture)
    if (problems.length) {
      // A fixture that no longer contains its subject renders consistently, so
      // this must stop the run rather than produce a green comparison.
      infrastructure.push(new RenderIncompleteError(
        `${fixture.id} is not a valid fixture: ${problems.join('; ')}`,
        { fixtureId: fixture.id },
      ))
      continue
    }
    for (const stage of fixture.targets) {
      if (onlyFamily && stage !== onlyFamily) continue
      // A fixture that declares `renderBothModes` is TWO documents: the learner
      // copy and the marking key. Both are rendered and both are compared,
      // because §4.3's whole point is that the two correspond — and a suite that
      // only rendered the learner copy would never see the marking key drift.
      // The copy list comes from the same helper the anchor contract validates
      // against, so a fixture cannot be rendered to a target no expectation was
      // ever required for.
      for (const copy of fixtureCopies(fixture)) {
        try {
          verdicts.push(await runOne(fixture, stage, copy, browser))
        } catch (err) {
          if (isInfrastructureFailure(err)) infrastructure.push(err)
          else throw err
        }
      }
    }
  }
} finally {
  if (browser) await browser.close().catch(() => {})
}

/* ── report ─────────────────────────────────────────────────────────────── */

// "No baseline yet" and "the render is broken" are different situations with
// different remedies, and filing them under one heading told people to fix a
// renderer that was working perfectly. A first run reported eighteen
// INFRASTRUCTURE / GENERATION FAILURES and instructed the reader to "fix the
// render" — when every page had rendered correctly and the only thing missing
// was the reviewed recording that has not happened yet.
const missingBaselines = infrastructure.filter((err) => err.detail?.missingBaseline)
const brokenRenders = infrastructure.filter((err) => !err.detail?.missingBaseline)

const lines = []
for (const verdict of verdicts) lines.push(summariseGateVerdict(verdict))
if (missingBaselines.length) {
  lines.push(
    '',
    `NOT RECORDED YET — ${missingBaselines.length} of ${missingBaselines.length + verdicts.length} `
    + 'target(s) have no baseline to compare against.',
    '',
    '  Nothing is broken: every page rendered. A comparison run never records a',
    '  baseline for itself, because that would turn "nobody has reviewed this',
    '  appearance" into "this appearance is correct" at exactly the moment a',
    '  person should be looking.',
    '',
    '  Record them once, through the reviewed workflow:',
    '      Actions → Visual baseline bootstrap → Run workflow',
    '  It creates only what is missing, never replaces what exists, and opens a',
    '  pull request for review.',
    '',
  )
  for (const err of missingBaselines) {
    // The long explanation is already above; the list only needs to say which.
    lines.push(`      ${err.detail.fixtureId} [${err.detail.stage}]`)
  }
}
if (brokenRenders.length) {
  lines.push('', 'INFRASTRUCTURE / GENERATION FAILURES — fix the render, do not accept a baseline:')
  for (const err of brokenRenders) lines.push(`  ${err.message}`)
}
const summary = lines.join('\n')
fs.writeFileSync(path.join(OUTPUT_DIR, 'summary.txt'), `${summary}\n`)
fs.writeFileSync(path.join(OUTPUT_DIR, 'summary.json'), JSON.stringify({
  mode: gateMode,
  environment,
  identities: verdicts.map((v) => v.identity),
  verdicts,
  missingBaselines: missingBaselines.map((e) => ({ ...e.detail })),
  infrastructure: brokenRenders.map((e) => ({ message: e.message, detail: e.detail || null })),
}, null, 2))
console.log(`\n${summary}`)
console.log(`\nArtefacts: ${path.relative(ROOT, OUTPUT_DIR)}`)

if (brokenRenders.length) {
  console.error('\n✗ the gate did not complete. No comparison result should be trusted, '
    + 'and no baseline may be updated from this run.')
  process.exit(EXIT_INFRASTRUCTURE)
}
if (missingBaselines.length) {
  // Still a failure — a gate that reported success while protecting nothing
  // would be worse than a red check. But it says what to DO about it.
  console.error(
    `\n✗ ${missingBaselines.length} target(s) have no baseline, so the gate is not `
    + 'protecting them yet. Run the Visual baseline bootstrap workflow to record them.',
  )
  process.exit(EXIT_INFRASTRUCTURE)
}
const failed = verdicts.some((v) => v.failed)
if (gateMode === 'update') {
  if (!bootstrapping) {
    // Counted for a sweep, because "every baseline a change moved" is a claim
    // worth stating as a number a reviewer can check against the fixture list.
    if (sweeping) {
      const rerecorded = verdicts.filter((v) => v.updated)
      console.log(`\n✓ ${rerecorded.length} baseline(s) re-recorded onto this branch.`)
      for (const v of rerecorded) console.log(`    ${v.fixtureId} [${v.family}/${v.copy}]`)
    } else {
      console.log('\n✓ baseline re-recorded for the named fixture and family only.')
    }
    process.exit(EXIT_OK)
  }
  // Counted rather than assumed. A bootstrap that recorded nothing is a
  // legitimate outcome (every baseline already existed) and a silent one would
  // be indistinguishable from a bootstrap that silently did nothing wrong.
  const recorded = verdicts.filter((v) => v.updated)
  const kept = verdicts.filter((v) => !v.updated)
  console.log(`\n✓ ${recorded.length} first baseline(s) recorded; ${kept.length} left untouched.`)
  for (const v of kept) console.log(`    kept ${v.fixtureId} [${v.family}/${v.copy}] — ${v.keptReason}`)
  // Published for the pull-request job to check the arriving recordings
  // against. Out of band, through the Actions API — a count carried inside the
  // artifact would be lost by the very layout bug it exists to catch.
  if (writeRecordedCount(recorded.length, process.env.GITHUB_OUTPUT)) {
    console.log(`reported to the next job: ${RECORDED_COUNT_OUTPUT}=${recorded.length}`)
  }
  if (!recorded.length) {
    console.log('\nNothing was missing, so nothing was recorded. Replacing an existing '
      + 'baseline is the reviewed update path, which names its fixture and states why.')
  }
  process.exit(EXIT_OK)
}
if (failed && !allowFailure) {
  console.error('\n✗ the printed output changed. Look at the artefacts; if the new appearance '
    + 'is correct, record it through the reviewed baseline workflow.')
  process.exit(EXIT_DIFFERENT)
}
if (failed) console.log('\n(differences found; --allow-failure was given, so this run does not fail)')
else console.log('\n✓ printed output matches every baseline.')
process.exit(EXIT_OK)

/* ── one fixture, one stage ─────────────────────────────────────────────── */

async function runOne(fixture, stage, copy, sharedBrowser) {
  const identity = baselineIdentity(stage, environment)
  const label = `${fixture.id} [${stage}/${copy}]`
  process.stdout.write(`  ${label} … `)

  const render = await renderFixture(fixture, stage, { browser: sharedBrowser, mode: copy })

  // Everything is published BEFORE anything is asserted.
  //
  // This was the other way round, and an incomplete render therefore published
  // nothing at all: the one failure whose cause is hardest to guess from a log
  // line was also the one with no document, no pages and no anchor map to look
  // at. "The render produced no diagram" is not diagnosable without the page it
  // failed to draw the diagram on.
  const candidateDir = path.join(OUTPUT_DIR, identity, fixture.id, copy, 'candidate')
  fs.mkdirSync(candidateDir, { recursive: true })
  // The whole document, not just the pages: a reviewer distinguishing a generator
  // regression from a rendering regression needs to open the real file.
  fs.copyFileSync(render.documentPath, path.join(candidateDir, path.basename(render.documentPath)))
  fs.writeFileSync(path.join(candidateDir, 'rendered.pdf'), render.pdfBytes)
  // EVERY page, not only the changed ones — the explanation for a move is on the
  // pages either side of it.
  for (const page of render.pages) {
    fs.writeFileSync(path.join(candidateDir, pageName(page.pageNumber)), page.png)
  }
  const layoutJson = {
    pageCount: render.layout.pageCount,
    anchors: render.layout.anchors,
    inkByPage: render.layout.inkByPage,
  }
  fs.writeFileSync(path.join(candidateDir, 'layout.json'), JSON.stringify(layoutJson, null, 2))
  fs.writeFileSync(path.join(candidateDir, 'identity.txt'), `${identity}\n${render.command}\n`)
  // The figure boxes and their source (a placed image, or ink no text explained),
  // because "no diagram was found" is answered by what WAS found.
  fs.writeFileSync(
    path.join(candidateDir, 'figures.json'),
    JSON.stringify(render.layout.figureBoxes, null, 2),
  )

  assertRenderComplete(render, {
    requiresAnchors: true,
    // The fixture's own declarations, not a list kept beside them: a fixture that
    // says a diagram must stay with its question and produces no diagram would
    // otherwise pass the togetherness check by having nothing to check.
    expectedAnchorPages: expectedAnchorsFor(fixture, copy, stage),
  })
  assertFiguresReallyEmbedded(fixture, stage, label, render)
  assertPagePrintsItsContent(fixture, copy, label, render)

  // The fixture knows how many questions it has, so a mis-read of the printed
  // page is caught rather than absorbed. Without this, an extractor that lost
  // question 7 would keep comparing pagination — for six questions — and report
  // green, which is the failure mode this whole suite is built against.
  const questionAnchors = Object.keys(render.layout.anchors).filter((id) => /^question_\d+$/.test(id))
  const expectedQuestions = (fixture.questions || []).length
  if (expectedQuestions && questionAnchors.length !== expectedQuestions) {
    throw new RenderIncompleteError(
      `${label}: the fixture has ${expectedQuestions} question(s) and `
      + `${questionAnchors.length} were found on the printed page `
      + `(${questionAnchors.sort().join(', ') || 'none'}) — the structural checks would `
      + 'be comparing a different paper from the one the fixture describes',
      { fixtureId: fixture.id, stage, expectedQuestions, found: questionAnchors },
    )
  }

  // The fixture's own floor, checked before the baseline because a fixture and
  // its baseline can agree and both be wrong. A floor rather than an exact count:
  // the exact count is the baseline's job, and the two renderer families
  // legitimately paginate the same content differently.
  if (fixture.minPages && render.layout.pageCount < fixture.minPages) {
    throw new RenderIncompleteError(
      `${label}: the fixture is meant to span at least ${fixture.minPages} page(s) and `
      + `the render produced ${render.layout.pageCount} — it is no longer the paper the `
      + 'fixture describes',
      { fixtureId: fixture.id, stage },
    )
  }

  const baselineFixtureDir = path.join(BASELINE_DIR, identity, fixture.id, copy)
  const baselineLayoutPath = path.join(baselineFixtureDir, 'layout.json')
  const hasBaseline = fs.existsSync(baselineLayoutPath)

  if (gateMode === 'update') {
    // The decision is made by the pure planner, not here, so "a bootstrap never
    // replaces an approved appearance" is a rule a test can call rather than a
    // branch a test has to reach through a render.
    const { record, skipped } = bootstrapping
      ? planBaselineBootstrap(
        [{ fixture: fixture.id, family: stage, copy, hasBaseline }],
        { fixture: onlyFixture, family: onlyFamily },
      )
      : { record: [{ fixture: fixture.id, family: stage, copy, hasBaseline }], skipped: [] }

    if (!record.length) {
      console.log(`kept (${skipped[0].why})`)
      return {
        fixtureId: fixture.id, family: stage, copy, identity, failed: false,
        structural: [], visual: [], pageCountChanged: false, structurallyFailed: false,
        updated: false, keptReason: skipped[0].why,
      }
    }
    writeBaseline(fixture, identity, copy, render, layoutJson)
    console.log(bootstrapping ? 'recorded (first baseline)' : 're-recorded')
    return {
      fixtureId: fixture.id, family: stage, copy, identity, failed: false,
      structural: [], visual: [], pageCountChanged: false, structurallyFailed: false,
      updated: true,
    }
  }

  // A comparison run never creates a baseline — not even a missing one.
  assertBaselineExists(fixture.id, `${stage}/${copy}`, hasBaseline)

  const baselineLayout = JSON.parse(fs.readFileSync(baselineLayoutPath, 'utf8'))
  assertComparableEnvironment(
    readJsonIfPresent(path.join(baselineFixtureDir, 'environment.json')),
    environment,
  )

  const pagination = comparePagination(baselineLayout, layoutJson, { together: fixture.together })

  const pageComparisons = []
  const diffDir = path.join(OUTPUT_DIR, identity, fixture.id, copy, 'diff')
  const baselineCopyDir = path.join(OUTPUT_DIR, identity, fixture.id, copy, 'baseline')
  fs.mkdirSync(baselineCopyDir, { recursive: true })

  for (const page of render.pages) {
    const baselinePagePath = path.join(baselineFixtureDir, pageName(page.pageNumber))
    if (!fs.existsSync(baselinePagePath)) {
      // A page the baseline does not have at all. Pagination already reports the
      // count change; recording it here keeps the page list honest.
      pageComparisons.push({
        pageNumber: page.pageNumber,
        comparison: { changed: true, reasons: ['this page is not in the baseline'] },
      })
      continue
    }
    fs.copyFileSync(baselinePagePath, path.join(baselineCopyDir, pageName(page.pageNumber)))
    const baselinePage = decodePng(fs.readFileSync(baselinePagePath))
    const { regions, unresolved } = resolveStrictRegions(fixture.regions, page, render.layout)
    if (unresolved.length) {
      throw new RenderIncompleteError(
        `${label}: the fixture declares strict region(s) at ${unresolved.join(', ')} `
        + 'and this render does not contain them, so those regions would be compared '
        + 'with the ordinary tolerance while the fixture says they are strict',
        { fixtureId: fixture.id, stage, unresolved },
      )
    }
    const comparison = comparePages(baselinePage, page, { strictRegions: regions })
    if (comparison.changed && comparison.diff) {
      fs.mkdirSync(diffDir, { recursive: true })
      fs.writeFileSync(
        path.join(diffDir, pageName(page.pageNumber)),
        encodePng({ width: page.width, height: page.height, data: comparison.diff }),
      )
    }
    pageComparisons.push({ pageNumber: page.pageNumber, comparison })
    console.log(`\n      ${summarisePageComparison(fixture.id, page.pageNumber, comparison)}`)
  }

  // A fixture's own statement of where an anchor belongs is a structural claim,
  // so a mismatch joins the structural findings rather than being reported as a
  // page of changed pixels.
  const target = renderTarget(stage, copy)
  const declaredMisses = declaredPageMismatches(
    expectedAnchorsFor(fixture, copy, stage),
    render.layout.anchors,
    target,
  )
  for (const miss of declaredMisses) {
    pagination.changed = true
    pagination.findings.push({
      kind: 'anchor_moved',
      // The target is named because the same pair of numbers is a different
      // verdict per renderer: page 2 for question 14 is correct through
      // LibreOffice and a Chromium regression, and a message that did not say
      // which engine produced it read as one fact.
      message: `${miss.id} is on page ${miss.actual} of ${miss.target}; the fixture `
        + `declares page ${miss.declared} for ${miss.target}`,
      id: miss.id,
      target: miss.target,
      before: miss.declared,
      after: miss.actual,
    })
  }

  const verdict = gateVerdict({
    fixtureId: fixture.id,
    family: stage,
    pageComparisons,
    pagination,
  })
  verdict.identity = identity
  verdict.copy = copy
  console.log(`      ${verdict.failed ? 'CHANGED' : 'ok'}`)
  return verdict
}

/**
 * A figure the fixture requires must be REALLY in the file, not merely plausible.
 *
 * The reason this is a separate check from everything else: a `.docx` carrying no
 * drawing at all still converts to a page that looks like a paper, and the pixel
 * comparison would have recorded it happily. So the first baseline must be proved
 * correct by construction rather than by appearance — otherwise the broken output
 * becomes the trusted reference and every later comparison certifies it.
 *
 * Every condition here is one the owner named, and each fails loudly on its own:
 * the diagram exists in the paper, the Word file has a drawing, the SVG part is
 * embedded, the PNG fallback is embedded, its relationship is declared, the
 * renderer drew it visibly, no unresolved-figure diagnostic survived, and no
 * placeholder stands where a real figure belongs.
 */
function assertFiguresReallyEmbedded(fixture, stage, label, render) {
  const fail = (message, detail = {}) => {
    throw new RenderIncompleteError(`${label}: ${message}`, { fixtureId: fixture.id, stage, ...detail })
  }

  // Applies to every render: a diagnostic means the exporter asked for a figure
  // and did not get one, whatever the page looks like.
  const unresolved = render.stats?.unresolvedFigures || []
  if (unresolved.length) {
    fail(
      `${unresolved.length} figure(s) could not be rendered — `
      + unresolved.map((u) => `${u.label || u.diagramKey || 'figure'} failed at the ${u.stage} stage`
        + `${u.reason ? ` (${u.reason})` : ''}`).join('; ')
      + '. A placeholder is not a diagram, so this render must not become a baseline',
      { unresolvedFigures: unresolved },
    )
  }

  const requiresFigure = (fixture.questions || []).some((q) => q?.imageDiagram?.libraryKey)
  if (!requiresFigure || stage !== 'docx') return

  const figures = render.docxFigures
  if (!figures) fail('the Word file was not inspected, so nothing about its figures is known')
  if (figures.placeholders) {
    fail(
      `the Word file contains ${figures.placeholders} "figure could not be embedded" `
      + 'placeholder(s) where the fixture requires a real figure',
    )
  }
  if (!figures.drawings) {
    fail(
      'the Word file contains no drawing at all — the exporter never embedded the '
      + 'figure, so LibreOffice is not what lost it',
      { figures },
    )
  }
  if (!figures.svgParts.length || !figures.svgBlips) {
    fail(
      'the Word file has no SVG part for the figure, so Word would draw the raster '
      + 'fallback instead of the vector (§4.2)',
      { figures },
    )
  }
  if (!figures.pngParts.length) {
    fail(
      'the Word file has an SVG with no PNG fallback — older Word builds and '
      + 'LibreOffice would show nothing at all',
      { figures },
    )
  }
  if (!figures.imageRelationships) {
    fail('the Word file declares no image relationship, so the drawing is a blank box', { figures })
  }
}

/**
 * Everything the fixture says the paper contains must be ON the paper.
 *
 * Checked against the rendered text rather than the fixture's own fields,
 * because the fixture's fields are exactly what kept passing while the page was
 * empty. Three separate times a fixture certified a paper containing none of
 * what it protects — a diagram with no ink, a figure whose catalog key did not
 * exist, and two fixtures whose entire maths content sat in a field the
 * exporters have never read. Each was invisible to `requires` and obvious on the
 * page.
 *
 * Loud, and before any baseline: recording a paper that is missing its content
 * makes the omission the reference, and every later comparison then certifies it.
 */
function assertPagePrintsItsContent(fixture, copy, label, render) {
  const printed = labelDocumentLines(render.pages)
    .flatMap((page) => page.lines.map((line) => line.text))
    .join(' \u0020')
    // The page breaks text into runs wherever it likes, so a needle can be split
    // across two of them. Comparing without spaces asks whether the CHARACTERS
    // are on the page, which is the question being asked. Case-folded too: the
    // header prints the school name in capitals, and a case-sensitive check
    // reported every one of the eight fixtures as missing its own school.
    .replace(/\s+/g, '')
    .toLowerCase()
  const missing = printedExpectations(fixture, { copy })
    .filter(({ needle }) => !printed.includes(needle.replace(/\s+/g, '').toLowerCase()))
  if (!missing.length) return
  throw new RenderIncompleteError(
    `${label}: the paper does not print ${missing.length} thing(s) the fixture says it contains — `
    + `${missing.slice(0, 6).map((m) => m.what).join('; ')}`
    + `${missing.length > 6 ? `; and ${missing.length - 6} more` : ''}. `
    + 'A baseline of a paper missing its own content makes the omission the reference',
    { fixtureId: fixture.id, missing: missing.map((m) => m.what) },
  )
}

function pageName(n) {
  return `page-${String(n).padStart(2, '0')}.png`
}

/**
 * A baseline with no recorded environment is not comparable, and saying so is
 * `assertComparableEnvironment`'s job — so this returns null rather than
 * inventing an environment that would let the comparison proceed.
 */
function readJsonIfPresent(file) {
  if (!fs.existsSync(file)) return null
  return JSON.parse(fs.readFileSync(file, 'utf8'))
}

/**
 * Write the baseline for exactly one fixture and one family.
 *
 * Every path is checked against `baselineWriteFilter` before it is written, so a
 * bug in this function cannot widen the update: the filter answers "may this file
 * be replaced" for every file, including one the writer did not mean to touch.
 */
function writeBaseline(fixture, identity, copy, render, layoutJson) {
  const allowed = baselineWriteFilter({ fixture: fixture.id, family: render.stage })
  const dir = path.join(BASELINE_DIR, identity, fixture.id, copy)
  const guard = (name) => {
    const rel = `${render.stage}/${fixture.id}/${copy}/${name}`
    if (!allowed(rel)) {
      throw new RenderIncompleteError(
        `refusing to write ${rel}: it is outside the fixture and family this update names`,
        { fixtureId: fixture.id, stage: render.stage },
      )
    }
  }
  fs.mkdirSync(dir, { recursive: true })
  // Pages absent from the new render are removed, so a paper that got shorter
  // does not leave an orphan page in the baseline that nothing compares against.
  for (const existing of fs.readdirSync(dir)) {
    if (/^page-\d+\.png$/.test(existing)) {
      guard(existing)
      fs.rmSync(path.join(dir, existing))
    }
  }
  for (const page of render.pages) {
    guard(pageName(page.pageNumber))
    fs.writeFileSync(path.join(dir, pageName(page.pageNumber)), page.png)
  }
  guard('layout.json')
  fs.writeFileSync(path.join(dir, 'layout.json'), JSON.stringify(layoutJson, null, 2))
  guard('environment.json')
  fs.writeFileSync(path.join(dir, 'environment.json'), JSON.stringify(environment, null, 2))
  // Hashes of everything just written.
  //
  // A baseline is a reference other work is measured against, so "which bytes
  // were approved" has to be answerable from the review record rather than by
  // re-downloading an artefact that expires in a fortnight. Computed AFTER the
  // files land, so they hash what is on disk rather than what was intended.
  const hashes = {}
  for (const name of fs.readdirSync(dir).sort()) {
    if (name === 'recorded.json') continue
    hashes[name] = createHash('sha256').update(fs.readFileSync(path.join(dir, name))).digest('hex')
  }

  const record = {
    fixtureId: fixture.id,
    family: render.stage,
    copy,
    identity,
    // The commit whose appearance this approves. `GITHUB_SHA` is the runner's
    // truth; `--source` is what a human typed, and both are kept because they
    // answer different questions six months later.
    sourceCommit: process.env.GITHUB_SHA || '',
    source: arg('source'),
    reason: arg('reason'),
    environment,
    settings: RENDER_SETTINGS,
    command: render.command,
    pageCount: layoutJson.pageCount,
    anchors: layoutJson.anchors,
    inkByPage: layoutJson.inkByPage,
    // Stated, not implied. `assertFiguresReallyEmbedded` has already refused to
    // get here with either of these non-zero — recording them means the review
    // record CLAIMS it rather than leaving a reviewer to trust that some check
    // ran.
    figures: {
      unresolvedFigureCount: (render.stats?.unresolvedFigures || []).length,
      unresolvedFigures: render.stats?.unresolvedFigures || [],
      placeholders: render.docxFigures ? render.docxFigures.placeholders : 0,
      docx: render.docxFigures || null,
      detected: render.layout.figureBoxes,
    },
    hashes,
  }
  guard('recorded.json')
  fs.writeFileSync(path.join(dir, 'recorded.json'), JSON.stringify(record, null, 2))
  // Appended rather than written outright. This file is the pull request's whole
  // body: written per-record it would describe only the LAST one, and a reviewer
  // would approve eighteen baselines from evidence about one. The accumulation
  // now lives in `baselineSummary.js` and spans BOTH recorders, so a
  // `family=all` dispatch cannot have one recorder erase the other's half of the
  // sheet.
  appendBaselineSummaryEntry(OUTPUT_DIR, {
    key: `${record.family}/${record.fixtureId}/${record.copy}`,
    family: record.family,
    // EVERY FILE this entry describes, relative to `tests/visual/baselines/`.
    //
    // The collector verifies each one arrived. This named the copy DIRECTORY,
    // which an artifact keeps as long as any single file inside it survives —
    // so a paper artifact that lost every rendered `page-N.png` but kept
    // `environment.json` passed arrival and could reach review as an unusable
    // baseline. The pages are the baseline; the metadata beside them is not a
    // substitute for it. Raised by Codex on #2143 (`r3729416392`).
    //
    // Computed in `baselinePaths.js` so a test can exercise it: this file is a
    // script with top-level await, so importing it runs the gate — which is why
    // the directory-shaped version this replaces was caught by nothing.
    paths: paperBaselinePaths({
      identity: record.identity,
      fixtureId: record.fixtureId,
      copy: record.copy,
      hashes: record.hashes,
    }),
    columns: ['Fixture', 'Copy', 'Pages'],
    cells: [record.fixtureId, record.copy, String(record.pageCount)],
    section: baselineSummarySection(fixture, record),
  })
}

/** One baseline's section of the review sheet. */
function baselineSummarySection(fixture, record) {
  const anchorRows = Object.entries(record.anchors)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([id, page]) => `| \`${id}\` | ${page} |`)
    .join('\n')
  const hashRows = Object.entries(record.hashes)
    .map(([name, sha]) => `| \`${name}\` | \`${sha}\` |`)
    .join('\n')
  const figureLines = record.figures.docx
    ? [
      `- Word drawings: **${record.figures.docx.drawings}**`,
      `- SVG parts: **${record.figures.docx.svgParts.length}**, PNG fallbacks: **${record.figures.docx.pngParts.length}**`,
      `- image relationships: **${record.figures.docx.imageRelationships}**`,
    ].join('\n')
    : '- (browser-print: figures are drawn by the print path, not embedded as parts)'

  return `Recorded **${record.fixtureId}** — ${fixture.title} — for **${record.family}** (${record.copy} copy).

**Reason:** ${record.reason}
**Source:** ${record.source}${record.sourceCommit ? ` (commit \`${record.sourceCommit}\`)` : ''}
**Baseline identity:** \`${record.identity}\`

### Rendering environment

| | |
|---|---|
| Chromium | ${record.environment.chromium || '—'} |
| LibreOffice | ${record.environment.libreoffice || '—'} |
| OS | ${record.environment.os} |
| Fonts | ${record.environment.fonts.count} (digest \`${record.environment.fonts.digest}\`) |
| Page | ${record.settings.pageSize} at ${record.settings.dpi}dpi, scale ${record.settings.deviceScaleFactor} |
| Locale / zone | ${record.settings.locale} / ${record.settings.timeZone} |

A baseline is only comparable against this environment; a later run in a
different one is refused as an environment error rather than reported as
hundreds of visual failures.

### Structure

**Page count: ${record.pageCount}**

| Anchor | Page |
|---|---|
${anchorRows}

### Figures

- unresolved figures: **${record.figures.unresolvedFigureCount}**
- "figure could not be embedded" placeholders: **${record.figures.placeholders}**
${figureLines}

${record.figures.unresolvedFigureCount === 0 && !record.figures.placeholders
    ? 'No figure is missing and no placeholder stands where a real figure belongs, so this baseline records the paper as it should print.'
    : '⚠ **This baseline contains a missing or placeholder figure and must NOT be approved.**'}

### Baseline files

| File | sha256 |
|---|---|
${hashRows}

The candidate pages, the full generated document and the comparison summary are
attached to the workflow run.
`
}
