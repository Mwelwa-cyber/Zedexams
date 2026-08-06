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
 */
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  BASELINE_SUMMARY_FILE, BASELINE_SUMMARY_ENTRIES, renderBaselineSummary,
} from './baselineSummary.js'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

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
  const dirs = artifactDirs(incoming)
  if (!dirs.length) {
    console.error(`no recording artifacts under ${incoming} — nothing was recorded, so there is nothing to review`)
    process.exit(1)
  }
  console.log(`collecting ${dirs.length} recording artifact${dirs.length === 1 ? '' : 's'}:`)
  for (const dir of dirs) console.log(`  ${path.basename(dir)}`)

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
