#!/usr/bin/env node
/**
 * The §7a sweep: every review thread on a pull request, and which arrived AFTER
 * it merged.
 *
 * ## Why this is a script and not a line in a document
 *
 * `MIGRATION_TEMPLATE.md` §7a used to print this:
 *
 *     gh pr view <n> -R Mwelwa-cyber/Zedexams --json reviewThreads,comments
 *
 * which exits 1. `reviewThreads` is a field on the GraphQL `PullRequest` type;
 * `gh pr view --json` accepts a different, fixed set that does not include it.
 * So the documented sweep had never been run by anybody, in a section written
 * because unread review comments had cost two days — a rule whose reader cannot
 * execute it produces confidence in sweeps that never happened, which is worse
 * than no rule at all.
 *
 * A command in prose is checked by nobody. A script is executed by its test and
 * by `sweep-command-check.yml`, which runs it against a real merged pull request
 * so the doc cannot drift from the tool again.
 *
 * ## Usage
 *
 *   node scripts/sweepPrReviewThreads.mjs 2143            # one pull request
 *   node scripts/sweepPrReviewThreads.mjs 2143 --all      # resolved ones too
 *   node scripts/sweepPrReviewThreads.mjs --print-query   # no network
 *   node scripts/sweepPrReviewThreads.mjs --self-check    # no network
 *
 * Exit codes: 0 = swept (whatever it found), 1 = could not sweep. Finding an
 * unresolved thread is NOT a failure — the point is to read them, and a script
 * that exits non-zero on the normal case teaches its user to ignore it.
 */
import { spawnSync } from 'node:child_process'

export const DEFAULT_REPO = 'Mwelwa-cyber/Zedexams'

/**
 * The whole reason this reaches for GraphQL. Every field here is one the REST
 * `gh pr view --json` surface cannot answer: resolution state lives only on the
 * GraphQL thread type, and without `mergedAt` there is no way to say which
 * comments arrived after the merge — the exact question §7a asks.
 */
export const REVIEW_THREADS_QUERY = `
query($owner: String!, $repo: String!, $pr: Int!) {
  repository(owner: $owner, name: $repo) {
    pullRequest(number: $pr) {
      title
      mergedAt
      reviewThreads(first: 100) {
        nodes {
          id
          isResolved
          isOutdated
          path
          comments(first: 25) {
            nodes { author { login } body createdAt url }
          }
        }
      }
    }
  }
}`.trim()

/** The exact `gh` invocation, as an argv. Built here so the test can read it. */
export function ghArgs({ owner, repo, pr }) {
  return [
    'api', 'graphql',
    '-f', `query=${REVIEW_THREADS_QUERY}`,
    '-f', `owner=${owner}`,
    '-f', `repo=${repo}`,
    '-F', `pr=${pr}`,          // -F, not -f: `pr` is Int! and a string is rejected
  ]
}

/**
 * What `gh api graphql` said, or why it cannot be used.
 *
 * GraphQL returns its errors with **HTTP 200**, so a rejected query arrives
 * looking like a successful call with no data — and if that is not checked
 * explicitly it reads as "this pull request has no review threads". Silently.
 * That is the same failure as the command this script replaces: not a crash, an
 * answer that is wrong and calm about it.
 *
 * Separated from the `gh` call so a control can feed it a rejection without a
 * network, because "the query was rejected and we said nothing" is precisely
 * what a live-only check would miss on the day the schema changes.
 *
 * @returns {{pullRequest: object}|{error: string}}
 */
export function interpretSweepResponse(stdout, { owner, repo, pr } = {}) {
  let payload
  try {
    payload = JSON.parse(stdout)
  } catch {
    return { error: `gh returned something that is not JSON:\n${String(stdout).slice(0, 400)}` }
  }
  if (Array.isArray(payload?.errors) && payload.errors.length) {
    return {
      error: 'the query was rejected:\n'
        + payload.errors.map((e) => `  ${e?.message ?? JSON.stringify(e)}`).join('\n'),
    }
  }
  const pullRequest = payload?.data?.repository?.pullRequest
  if (!pullRequest) return { error: `no pull request ${owner}/${repo}#${pr}` }
  return { pullRequest }
}

/** Threads worth a human's attention, newest comment last. */
export function summariseThreads(pullRequest, { includeResolved = false } = {}) {
  const mergedAt = pullRequest?.mergedAt ? Date.parse(pullRequest.mergedAt) : null
  const threads = pullRequest?.reviewThreads?.nodes ?? []
  return threads
    .filter((t) => includeResolved || !t.isResolved)
    .map((t) => {
      const comments = (t.comments?.nodes ?? []).map((c) => ({
        author: c.author?.login ?? '(deleted)',
        body: c.body ?? '',
        createdAt: c.createdAt,
        url: c.url,
        // The §7a question. A comment posted after the merge is the one nobody
        // is looking at, and is more urgent than it was while the PR was open —
        // it describes something now on main.
        afterMerge: Boolean(mergedAt && Date.parse(c.createdAt) > mergedAt),
      }))
      return {
        id: t.id,
        path: t.path,
        isResolved: Boolean(t.isResolved),
        isOutdated: Boolean(t.isOutdated),
        comments,
        hasPostMergeComment: comments.some((c) => c.afterMerge),
      }
    })
}

function firstLines(body, n = 4) {
  return String(body).split('\n').filter(Boolean).slice(0, n).join('\n      ')
}

function main() {
  const argv = process.argv.slice(2)
  if (argv.includes('--print-query')) { console.log(REVIEW_THREADS_QUERY); return 0 }
  if (argv.includes('--self-check')) return selfCheck()

  const repoArg = (argv.find((a) => a.startsWith('--repo=')) || '').slice('--repo='.length)
  const [owner, repo] = (repoArg || DEFAULT_REPO).split('/')
  const includeResolved = argv.includes('--all')
  const pr = Number(argv.find((a) => /^\d+$/.test(a)))
  if (!pr) {
    console.error('usage: node scripts/sweepPrReviewThreads.mjs <pr-number> [--all] [--repo=owner/name]')
    return 1
  }

  const run = spawnSync('gh', ghArgs({ owner, repo, pr }), { encoding: 'utf8' })
  if (run.error?.code === 'ENOENT') {
    console.error('gh is not installed. This sweep needs the GitHub CLI, authenticated (gh auth login).')
    return 1
  }
  if (run.status !== 0) {
    console.error(`gh exited ${run.status}:\n${run.stderr || run.stdout}`)
    return 1
  }
  const interpreted = interpretSweepResponse(run.stdout, { owner, repo, pr })
  if (interpreted.error) {
    console.error(interpreted.error)
    return 1
  }
  const { pullRequest } = interpreted

  const threads = summariseThreads(pullRequest, { includeResolved })
  const label = `${owner}/${repo}#${pr} — ${pullRequest.title}`
  console.log(pullRequest.mergedAt ? `${label}\n  merged ${pullRequest.mergedAt}` : label)
  if (!threads.length) {
    console.log(`\n  no ${includeResolved ? '' : 'unresolved '}review threads`)
    return 0
  }
  const postMerge = threads.filter((t) => t.hasPostMergeComment)
  console.log(`\n  ${threads.length} thread(s)${postMerge.length ? `, ${postMerge.length} with comments AFTER the merge` : ''}\n`)
  for (const t of threads) {
    const flags = [
      t.isResolved ? 'resolved' : 'UNRESOLVED',
      t.isOutdated ? 'outdated' : null,
      t.hasPostMergeComment ? 'POST-MERGE' : null,
    ].filter(Boolean).join(' · ')
    console.log(`  ${t.path ?? '(no file)'}  [${flags}]`)
    for (const c of t.comments) {
      console.log(`    ${c.afterMerge ? '→ ' : '  '}${c.author} ${c.createdAt}`)
      console.log(`      ${firstLines(c.body)}`)
      console.log(`      ${c.url}`)
    }
    console.log('')
  }
  return 0
}

/**
 * Everything checkable without a network or a `gh` binary.
 *
 * Deliberately narrow: it proves the invocation is well formed and the query
 * asks for the fields the summary reads. It CANNOT prove the query is valid
 * against GitHub's schema — only running it can, which is what
 * `sweep-command-check.yml` is for. Saying that here rather than letting a green
 * self-check imply more than it establishes.
 */
function selfCheck() {
  const problems = []
  const args = ghArgs({ owner: 'o', repo: 'r', pr: 7 })
  if (args[0] !== 'api' || args[1] !== 'graphql') problems.push('the invocation is not `gh api graphql`')
  if (!args.includes('-F') || !args.some((a) => a === 'pr=7')) {
    problems.push('`pr` must be passed with -F so it reaches GraphQL as Int!, not a string')
  }
  for (const field of ['reviewThreads', 'isResolved', 'mergedAt', 'comments', 'createdAt']) {
    if (!REVIEW_THREADS_QUERY.includes(field)) problems.push(`the query does not ask for ${field}`)
  }
  const open = (REVIEW_THREADS_QUERY.match(/\{/g) || []).length
  const close = (REVIEW_THREADS_QUERY.match(/\}/g) || []).length
  if (open !== close) problems.push(`the query's braces do not balance (${open} open, ${close} close)`)

  // The summary must survive a pull request that was never merged, and one with
  // no threads — both real, and both easy to crash on.
  const empty = summariseThreads({ mergedAt: null, reviewThreads: { nodes: [] } })
  if (empty.length !== 0) problems.push('an empty thread list should summarise to nothing')
  const unmerged = summariseThreads({
    mergedAt: null,
    reviewThreads: { nodes: [{ isResolved: false, comments: { nodes: [{ createdAt: '2026-01-01T00:00:00Z' }] } }] },
  })
  if (unmerged[0]?.hasPostMergeComment !== false) {
    problems.push('an unmerged pull request cannot have post-merge comments')
  }
  const merged = summariseThreads({
    mergedAt: '2026-08-06T13:17:55Z',
    reviewThreads: {
      nodes: [{
        isResolved: false,
        comments: { nodes: [{ createdAt: '2026-08-06T13:20:46Z', author: { login: 'x' } }] },
      }],
    },
  })
  if (merged[0]?.hasPostMergeComment !== true) {
    problems.push('a comment three minutes after the merge must be flagged as post-merge')
  }

  if (problems.length) {
    for (const p of problems) console.error(`  ✗ ${p}`)
    return 1
  }
  console.log('sweep self-check passed (offline: shape only — running it against GitHub is the real proof)')
  return 0
}

if (import.meta.url === `file://${process.argv[1]}`) process.exit(main())
