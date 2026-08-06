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
 * ## The recordings must ARRIVE, and a lost one must say so
 *
 * Splitting the jobs put a network hop between recording a baseline and
 * committing it, and nothing downstream could see across it. The pull-request
 * job's `if:` proves neither recorder FAILED; it cannot prove what either one
 * DELIVERED. So a recorder that succeeded and whose artifact never arrived —
 * an upload that matched no files, an expired or renamed artifact, a download
 * `pattern` edited to match one of the two — left this script collecting
 * whatever did turn up and reporting it as the whole story. That is a pull
 * request describing half its own diff: the failure the entry merge above
 * exists to prevent, arriving by the one route the merge cannot see, because
 * entries that were never downloaded cannot be noticed missing from a union.
 *
 * The fix is to be TOLD what was owed rather than to infer it from what came
 * back. Each recorder's job result reaches this script as an environment
 * variable: `success` means that recorder ran to completion and its artifact
 * must be here, `skipped` means the dispatch narrowed it away and nothing is
 * owed. An owed recording that did not arrive is named, along with the
 * families whose baselines are therefore absent from the review, and the run
 * stops before a pull request is opened.
 *
 * A result this script was not given is refused rather than read as "nothing
 * owed". A check whose condition is never supplied is a check that never
 * fires, and it fails open silently — which is the shape of the bug it is here
 * to catch.
 *
 * Usage:  node scripts/visual/collectBootstrapRecordings.mjs <incoming-dir>
 *
 * `<incoming-dir>` is where `actions/download-artifact` put the artifacts, one
 * subdirectory per artifact. A missing directory, or one with no artifacts in
 * it, is reported and exits non-zero: the pull-request job must not open an
 * empty pull request from a run that recorded nothing.
 */
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  BASELINE_SUMMARY_FILE, BASELINE_SUMMARY_ENTRIES, renderBaselineSummary,
} from './baselineSummary.js'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

/** Where a recorder's artifact carries the baselines it wrote. */
const BASELINES_IN_ARTIFACT = 'tests/visual/baselines'

/**
 * The bootstrap's recorders, and what each one hands over.
 *
 * Declared here rather than in the workflow so the check is over a KNOWN set:
 * a third renderer family gets a recorder job, an entry in this list and the
 * arrival check together, instead of a job whose loss nothing looks for.
 */
export const RECORDERS = [
  {
    job: 'record-paper',
    env: 'RECORD_PAPER_RESULT',
    artifact: 'bootstrap-recording-paper',
    families: 'the paper families (browser-print, docx)',
  },
  {
    job: 'record-screen',
    env: 'RECORD_SCREEN_RESULT',
    artifact: 'bootstrap-recording-screen',
    families: 'the screen family',
  },
]

/**
 * What this run is OWED, from each recorder's job result.
 *
 * `success` owes an artifact. `skipped` owes nothing — a narrowed dispatch runs
 * one recorder and that is a normal outcome. Every other value, including a
 * result that was never passed in, lands in `unknown`: `failure` and
 * `cancelled` cannot reach this job (the workflow's `if:` refuses them), so
 * seeing one means the wiring changed, and an empty string means this script
 * was not told. Neither is safe to read as "nothing owed", which is the answer
 * that would quietly restore the behaviour this exists to end.
 */
export function expectedRecordings(results = {}) {
  const owed = []
  const skipped = []
  const unknown = []
  for (const recorder of RECORDERS) {
    const result = String(results[recorder.job] ?? '').trim()
    if (result === 'success') owed.push(recorder)
    else if (result === 'skipped') skipped.push(recorder)
    else unknown.push({ ...recorder, result })
  }
  return { owed, skipped, unknown }
}

/**
 * The owed recordings that did not arrive, each with the reason it counts lost.
 *
 * Arrival is not the directory existing — it is the baselines being IN it. An
 * artifact that lost its `tests/visual/baselines` tree in transit still carries
 * its summary sidecar, so the review sheet would describe baselines that never
 * reach the commit: a pull request whose body and whose diff disagree, which is
 * worse than one that is merely incomplete.
 */
export function missingRecordings(owed, incoming) {
  const lost = []
  for (const recorder of owed) {
    const dir = path.join(incoming, recorder.artifact)
    if (!existsSync(dir)) {
      lost.push({ ...recorder, why: 'no artifact by that name was downloaded' })
    } else if (!existsSync(path.join(dir, BASELINES_IN_ARTIFACT))) {
      lost.push({ ...recorder, why: `the artifact arrived without its ${BASELINES_IN_ARTIFACT} tree` })
    }
  }
  return lost
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
    const sidecar = path.join(dir, 'tests/visual/output', BASELINE_SUMMARY_ENTRIES)
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

function main() {
  const incoming = path.resolve(process.argv[2] || 'incoming')

  // What was owed, decided BEFORE looking at what came back — otherwise the
  // answer is whatever arrived, which is the question.
  const { owed, skipped, unknown } = expectedRecordings(
    Object.fromEntries(RECORDERS.map((r) => [r.job, process.env[r.env]])),
  )
  if (unknown.length) {
    for (const recorder of unknown) {
      console.error(
        `cannot tell what ${recorder.job} produced: ${recorder.env} is `
        + `${recorder.result ? `"${recorder.result}"` : 'not set'}, and only "success" or "skipped" reach this job. `
        + 'Without it a lost recording cannot be told from one that was never dispatched.',
      )
    }
    process.exit(1)
  }
  for (const recorder of skipped) {
    console.log(`${recorder.job} was skipped by this dispatch — ${recorder.families} are not part of this review`)
  }

  const dirs = artifactDirs(incoming)
  if (!dirs.length) {
    console.error(`no recording artifacts under ${incoming} — nothing was recorded, so there is nothing to review`)
    process.exit(1)
  }
  console.log(`collecting ${dirs.length} recording artifact${dirs.length === 1 ? '' : 's'}:`)
  for (const dir of dirs) console.log(`  ${path.basename(dir)}`)

  // Nothing is copied, merged or written from a run that is about to be
  // refused: the loss is reported against the recorder that suffered it, not
  // as a thinner review sheet nobody can read as thin.
  const lost = missingRecordings(owed, incoming)
  if (lost.length) {
    for (const recorder of lost) {
      console.error(
        `${recorder.job} succeeded but its recording never arrived: ${recorder.why} `
        + `(expected "${recorder.artifact}" under ${incoming}). `
        + `Baselines for ${recorder.families} would be missing from this review, so no pull request is opened.`,
      )
    }
    console.error(
      '\nA pull request assembled from what happened to arrive describes half its own diff. '
      + 'Re-run the dispatch; if the recorder logs show it wrote baselines, its upload or the '
      + "download pattern is what lost them, not the recording.",
    )
    process.exit(1)
  }

  for (const dir of dirs) {
    const baselines = path.join(dir, 'tests/visual/baselines')
    if (existsSync(baselines)) {
      cpSync(baselines, path.join(ROOT, 'tests/visual/baselines'), { recursive: true })
    }
  }

  const entries = mergeSummaryEntries(dirs)
  const outputDir = path.join(ROOT, 'tests/visual/output')
  mkdirSync(outputDir, { recursive: true })
  writeFileSync(path.join(outputDir, BASELINE_SUMMARY_ENTRIES), `${JSON.stringify(entries, null, 2)}\n`)
  writeFileSync(path.join(outputDir, BASELINE_SUMMARY_FILE), renderBaselineSummary(entries))
  console.log(`\n${entries.length} baseline${entries.length === 1 ? '' : 's'} described in the review sheet`)

  if (!entries.length) {
    // Every baseline already existed. A legitimate outcome, and the workflow's
    // own "nothing to commit" branch reports it — but there is no sheet to
    // review, so say so rather than leaving an empty file behind.
    console.log('(no NEW baselines were recorded — every one already existed)')
  }
}

if (import.meta.url === `file://${process.argv[1]}`) main()
