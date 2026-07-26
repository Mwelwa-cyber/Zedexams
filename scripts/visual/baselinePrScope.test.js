import assert from 'node:assert/strict'
import { classifyVisualPullRequest, parseBaselinePath } from './baselinePrScope.js'

let passed = 0
function test(name, fn) {
  try {
    fn()
    passed += 1
  } catch (error) {
    console.error(`✗ ${name}\n  ${error.message}`)
    process.exitCode = 1
  }
}

const browser = (fixture, copy = 'paper', file = 'layout.json') =>
  `tests/visual/baselines/browser-print/chromium-150.0.7871.24/${fixture}/${copy}/${file}`
const docx = (fixture, copy = 'paper', file = 'layout.json') =>
  `tests/visual/baselines/docx/libreoffice-24.2.7.2/${fixture}/${copy}/${file}`

test('a reviewed baseline PR selects only its fixture and renderer family', () => {
  const scope = classifyVisualPullRequest({
    eventName: 'pull_request',
    headRef: 'baseline/vr-002-browser-print-30215626337',
    changedFiles: [browser('vr-002'), browser('vr-002', 'paper', 'page-01.png')],
  })
  assert.equal(scope.mode, 'targeted')
  assert.equal(scope.fixture, 'vr-002')
  assert.equal(scope.family, 'browser-print')
  assert.deepEqual(scope.copies, ['paper'])
})

test('paper and marking scheme may travel together for the same target', () => {
  const scope = classifyVisualPullRequest({
    eventName: 'pull_request',
    headRef: 'baseline/vr-004-docx-30215626338',
    changedFiles: [docx('vr-004', 'paper'), docx('vr-004', 'scheme')],
  })
  assert.equal(scope.mode, 'targeted')
  assert.deepEqual(scope.copies, ['paper', 'scheme'])
})

test('a baseline PR touching application code is refused', () => {
  const scope = classifyVisualPullRequest({
    eventName: 'pull_request',
    headRef: 'baseline/vr-002-browser-print-30215626337',
    changedFiles: [browser('vr-002'), 'src/utils/assessmentToDocx.js'],
  })
  assert.equal(scope.mode, 'invalid')
  assert.match(scope.problems.join('\n'), /outside tests\/visual\/baselines/)
})

test('two fixture or family targets in one reviewed update are refused', () => {
  const scope = classifyVisualPullRequest({
    eventName: 'pull_request',
    headRef: 'baseline/vr-002-browser-print-30215626337',
    changedFiles: [browser('vr-002'), browser('vr-003')],
  })
  assert.equal(scope.mode, 'invalid')
  assert.match(scope.problems.join('\n'), /exactly one fixture\/family/)
})

test('the branch target must agree with the files', () => {
  const scope = classifyVisualPullRequest({
    eventName: 'pull_request',
    headRef: 'baseline/vr-002-browser-print-30215626337',
    changedFiles: [docx('vr-002')],
  })
  assert.equal(scope.mode, 'invalid')
  assert.match(scope.problems.join('\n'), /branch names vr-002\/browser-print/)
})

test('ordinary PRs and manual runs retain the complete suite', () => {
  assert.equal(classifyVisualPullRequest({ eventName: 'pull_request', headRef: 'fix/paper-layout' }).mode, 'full')
  assert.equal(classifyVisualPullRequest({ eventName: 'workflow_dispatch', headRef: '' }).mode, 'full')
})

test('bootstrap PRs retain the complete suite because they may contain many targets', () => {
  const scope = classifyVisualPullRequest({
    eventName: 'pull_request',
    headRef: 'baseline/bootstrap-30215626339',
    changedFiles: [browser('vr-001'), docx('vr-008')],
  })
  assert.equal(scope.mode, 'full')
})

test('baseline paths must carry a renderer identity matching their family', () => {
  const parsed = parseBaselinePath('tests/visual/baselines/docx/chromium-150/vr-001/paper/page-01.png')
  assert.equal(parsed.ok, false)
  assert.match(parsed.problem, /does not belong to docx/)
})

console.log(`✓ baseline PR scope — ${passed} tests passed`)
