/**
 * Does production's Storage ruleset still say what storage.rules says?
 *
 * ## Why this exists
 *
 * #2276: an admin hit storage/unauthorized reading papers/{ownerUid}/{paperId}
 * under rules that, in this repository, allow exactly that read. The Storage
 * rules emulator suite agreed with the repository. So production disagreed with
 * the repository, and nothing anywhere checked whether those two are the same
 * thing.
 *
 * The deploy is not the gap: deploy-firebase.yml ships storage.rules on every
 * push that touches it. The gap is that nobody ever reads back. A rules edit
 * made in the Firebase console never reaches git, so there is no push, no
 * deploy and no signal at all -- the divergence stays invisible until a user is
 * denied a read the repository allows.
 *
 * ## Three verdicts, because "different" is too blunt to act on
 *
 *   match     identical once line endings and trailing whitespace settle.
 *   cosmetic  differs only in comments and whitespace. Reported, not fatal:
 *             it cannot change an authorization decision.
 *   mismatch  the effective rule text differs. Fatal. This is #2276's shape.
 *
 * ## Two more that are NOT drift, and must never be mistaken for it
 *
 *   unreadable   the API answered, but not with a ruleset we recognise.
 *   unavailable  we could not ask. Absence of an answer is not an answer.
 *
 * Conflating "we could not check" with "they differ" is how a monitoring
 * change becomes an outage: deploy-hosting.yml waits on this workflow, so a
 * false red here strands the frontend exactly the way the grep-based deploy
 * verdict did on 2026-07-29 (see functionsDeployLog.js in this directory).
 *
 * ## What is deliberately NOT canonicalised
 *
 * Comments and whitespace, yes. Statement order, no: two rulesets carrying the
 * same match blocks in a different order are a real difference and a human
 * should see it, whereas sorting them would hide an edit. Order is normalised
 * only where the API's own representation is arbitrary -- the file array inside
 * a ruleset, and the release list.
 *
 * Nothing here returns a token, a credential, or the deployed source. Callers
 * get digests and line numbers, so a public CI log never carries production
 * rules.
 *
 * Pure: no filesystem, no network, no process. Tested by
 * storageRulesDrift.test.js (npm run test:storage-rules-drift), which the
 * deploy workflow runs -- via npm run test:all -- before it trusts this.
 */

import {createHash} from 'node:crypto'

/**
 * Storage releases are named `projects/P/releases/firebase.storage/BUCKET`.
 * Firestore's is `cloud.firestore`, in the same list, which is why the product
 * segment has to be matched rather than assumed.
 */
export const STORAGE_RELEASE_PREFIX = 'firebase.storage'

/** Exit codes. Drift and "could not check" must never share one. */
export const EXIT = {ok: 0, drift: 1, unknown: 2}

/**
 * Line endings, BOM, trailing spaces and trailing blank lines settled.
 *
 * None of those can change an authorization decision, and all of them differ
 * routinely between a file in git and the same text round-tripped through an
 * API, so comparing raw strings would fail on the first deploy.
 *
 * @param {unknown} text
 * @returns {string}
 */
export function canonicalSource(text) {
  if (typeof text !== 'string') return ''
  return text
    .replace(/^\uFEFF/, '')
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.replace(/[ \t]+$/, ''))
    .join('\n')
    .replace(/\n+$/, '\n')
}

/**
 * Comments removed and whitespace collapsed: what the rules engine acts on.
 *
 * Quotes are tracked rather than regex-replacing `//`, because a `//` inside a
 * string literal is rule text and deleting it would corrupt the comparison in
 * the direction that hides drift.
 *
 * @param {unknown} text
 * @returns {string}
 */
export function effectiveSource(text) {
  const src = canonicalSource(text)
  let out = ''
  let quote = null

  for (let i = 0; i < src.length; i++) {
    const c = src[i]
    const next = src[i + 1]

    if (quote) {
      out += c
      if (c === '\\') {
        out += next === undefined ? '' : next
        i++
        continue
      }
      if (c === quote) quote = null
      continue
    }

    if (c === '"' || c === "'") {
      quote = c
      out += c
      continue
    }

    if (c === '/' && next === '/') {
      while (i < src.length && src[i] !== '\n') i++
      out += '\n'
      continue
    }

    if (c === '/' && next === '*') {
      i += 2
      while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) i++
      i++
      out += ' '
      continue
    }

    out += c
  }

  return out.replace(/\s+/g, ' ').trim()
}

/**
 * A short digest of the EFFECTIVE source, safe to print anywhere.
 *
 * Two rulesets with the same digest enforce the same thing; a digest reveals
 * nothing about what they enforce, which is what makes it printable in a
 * public CI log.
 *
 * @param {unknown} text
 * @returns {string}
 */
export function sourceDigest(text) {
  return createHash('sha256').update(effectiveSource(text)).digest('hex').slice(0, 12)
}

/**
 * The 1-based line of the first difference, or null. A number, never the text.
 *
 * @param {unknown} a
 * @param {unknown} b
 * @returns {number|null}
 */
export function firstDifferingLine(a, b) {
  const la = canonicalSource(a).split('\n')
  const lb = canonicalSource(b).split('\n')
  const n = Math.max(la.length, lb.length)
  for (let i = 0; i < n; i++) {
    if (la[i] !== lb[i]) return i + 1
  }
  return null
}

/**
 * The source text out of a firebaserules.googleapis.com ruleset payload.
 *
 * Shape: `{name, source: {files: [{name, content, fingerprint}]}}`. The file
 * NAME is ignored -- the deployed file may be called anything, and a filename
 * is not an authorization difference. A ruleset normally carries one file; if
 * it carries several they are joined in name order, because the array order is
 * the API's business rather than a change to the rules.
 *
 * Anything unrecognised is `unreadable`, never a mismatch: a payload we cannot
 * parse tells us nothing about what production enforces.
 *
 * @param {unknown} payload
 * @returns {{ok: true, source: string}|{ok: false, reason: string}}
 */
export function readRulesetSource(payload) {
  const files = payload && payload.source && payload.source.files
  if (!Array.isArray(files) || files.length === 0) {
    return {ok: false, reason: 'the ruleset payload carried no source files'}
  }

  const contents = [...files]
    .sort((x, y) => String((x && x.name) || '').localeCompare(String((y && y.name) || '')))
    .map((f) => f && f.content)

  if (contents.some((c) => typeof c !== 'string')) {
    return {ok: false, reason: 'the ruleset payload had a file with no string content'}
  }

  return {ok: true, source: contents.join('\n')}
}

/**
 * Every Storage release in a releases-list payload, in a stable order.
 *
 * A project's release list covers every rules-backed product, so
 * `cloud.firestore` sits in the same array and must be filtered out. There is
 * one Storage release per bucket, so a project with several buckets has
 * several: taking the first would silently check the wrong bucket and report a
 * clean result for a bucket nobody asked about. Callers get all of them.
 *
 * @param {unknown} payload
 * @returns {Array<{bucket: string, release: string, rulesetName: string}>}
 */
export function selectStorageReleases(payload) {
  const releases = payload && payload.releases
  if (!Array.isArray(releases)) return []

  const marker = '/releases/' + STORAGE_RELEASE_PREFIX + '/'

  return releases
    .filter((r) => r && typeof r.name === 'string' && typeof r.rulesetName === 'string')
    .filter((r) => r.name.includes(marker))
    .map((r) => ({
      bucket: r.name.slice(r.name.indexOf(marker) + marker.length) || '(unnamed bucket)',
      release: r.name,
      rulesetName: r.rulesetName,
    }))
    .sort((a, b) => a.bucket.localeCompare(b.bucket))
}

/**
 * Compare the repository's rules with the deployed ones.
 *
 * @param {unknown} repoText   storage.rules at this commit: the source of truth.
 * @param {unknown} deployedText   what the Rules API handed back.
 * @returns {{status: 'match'|'cosmetic'|'mismatch', repoDigest: string, deployedDigest: string, line: number|null}}
 */
export function compareRules(repoText, deployedText) {
  const repoDigest = sourceDigest(repoText)
  const deployedDigest = sourceDigest(deployedText)

  if (canonicalSource(repoText) === canonicalSource(deployedText)) {
    return {status: 'match', repoDigest, deployedDigest, line: null}
  }

  return {
    status: repoDigest === deployedDigest ? 'cosmetic' : 'mismatch',
    repoDigest,
    deployedDigest,
    line: firstDifferingLine(repoText, deployedText),
  }
}

/** The API answered with something we cannot parse. Not a mismatch. */
export function unreadable(reason) {
  return {status: 'unreadable', reason}
}

/** We could not ask at all. Not a mismatch. */
export function unavailable(reason) {
  return {status: 'unavailable', reason}
}

/**
 * One line per verdict, safe for a public log: digests and line numbers only.
 *
 * @param {string} bucket
 * @param {{status: string, repoDigest?: string, deployedDigest?: string, line?: number|null, reason?: string}} v
 * @returns {string}
 */
export function describeVerdict(bucket, v) {
  switch (v.status) {
    case 'match':
      return bucket + ': deployed rules match storage.rules (effective digest ' + v.repoDigest + ')'
    case 'cosmetic':
      return (
        bucket +
        ': comments or whitespace differ from storage.rules, first at line ' +
        v.line +
        ' -- effective rules identical (' +
        v.repoDigest +
        '), so no authorization difference'
      )
    case 'mismatch':
      return (
        bucket +
        ': DEPLOYED RULES DIFFER from storage.rules -- effective digest ' +
        v.deployedDigest +
        ' vs repository ' +
        v.repoDigest +
        ', first difference at line ' +
        v.line
      )
    case 'unreadable':
      return bucket + ': could not read the deployed ruleset -- ' + v.reason
    case 'unavailable':
      return bucket + ': could not retrieve the deployed ruleset -- ' + v.reason
    default:
      return bucket + ': unrecognised verdict'
  }
}

/**
 * The process exit code for a set of verdicts.
 *
 * Drift outranks unknown because a proven mismatch is the more actionable
 * finding, and both stay distinguishable from a clean run -- which is the
 * whole point: the caller maps `drift` to a failure and `unknown` to a
 * warning, so an unreachable API cannot masquerade as a rules difference.
 *
 * @param {Array<{status: string}>} verdicts
 * @returns {number}
 */
export function exitCodeFor(verdicts) {
  if (!Array.isArray(verdicts) || verdicts.length === 0) return EXIT.unknown
  if (verdicts.some((v) => v && v.status === 'mismatch')) return EXIT.drift
  if (verdicts.some((v) => v && (v.status === 'unreadable' || v.status === 'unavailable'))) {
    return EXIT.unknown
  }
  return EXIT.ok
}
