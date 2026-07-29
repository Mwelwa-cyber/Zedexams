/**
 * What a `firebase deploy --only functions` log actually says happened.
 *
 * ## Why this is a module rather than a grep pipeline
 *
 * The workflow used to classify the deploy with a stack of `grep`s over the
 * output. Every one of them answered "does this text appear anywhere", which is
 * not the question. firebase-tools retries a throttled operation ITSELF, inside
 * a single deploy, and reports both outcomes:
 *
 *     ⚠  functions: Request to https://…/functions/triggerWeeklyParentDigest?… had HTTP Error: 429, Quota exceeded…
 *     ⚠  functions: Got "Quota Exceeded" error while trying to update …/triggerWeeklyParentDigest. Waiting to retry…
 *     ⚠  functions:  failed to update function projects/…/functions/triggerWeeklyParentDigest
 *     ✔  functions[triggerWeeklyParentDigest(us-central1)] Successful update operation.
 *     ✔  Deploy complete!
 *
 * The failure marker is present, so the grep failed the job — on a deploy that
 * had finished. On 2026-07-29 that false red blocked the Hosting deploy behind
 * it for 35 minutes (the firestore.rules fix teachers were waiting on had
 * already been released; the frontend had not). It fires whenever two pull
 * requests merge close enough together to hit the per-minute Cloud Functions
 * mutation quota, which is a normal Tuesday.
 *
 * ## The rule
 *
 * A function is UNRESOLVED when its last event in the log is a failure. Order
 * decides, not presence: a failure followed by a success is a recovery, and a
 * success followed by a failure is a failure — the same two lines in the other
 * order mean the opposite thing, which is precisely what a presence test cannot
 * see.
 *
 * Only unresolved functions are then classified as cosmetic-or-genuine by the
 * pre-existing 409 rules, which are preserved verbatim below. Nothing here
 * widens what counts as cosmetic: a 429 that never recovered is still genuine,
 * because a function left running stale code is the failure this job exists to
 * catch.
 *
 * Cloud Scheduler trigger failures are outside all of it — see below.
 *
 * Pure: no filesystem, no network, no process. Tested by
 * functionsDeployLog.test.js (npm run test:deploy-log), which the deploy
 * workflow runs before it trusts this.
 */

/**
 * `✔  functions[NAME(region)] Successful update operation.`
 *
 * Success is reported with the bracket form and failure with a resource path,
 * so the two can never be confused for each other.
 */
const SUCCESS_RE =
  /functions\[([A-Za-z0-9_-]+)\([^)]*\)\]\s+Successful\s+(?:update|create|delete|upsert)\s+operation/i

/** `⚠  functions:  failed to update function projects/…/functions/NAME` */
const FAILURE_RE =
  /failed to (?:update|create) function\b[^\n]*?\/functions\/([A-Za-z0-9_-]+)/i

/**
 * `Request to https://…/functions/NAME?updateMask=… had HTTP Error: 409, …`
 *
 * Gen 2 failures always carry one of these. Gen 1 failures do NOT — that
 * asymmetry is what the bare-failure rule below exists for.
 */
const DETAIL_RE = /\/functions\/([A-Za-z0-9_-]+)\b[^\n]*?had HTTP Error:\s*(\d+)/i

/** The transient race: the operation completes server-side. */
const QUEUE_409_RE = /HTTP Error:\s*409,\s*unable to queue the operation/i

/** The idempotent create race: the resource is already there, with our code. */
const ALREADY_EXISTS_409_RE =
  /HTTP Error:\s*409,\s*Resource '[^']*\/functions\/([A-Za-z0-9_-]+)' already exists/i

/** `Failed to upsert schedule function NAME in region …` */
const SCHEDULER_RE = /Failed to upsert schedule function\s+([A-Za-z0-9_-]+)/i

const uniqueSorted = (names) => [...new Set(names)].sort()

/**
 * Every per-function event in the log, in the order the log reports them.
 *
 * @param {string} logText
 * @returns {Array<{name: string, kind: 'success'|'failure', line: number}>}
 */
export function readDeployEvents(logText) {
  const events = []
  const lines = String(logText || '').split('\n')

  lines.forEach((line, index) => {
    // Success first: a success line never also matches FAILURE_RE, but reading
    // in this order keeps the precedence explicit rather than incidental.
    const success = SUCCESS_RE.exec(line)
    if (success) {
      events.push({ name: success[1], kind: 'success', line: index })
      return
    }
    const failure = FAILURE_RE.exec(line)
    if (failure) {
      events.push({ name: failure[1], kind: 'failure', line: index })
    }
  })

  return events
}

/**
 * Classify a functions deploy from its log.
 *
 * @param {string} logText  the deploy output — pass EVERY attempt's output,
 *   concatenated in order. A retry that prints "no changes detected" mentions
 *   nothing, so the last thing actually said about a function is what stands,
 *   which fails closed.
 * @returns {{
 *   recovered: string[],    failed, then succeeded later — not a failure
 *   unresolved: string[],   last event is a failure
 *   cosmetic: string[],     unresolved, but a known transient 409
 *   genuine: string[],      unresolved and not cosmetic — the job must fail
 *   schedulerFailed: string[],
 *   ok: boolean,
 * }}
 */
export function classifyFunctionsDeploy(logText) {
  const text = String(logText || '')
  const events = readDeployEvents(text)

  // Last event wins. This is the whole fix.
  const lastKind = new Map()
  const everFailed = new Set()
  for (const event of events) {
    lastKind.set(event.name, event.kind)
    if (event.kind === 'failure') everFailed.add(event.name)
  }

  const unresolved = uniqueSorted(
    [...lastKind.entries()].filter(([, kind]) => kind === 'failure').map(([name]) => name),
  )
  const recovered = uniqueSorted(
    [...everFailed].filter((name) => lastKind.get(name) === 'success'),
  )

  // ── Cosmetic classification, applied ONLY to unresolved functions ──────
  // Unchanged in substance from the grep implementation these replace; the
  // difference is that a recovered function never reaches them, because it is
  // not a failure to excuse in the first place.
  const unresolvedSet = new Set(unresolved)
  const queueRace = new Set()
  const alreadyExists = new Set()
  const detailed = new Set()

  for (const line of text.split('\n')) {
    const detail = DETAIL_RE.exec(line)
    if (detail) {
      detailed.add(detail[1])
      if (QUEUE_409_RE.test(line)) queueRace.add(detail[1])
    }
    const exists = ALREADY_EXISTS_409_RE.exec(line)
    if (exists) alreadyExists.add(exists[1])
  }

  // A gen 1 function surfaces the same throttling race with no HTTP detail at
  // all — only the bare "failed to update function" line. When the race is
  // demonstrably present in this deploy (some gen 2 sibling printed the 409),
  // a co-failing function that reported no detail is overwhelmingly the same
  // race. With no "unable to queue" line anywhere, `raceIsPresent` is false and
  // a bare failure stays genuine — fail closed.
  const raceIsPresent = [...queueRace].some((name) => unresolvedSet.has(name))
    || QUEUE_409_RE.test(text)
  const bare = raceIsPresent
    ? unresolved.filter((name) => !detailed.has(name))
    : []

  const cosmetic = uniqueSorted(
    unresolved.filter(
      (name) => queueRace.has(name) || alreadyExists.has(name) || bare.includes(name),
    ),
  )
  const cosmeticSet = new Set(cosmetic)
  const genuine = unresolved.filter((name) => !cosmeticSet.has(name))

  const schedulerFailed = uniqueSorted(
    text.split('\n')
      .map((line) => SCHEDULER_RE.exec(line))
      .filter(Boolean)
      .map((match) => match[1]),
  )

  return {
    recovered,
    unresolved,
    cosmetic,
    genuine,
    schedulerFailed,
    ok: genuine.length === 0 && schedulerFailed.length === 0,
  }
}

/**
 * The functions worth retrying: those whose last event is a failure.
 *
 * The grep version retried every function that had ever printed a failure line,
 * including ones that had already recovered — spending mutation quota on work
 * already done, during the exact incident where that quota had run out.
 *
 * @param {string} logText  ONE attempt's output.
 * @returns {string[]}
 */
export function retrySetFromLog(logText) {
  return classifyFunctionsDeploy(logText).unresolved
}
