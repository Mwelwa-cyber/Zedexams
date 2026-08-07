#!/usr/bin/env node
/**
 * Gather what the recording jobs produced, into one tree and one review sheet.
 *
 * The bootstrap records on TWO runners now, because the two renderer families
 * need incompatible environments: the paper families want LibreOffice, and the
 * screen family must never see it (`assertScreenEnvironmentIsClean` — a screen
 * baseline stamped with a libreoffice version and its font digest is one no
 * comparing job can ever reproduce). Splitting the environments means splitting
 * the jobs, and splitting the jobs means the recordings arrive as artifacts
 * rather than as files already in the workspace.
 *
 * Two things therefore have to be merged rather than copied:
 *
 *   • the BASELINES — each job's artifact carries the whole
 *     `tests/visual/baselines` tree, most of it unchanged. Copying every file
 *     is safe: identical bytes stage as nothing, and `git add` sees only what
 *     actually changed.
 *   • the REVIEW SHEET — each job wrote its own `baseline-summary.entries.json`
 *     against its own runner, so neither is the whole story. Overwriting one
 *     with the other is how a pull request ends up describing half its own
 *     diff, which is the failure `baselineSummary.js` exists to prevent. The
 *     entries are unioned and the sheet re-rendered from all of them.
 *
 * Usage:  node scripts/visual/collectBootstrapRecordings.mjs <incoming-dir>
 *
 * `<incoming-dir>` is where `actions/download-artifact` put the artifacts, one
 * subdirectory per artifact. A missing directory, or one with no artifacts in
 * it, is reported and exits non-zero: the pull-request job must not open an
 * empty pull request from a run that recorded nothing.
 *
 * ## The artifact's root is FOUND, not assumed
 *
 * `upload-artifact@v4` roots the archive at the least common ancestor of the
 * files its search paths matched. Both recorders upload two paths —
 * `tests/visual/baselines/**` and `tests/visual/output/**` — so that ancestor is
 * `tests/visual`, and the zip contains `baselines/…` and `output/…` with the
 * prefix STRIPPED. This script's first version joined `tests/visual` onto each
 * artifact directory, found nothing, and reported it as "0 baselines" — a green
 * run that silently discarded 5 MB of correct renders (run 31094944867).
 *
 * The layout is therefore probed against a declared list rather than hard-coded,
 * and the probe is not the safety net: `handoffInvariant.js` compares what
 * arrives against what the recorders said they wrote, out of band. A layout this
 * list does not cover fails loudly instead of collecting nothing quietly.
 */
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  BASELINE_SUMMARY_FILE, BASELINE_SUMMARY_ENTRIES, renderBaselineSummary,
} from './baselineSummary.js'
import { assertHandoffComplete, resolveExpectedRecordings } from './handoffInvariant.js'
import { isDirectRun } from '../lib/isDirectRun.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

/**
 * Where `tests/visual` may sit inside a downloaded artifact, in probe order.
 *
 * `''` is the layout v4 actually produces today; `tests/visual` is what a
 * single-path upload would produce, and what this script assumed. Both are
 * listed because the action's rooting rule is its business, not ours — pinning
 * one and being wrong is how this failed the first time.
 */
export const ARTIFACT_ROOT_CANDIDATES = Object.freeze(['tests/visual', ''])

/** The trees a recording artifact is recognised by. */
const RECORDING_TREES = Object.freeze(['baselines', 'output'])

/**
 * The directory inside `artifactDir` that holds `baselines/` and `output/`,
 * or null if this artifact carries neither under any known layout.
 */
export function resolveVisualRoot(artifactDir) {
  for (const candidate of ARTIFACT_ROOT_CANDIDATES) {
    const base = candidate ? path.join(artifactDir, candidate) : artifactDir
    if (RECORDING_TREES.some((tree) => existsSync(path.join(base, tree)))) return base
  }
  return null
}

/**
 * The baseline files one entry describes, relative to `baselines/`.
 *
 * A screen capture is one file; a paper baseline is a directory of rendered
 * pages plus its metadata, and naming the DIRECTORY was the defect — it exists
 * as long as any single file inside it survives, so an artifact that lost every
 * `page-N.png` but kept `environment.json` passed arrival.
 *
 * The legacy single `path` is still read, as one file. Sidecars are written and
 * consumed within one run so no old one can be in flight, but a normaliser that
 * silently returns nothing for a shape it does not recognise would report the
 * entry as unverifiable rather than crash — and this is the function that
 * decides what "names nothing" means.
 */
export function entryPaths(entry) {
  if (Array.isArray(entry?.paths)) {
    return entry.paths.filter((p) => typeof p === 'string' && p)
  }
  if (typeof entry?.path === 'string' && entry.path) return [entry.path]
  return []
}

/**
 * An artifact that describes baselines it did not bring.
 *
 * The count invariant compares what the recorders WROTE against what the review
 * sheet DESCRIBES, and both of those live in the summary sidecar. An artifact
 * that arrived carrying its `output/` tree but not its `baselines/` tree
 * satisfies it perfectly: sixteen entries expected, sixteen entries merged,
 * green — and then `git add tests/visual/baselines` stages nothing and the run
 * prints "nothing to commit". A pull request whose body approves sixteen
 * baselines over an empty diff, or no pull request at all.
 *
 * Which is worse than an obviously empty hand-off, because the body reads as
 * evidence. Found by the parallel implementation in #2142, whose arrival check
 * covers a case the count check structurally cannot: the count is derived from
 * one half of the artifact and cannot notice the other half missing.
 *
 * ## Each DESCRIBED FILE is checked, never the tree
 *
 * The first version of this asked whether a `baselines/` directory existed, and
 * that proves nothing. Every recorder uploads `tests/visual/baselines/**` from a
 * checkout that ALREADY contains the committed browser-print and docx
 * baselines — so a screen artifact that lost all sixteen of its new pages still
 * carries a large, non-empty `baselines/` tree of unrelated tracked files, and
 * the check passed on precisely the dispatch it exists for. Raised by Codex on
 * #2142 (`r3729107231`), three minutes after that pull request merged.
 *
 * So every entry names the file it describes and every named file must be
 * present. An entry that names nothing is itself a failure: it cannot be
 * verified, and treating unverifiable as acceptable is how the tree check
 * passed.
 *
 * @returns {string[]} why each hollow artifact is hollow; empty when all are whole
 */
export function hollowArtifacts(dirs) {
  const hollow = []
  for (const dir of dirs) {
    const visualRoot = resolveVisualRoot(dir)
    if (!visualRoot) continue                       // reported separately, as UNREADABLE
    const sidecar = path.join(visualRoot, 'output', BASELINE_SUMMARY_ENTRIES)
    if (!existsSync(sidecar)) continue              // describes nothing, so owes nothing
    let entries = []
    try {
      const parsed = JSON.parse(readFileSync(sidecar, 'utf8'))
      entries = Array.isArray(parsed) ? parsed : []
    } catch { continue }
    if (!entries.length) continue

    const unnamed = entries.filter((e) => !entryPaths(e).length)
    if (unnamed.length) {
      hollow.push(
        `${path.basename(dir)} has ${unnamed.length} `
        + (unnamed.length === 1
          ? 'entry that does not name the baseline files it describes'
          : 'entries that do not name the baseline files they describe')
        + ', so arrival cannot be verified',
      )
      continue
    }
    const missing = entries
      .flatMap(entryPaths)
      .filter((rel) => !existsSync(path.join(visualRoot, 'baselines', rel)))
    if (missing.length) {
      hollow.push(
        `${path.basename(dir)} describes ${entries.length} baseline(s) but ${missing.length} file(s) `
        + `did not arrive: ${missing.slice(0, 4).join(', ')}${missing.length > 4 ? ', …' : ''}`,
      )
    }
  }
  return hollow
}

/** Every artifact directory under `incoming`, in a stable order. */
export function artifactDirs(incoming) {
  if (!existsSync(incoming)) return []
  return readdirSync(incoming, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => path.join(incoming, e.name))
    .sort()
}

/**
 * Union of the review-sheet entries each artifact carries.
 *
 * Later entries win on a duplicate key, which cannot happen across families
 * (the key is prefixed by family) and is harmless within one.
 */
export function mergeSummaryEntries(dirs) {
  const byKey = new Map()
  for (const dir of dirs) {
    const visualRoot = resolveVisualRoot(dir)
    if (!visualRoot) continue
    const sidecar = path.join(visualRoot, 'output', BASELINE_SUMMARY_ENTRIES)
    if (!existsSync(sidecar)) continue
    let parsed
    try {
      parsed = JSON.parse(readFileSync(sidecar, 'utf8'))
    } catch {
      continue
    }
    if (!Array.isArray(parsed)) continue
    for (const entry of parsed) byKey.set(entry?.key, entry)
  }
  return [...byKey.values()].filter((e) => e && typeof e.key === 'string')
}

/**
 * What the recorder jobs reported, read from the environment the workflow sets.
 *
 * Each family contributes a `result` (so a skipped job is told apart from a
 * silent one) and a `recorded` count. Both come from the Actions API via
 * `needs.*`, never from the artifact — see `handoffInvariant.js`.
 */
export function recorderJobsFromEnv(env = process.env) {
  return {
    paper: { result: env.PAPER_RESULT ?? '', recorded: env.PAPER_RECORDED },
    screen: { result: env.SCREEN_RESULT ?? '', recorded: env.SCREEN_RECORDED },
  }
}

/**
 * Collect `incoming` into `destRoot`. Throws rather than exiting, so the whole
 * path — probe, copy, merge, invariant — is drivable by a test against a
 * temporary directory.
 *
 * `destRoot` is a parameter for exactly one reason: every defect this file has
 * had lived in the WIRING between correct pieces, and a suite that can only
 * reach the pieces is the suite that already passed while the real handoff
 * collected nothing.
 */
export function collectRecordings({ incoming, destRoot, jobs, log = () => {} }) {
  const dirs = artifactDirs(incoming)
  if (!dirs.length) {
    throw new Error(
      `no recording artifacts under ${incoming} — nothing was recorded, so there is nothing to review`,
    )
  }
  log(`collecting ${dirs.length} recording artifact${dirs.length === 1 ? '' : 's'}:`)

  // Both trees are copied. `baselines` becomes the diff; `output` is the
  // rendered evidence the next step uploads — and every review-sheet section
  // ends with "Every rendered page is attached to the workflow run", which was
  // false while this copied only the baselines: the evidence artifact held the
  // two rebuilt summary files and nothing else, 309 bytes.
  for (const dir of dirs) {
    const visualRoot = resolveVisualRoot(dir)
    if (!visualRoot) {
      throw new Error(
        `HANDOFF UNREADABLE: artifact ${path.basename(dir)} carries no baselines/ or output/ tree `
        + `under any known layout (${ARTIFACT_ROOT_CANDIDATES.map((c) => c || '<root>').join(', ')}).\n`
        + 'The recording was made and then lost in transit. Nothing is collected from a run whose '
        + 'renders cannot be found — that is how 5 MB of correct baselines were once reported as zero.',
      )
    }
    log(`  ${path.basename(dir)} (tests/visual at ${path.relative(dir, visualRoot) || '<artifact root>'})`)
    for (const tree of RECORDING_TREES) {
      const from = path.join(visualRoot, tree)
      if (existsSync(from)) cpSync(from, path.join(destRoot, 'tests/visual', tree), { recursive: true })
    }
  }

  // Checked BEFORE the counts, because a hollow artifact PASSES the count
  // invariant — both sides of that comparison are read from the sidecar this
  // artifact still has. Reported on its own terms rather than as a miscount.
  const hollow = hollowArtifacts(dirs)
  if (hollow.length) {
    throw new Error(
      `HANDOFF HOLLOW: ${hollow.length} artifact(s) describe baselines they did not bring:\n`
      + hollow.map((h) => `  ${h}`).join('\n')
      + '\n\nThe review sheet would approve baselines that are not in the diff — a body that reads '
      + 'as evidence over a pull request that changes nothing. Re-run the dispatch; if the recorder '
      + 'logs show it wrote baselines, its upload lost them.',
    )
  }

  const entries = mergeSummaryEntries(dirs)
  const outputDir = path.join(destRoot, 'tests/visual/output')
  mkdirSync(outputDir, { recursive: true })
  // Written AFTER the output trees are copied, so the merged sheet is the one
  // that survives rather than whichever recorder's copy landed last.
  writeFileSync(path.join(outputDir, BASELINE_SUMMARY_ENTRIES), `${JSON.stringify(entries, null, 2)}\n`)
  writeFileSync(path.join(outputDir, BASELINE_SUMMARY_FILE), renderBaselineSummary(entries))
  log(`\n${entries.length} baseline${entries.length === 1 ? '' : 's'} described in the review sheet`)

  // The invariant. What the recorders said they wrote must be what arrived, and
  // the recorders said it through the Actions API rather than through the
  // archive that can lose it.
  const { expected, byFamily } = resolveExpectedRecordings(jobs)
  log(`recorders reported: ${Object.entries(byFamily).map(([f, n]) => `${f}=${n}`).join(', ')} (${expected} total)`)
  assertHandoffComplete({ expected, collected: entries.length })

  if (!entries.length) {
    // Legitimate ONLY because the recorders independently reported zero, which
    // the assertion above has just confirmed. Every baseline already existed.
    log('(no NEW baselines were recorded — every one already existed, and both recorders said so)')
  }
  return { entries, expected, byFamily }
}

function main() {
  try {
    collectRecordings({
      incoming: path.resolve(process.argv[2] || 'incoming'),
      destRoot: ROOT,
      jobs: recorderJobsFromEnv(),
      log: (line) => console.log(line),
    })
  } catch (err) {
    console.error(`\n${err.message}`)
    process.exit(1)
  }
}

if (isDirectRun(import.meta.url)) main()
