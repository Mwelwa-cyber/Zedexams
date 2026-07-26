/**
 * runVisualGate — the entry point both §4.6 workflows invoke.
 *
 *   node scripts/visual/runVisualGate.mjs --mode=compare
 *   node scripts/visual/runVisualGate.mjs --mode=compare --fixture=vr-003 --family=docx
 *   node scripts/visual/runVisualGate.mjs --mode=update  --fixture=vr-003 --family=docx \
 *        --reason="..." --source="#1934"
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
 *  - compare anything when the render was incomplete
 *  - report success for a fixture it could not render
 *
 * Exit codes: 0 = the gate passed (or an update completed), 1 = a visual or
 * structural difference, 2 = an infrastructure or generation failure. The last is
 * kept distinct because the response to it is to fix the renderer, never to
 * accept a new baseline.
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { VISUAL_FIXTURES, fixtureById, validateFixture } from './fixtures.js'
import {
  captureRenderEnvironment, assertComparableEnvironment, assertToolchain,
  baselineIdentity, resolveRenderChromium, RENDER_SETTINGS,
} from './renderEnvironment.js'
import {
  assertRenderComplete, assertBaselineExists, isInfrastructureFailure, RenderIncompleteError,
} from './renderGuards.js'
import { comparePages, summarisePageComparison } from './compareRender.js'
import { comparePagination } from './comparePagination.js'
import { resolveStrictRegions, expectedAnchorsFor, declaredPageMismatches } from './anchors.js'
import { renderFixture, decodePng, encodePng, assertLibreOfficeCanConvert } from './renderStages.js'
import {
  GATE_MODES, RENDERER_FAMILIES, mayWriteBaseline, validateUpdateRequest,
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
  const problems = validateUpdateRequest(
    { fixture: onlyFixture, family: onlyFamily, reason: arg('reason'), source: arg('source') },
    VISUAL_FIXTURES.map((f) => f.id),
  )
  if (problems.length) {
    console.error('✗ this baseline update is not permitted:')
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

fs.rmSync(OUTPUT_DIR, { recursive: true, force: true })
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
      for (const copy of fixture.renderBothModes ? ['paper', 'scheme'] : ['paper']) {
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

const lines = []
for (const verdict of verdicts) lines.push(summariseGateVerdict(verdict))
if (infrastructure.length) {
  lines.push('', 'INFRASTRUCTURE / GENERATION FAILURES — fix the render, do not accept a baseline:')
  for (const err of infrastructure) lines.push(`  ${err.message}`)
}
const summary = lines.join('\n')
fs.writeFileSync(path.join(OUTPUT_DIR, 'summary.txt'), `${summary}\n`)
fs.writeFileSync(path.join(OUTPUT_DIR, 'summary.json'), JSON.stringify({
  mode: gateMode,
  environment,
  identities: verdicts.map((v) => v.identity),
  verdicts,
  infrastructure: infrastructure.map((e) => ({ message: e.message, detail: e.detail || null })),
}, null, 2))
console.log(`\n${summary}`)
console.log(`\nArtefacts: ${path.relative(ROOT, OUTPUT_DIR)}`)

if (infrastructure.length) {
  console.error('\n✗ the gate did not complete. No comparison result should be trusted, '
    + 'and no baseline may be updated from this run.')
  process.exit(EXIT_INFRASTRUCTURE)
}
const failed = verdicts.some((v) => v.failed)
if (gateMode === 'update') {
  console.log('\n✓ baseline re-recorded for the named fixture and family only.')
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
  assertRenderComplete(render, {
    requiresAnchors: true,
    // The fixture's own declarations, not a list kept beside them: a fixture that
    // says a diagram must stay with its question and produces no diagram would
    // otherwise pass the togetherness check by having nothing to check.
    expectedAnchorPages: expectedAnchorsFor(fixture, copy),
  })

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
    writeBaseline(fixture, identity, copy, render, layoutJson)
    console.log('re-recorded')
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
  for (const miss of declaredPageMismatches(expectedAnchorsFor(fixture, copy), render.layout.anchors)) {
    pagination.changed = true
    pagination.findings.push({
      kind: 'anchor_moved',
      message: `${miss.id} is on page ${miss.actual}; the fixture declares page ${miss.declared}`,
      id: miss.id,
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
  guard('recorded.json')
  fs.writeFileSync(path.join(dir, 'recorded.json'), JSON.stringify({
    fixtureId: fixture.id,
    family: render.stage,
    copy,
    identity,
    reason: arg('reason'),
    source: arg('source'),
    settings: RENDER_SETTINGS,
    command: render.command,
  }, null, 2))
}
