/**
 * The scope job: decide, on every pull request, whether printed output can be
 * affected — and narrow a reviewed baseline pull request to its one target.
 *
 * Both decisions in one place because they are one question with two answers,
 * and because the gate job needs them together: a baseline pull request is
 * always print-affecting AND always narrowed.
 *
 * Exits non-zero when it cannot decide. That is deliberate and it is the whole
 * reason the final gate watches this job's result: an unresolvable scope must
 * fail the pull request, not fall through to "nothing to render".
 */

import fs from 'node:fs'
import { execFileSync } from 'node:child_process'
import { classifyVisualPullRequest } from './baselinePrScope.js'
import { classifyPrintScope } from './printAffectingPaths.js'
import { classifyScreenScope } from './screen/screenAffectingPaths.js'

const eventName = process.env.GITHUB_EVENT_NAME || ''
const eventPath = process.env.GITHUB_EVENT_PATH || ''
const outputPath = process.env.GITHUB_OUTPUT || ''
const summaryPath = process.env.GITHUB_STEP_SUMMARY || ''
const forced = String(process.env.VISUAL_FORCE || '').toLowerCase() === 'true'

const writeOutput = (name, value) => {
  if (outputPath) fs.appendFileSync(outputPath, `${name}=${String(value ?? '')}\n`)
}
const writeSummary = (text) => {
  if (summaryPath) fs.appendFileSync(summaryPath, `${text}\n`)
}

function pullRequestFiles() {
  try {
    const text = execFileSync('git', ['diff', '--name-only', 'HEAD^1', 'HEAD'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    return text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
  } catch (error) {
    const stderr = String(error?.stderr || '').trim()
    throw new Error(
      'could not determine the pull request files from the checked-out merge commit'
      + `${stderr ? `: ${stderr}` : ''}. Ensure checkout uses fetch-depth: 2.`,
    )
  }
}

let event = {}
if (eventPath && fs.existsSync(eventPath)) {
  event = JSON.parse(fs.readFileSync(eventPath, 'utf8'))
}

const isPullRequest = eventName === 'pull_request'
const changedFiles = isPullRequest ? pullRequestFiles() : []

// Baseline pull requests first: the rules there are stricter than "does this
// touch a renderer", and an invalid one must stop the run rather than be
// classified as an ordinary change and rendered against the wrong scope.
const baseline = classifyVisualPullRequest({
  eventName,
  headRef: event?.pull_request?.head?.ref || process.env.GITHUB_HEAD_REF || '',
  changedFiles,
})

if (baseline.mode === 'invalid') {
  console.error('✗ this visual-baseline pull request is not permitted:')
  for (const problem of baseline.problems) console.error(`    ${problem}`)
  writeSummary('### Visual regression gate\n\n**Scope could not be resolved** — this baseline pull request is not permitted:\n')
  for (const problem of baseline.problems) writeSummary(`- ${problem}`)
  process.exit(2)
}

const print = isPullRequest && !forced
  ? classifyPrintScope(changedFiles)
  : { requiresVisual: true, reason: forced ? 'forced' : 'not-a-pull-request', summary: forced
    ? 'Forced by the manual dispatch, whatever changed.'
    : 'Not a pull request, so the full suite runs.', matched: [] }

// A narrowed baseline run is always a render — it exists to validate exactly
// one replaced baseline.
const requiresVisual = print.requiresVisual || Boolean(baseline.fixture)

writeOutput('requires_visual', requiresVisual ? 'true' : 'false')

// The learner-SCREEN family, classified by its own list. Separate from the
// print one because the two answer different questions: a paper change must
// not render screens and a screen change must not render papers. Both report
// through the one required check (`gateVerdict`), and both must be acceptable.
const screen = isPullRequest && !forced
  ? classifyScreenScope(changedFiles)
  : { requiresScreen: true, reason: forced ? 'forced' : 'not-a-pull-request', summary: forced
      ? 'Forced by the manual dispatch, whatever changed.'
      : 'Not a pull request, so the full screen suite runs.', matched: [] }
const requiresScreen = screen.requiresScreen || Boolean(baseline.fixture)
writeOutput('requires_screen', requiresScreen ? 'true' : 'false')
writeOutput('screen_summary', screen.summary)
writeOutput('reason', baseline.fixture ? 'baseline' : print.reason)
writeOutput('summary', baseline.fixture
  ? `Reviewed baseline pull request: validating ${baseline.fixture} (${baseline.family || 'all families'}).`
  : print.summary)
writeOutput('mode', baseline.mode)
writeOutput('fixture', baseline.fixture || '')
writeOutput('family', baseline.family || '')

console.log(`scope: requires_visual=${requiresVisual} reason=${baseline.fixture ? 'baseline' : print.reason}`)
if (print.matched.length) console.log(`  matched: ${print.matched.join('\n           ')}`)

writeSummary('### Visual regression gate\n')
writeSummary(requiresVisual
  ? `Rendering the suite. ${baseline.fixture
    ? `Reviewed baseline pull request, narrowed to \`${baseline.fixture}\`.`
    : print.summary}`
  : `**Printed output not affected.** ${print.summary}`)
if (print.matched.length) {
  writeSummary('\n<details><summary>Files that can affect printed output</summary>\n')
  for (const f of print.matched) writeSummary(`- \`${f}\``)
  writeSummary('\n</details>')
}
