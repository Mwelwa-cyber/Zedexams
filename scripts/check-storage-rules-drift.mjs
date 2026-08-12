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

const API = 'https://firebaserules.googleapis.com/v1'
const RULES_FILE = new URL('../storage.rules', import.meta.url)
const FIREBASERC = new URL('../.firebaserc', import.meta.url)

/** The project whose rules to read: explicit env first, then .firebaserc. */
function projectId() {
  if (process.env.FIREBASE_PROJECT_ID) return process.env.FIREBASE_PROJECT_ID
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
  const res = await fetch(url, {headers: {Authorization: 'Bearer ' + token}})
  if (!res.ok) throw new Error('HTTP ' + res.status + ' from the Rules API')
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
    const payload = await getJson(API + '/projects/' + project + '/releases?pageSize=100' + query, token)
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

  const summaryPath = process.env.GITHUB_STEP_SUMMARY
  if (summaryPath) {
    const md = ['### Storage rules drift (#2276)', '', heading, '']
      .concat(lines.map((line) => '- ' + line))
      .concat([''])
      .join('\n')
    try {
      appendFileSync(summaryPath, md)
    } catch (err) {
      console.log('  (could not write the step summary: ' + err.message + ')')
    }
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
