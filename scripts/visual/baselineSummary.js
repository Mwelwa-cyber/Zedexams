/**
 * The baseline review sheet — one builder, every renderer family.
 *
 * A baseline pull request's BODY is this file. It is what a reviewer approving
 * the first appearance of a render actually reads, and approving it approves
 * every baseline in the diff as the reference each later comparison is measured
 * against. So the sheet has one job: describe **every** recorded baseline, and
 * lead with how many there are, so a reviewer can see at a glance that the
 * number in the diff is the number described below it.
 *
 * ## Why this is a module and not a function inside one runner
 *
 * It lived inside `runVisualGate.mjs`, the PAPER recorder. The screen recorder
 * is a second entry point with its own stage, and it wrote no sheet at all — so
 * `visual-baseline-bootstrap.yml`, which hard-stops when the sheet is missing,
 * failed at the pull-request step on **every** `family=screen` dispatch, after
 * a successful recording. The images were rendered, committed and pushed; the
 * only thing missing was the page describing them.
 *
 * The workflow-side assertion existed (`gate.test.js`: every writer reads
 * `baseline-summary.md` and exits 1 without it). The recorder-side one did not,
 * so "a recorder that can write a baseline produces a review sheet" was true of
 * one recorder and untested for the other, and it reached main green.
 *
 * ## Entries accumulate across recorders, they do not overwrite
 *
 * A `family=all` dispatch runs both recorders in one job, into one output
 * directory. If each wrote the sheet outright, the second would erase the
 * first's and the pull request would describe half its own diff — the exact
 * failure the per-record version of this function was written to avoid, moved
 * up one level. Entries are therefore appended to a sidecar and the sheet is
 * re-rendered from all of them, so the count is always the true total.
 *
 * De-duplication is on `key` so a re-run in a directory that still holds a
 * previous run's sidecar reports what it recorded rather than twice that.
 */
import fs from 'node:fs'
import path from 'node:path'

/** The file every writer workflow reads as `--body-file`. */
export const BASELINE_SUMMARY_FILE = 'baseline-summary.md'

/** The machine-readable accumulation behind it. Never read by a human. */
export const BASELINE_SUMMARY_ENTRIES = 'baseline-summary.entries.json'

const CLOSING = 'Every one is described in full below. Approving this pull request '
  + 'approves all of them as the reference each later comparison is measured against.'

/**
 * @typedef {object} BaselineSummaryEntry
 * @property {string}   key      stable identity for de-duplication
 * @property {string}   family   'browser-print' | 'docx' | 'screen'
 * @property {string[]} columns  index-table headers for this family
 * @property {string[]} cells    this entry's index-table row
 * @property {string}   section  the full markdown description
 */

/**
 * Render the sheet.
 *
 * One index table per family, because the families do not describe themselves
 * with the same facts — a paper baseline has a page count and a copy, a screen
 * baseline has a viewport and a pixel size — and flattening them into shared
 * column names would make both vaguer to spare the builder a `groupBy`.
 *
 * A single entry gets no index at all: the update workflow records one fixture,
 * and a one-row table above one description is furniture.
 */
export function renderBaselineSummary(entries) {
  const list = dedupe(entries)
  if (!list.length) return ''
  const sections = list.map((e) => e.section)
  if (list.length === 1) return sections[0]

  const families = [...new Set(list.map((e) => e.family))]
  const tables = families.map((family) => {
    const rows = list.filter((e) => e.family === family)
    const columns = rows[0].columns
    const mismatch = rows.find((r) => r.columns.join('|') !== columns.join('|'))
    if (mismatch) {
      throw new Error(
        `the ${family} entries disagree about the index columns (${mismatch.cells.join(', ')}) — `
        + 'one family describes itself one way',
      )
    }
    return `## ${family} (${rows.length})\n\n`
      + `| ${columns.join(' | ')} |\n|${columns.map(() => '---').join('|')}|\n`
      + rows.map((r) => `| ${r.cells.join(' | ')} |`).join('\n')
  })

  return `# ${list.length} baselines recorded\n\n${tables.join('\n\n')}\n\n${CLOSING}\n\n---\n\n`
    + sections.join('\n\n---\n\n')
}

/**
 * Add one entry and rewrite the sheet.
 *
 * Returns the sheet's path and every entry known so far, so a caller can report
 * the count it actually recorded rather than the count it intended to.
 */
export function appendBaselineSummaryEntry(outputDir, entry) {
  assertEntry(entry)
  fs.mkdirSync(outputDir, { recursive: true })
  const sidecar = path.join(outputDir, BASELINE_SUMMARY_ENTRIES)
  const entries = dedupe([...readEntries(sidecar), entry])
  fs.writeFileSync(sidecar, `${JSON.stringify(entries, null, 2)}\n`)
  const file = path.join(outputDir, BASELINE_SUMMARY_FILE)
  fs.writeFileSync(file, renderBaselineSummary(entries))
  return { file, entries }
}

/** Entries recorded so far, or none. A damaged sidecar is treated as none —
 *  the run in progress can still describe what IT recorded, and a sheet that
 *  throws mid-record would abandon baselines already written to disk. */
export function readEntries(sidecar) {
  try {
    const parsed = JSON.parse(fs.readFileSync(sidecar, 'utf8'))
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

/** Later entries win, order of first appearance is kept. */
function dedupe(entries) {
  const byKey = new Map()
  for (const entry of entries) byKey.set(entry.key, entry)
  return [...byKey.values()]
}

function assertEntry(entry) {
  for (const field of ['key', 'family', 'section']) {
    if (typeof entry?.[field] !== 'string' || !entry[field]) {
      throw new Error(`a baseline summary entry needs a non-empty ${field}`)
    }
  }
  if (!Array.isArray(entry.columns) || !Array.isArray(entry.cells)
    || entry.columns.length !== entry.cells.length || !entry.columns.length) {
    throw new Error('a baseline summary entry needs matching, non-empty columns and cells')
  }
}
