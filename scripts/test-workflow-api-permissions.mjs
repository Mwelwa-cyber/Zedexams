/**
 * A workflow that READS the GitHub Actions API must declare `actions: read`.
 *
 * What went wrong on 2026-08-18: `deploy-hosting.yml`'s "Wait for Deploy
 * Firebase run" step polls
 * `/repos/{repo}/actions/workflows/deploy-firebase.yml/runs`, but the job
 * declared only `permissions: contents: read`. Declaring a `permissions:` block
 * restricts GITHUB_TOKEN to EXACTLY what it lists, so that endpoint was never
 * authorized — it merely worked anyway, because the Actions API serves run
 * metadata for PUBLIC repositories without the actions scope. The repository
 * went private that day and the next deploy got `HTTP Error 403: Forbidden` on
 * the first poll.
 *
 * Why this needs a test rather than care:
 *
 *   1. NOTHING FAILS LOUDLY. Lint, tests, build and prerender all pass first,
 *      so the run reads as a deploy that got as far as deploying. What actually
 *      happens is that the Hosting deploy is SKIPPED and production stops
 *      receiving frontend changes.
 *   2. IT ONLY FIRES ON SOME COMMITS. The wait step runs only when a commit
 *      touches `functions/` and friends, so the breakage is intermittent by
 *      commit content — the shape that gets misread as a flake.
 *   3. THE TRIGGER WAS NOT A CODE CHANGE. No edit to any workflow caused it;
 *      a repository VISIBILITY change did. Nothing in a diff could have shown
 *      it, and re-running the job could never fix it.
 *
 *   node scripts/test-workflow-api-permissions.mjs
 */
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const DIR = '.github/workflows'

/** A real call to the Actions REST API — not a display URL built for a log. */
const ACTIONS_API = /api\.github\.com\/repos\/[^"'\s]*\/actions\//

let failures = 0
let checked = 0
const needing = []

function fail(msg) {
  failures += 1
  console.error(`  ✗ ${msg}`)
}

/**
 * Split a workflow into its job blocks by indentation, so a step's API call is
 * attributed to the job whose `permissions:` actually governs it. Parsing the
 * YAML properly would be better, but js-yaml is not a root dependency and this
 * suite runs under plain node.
 */
function jobBlocks(source) {
  const lines = source.split('\n')
  const jobsAt = lines.findIndex((l) => /^jobs:\s*$/.test(l))
  if (jobsAt < 0) return []

  const blocks = []
  let current = null
  for (let i = jobsAt + 1; i < lines.length; i += 1) {
    const line = lines[i]
    const jobHeader = /^ {2}([A-Za-z0-9_-]+):\s*$/.exec(line)
    if (jobHeader) {
      if (current) blocks.push(current)
      current = { name: jobHeader[1], lines: [] }
      continue
    }
    if (current) current.lines.push(line)
  }
  if (current) blocks.push(current)
  return blocks.map((b) => ({ name: b.name, text: b.lines.join('\n') }))
}

/** The job's own `permissions:` block, or null when it inherits the default. */
function jobPermissions(text) {
  const at = /^ {4}permissions:\s*$/m.exec(text)
  if (!at) return null
  const rest = text.slice(at.index + at[0].length + 1).split('\n')
  const perms = {}
  for (const line of rest) {
    // Comments and blank lines sit BETWEEN entries — the reason each grant is
    // there is worth writing down, and a parser that stopped at the first
    // comment would read a documented block as a truncated one. That is not
    // hypothetical: it misread the very fix this guard was written for.
    if (/^\s*(#.*)?$/.test(line)) continue
    const entry = /^ {6}([a-z-]+):\s*(\S+)\s*$/.exec(line)
    if (!entry) break
    perms[entry[1]] = entry[2]
  }
  return perms
}

console.log('workflow-api-permissions')

for (const file of readdirSync(DIR).filter((f) => /\.ya?ml$/.test(f)).sort()) {
  const source = readFileSync(join(DIR, file), 'utf8')
  for (const job of jobBlocks(source)) {
    if (!ACTIONS_API.test(job.text)) continue
    checked += 1
    needing.push(`${file}:${job.name}`)

    const perms = jobPermissions(job.text)
    if (perms === null) {
      // No job-level block: the workflow-level default applies, which we do not
      // narrow here. Report it rather than pass it silently — an unexamined
      // case reads exactly like a checked one.
      console.log(`  · ${file}:${job.name} — no job-level permissions block (inherits default)`)
      continue
    }
    if (perms.actions !== 'read' && perms.actions !== 'write') {
      fail(
        `${file}: job "${job.name}" calls the Actions REST API but its ` +
        `permissions block does not grant \`actions\`. A declared block is ` +
        `exhaustive, so the call gets 403 on a private repository. ` +
        `Got: ${JSON.stringify(perms)}`,
      )
    } else {
      console.log(`  ✓ ${file}:${job.name} — actions: ${perms.actions}`)
    }
  }
}

// A guard that silently matches nothing looks exactly like a guard that found
// nothing wrong. The wait step is the known caller; if it stops being detected,
// the detector is broken rather than the problem being solved.
if (checked === 0) {
  fail(
    'no workflow job was found calling the Actions REST API — the detector ' +
    'has stopped matching. Expected at least deploy-hosting.yml.',
  )
}

if (failures > 0) {
  console.error(`\nworkflow-api-permissions — ${failures} failed`)
  process.exit(1)
}
console.log(`workflow-api-permissions — ${checked} job(s) checked: ${needing.join(', ')}`)
