#!/usr/bin/env node
/* global console, process, fetch, URL */
/**
 * Read back the Storage rules production is actually enforcing (#2276).
 *
 * storage.rules in this repository is the source of truth. Deploying it proves
 * we sent it; it does not prove the live ruleset still matches, because a rules
 * edit made in the Firebase console never reaches git -- no push, no deploy, no
 * signal, until an admin is denied a read the repository allows. That is #2276.
 *
 * GET only. This script never creates a ruleset, never moves a release and
 * never edits a rule: the only write to production in this workflow is the
 * deploy that already existed. If the deployed rules are wrong, a human fixes
 * them by committing storage.rules and letting the deploy ship it.
 *
 * Authentication is the deploy's own: GOOGLE_APPLICATION_CREDENTIALS, exported
 * by the workflow's "Set up Firebase deploy credentials" step. Nothing new is
 * provisioned. Nothing here prints a token, a credential, a response body or
 * the deployed rule text -- verdicts carry digests and line numbers only.
 *
 * Exit codes, which the workflow maps deliberately differently:
 *   0  the deployed rules match, or differ only in comments/whitespace.
 *   1  the effective rules differ. A real finding; fails the job.
 *   2  we could not check. A warning, NOT a failure -- deploy-hosting.yml waits
 *      on this workflow, so treating an unanswered question as drift would
 *      strand the frontend over an API blip.
 *
 * The comparison logic lives in scripts/deploy/storageRulesDrift.js and is
 * tested by storageRulesDrift.test.js; this file only does the I/O.
 */
import {appendFileSync, readFileSync} from 'node:fs'
import {isAbsolute, resolve} from 'node:path'

import {
  EXIT,
  STORAGE_RELEASE_PREFIX,
  compareRules,
  describeVerdict,
  exitCodeFor,
  readRulesetSource,
  selectStorageReleases,
  unavailable,
  unreadable,
} from './deploy/storageRulesDrift.js'

// The ONLY origin this script talks to. Every request URL is re-parsed and
// checked against it in getJson, so a value read back from the API (a page
// token, a ruleset name) can never redirect the bearer token elsewhere.
const API_ORIGIN = 'https://firebaserules.googleapis.com'
const API = API_ORIGIN + '/v1'
const RULES_FILE = new URL('../storage.rules', import.meta.url)
const FIREBASERC = new URL('../.firebaserc', import.meta.url)

// A Google Cloud project id: 6-30 characters, lowercase letters, digits and
// hyphens, first character a letter, last not a hyphen.
const PROJECT_ID = /^[a-z][a-z0-9-]{4,28}[a-z0-9]$/

/**
 * The project whose rules to read: explicit env first, then .firebaserc.
 *
 * The value is checked against the project-id grammar before it is used,
 * because it is the one part of the request path this script does not write
 * itself. A value carrying `/`, `?` or `#` would silently address a different
 * Rules API resource while still passing the origin pin in getJson; that is a
 * repository or workflow misconfiguration, so it is refused outright rather
 * than escaped and sent anyway (CodeQL #67, js/file-access-to-http, is what
 * pointed at this path -- file contents reaching an outbound request URL).
 */
function projectId() {
  const raw = process.env.FIREBASE_PROJECT_ID || readDefaultProject()
  return typeof raw === 'string' && PROJECT_ID.test(raw) ? raw : null
}

/** The default project recorded in .firebaserc, or null if there isn't one. */
function readDefaultProject() {
  try {
    const rc = JSON.parse(readFileSync(FIREBASERC, 'utf8'))
    return (rc && rc.projects && rc.projects.default) || null
  } catch {
    return null
  }
}

/**
 * An access token from the credentials the deploy already uses.
 *
 * The legacy FIREBASE_TOKEN path cannot mint a Google API token. Inventing a
 * second production credential to work around that would be a worse trade than
 * reporting "unavailable", which is exactly why unavailable exists.
 */
async function accessToken() {
  if (!process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    return {
      ok: false,
      reason:
        'GOOGLE_APPLICATION_CREDENTIALS is unset, so there is no service account to read as; the legacy FIREBASE_TOKEN path cannot mint a Google API token',
    }
  }

  try {
    const {applicationDefault} = await import('firebase-admin/app')
    const token = await applicationDefault().getAccessToken()
    if (!token || !token.access_token) {
      return {ok: false, reason: 'the service-account credential returned no access token'}
    }
    return {ok: true, token: token.access_token}
  } catch (err) {
    return {ok: false, reason: 'could not mint an access token: ' + err.message}
  }
}

/**
 * A GET against the Rules API.
 *
 * Failures report the status code and nothing else: a response body can echo
 * request metadata, and this log is public.
 */
async function getJson(url, token) {
  // Parse and pin the destination before attaching the credential: the token
  // (minted from the service-account file) may only ever be sent to the fixed
  // Rules API origin, whatever ends up interpolated into the path or query.
  const target = new URL(url)
  if (target.origin !== API_ORIGIN || target.protocol !== 'https:') {
    throw new Error('refusing to call ' + target.origin + ' — only ' + API_ORIGIN + ' is allowed')
  }
  const res = await fetch(target, {headers: {Authorization: 'Bearer ' + token}})
  // Number(), not res.status directly: the status is the only thing from this
  // response that may be repeated, and the coercion says so at the point of
  // use. Nothing from the body, the headers or the URL is ever echoed -- this
  // message reaches a public job log (CodeQL #69, js/http-to-file-access).
  if (!res.ok) throw new Error('HTTP ' + Number(res.status) + ' from the Rules API')
  return res.json()
}

/**
 * Every Storage release in the project, across pages.
 *
 * The release list holds every rules-backed product and one entry per Storage
 * bucket, so it is paged through rather than sampled: stopping at the first
 * page could miss a bucket and report a clean result for rules nobody checked.
 */
async function storageReleases(project, token) {
  const found = []
  let pageToken = null

  for (let page = 0; page < 20; page++) {
    const query = pageToken ? '&pageToken=' + encodeURIComponent(pageToken) : ''
    const payload = await getJson(
      API + '/projects/' + encodeURIComponent(project) + '/releases?pageSize=100' + query,
      token,
    )
    found.push(...selectStorageReleases(payload))
    pageToken = (payload && payload.nextPageToken) || null
    if (!pageToken) break
  }

  return found.sort((a, b) => a.bucket.localeCompare(b.bucket))
}

function headingFor(code) {
  if (code === EXIT.ok) return 'Deployed Storage rules agree with storage.rules'
  if (code === EXIT.drift) return 'Deployed Storage rules DIFFER from storage.rules'
  return 'Could not verify the deployed Storage rules'
}

function report(lines, verdicts) {
  const code = exitCodeFor(verdicts)
  const heading = headingFor(code)

  console.log(heading)
  for (const line of lines) console.log('  ' + line)

  // The step summary is the runner-provided file and nothing else: the path
  // must be absolute (the runner always exports one), and what is appended is
  // our own verdict lines — API-derived fragments inside them (bucket names,
  // error messages) are stripped of control characters and the whole summary
  // is size-capped, so remote content cannot smuggle terminal escapes or grow
  // the file unboundedly.
  const summaryPath = process.env.GITHUB_STEP_SUMMARY
  if (summaryPath && isAbsolute(summaryPath)) {
    const sanitize = (s) => String(s).replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, '')
    const md = ['### Storage rules drift (#2276)', '', sanitize(heading), '']
      .concat(lines.map((line) => '- ' + sanitize(line)))
      .concat([''])
      .join('\n')
      .slice(0, 64 * 1024)
    try {
      appendFileSync(resolve(summaryPath), md)
    } catch (err) {
      console.log('  (could not write the step summary: ' + err.message + ')')
    }
  } else if (summaryPath) {
    console.log('  (ignored GITHUB_STEP_SUMMARY: not an absolute path)')
  }

  if (code === EXIT.drift) {
    console.log(
      '::error::The deployed Storage rules differ from storage.rules at this commit. Compare Firebase console > Storage > Rules against storage.rules, then fix it by committing storage.rules -- not by editing rules in the console, which is how this drift happens.',
    )
  }

  return code
}

async function main() {
  const repoRules = readFileSync(RULES_FILE, 'utf8')
  const verdicts = []
  const lines = []

  const record = (bucket, verdict) => {
    verdicts.push(verdict)
    lines.push(describeVerdict(bucket, verdict))
  }

  const project = projectId()
  if (!project) {
    record('(unknown project)', unavailable('no default project in .firebaserc and no FIREBASE_PROJECT_ID'))
    return report(lines, verdicts)
  }

  const auth = await accessToken()
  if (!auth.ok) {
    record(project, unavailable(auth.reason))
    return report(lines, verdicts)
  }

  let releases
  try {
    releases = await storageReleases(project, auth.token)
  } catch (err) {
    record(project, unavailable('listing releases failed: ' + err.message))
    return report(lines, verdicts)
  }

  if (releases.length === 0) {
    record(project, unavailable('the project reports no ' + STORAGE_RELEASE_PREFIX + ' release'))
    return report(lines, verdicts)
  }

  for (const release of releases) {
    let payload
    try {
      payload = await getJson(API + '/' + release.rulesetName, auth.token)
    } catch (err) {
      record(release.bucket, unavailable('fetching the ruleset failed: ' + err.message))
      continue
    }

    const read = readRulesetSource(payload)
    if (!read.ok) {
      record(release.bucket, unreadable(read.reason))
      continue
    }

    record(release.bucket, compareRules(repoRules, read.source))
  }

  return report(lines, verdicts)
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    // An unexpected throw is "we could not check", never "they differ".
    console.log(headingFor(EXIT.unknown))
    console.log('  unexpected failure: ' + err.message)
    process.exit(EXIT.unknown)
  })
