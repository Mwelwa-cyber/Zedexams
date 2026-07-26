import fs from 'node:fs'
import { execFileSync } from 'node:child_process'
import { classifyVisualPullRequest } from './baselinePrScope.js'

const eventName = process.env.GITHUB_EVENT_NAME || ''
const eventPath = process.env.GITHUB_EVENT_PATH || ''
const outputPath = process.env.GITHUB_OUTPUT || ''

const writeOutput = (name, value) => {
  if (!outputPath) return
  fs.appendFileSync(outputPath, `${name}=${String(value ?? '')}\n`)
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

const changedFiles = eventName === 'pull_request' ? pullRequestFiles() : []
const scope = classifyVisualPullRequest({
  eventName,
  headRef: event?.pull_request?.head?.ref || process.env.GITHUB_HEAD_REF || '',
  changedFiles,
})

if (scope.mode === 'invalid') {
  console.error('✗ this visual-baseline pull request is not permitted:')
  for (const problem of scope.problems) console.error(`    ${problem}`)
  process.exit(2)
}

writeOutput('mode', scope.mode)
writeOutput('fixture', scope.fixture || '')
writeOutput('family', scope.family || '')
writeOutput('identity', scope.identity || '')
writeOutput('copies', (scope.copies || []).join(','))

if (scope.mode === 'targeted') {
  console.log(`Visual scope: ${scope.fixture} [${scope.family}] only`)
  console.log(`Changed baseline identity: ${scope.identity}`)
  console.log(`Copies: ${(scope.copies || []).join(', ') || 'paper'}`)
} else {
  console.log(`Visual scope: complete suite (${scope.reason || 'ordinary run'})`)
}
