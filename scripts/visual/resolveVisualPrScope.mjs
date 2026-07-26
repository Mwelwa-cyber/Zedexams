import fs from 'node:fs'
import { classifyVisualPullRequest } from './baselinePrScope.js'

const eventName = process.env.GITHUB_EVENT_NAME || ''
const eventPath = process.env.GITHUB_EVENT_PATH || ''
const outputPath = process.env.GITHUB_OUTPUT || ''

const writeOutput = (name, value) => {
  if (!outputPath) return
  fs.appendFileSync(outputPath, `${name}=${String(value ?? '')}\n`)
}

async function pullRequestFiles(event) {
  const pullNumber = event?.pull_request?.number
  const repository = process.env.GITHUB_REPOSITORY
  const token = process.env.GITHUB_TOKEN
  if (!pullNumber || !repository || !token) {
    throw new Error('pull-request scope needs GITHUB_REPOSITORY, GITHUB_TOKEN and the event pull-request number')
  }

  const files = []
  for (let page = 1; ; page += 1) {
    const response = await fetch(
      `https://api.github.com/repos/${repository}/pulls/${pullNumber}/files?per_page=100&page=${page}`,
      {
        headers: {
          Accept: 'application/vnd.github+json',
          Authorization: `Bearer ${token}`,
          'X-GitHub-Api-Version': '2022-11-28',
          'User-Agent': 'zedexams-visual-gate',
        },
      },
    )
    if (!response.ok) {
      throw new Error(`GitHub returned ${response.status} while listing pull-request files`)
    }
    const batch = await response.json()
    files.push(...batch.map((item) => item.filename))
    if (batch.length < 100) break
  }
  return files
}

let event = {}
if (eventPath && fs.existsSync(eventPath)) {
  event = JSON.parse(fs.readFileSync(eventPath, 'utf8'))
}

const changedFiles = eventName === 'pull_request' ? await pullRequestFiles(event) : []
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
