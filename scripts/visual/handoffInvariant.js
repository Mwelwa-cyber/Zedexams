/**
 * The handoff invariant: what the recorders wrote must be what arrives.
 *
 * ## The failure this exists for
 *
 * Splitting the bootstrap into two recorder jobs (#2138) meant the recordings
 * stopped being files already in the pull-request job's workspace and started
 * being ARTIFACTS. Run 31094944867 recorded all sixteen screen baselines, packed
 * them into a 4,990,794-byte artifact, and then collected **zero** of them,
 * because `upload-artifact@v4` takes the least common ancestor of its search
 * paths as the archive root — so the zip held `baselines/…` and `output/…` while
 * the collector looked under `tests/visual/…`.
 *
 * Nothing failed. The collector reported "0 baselines described in the review
 * sheet", the pull-request step found nothing staged, printed *"Every baseline
 * already exists — nothing was recorded"* and exited **0**. A green run that
 * produced nothing, wearing the message of a legitimate outcome.
 *
 * That is the shape worth naming: the bug did not break a check, it walked into
 * an existing success path. "Nothing to commit" is a real outcome — every
 * baseline already existed — and it is indistinguishable from total handoff loss
 * unless something states, from OUTSIDE the thing that went missing, how many
 * baselines were supposed to arrive.
 *
 * ## Why the count travels as a job output and not in the artifact
 *
 * Out-of-band, deliberately. A count carried inside the artifact would have been
 * lost by exactly the same layout bug it is meant to catch: the collector would
 * have read zero expected and zero collected, agreed with itself, and stayed
 * green. The recorder therefore writes the number to `$GITHUB_OUTPUT`, which
 * reaches the pull-request job through the Actions API — a channel the archive
 * layout cannot touch.
 *
 * The number is the recorder's own `wrote` counter, taken from the loop that
 * writes the files, not re-derived afterwards from something on disk. A
 * re-derivation can agree with a broken write; the counter cannot.
 */
import { appendFileSync } from 'node:fs'

/** The job-output name both recorders write, and the workflow re-exports. */
export const RECORDED_COUNT_OUTPUT = 'recorded'

/** Prefix on every failure this module raises, so a control can assert on it. */
export const HANDOFF_FAILURE = 'HANDOFF'

/**
 * How many baselines the recorders say they wrote.
 *
 * Takes each family's job `result` alongside its reported count, because the
 * two answer different questions and only the pair is conclusive:
 *
 *   • `skipped`  — the dispatch narrowed to the other family. Contributes 0,
 *     and a blank count is CORRECT rather than suspicious.
 *   • `success`  — the recorder ran. It must have reported a number. A blank
 *     here is the invariant itself going missing (the step that emits the count
 *     was edited away, or never ran), which must fail rather than default to 0 —
 *     defaulting to 0 would make every subsequent comparison vacuously true.
 *   • anything else — the pull-request job's own `if:` should have stopped the
 *     run. Refused here too, because a guard that exists in one place is a guard
 *     that moves.
 *
 * @param {Record<string, {result: string, recorded: string|number|undefined}>} jobs
 * @returns {{expected: number, byFamily: Record<string, number>}}
 */
export function resolveExpectedRecordings(jobs) {
  const byFamily = {}
  for (const [family, job] of Object.entries(jobs ?? {})) {
    const result = job?.result ?? ''
    if (result === 'skipped') { byFamily[family] = 0; continue }
    if (result !== 'success') {
      throw new Error(
        `${HANDOFF_FAILURE} REFUSED: the ${family} recorder finished as "${result || '(no result)'}", `
        + 'so this run did not record what it set out to record. A half-recorded bootstrap '
        + 'must not become a pull request.',
      )
    }
    const count = parseCount(job?.recorded)
    if (count === null) {
      throw new Error(
        `${HANDOFF_FAILURE} UNREPORTED: the ${family} recorder succeeded but reported no baseline `
        + `count (got ${JSON.stringify(job?.recorded ?? null)}). The count is what proves the `
        + 'recordings survived the handoff, so a missing one is a failure, never a zero.',
      )
    }
    byFamily[family] = count
  }
  return { expected: Object.values(byFamily).reduce((a, b) => a + b, 0), byFamily }
}

/**
 * Refuse to continue unless every recorded baseline arrived.
 *
 * `expected === 0 && collected === 0` is the one legitimate quiet outcome: a
 * re-dispatch where every baseline already existed. It is legitimate ONLY
 * because the recorder independently said zero — which is the whole point of
 * asking it.
 */
export function assertHandoffComplete({ expected, collected }) {
  if (collected === expected) return
  if (collected > expected) {
    throw new Error(
      `${HANDOFF_FAILURE} INCONSISTENT: ${collected} baseline(s) arrived but the recorders only `
      + `wrote ${expected}. The artifacts carry a sidecar from an earlier run, so this pull `
      + 'request would describe baselines this run never recorded.',
    )
  }
  throw new Error(
    `${HANDOFF_FAILURE} INCOMPLETE: the recorders wrote ${expected} baseline(s) but only ${collected} `
    + 'arrived in the pull-request job.\n\n'
    + 'The renders were made and then lost between the jobs — check the artifact layout against '
    + 'ARTIFACT_ROOT_CANDIDATES in collectBootstrapRecordings.mjs. This must never be reported as '
    + '"nothing to commit": that message means every baseline already existed, and it is only true '
    + 'when the recorders themselves reported zero.',
  )
}

/**
 * Publish the count for the next job.
 *
 * Takes the file path rather than reading `process.env` so a test drives it
 * against a real file instead of stubbing the environment. Absent path — every
 * local run — writes nothing and is not an error.
 *
 * Appends rather than writes: `$GITHUB_OUTPUT` is shared by every step in the
 * job, and truncating it would silently drop outputs this file knows nothing
 * about.
 */
export function writeRecordedCount(count, githubOutputPath) {
  if (!githubOutputPath) return false
  const value = parseCount(count)
  if (value === null) {
    throw new Error(
      `${HANDOFF_FAILURE} UNREPORTABLE: refusing to publish a baseline count of `
      + `${JSON.stringify(count)} — the next job would read it as zero and pass.`,
    )
  }
  appendFileSync(githubOutputPath, `${RECORDED_COUNT_OUTPUT}=${value}\n`)
  return true
}

function parseCount(value) {
  if (typeof value === 'number') return Number.isInteger(value) && value >= 0 ? value : null
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!/^\d+$/.test(trimmed)) return null
  return Number(trimmed)
}
