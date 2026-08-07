/**
 * The §7a sweep command has to be runnable by the person reading it.
 *
 * It was not. `MIGRATION_TEMPLATE.md` documented
 * `gh pr view <n> --json reviewThreads,comments`, which exits 1 —
 * `reviewThreads` is a GraphQL `PullRequest` field and `gh pr view --json`
 * accepts a different, fixed set. Nobody had ever run it, in a section written
 * because unread review comments had cost two days.
 *
 * What this file can prove, offline: the document names the script, the script
 * executes, its invocation is well formed, and no document has gone back to
 * asking `gh pr view --json` for a GraphQL-only field.
 *
 * What it CANNOT prove: that the query is valid against GitHub's schema. Only
 * running it can, which is `sweep-command-check.yml`'s job. Stating the boundary
 * because a green check that quietly means less than it looks like is the
 * failure being fixed here.
 *
 * Run: node scripts/test-pr-review-sweep.mjs
 */
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  collectThreadPages, ghArgs, interpretSweepResponse, REVIEW_THREADS_QUERY, summariseThreads,
} from './sweepPrReviewThreads.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const SCRIPT = 'scripts/sweepPrReviewThreads.mjs'

let passed = 0
function test(name, fn) {
  try {
    fn()
    passed += 1
    console.log(`  ✓ ${name}`)
  } catch (err) {
    console.error(`  ✗ ${name}\n    ${err.message}`)
    process.exitCode = 1
  }
}

const node = (...args) => spawnSync(process.execPath, [path.join(ROOT, SCRIPT), ...args], { encoding: 'utf8' })

console.log('the §7a sweep command')

/* ── the command in the document is the one that exists ─────────────────── */

test('§7a names the script, and the script is there', () => {
  const doc = readFileSync(path.join(ROOT, 'docs/MIGRATION_TEMPLATE.md'), 'utf8')
  const section = doc.slice(doc.indexOf('## 7a'))
  assert.ok(section.includes(SCRIPT), `§7a must name ${SCRIPT}`)
  assert.ok(statSync(path.join(ROOT, SCRIPT)).isFile())
})

/**
 * Fields on the GraphQL `PullRequest` type that `gh pr view --json` does not
 * accept. Any command pairing them exits 1 the first time it is run — which,
 * in a document, is usually the first time anybody needs it.
 */
const GRAPHQL_ONLY_FIELDS = ['reviewThreads', 'isResolved', 'resolvedBy', 'isCollapsed']

/**
 * Broken `gh pr view --json` commands in a document's RUNNABLE blocks.
 *
 * Fenced code blocks only, because those are what a reader copies. Prose about
 * a command — including this section's own explanation of the command it
 * replaced — is commentary, not an instruction, and flagging it would make the
 * guard unable to coexist with the record of why it exists. Exported so the
 * control below can prove it still fires where it should.
 */
export function brokenSweepCommands(markdown) {
  const found = []
  let inFence = false
  for (const line of markdown.split('\n')) {
    if (/^\s*```/.test(line)) { inFence = !inFence; continue }
    if (!inFence) continue
    if (!/gh pr view/.test(line) || !/--json/.test(line)) continue
    const hit = GRAPHQL_ONLY_FIELDS.find((f) => line.includes(f))
    if (hit) found.push(hit)
  }
  return found
}

/**
 * Every Markdown file git tracks.
 *
 * The first version walked `docs/` plus four hand-picked root files, while the
 * test's name claimed "no runnable block in ANY document" — so the exact broken
 * command could be added to `README.md`, `DEPLOY.md`, or anything under
 * `functions/` or `scripts/` and this stayed green. 109 tracked `.md` files sat
 * outside the four. Raised by Codex on #2146 (`r3730024116`).
 *
 * `git ls-files` rather than a walk with an exclusion list: it already excludes
 * `node_modules`, build output and everything else ignored, and it cannot drift
 * from what is actually in the repository. A failure to run git is reported,
 * never treated as "no files to check" — a guard that inspects nothing must not
 * look like a guard that found nothing.
 */
function trackedMarkdown() {
  const run = spawnSync('git', ['ls-files', '*.md', '*.mdx'], { cwd: ROOT, encoding: 'utf8' })
  if (run.status !== 0) throw new Error(`could not list tracked markdown: ${run.stderr}`)
  return run.stdout.split('\n').filter(Boolean)
}

test('NO runnable block in ANY tracked document asks for a GraphQL-only field', () => {
  const files = trackedMarkdown()
  assert.ok(files.length > 50, `expected the whole repository's markdown, got ${files.length}`)
  // The files the old allowlist missed, named so a future narrowing is visible.
  for (const outside of ['README.md']) {
    assert.ok(files.includes(outside), `${outside} must be inspected`)
  }
  const offenders = []
  for (const rel of files) {
    for (const hit of brokenSweepCommands(readFileSync(path.join(ROOT, rel), 'utf8'))) {
      offenders.push(`${rel}: --json ${hit}`)
    }
  }
  assert.deepEqual(offenders, [], `these commands exit 1 when run:\n    ${offenders.join('\n    ')}`)
})

test('the guard fires inside a fenced block and stays quiet outside one', () => {
  // Its own control. A fence-aware check is one edit away from being
  // fence-blind or block-blind, and either way it goes quiet rather than wrong.
  const runnable = '```bash\ngh pr view 1 --json reviewThreads,comments\n```'
  assert.deepEqual(brokenSweepCommands(runnable), ['reviewThreads'])
  const prose = '> it used to say `gh pr view <n> --json reviewThreads`, and it exits 1'
  assert.deepEqual(brokenSweepCommands(prose), [], 'commentary is not an instruction')
  const fixed = '```bash\nnode scripts/sweepPrReviewThreads.mjs 2143\n```'
  assert.deepEqual(brokenSweepCommands(fixed), [])
  // And §7a itself: the runnable block is clean while the explanation above it
  // still quotes the command it replaced.
  const doc = readFileSync(path.join(ROOT, 'docs/MIGRATION_TEMPLATE.md'), 'utf8')
  assert.deepEqual(brokenSweepCommands(doc), [])
  assert.ok(doc.includes('--json reviewThreads'), 'the record of the defect is kept')
})

/* ── the script runs, here, now ─────────────────────────────────────────── */

test('--self-check passes when executed for real', () => {
  const run = node('--self-check')
  assert.equal(run.status, 0, run.stderr || run.stdout)
  assert.match(run.stdout, /offline: shape only/, 'and says what it did NOT prove')
})

test('--print-query prints a query that balances and names what it reads', () => {
  const run = node('--print-query')
  assert.equal(run.status, 0, run.stderr)
  assert.equal(run.stdout.trim(), REVIEW_THREADS_QUERY)
  for (const field of ['reviewThreads', 'isResolved', 'mergedAt']) {
    assert.ok(run.stdout.includes(field), `the query asks for ${field}`)
  }
})

test('no pull-request number is a usage error, not a silent empty sweep', () => {
  const run = node()
  assert.equal(run.status, 1)
  assert.match(run.stderr, /usage:/)
})

test('`pr` is passed as an Int, which is the argument GraphQL rejects as a string', () => {
  const args = ghArgs({ owner: 'o', repo: 'r', pr: 2143 })
  assert.deepEqual(args.slice(0, 2), ['api', 'graphql'])
  const prFlag = args[args.indexOf('pr=2143') - 1]
  assert.equal(prFlag, '-F', '-f would send "2143" as a String and the query would be rejected')
})

/* ── the question §7a actually asks ─────────────────────────────────────── */

test('a comment after the merge is flagged; one before it is not', () => {
  // #2142 merged 13:17:55Z; Codex commented 13:20:46Z. That three-minute gap is
  // the whole subject of §7a, so it is the fixture.
  const threads = summariseThreads({
    mergedAt: '2026-08-06T13:17:55Z',
    reviewThreads: {
      nodes: [{
        isResolved: false,
        path: 'scripts/visual/collectBootstrapRecordings.mjs',
        comments: {
          nodes: [
            { createdAt: '2026-08-06T12:30:00Z', author: { login: 'before' } },
            { createdAt: '2026-08-06T13:20:46Z', author: { login: 'after' } },
          ],
        },
      }],
    },
  })
  assert.equal(threads.length, 1)
  assert.equal(threads[0].hasPostMergeComment, true)
  assert.deepEqual(threads[0].comments.map((c) => c.afterMerge), [false, true])
})

test('every page of review threads is followed, not just the first', () => {
  // `reviewThreads(first: 100)` alone drops thread 101 onward, and a sweep that
  // omits threads while reporting "no post-merge comments" is this script's own
  // failure mode wearing a different hat.
  const pages = [
    { pullRequest: { title: 't', mergedAt: null, reviewThreads: {
      pageInfo: { hasNextPage: true, endCursor: 'A' }, nodes: [{ id: '1' }, { id: '2' }] } } },
    { pullRequest: { title: 't', mergedAt: null, reviewThreads: {
      pageInfo: { hasNextPage: true, endCursor: 'B' }, nodes: [{ id: '3' }] } } },
    { pullRequest: { title: 't', mergedAt: null, reviewThreads: {
      pageInfo: { hasNextPage: false, endCursor: null }, nodes: [{ id: '4' }] } } },
  ]
  const seen = []
  let i = 0
  const result = collectThreadPages((after) => { seen.push(after); return pages[i++] })
  assert.deepEqual(result.pullRequest.reviewThreads.nodes.map((n) => n.id), ['1', '2', '3', '4'])
  assert.deepEqual(seen, [null, 'A', 'B'], 'the cursor is carried forward each time')
})

test('a cursor that does not advance stops the loop AND reports the sweep incomplete', () => {
  // A server insisting hasNextPage while returning the same cursor would hang
  // the sweep. Stopping is the anti-spin half; the other half is that the stop
  // is an ERROR — the server said more pages exist, so threads are known to be
  // missing, and returning the accumulated nodes would print a confident
  // undercount (the failure this script exists to prevent).
  let calls = 0
  const result = collectThreadPages(() => {
    calls += 1
    return { pullRequest: { reviewThreads: { pageInfo: { hasNextPage: true, endCursor: 'SAME' }, nodes: [{ id: 'x' }] } } }
  })
  assert.equal(calls, 2, 'it stops as soon as the cursor repeats')
  assert.match(result.error ?? '', /cursor did not advance/)
  assert.match(result.error ?? '', /2 threads collected/, 'the error says how much WAS swept')
  assert.equal(result.pullRequest, undefined, 'an incomplete sweep is not handed on as a complete one')
})

test('an exhausted page cap is an error, never a silent undercount', () => {
  // Codex P2 on #2148 (r3733144557): with more than maxPages of threads, the
  // loop used to end at the cap and return the accumulated nodes as a
  // successful complete sweep. A 5,000-thread pull request is absurd — which
  // is exactly why this exit would never be looked at if it lied.
  const result = collectThreadPages(
    (after) => ({ pullRequest: { reviewThreads: {
      pageInfo: { hasNextPage: true, endCursor: `${after ?? 'C'}+` }, nodes: [{ id: 'x' }] } } }),
    { maxPages: 3 },
  )
  assert.match(result.error ?? '', /cap exhausted/)
  assert.match(result.error ?? '', /3 threads collected/)
  assert.equal(result.pullRequest, undefined)
})

test('the completing page cap boundary is NOT an error', () => {
  // Exactly maxPages pages where the last one reports completion: legitimate.
  // The cap is only exhausted when the last page still promised more.
  let i = 0
  const result = collectThreadPages(
    () => (i++ < 2
      ? { pullRequest: { reviewThreads: { pageInfo: { hasNextPage: true, endCursor: `P${i}` }, nodes: [{ id: `${i}` }] } } }
      : { pullRequest: { reviewThreads: { pageInfo: { hasNextPage: false }, nodes: [{ id: '3' }] } } }),
    { maxPages: 3 },
  )
  assert.equal(result.error, undefined)
  assert.equal(result.pullRequest.reviewThreads.nodes.length, 3)
})

test('the first page sends a TYPED null cursor, later pages the raw cursor', () => {
  // Codex P1 on #2148 (r3733144550): `-f after=` sends the EMPTY STRING, and a
  // connection cursor must be a valid opaque cursor — GitHub rejects "" rather
  // than reading it as "start at the beginning", so the sweep failed before
  // its first page. `-F after=null` supplies the declared variable as JSON
  // null, which is both accepted and what the query means.
  const first = ghArgs({ owner: 'o', repo: 'r', pr: 1 })
  const firstIdx = first.indexOf('after=null')
  assert.ok(firstIdx > 0, 'the first page supplies after')
  assert.equal(first[firstIdx - 1], '-F', 'null is typed (-F), not the raw string "null"')
  assert.ok(!first.includes('after='), 'the empty-string cursor is gone')

  const later = ghArgs({ owner: 'o', repo: 'r', pr: 1, after: 'Y3Vyc29y' })
  const laterIdx = later.indexOf('after=Y3Vyc29y')
  assert.ok(laterIdx > 0, 'later pages carry the cursor')
  assert.equal(later[laterIdx - 1], '-f', 'a real cursor is a raw string (-f), never re-typed')
})

test('an error on ANY page fails the sweep rather than returning a partial one', () => {
  const result = collectThreadPages((after) => (after === null
    ? { pullRequest: { reviewThreads: { pageInfo: { hasNextPage: true, endCursor: 'A' }, nodes: [{ id: '1' }] } } }
    : { error: 'the query was rejected' }))
  assert.match(result.error ?? '', /rejected/)
  assert.equal(result.pullRequest, undefined, 'a partial sweep is not handed on as a complete one')
})

test('comments beyond the first page are REPORTED, never silently dropped', () => {
  const threads = summariseThreads({
    mergedAt: null,
    reviewThreads: { nodes: [{
      isResolved: false,
      comments: { totalCount: 130, nodes: Array.from({ length: 100 }, () => ({ createdAt: '2026-01-01T00:00:00Z' })) },
    }] },
  })
  assert.equal(threads[0].truncatedComments, 30)
  const whole = summariseThreads({
    mergedAt: null,
    reviewThreads: { nodes: [{ isResolved: false, comments: { totalCount: 2, nodes: [{ createdAt: 'x' }, { createdAt: 'y' }] } }] },
  })
  assert.equal(whole[0].truncatedComments, 0)
})

test('the script runs from a path containing a space', () => {
  // `import.meta.url === \`file://${process.argv[1]}\`` is false when the path
  // is percent-encoded, so main() never ran: exit 0, no output, for a tool whose
  // whole job is to print what it found. Reproduced before the fix.
  const tmp = mkdtempSync(path.join(os.tmpdir(), 'zed sweep '))
  try {
    mkdirSync(path.join(tmp, 'lib'), { recursive: true })
    cpSync(path.join(ROOT, 'scripts/sweepPrReviewThreads.mjs'), path.join(tmp, 'sweepPrReviewThreads.mjs'))
    cpSync(path.join(ROOT, 'scripts/lib/isDirectRun.mjs'), path.join(tmp, 'lib/isDirectRun.mjs'))
    const run = spawnSync(process.execPath, [path.join(tmp, 'sweepPrReviewThreads.mjs'), '--self-check'], { encoding: 'utf8' })
    assert.equal(run.status, 0, run.stderr)
    assert.match(run.stdout, /self-check passed/, 'silence here is the bug, not a pass')
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
})

test('a REJECTED query is an error, never an empty sweep', () => {
  // GraphQL returns its errors with HTTP 200, so a rejected query arrives
  // looking like a successful call with no data. Unchecked, it reads as "this
  // pull request has no review threads" — the same shape as the bug this
  // script replaces: not a crash, an answer that is wrong and calm about it.
  const rejected = interpretSweepResponse(JSON.stringify({
    errors: [{ message: "Field 'reviewThreads' doesn't exist on type 'PullRequest'" }],
  }), { owner: 'o', repo: 'r', pr: 1 })
  assert.match(rejected.error ?? '', /the query was rejected/)
  assert.match(rejected.error ?? '', /reviewThreads/)
  assert.equal(rejected.pullRequest, undefined, 'nothing is handed on from a rejection')

  // And the shapes either side of it.
  assert.match(interpretSweepResponse('<html>502</html>').error ?? '', /not JSON/)
  assert.match(
    interpretSweepResponse(JSON.stringify({ data: { repository: { pullRequest: null } } }),
      { owner: 'o', repo: 'r', pr: 9 }).error ?? '',
    /no pull request o\/r#9/,
  )
  const ok = interpretSweepResponse(JSON.stringify({
    data: { repository: { pullRequest: { title: 'x', mergedAt: null, reviewThreads: { nodes: [] } } } },
  }))
  assert.equal(ok.error, undefined)
  assert.equal(ok.pullRequest.title, 'x')
})

test('resolved threads are hidden by default and shown with --all', () => {
  const pr = {
    mergedAt: null,
    reviewThreads: { nodes: [{ isResolved: true, comments: { nodes: [] } }] },
  }
  assert.equal(summariseThreads(pr).length, 0)
  assert.equal(summariseThreads(pr, { includeResolved: true }).length, 1)
})

test('a deleted author and a missing thread list do not crash the sweep', () => {
  const threads = summariseThreads({
    mergedAt: '2026-08-06T13:17:55Z',
    reviewThreads: { nodes: [{ isResolved: false, comments: { nodes: [{ createdAt: '2026-08-06T14:00:00Z' }] } }] },
  })
  assert.equal(threads[0].comments[0].author, '(deleted)')
  assert.deepEqual(summariseThreads(undefined), [])
  assert.deepEqual(summariseThreads({}), [])
})

console.log(`\npr review sweep: ${passed} passed`)
