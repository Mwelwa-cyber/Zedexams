/**
 * Write journals, and the rules for calling two of them identical.
 *
 * This is the machinery behind `docs/phase3-plan.md` §3 — the byte-compatibility
 * guarantee that lets a cutover be a comparison rather than a code review.
 *
 * ## What it is for, and what it cannot do yet
 *
 * The plan's §3.3 describes replaying a recorded attempt through BOTH paths and
 * diffing the journals. The engine has no write adapter yet (`persist/` does not
 * exist), so there is no second path, and a "comparison" run today would be one
 * path checked against itself.
 *
 * So this ships as two separable things, and only the first is finished:
 *
 *   1. **The rules** (`diffJournals`) — pure, and tested against every way two
 *      journals can differ. Reviewing them NOW is the point: once a cutover is
 *      in flight there is pressure to make the comparison pass, and a rule
 *      loosened under that pressure is how byte-compatibility quietly becomes a
 *      formality.
 *   2. **A baseline pin** (`scripts/replay/replayQuizResults.test.js`) — the
 *      current path's journal, recorded and asserted. That is not the old-vs-new
 *      diff; it is the OLD side of it, captured while the old path is still the
 *      only one, plus a guard against the old path drifting before cutover.
 *
 * The old-vs-new diff lands with the first write adapter, and at that point
 * `diffJournals` is already reviewed and already has controls.
 *
 * ## The rules (§3.2)
 *
 * Two journals are identical when:
 *
 *   1. the same NUMBER of writes happened, to the same paths in the same order —
 *      so a "harmless" extra `setDoc` cannot hide inside an equal payload;
 *   2. each payload has the same FIELD SET — a new field in `results` is a schema
 *      change with rules, index and consumer consequences, never a detail;
 *   3. every value is `===`, with exactly three declared exceptions;
 *   4. TYPES match, because `4` and `'4'` are not the same value. This is not
 *      pedantry: the `scores` collection stores grade as a Number and subject
 *      lowercased by documented, deliberate divergence, and an engine that
 *      "tidied" either would break every games leaderboard query while a
 *      value-only comparison stayed green.
 *
 * The three exceptions are `VOLATILE`, below. **The list is part of the
 * assertion**: a fourth exception is added in a diff a reviewer can see, never
 * discovered by loosening a matcher until a test passes.
 */

/**
 * The only fields allowed to differ between two runs of the same attempt.
 *
 * Each is non-deterministic by nature, not by accident:
 *   • server timestamps are assigned by Firestore, not by either path;
 *   • auto-ids are assigned by Firestore;
 *   • wall-clock durations depend on when the replay ran.
 *
 * Anything else that differs is a real difference.
 */
export const VOLATILE = Object.freeze({
  /** Sentinels a path emits where the server will write a time. */
  serverTimestampFields: Object.freeze(['completedAt', 'startedAt', 'submittedAt', 'playedAt', 'updatedAt', 'lockedAt']),
  /** Firestore-assigned document ids. */
  autoIdFields: Object.freeze(['id']),
  /** Measured elapsed time. */
  wallClockFields: Object.freeze(['timeSpent', 'elapsedSeconds', 'timeTakenSeconds']),
})

const ALL_VOLATILE = Object.freeze([
  ...VOLATILE.serverTimestampFields,
  ...VOLATILE.autoIdFields,
  ...VOLATILE.wallClockFields,
])

/** Is `field` allowed to differ? Exact match only — no prefix or fuzzy rules. */
export function isVolatile(field) {
  return ALL_VOLATILE.includes(field)
}

/**
 * A fake Firestore that records instead of writing.
 *
 * Deliberately not a mock of the SDK's surface — it records the four operations
 * the Phase 3 paths actually perform, and anything else is an error rather than
 * a silent no-op, because a path that started doing something new is exactly
 * what this exists to notice.
 */
export function createRecorder() {
  const entries = []
  const record = (op, path, payload) => {
    entries.push({ op, path, payload })
    return { id: `recorded-${entries.length}` }
  }
  return {
    entries,
    addDoc: (path, payload) => record('addDoc', path, payload),
    setDoc: (path, payload) => record('setDoc', path, payload),
    updateDoc: (path, payload) => record('updateDoc', path, payload),
    /** A transaction records its writes in order, flattened into the journal. */
    runTransaction: (fn) => fn({
      set: (path, payload) => record('tx.set', path, payload),
      update: (path, payload) => record('tx.update', path, payload),
    }),
    journal: () => entries.map((e) => ({ ...e })),
  }
}

/** `typeof`, but distinguishing null and arrays — the cases that hide bugs. */
function typeName(value) {
  if (value === null) return 'null'
  if (Array.isArray(value)) return 'array'
  return typeof value
}

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v)
}

/**
 * Compare one payload against another, recursively.
 * `path` is the dotted field path, used only for the difference message.
 */
function comparePayload(a, b, path, out) {
  const aKeys = Object.keys(a ?? {}).sort()
  const bKeys = Object.keys(b ?? {}).sort()

  for (const key of aKeys) if (!bKeys.includes(key)) out.push(`${path}${key}: present in A, absent in B`)
  for (const key of bKeys) if (!aKeys.includes(key)) out.push(`${path}${key}: absent in A, present in B`)

  for (const key of aKeys) {
    if (!bKeys.includes(key)) continue
    const av = a[key]
    const bv = b[key]

    // A volatile field must still be PRESENT in both — only its value is
    // exempt. A path that stopped writing `completedAt` entirely is a real
    // difference, and exempting the value must not exempt the field.
    if (isVolatile(key)) continue

    if (typeName(av) !== typeName(bv)) {
      out.push(`${path}${key}: type ${typeName(av)} vs ${typeName(bv)} (${JSON.stringify(av)} vs ${JSON.stringify(bv)})`)
      continue
    }
    if (isPlainObject(av)) {
      comparePayload(av, bv, `${path}${key}.`, out)
      continue
    }
    if (Array.isArray(av)) {
      if (av.length !== bv.length) {
        out.push(`${path}${key}: array length ${av.length} vs ${bv.length}`)
        continue
      }
      av.forEach((item, i) => {
        if (isPlainObject(item)) comparePayload(item, bv[i], `${path}${key}[${i}].`, out)
        else if (item !== bv[i]) out.push(`${path}${key}[${i}]: ${JSON.stringify(item)} vs ${JSON.stringify(bv[i])}`)
      })
      continue
    }
    if (av !== bv) out.push(`${path}${key}: ${JSON.stringify(av)} vs ${JSON.stringify(bv)}`)
  }
}

/**
 * Diff two write journals under §3.2's rules.
 *
 * @returns {{ identical: boolean, differences: string[] }}
 *   `differences` is empty exactly when `identical` is true. Every entry names
 *   the write index, the field path and both values, because a diff that says
 *   "journals differ" sends whoever hits it back to reading two payloads by eye.
 */
export function diffJournals(a, b) {
  const differences = []

  if (a.length !== b.length) {
    differences.push(`write count: ${a.length} vs ${b.length}`)
  }

  const n = Math.min(a.length, b.length)
  for (let i = 0; i < n; i += 1) {
    const label = `write[${i}]`
    if (a[i].op !== b[i].op) differences.push(`${label}.op: ${a[i].op} vs ${b[i].op}`)
    if (a[i].path !== b[i].path) differences.push(`${label}.path: ${a[i].path} vs ${b[i].path}`)
    comparePayload(a[i].payload, b[i].payload, `${label}.`, differences)
  }

  // Writes past the shorter journal are reported individually — "count differs"
  // alone does not say WHICH extra write appeared, and that is the whole
  // question when an engine writes one document too many.
  for (let i = n; i < a.length; i += 1) differences.push(`${`write[${i}]`}: only in A — ${a[i].op} ${a[i].path}`)
  for (let i = n; i < b.length; i += 1) differences.push(`${`write[${i}]`}: only in B — ${b[i].op} ${b[i].path}`)

  return { identical: differences.length === 0, differences }
}
