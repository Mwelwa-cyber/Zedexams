/**
 * gateCore — what the visual gate decides, separated from how CI runs it (§4.6).
 *
 * Slice B's risk is not rendering; it is that CI could bypass or silently rewrite
 * the gate slice A built. Both of those are decisions, and decisions belong in
 * testable code rather than in YAML that only executes on a runner.
 *
 * So this module holds the rules:
 *
 *  - whether a run is allowed to write a baseline at all;
 *  - which baselines a reviewed update may touch (exactly one fixture, exactly
 *    one renderer family);
 *  - which baselines a bootstrap may CREATE (only ones that do not exist);
 *  - what an update or a bootstrap must supply before it is permitted;
 *  - how a structural failure survives a permissive pixel tolerance;
 *  - which artefacts must be published for a failure to be reviewable.
 *
 * The workflow files then do only what YAML is good at — triggering, installing,
 * uploading — and `gate.test.js` asserts BOTH: these rules by calling them, and
 * the workflow configuration by parsing it. Neither half proves the other.
 */

/** The two run modes. `compare` can never write; `update` is the only writer. */
export const GATE_MODES = ['compare', 'update']

/**
 * Renderer families, matching `baselineIdentity` in renderEnvironment.js.
 *
 * `screen` is the learner viewport (`scripts/visual/screen/`). It is offered by
 * the BOOTSTRAP workflow and validated here, but it is not a family
 * `runVisualGate.mjs` itself renders — it has its own runner, because it has
 * its own renderer. `validateBaselineUpdateRequest` still recognises the name
 * so a dispatch naming it is a real narrowing rather than a typo that silently
 * targets everything.
 */
export const RENDERER_FAMILIES = ['browser-print', 'docx', 'screen']

/**
 * The families whose approved baselines can be REPLACED.
 *
 * A subset, and deliberately so. Replacing goes through the sweep path —
 * `validateSweepUpdateRequest`, the before/after audit record,
 * `runVisualGate.mjs` — and none of that is routed to the screen runner, which
 * has its own renderer. Offering `screen` there would reach an unrouted path
 * and silently record nothing while reporting success, which is worse than its
 * absence.
 *
 * Screen baselines are BOOTSTRAP-only until that path exists. Nothing is
 * blocked by it: a baseline that does not exist cannot be replaced, and none
 * exist yet.
 */
export const UPDATABLE_FAMILIES = ['browser-print', 'docx']

/**
 * Artefacts that must be published for a failed comparison to be reviewable.
 *
 * The list is a contract rather than a convenience. A reviewer looking at a
 * failure needs to distinguish a generator regression from a
 * document-to-image rendering regression, and that is only possible if the
 * generated document, the rendered pages and the comparison images are all
 * present. Publishing only the changed pages makes a pagination move
 * un-diagnosable, because the explanation is on the pages either side.
 */
export const REQUIRED_ARTEFACTS = [
  'document',          // the generated .docx or .pdf itself
  'rendered-pdf',      // the intermediate PDF, where the stage produces one
  'pages',             // EVERY candidate page, not only the changed ones
  'anchors',           // the semantic anchor manifest
  'page-count',        // the recorded page count
  'baseline-pages',    // what it was compared against
  'diff',              // difference images for changed pages
  'summary-json',      // machine-readable comparison summary
  'summary-txt',       // the human-readable failure summary
]

/** Artefacts required in addition when generation itself failed. */
export const FAILURE_ARTEFACTS = ['stderr', 'command']

/**
 * May this run write a baseline?
 *
 * The answer is no unless the run is an explicitly reviewed update. A comparison
 * run is read-only with respect to committed baselines — including when a
 * baseline is missing, which is exactly when writing one would be most tempting
 * and most damaging.
 */
export function mayWriteBaseline({ mode, event } = {}) {
  if (mode !== 'update') return false
  // A pull_request event must never reach the update path: that event can run
  // code from a fork, and a fork must not be able to rewrite what it is
  // measured against.
  if (event === 'pull_request' || event === 'pull_request_target') return false
  return true
}

/**
 * Validate an update request before anything is re-recorded.
 *
 * Returns a list of problems; [] means the request is permitted. Every field is
 * required because a baseline change with no stated reason is indistinguishable,
 * six months later, from a regression somebody accepted by accident.
 */
export function validateUpdateRequest(request = {}, knownFixtureIds = []) {
  const problems = []
  const { fixture, family, reason, source } = request

  if (!fixture) problems.push('no fixture ID given — an update names exactly one fixture')
  else if (!/^vr-\d{3}$/.test(String(fixture))) {
    problems.push(`"${fixture}" is not a fixture ID (expected vr-NNN)`)
  } else if (knownFixtureIds.length && !knownFixtureIds.includes(String(fixture))) {
    problems.push(`fixture "${fixture}" does not exist`)
  }

  if (!family) problems.push('no renderer family given')
  else if (!RENDERER_FAMILIES.includes(String(family))) {
    problems.push(`"${family}" is not a renderer family (${RENDERER_FAMILIES.join(' or ')})`)
  }

  const why = String(reason || '').trim()
  if (!why) problems.push('no reason given — a baseline change must say why the new appearance is correct')
  else if (why.length < 10) problems.push(`the reason "${why}" is too short to be a reason`)

  if (!String(source || '').trim()) {
    problems.push('no source commit or pull request given, so the change cannot be traced')
  }
  return problems
}

/**
 * Validate a BOOTSTRAP request — the first recording of baselines that do not
 * exist yet.
 *
 * Bootstrapping is a different act from re-recording, and the difference is what
 * makes the relaxed fixture rule safe. A re-record REPLACES an approved
 * appearance, so it must name the one thing it replaces. A bootstrap creates
 * only what is absent; there is no approved appearance to lose, and naming eight
 * fixtures one at a time buys nothing while making the gate unreachable in
 * practice (eight fixtures times two renderer families is sixteen dispatches and
 * sixteen pull requests, which is how a gate ends up permanently red).
 *
 * So `fixture` and `family` become optional and NARROWING — they shrink what is
 * recorded, they never authorise a replacement. `reason` and `source` stay
 * required, because a baseline whose origin is unrecorded is exactly as
 * untraceable whether it was the first one or the fifth.
 */
export function validateBootstrapRequest(request = {}, knownFixtureIds = []) {
  const problems = []
  const { fixture, family, reason, source } = request

  // Given but wrong is an error; absent is the documented default. A silently
  // ignored typo would record every fixture while the operator believed one was
  // selected — the failure mode a narrowing option exists to avoid.
  if (fixture) {
    if (!/^vr-\d{3}$/.test(String(fixture))) {
      problems.push(`"${fixture}" is not a fixture ID (expected vr-NNN)`)
    } else if (knownFixtureIds.length && !knownFixtureIds.includes(String(fixture))) {
      problems.push(`fixture "${fixture}" does not exist`)
    }
  }
  if (family && !RENDERER_FAMILIES.includes(String(family))) {
    problems.push(`"${family}" is not a renderer family (${RENDERER_FAMILIES.join(' or ')})`)
  }

  const why = String(reason || '').trim()
  if (!why) problems.push('no reason given — a baseline change must say why the new appearance is correct')
  else if (why.length < 10) problems.push(`the reason "${why}" is too short to be a reason`)

  if (!String(source || '').trim()) {
    problems.push('no source commit or pull request given, so the change cannot be traced')
  }
  return problems
}

/**
 * Decide which targets a bootstrap may record.
 *
 * The rule that keeps a bootstrap from becoming an unreviewed mass update: a
 * target that ALREADY has a baseline is never recorded, whatever the narrowing
 * options say. Replacing an approved appearance stays the reviewed update path,
 * which names its one fixture and states why.
 *
 * Returns {record, skipped} rather than a filtered list, so a caller — and a
 * test — can assert what was left alone instead of trusting that it was, and so
 * the run can report "kept 3, recorded 13" rather than silently doing less than
 * the operator expected.
 */
export function planBaselineBootstrap(targets = [], { fixture, family } = {}) {
  const record = []
  const skipped = []
  for (const target of targets) {
    if (fixture && target.fixture !== fixture) {
      skipped.push({ ...target, why: 'outside the fixture this run names' })
    } else if (family && target.family !== family) {
      skipped.push({ ...target, why: 'outside the renderer family this run names' })
    } else if (target.hasBaseline) {
      // The whole point. Stated as its own branch so the reason is reportable.
      skipped.push({ ...target, why: 'a baseline already exists — replacing one is a reviewed update' })
    } else {
      record.push(target)
    }
  }
  return { record, skipped }
}

/**
 * Which baseline files a request is allowed to replace.
 *
 * Deliberately expressed as a predicate over paths rather than as a glob passed
 * to a writer: the question "may this file be replaced" is then answerable for
 * every file, including ones the writer did not expect to touch.
 */
export function baselineWriteFilter({ fixture, family }) {
  const prefix = `${family}/`
  return (relativePath) => {
    const p = String(relativePath || '').replace(/\\/g, '/')
    // Family first: a browser update must not rewrite the DOCX baseline.
    if (!p.startsWith(prefix)) return false
    // Then the fixture. Page-numbered files under the one fixture are allowed.
    return new RegExp(`(^|/)${fixture}([./_-]|$)`).test(p)
  }
}

/**
 * Apply a reviewed update to a set of baseline paths.
 *
 * Returns {replaced, untouched} so a caller — and a test — can assert that
 * everything outside the selection was left alone, rather than trusting that it
 * was.
 */
export function planBaselineUpdate(allBaselinePaths, request) {
  const allowed = baselineWriteFilter(request)
  const replaced = []
  const untouched = []
  for (const p of allBaselinePaths) (allowed(p) ? replaced : untouched).push(p)
  return { replaced, untouched }
}

/**
 * The gate's verdict for one fixture and family.
 *
 * The rule the owner asked to be explicit: a STRUCTURAL failure is independent
 * of pixel tolerance. Pagination, page count, a separated diagram and a blank
 * page are not pixel questions, so a permissive tolerance — or a tolerance
 * disabled entirely — cannot approve them. `pixelTolerance` exists here only so
 * that a test can disable it and prove the structural failure survives.
 */
export function gateVerdict({
  fixtureId,
  family,
  pageComparisons = [],
  pagination = null,
  pixelTolerance = 'normal',
} = {}) {
  const structural = []
  const visual = []

  if (pagination && pagination.changed) {
    for (const f of pagination.findings) structural.push({ kind: f.kind, message: f.message })
  }
  // Page count is surfaced separately even though it is already in the findings:
  // a small pixel difference can hide a serious pagination regression, and the
  // summary must not bury it among page-level noise.
  const pageCountChanged = Boolean(pagination && pagination.pageCountChanged)

  if (pixelTolerance !== 'ignore') {
    for (const c of pageComparisons) {
      if (c.comparison?.changed) {
        visual.push({ page: c.pageNumber, reasons: c.comparison.reasons })
      }
    }
  }

  return {
    fixtureId,
    family,
    failed: structural.length > 0 || visual.length > 0,
    // Kept apart so a reviewer reads "the layout moved" separately from "these
    // pixels differ", and so the summary can say which kind of failure it is.
    structural,
    visual,
    pageCountChanged,
    // A structural failure is never waivable by a tolerance setting.
    structurallyFailed: structural.length > 0,
  }
}

/**
 * A human-readable failure summary. Names the fixture ID, never a title.
 */
export function summariseGateVerdict(verdict) {
  if (!verdict) return ''
  // The copy is named as well as the family: "vr-004 [docx]" is ambiguous when a
  // fixture renders both the learner paper and the marking key, and a reviewer
  // needs to know which of the two moved.
  const which = verdict.copy ? `${verdict.family}/${verdict.copy}` : verdict.family
  const lines = [`${verdict.failed ? 'FAILED' : 'ok'}  ${verdict.fixtureId} [${which}]`]
  if (verdict.pageCountChanged) {
    lines.push('  PAGE COUNT CHANGED — reported separately because a small pixel')
    lines.push('  difference can hide a serious pagination regression')
  }
  for (const s of verdict.structural) {
    lines.push(`  structural (${s.kind}): ${s.message}`)
  }
  for (const v of verdict.visual) {
    lines.push(`  page ${v.page}: ${v.reasons.join('; ')}`)
  }
  return lines.join('\n')
}

/**
 * Every artefact that must be present for this run to be reviewable.
 *
 * `generationFailed` adds the renderer's stderr and the exact command, because
 * when generation is what broke, those two are the only useful evidence and a
 * page image is worthless.
 */
export function requiredArtefacts({ generationFailed = false } = {}) {
  return generationFailed
    ? [...REQUIRED_ARTEFACTS, ...FAILURE_ARTEFACTS]
    : [...REQUIRED_ARTEFACTS]
}

/**
 * Should the run proceed to comparison?
 *
 * No, when generation itself was invalid. Comparing partially generated output
 * produces a diff that looks like a rendering change and is actually a broken
 * render — and a reviewer who accepts it commits a baseline of a broken paper.
 */
export function shouldProceedToComparison({ generationFailed = false } = {}) {
  return !generationFailed
}

/**
 * Validate a SWEEP update — re-recording every baseline a code change moved, in
 * one run, onto the pull request that caused it.
 *
 * ## Why this exists beside `validateUpdateRequest`
 *
 * The one-fixture rule is right for its case: a re-record REPLACES an approved
 * appearance, so it must name the one thing it replaces and say why. But a
 * change that legitimately moves EVERY fixture — the paper's header wording, the
 * Word export's margins — turns that rule into sixteen dispatches and sixteen
 * pull requests, which `validateBootstrapRequest` already identifies, in those
 * words, as "how a gate ends up permanently red".
 *
 * ## What makes relaxing it safe here
 *
 * Not the operator's good intentions. Three structural conditions:
 *
 *  - `pullRequest` is REQUIRED, and the baselines are committed to that pull
 *    request's own branch. So the new appearance is reviewed — alongside the
 *    code change that caused it, which is strictly more informative than a
 *    baseline pull request reviewed on its own, where a reviewer sees changed
 *    pixels and has to go and find out what moved them.
 *  - the destination may never be the default branch (`assertBaselineDestination`).
 *    Branch protection then applies to the result exactly as before.
 *  - `reason` and `source` stay required and unchanged. A baseline whose origin
 *    is unrecorded is equally untraceable however many were recorded at once.
 *
 * `fixture` and `family` remain available and NARROWING, same as the bootstrap:
 * they shrink what is recorded, they never widen it.
 */
export function validateSweepUpdateRequest(request = {}, knownFixtureIds = []) {
  const problems = validateBootstrapRequest(request, knownFixtureIds)

  // The condition that carries the review guarantee. Without a pull request
  // there is nowhere for the new appearance to be reviewed, and the sweep would
  // be exactly the unreviewed mass update the one-fixture rule exists to stop.
  const pr = String(request.pullRequest || '').trim()
  if (!pr) {
    problems.push(
      'no pull request given — a sweep re-records many baselines at once and is only '
      + 'permitted onto the pull request whose change moved them, where they are reviewed',
    )
  } else if (!/^\d+$/.test(pr)) {
    problems.push(`"${pr}" is not a pull request number`)
  }
  return problems
}

/**
 * Refuse to write baselines anywhere but a feature branch.
 *
 * Stated as its own function, and tested, because it is the one guarantee that
 * cannot be restored after the fact: a baseline pushed straight to the default
 * branch has skipped every review the rest of this design is built around, and
 * nothing downstream can tell it apart from one that was reviewed.
 */
export function assertBaselineDestination(branch, defaultBranch = 'main') {
  const target = String(branch || '').trim().replace(/^refs\/heads\//, '')
  const base = String(defaultBranch || 'main').trim().replace(/^refs\/heads\//, '')
  const problems = []
  if (!target) {
    problems.push('no destination branch — a baseline write must name the branch it lands on')
  } else if (target === base) {
    problems.push(
      `refusing to write baselines to "${target}", the default branch — `
      + 'they must land on a branch so branch protection and review apply',
    )
  }
  return problems
}
