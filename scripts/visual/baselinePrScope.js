export const BASELINE_ROOT = 'tests/visual/baselines/'
export const BASELINE_UPDATE_BRANCH = /^baseline\/(vr-\d{3})-(browser-print|docx)-(\d+)$/
export const BASELINE_BOOTSTRAP_BRANCH = /^baseline\/bootstrap-\d+$/

const FAMILIES = new Set(['browser-print', 'docx'])
const COPIES = new Set(['paper', 'scheme'])

const normalisePath = (value) => String(value || '').replace(/\\/g, '/').replace(/^\.\//, '')

export function parseBaselinePath(value) {
  const file = normalisePath(value)
  if (!file.startsWith(BASELINE_ROOT)) {
    return { ok: false, file, problem: `outside ${BASELINE_ROOT}` }
  }

  const relative = file.slice(BASELINE_ROOT.length)
  const parts = relative.split('/').filter(Boolean)
  if (parts.length < 5) {
    return { ok: false, file, problem: 'does not name family/identity/fixture/copy/file' }
  }

  const [family, identity, fixture, copy] = parts
  if (!FAMILIES.has(family)) {
    return { ok: false, file, problem: `unknown renderer family "${family}"` }
  }
  const identityPrefix = family === 'browser-print' ? 'chromium-' : 'libreoffice-'
  if (!identity.startsWith(identityPrefix)) {
    return {
      ok: false,
      file,
      problem: `identity "${identity}" does not belong to ${family}`,
    }
  }
  if (!/^vr-\d{3}$/.test(fixture)) {
    return { ok: false, file, problem: `invalid fixture ID "${fixture}"` }
  }
  if (!COPIES.has(copy)) {
    return { ok: false, file, problem: `invalid copy "${copy}"` }
  }

  return { ok: true, file, family, identity, fixture, copy }
}

export function classifyVisualPullRequest({ eventName, headRef, changedFiles = [] } = {}) {
  if (eventName !== 'pull_request') {
    return { mode: 'full', reason: 'not a pull-request event' }
  }

  const branch = String(headRef || '')
  if (BASELINE_BOOTSTRAP_BRANCH.test(branch)) {
    return { mode: 'full', reason: 'bootstrap PRs may contain several baseline targets' }
  }
  const branchMatch = branch.match(BASELINE_UPDATE_BRANCH)
  if (!branchMatch) {
    if (branch.startsWith('baseline/')) {
      return {
        mode: 'invalid',
        problems: [`baseline branch "${branch}" is not a reviewed update or bootstrap branch`],
      }
    }
    return { mode: 'full', reason: 'ordinary pull request' }
  }

  const files = [...new Set(changedFiles.map(normalisePath).filter(Boolean))]
  if (!files.length) {
    return { mode: 'invalid', problems: ['the baseline pull request changes no files'] }
  }

  const parsed = files.map(parseBaselinePath)
  const problems = parsed.filter((item) => !item.ok).map((item) => `${item.file}: ${item.problem}`)
  if (problems.length) return { mode: 'invalid', problems }

  const targets = new Map()
  for (const item of parsed) {
    const key = `${item.family}/${item.fixture}`
    if (!targets.has(key)) {
      targets.set(key, {
        family: item.family,
        fixture: item.fixture,
        identities: new Set(),
        copies: new Set(),
      })
    }
    const target = targets.get(key)
    target.identities.add(item.identity)
    target.copies.add(item.copy)
  }

  if (targets.size !== 1) {
    return {
      mode: 'invalid',
      problems: [
        `a reviewed baseline PR must change exactly one fixture/family; found ${[...targets.keys()].join(', ')}`,
      ],
    }
  }

  const target = [...targets.values()][0]
  if (target.identities.size !== 1) {
    return {
      mode: 'invalid',
      problems: [`the selected baseline spans ${target.identities.size} renderer identities`],
    }
  }

  const [, branchFixture, branchFamily] = branchMatch
  if (branchFixture !== target.fixture || branchFamily !== target.family) {
    return {
      mode: 'invalid',
      problems: [
        `branch names ${branchFixture}/${branchFamily}, but changed files name ${target.fixture}/${target.family}`,
      ],
    }
  }

  return {
    mode: 'targeted',
    fixture: target.fixture,
    family: target.family,
    identity: [...target.identities][0],
    copies: [...target.copies].sort(),
    files,
  }
}
