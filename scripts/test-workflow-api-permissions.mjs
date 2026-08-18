#!/usr/bin/env node
/**
 * A workflow that calls the GitHub **Actions** REST API must say so in its
 * `permissions:` block.
 *
 * What went wrong on 2026-08-18: `deploy-hosting.yml`'s "Wait for Deploy
 * Firebase run" step reads this repository's own workflow runs through
 * `GET /repos/{repo}/actions/workflows/{file}/runs`, while its job declared
 * only `contents: read`. That endpoint needs `actions: read` — but on a
 * PUBLIC repository the runs are anonymously readable, so GITHUB_TOKEN was
 * answered whatever scope it carried and the missing permission was invisible
 * for as long as the workflow had existed. The repository went private that
 * morning and the same call started returning 403.
 *
 * The reason it needs a guard rather than a fix and a note: the failure is
 * narrow. The wait step is gated on `firebase_changes.required`, so a
 * hosting-only push kept deploying green and ONLY a push that also touched
 * firestore.rules / firestore.indexes.json / functions/ failed. Runs #2160 and
 * #2161 were the first two, and each left production Hosting behind a Cloud
 * Functions deploy that had already shipped — a client older than the API it
 * calls, which is the skew scripts/test-deploy-timeouts.mjs guards the other
 * approach to. Nothing at runtime can catch a permission a token silently
 * doesn't need yet; only a check like this can.
 *
 *   node scripts/test-workflow-api-permissions.mjs
 */
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'

const WORKFLOW_DIR = '.github/workflows'

/**
 * Endpoints under `/repos/{owner}/{repo}/actions/...` — runs, jobs, artifacts,
 * caches, workflow dispatches. All of them are gated on the `actions`
 * permission, and all of them are readable unauthenticated while the
 * repository is public, which is what makes the omission survivable until it
 * isn't.
 */
const ACTIONS_API = /api\.github\.com\/repos\/[^"'\s]*\/actions\//

/** `gh` reaching the same endpoints, for whenever a workflow prefers the CLI. */
const ACTIONS_CLI = /\bgh\s+(?:run|cache|workflow)\b|\bgh\s+api\b[^\n]*\/actions\//

const GRANTS = new Set(['read', 'write'])

const indentOf = (line) => line.length - line.trimStart().length

/**
 * Read the mapping under the `permissions:` at `startLine`, i.e. the following
 * run of lines indented deeper than it. `permissions: write-all` and
 * `permissions: {}` are single-line forms and carry no mapping.
 */
function readPermissions(lines, startLine) {
  const inline = lines[startLine].split('permissions:')[1].trim()
  if (inline) return inline === 'write-all' ? { actions: 'write' } : {}

  const base = indentOf(lines[startLine])
  const permissions = {}
  for (let i = startLine + 1; i < lines.length; i += 1) {
    const line = lines[i]
    if (!line.trim() || line.trim().startsWith('#')) continue
    if (indentOf(line) <= base) break
    const entry = /^\s*([a-z-]+):\s*(\S+)\s*$/.exec(line)
    if (entry) permissions[entry[1]] = entry[2]
  }
  return permissions
}

/**
 * Split a workflow into its jobs, each carrying its own line range and its own
 * `permissions:` if it declares one. A job-level block REPLACES the
 * workflow-level one rather than merging with it — that is GitHub's rule, and
 * getting it wrong here would pass a job whose own block dropped `actions`.
 */
function parseWorkflow(source) {
  const lines = source.split('\n')
  let workflowPermissions = null
  const jobs = []
  let jobsIndent = null

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]
    if (!line.trim() || line.trimStart().startsWith('#')) continue
    const indent = indentOf(line)

    if (indent === 0 && /^permissions:/.test(line)) {
      workflowPermissions = readPermissions(lines, i)
      continue
    }
    if (indent === 0 && /^jobs:\s*$/.test(line)) {
      jobsIndent = null
      // The first key under `jobs:` fixes the indent every job id sits at.
      for (let j = i + 1; j < lines.length; j += 1) {
        if (!lines[j].trim() || lines[j].trimStart().startsWith('#')) continue
        jobsIndent = indentOf(lines[j])
        break
      }
      continue
    }
    if (jobsIndent !== null && indent === jobsIndent && /^\s*[\w-]+:\s*$/.test(line)) {
      const id = line.trim().slice(0, -1)
      if (jobs.length) jobs[jobs.length - 1].endLine = i
      jobs.push({ id, startLine: i, endLine: lines.length, permissions: null })
      continue
    }
    if (jobs.length && indent > jobsIndent && /^\s*permissions:/.test(line)) {
      const job = jobs[jobs.length - 1]
      // Only the job's OWN block, not one nested deeper (a step never has one,
      // but a reusable-workflow `with:` can carry lookalike keys).
      if (indent === jobsIndent + 2) job.permissions = readPermissions(lines, i)
    }
  }

  return { lines, workflowPermissions, jobs }
}

const files = readdirSync(WORKFLOW_DIR)
  .filter((name) => name.endsWith('.yml') || name.endsWith('.yaml'))
  .sort()

assert.ok(files.length > 0, `${WORKFLOW_DIR}: no workflow files found`)

const callers = []
const failures = []

for (const name of files) {
  const file = path.join(WORKFLOW_DIR, name)
  const source = readFileSync(file, 'utf8')
  if (!ACTIONS_API.test(source) && !ACTIONS_CLI.test(source)) continue

  const { lines, workflowPermissions, jobs } = parseWorkflow(source)

  lines.forEach((line, index) => {
    if (!ACTIONS_API.test(line) && !ACTIONS_CLI.test(line)) return
    if (line.trimStart().startsWith('#')) return

    const job = jobs.find((j) => index >= j.startLine && index < j.endLine)
    const effective = job?.permissions ?? workflowPermissions
    const where = `${file}:${index + 1}${job ? ` (job "${job.id}")` : ''}`
    callers.push(where)

    if (effective === null || effective === undefined) {
      // No block anywhere ⇒ the repository default applies, which can be
      // read-all and can equally be contents-only. Unstated is not a grant.
      failures.push(
        `${where} calls the Actions REST API but neither the workflow nor its ` +
          `job declares a permissions block — add \`actions: read\`.`,
      )
      return
    }
    if (!GRANTS.has(effective.actions)) {
      failures.push(
        `${where} calls the Actions REST API but its effective permissions ` +
          `(${JSON.stringify(effective)}) do not grant \`actions\`. Add ` +
          `\`actions: read\`, or the call returns 403 on a private repository.`,
      )
    }
  })
}

assert.ok(
  callers.length > 0,
  'No workflow calls the Actions REST API any more. If that is deliberate, ' +
    'delete this check — a guard that matches nothing reads exactly like one ' +
    'that found nothing wrong.',
)

if (failures.length) {
  for (const failure of failures) console.error(`  ✗ ${failure}`)
  assert.fail(
    `${failures.length} workflow call(s) to the GitHub Actions REST API lack ` +
      'the `actions` permission.',
  )
}

console.log(
  `Actions REST API callers all grant \`actions\` (${callers.length} call ` +
    `site${callers.length === 1 ? '' : 's'}):`,
)
for (const caller of callers) console.log(`  ✓ ${caller}`)
