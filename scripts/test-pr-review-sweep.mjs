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
import { readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  ghArgs, interpretSweepResponse, REVIEW_THREADS_QUERY, summariseThreads,
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

test('NO runnable block asks `gh pr view --json` for a GraphQL-only field', () => {
  const offenders = []
  const inspect = (full) => {
    const rel = path.relative(ROOT, full)
    for (const hit of brokenSweepCommands(readFileSync(full, 'utf8'))) {
      offenders.push(`${rel}: --json ${hit}`)
    }
  }
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const full = path.join(dir, name)
      if (statSync(full).isDirectory()) { walk(full); continue }
      if (/\.mdx?$/.test(name)) inspect(full)
    }
  }
  walk(path.join(ROOT, 'docs'))
  for (const root of ['CLAUDE.md', 'ORG.md', 'BUG_REPORT.md', 'AI_DEVELOPMENT_GUIDE.md']) {
    try { inspect(path.join(ROOT, root)) } catch { /* the file need not exist */ }
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
