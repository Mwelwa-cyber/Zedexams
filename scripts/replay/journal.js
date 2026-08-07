/**
 * Write journals, and the rules for calling two of them identical.
 *
 * This is the machinery behind `docs/phase3-plan.md` §3 — the byte-compatibility
 * guarantee that lets a cutover be a comparison rather than a code review.
 *
 * ## What it is for
 *
 * The plan's §3.3 describes replaying a recorded attempt through BOTH paths and
 * diffing the journals. Three things make that up, and they landed in this
 * order deliberately:
 *
 *   1. **The rules** (`diffJournals`) — pure, and tested against every way two
 *      journals can differ. Reviewing them BEFORE a cutover existed was the
 *      point: once one is in flight there is pressure to make the comparison
 *      pass, and a rule loosened under that pressure is how byte-compatibility
 *      quietly becomes a formality.
 *   2. **A baseline pin** (`replayQuizResults.test.js`) — the old path's
 *      journal, recorded and asserted while it was still the only one. Not the
 *      comparison; the OLD side of it, plus a guard against the old path
 *      drifting.
 *   3. **The comparison** (`replayEngineComparison.test.js`) — both paths, per
 *      fixture, diffed. This exists as of `persist/`.
 *
 * So the rules arrived reviewed, with controls, before anything depended on
 * them passing.
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
 * A difference the two paths are SUPPOSED to have.
 *
 * Byte-compatibility is the rule; a deviation is a decided, reviewed exception
 * to it, and there is exactly one so far (`timeSpent: 0` → `null` when the
 * attempt's start is unknown — see `persist/resultDocument.js`).
 *
 * Two properties make this different from adding a field to `VOLATILE`:
 *
 *   1. **It states both sides.** `{ from: 0, to: null }` — not "this field may
 *      differ", but "it differs in exactly this way". A path that starts
 *      writing `-1` fails.
 *   2. **A deviation that does NOT occur is itself a difference.** If the
 *      engine stops writing null, this reports it. An exception nobody
 *      re-examines is how a temporary allowance becomes permanent, and the
 *      usual failure of an allow-list is that entries outlive their reason
 *      in silence.
 *
 * @typedef {object} Deviation
 * @property {number} write   index into the journal
 * @property {string} field   dotted field path within that write's payload
 * @property {*} from         the value A is required to have
 * @property {*} to           the value B is required to have
 * @property {string} reason  why this is allowed — shown when it fails
 */

/** Same-value test that treats NaN as equal to itself and distinguishes types. */
function sameValue(a, b) {
  return Object.is(a, b)
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
 *
 * @param {object} ctx  `{ compareWallClock, deviations, satisfied }` — the
 *   options that reach the leaves, plus the set recording which declared
 *   deviations actually occurred, so an unused one can be reported.
 */
function comparePayload(a, b, path, out, ctx) {
  const aKeys = Object.keys(a ?? {}).sort()
  const bKeys = Object.keys(b ?? {}).sort()

  for (const key of aKeys) if (!bKeys.includes(key)) out.push(`${path}${key}: present in A, absent in B`)
  for (const key of bKeys) if (!aKeys.includes(key)) out.push(`${path}${key}: absent in A, present in B`)

  for (const key of aKeys) {
    if (!bKeys.includes(key)) continue
    const av = a[key]
    const bv = b[key]
    const fieldPath = `${path}${key}`

    // A DECLARED deviation is checked before anything else, and checked
    // exactly: both sides must be what the declaration says. Anything else at
    // this field is a real difference, including a deviation that half
    // happened.
    const declared = ctx.deviations.find((d) => d.path === fieldPath)
    if (declared) {
      if (sameValue(av, declared.from) && sameValue(bv, declared.to)) {
        ctx.satisfied.add(declared)
        continue
      }
      out.push(
        `${fieldPath}: declared deviation not met — expected ${JSON.stringify(declared.from)} → ` +
        `${JSON.stringify(declared.to)}, got ${JSON.stringify(av)} → ${JSON.stringify(bv)} ` +
        `(${declared.reason})`,
      )
      continue
    }

    // A volatile field must still be PRESENT in both — only its value is
    // exempt. A path that stopped writing `completedAt` entirely is a real
    // difference, and exempting the value must not exempt the field.
    //
    // `compareWallClock` turns the wall-clock half of that off, and the reason
    // is a finding from the baseline run: the exemption is a property of LIVE
    // capture, where the same attempt replayed a moment later genuinely yields
    // a different elapsed value. A replay from a fixture INJECTS the clock, so
    // the duration is fully determined — and exempting it there let a changed
    // rounding rule through, which a control proved.
    if (isVolatile(key)) {
      const isWallClock = VOLATILE.wallClockFields.includes(key)
      if (!(isWallClock && ctx.compareWallClock)) continue
    }

    if (typeName(av) !== typeName(bv)) {
      out.push(`${path}${key}: type ${typeName(av)} vs ${typeName(bv)} (${JSON.stringify(av)} vs ${JSON.stringify(bv)})`)
      continue
    }
    if (isPlainObject(av)) {
      comparePayload(av, bv, `${path}${key}.`, out, ctx)
      continue
    }
    if (Array.isArray(av)) {
      if (av.length !== bv.length) {
        out.push(`${path}${key}: array length ${av.length} vs ${bv.length}`)
        continue
      }
      av.forEach((item, i) => {
        if (isPlainObject(item)) comparePayload(item, bv[i], `${path}${key}[${i}].`, out, ctx)
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
 * @param {Array} a  the journal to treat as the baseline (the OLD path)
 * @param {Array} b  the journal being compared to it (the ENGINE)
 * @param {object} [options]
 * @param {Deviation[]} [options.deviations]  decided, reviewed exceptions. Each
 *   states both sides; one that does not occur is reported as a difference in
 *   its own right, so an allowance cannot outlive its reason unnoticed.
 * @param {boolean} [options.compareWallClock]  compare `timeSpent` and friends
 *   instead of exempting them. Correct whenever BOTH journals were produced
 *   from an injected clock — a fixture replay — and wrong for a live capture.
 * @returns {{ identical: boolean, differences: string[] }}
 *   `differences` is empty exactly when `identical` is true. Every entry names
 *   the write index, the field path and both values, because a diff that says
 *   "journals differ" sends whoever hits it back to reading two payloads by eye.
 */
export function diffJournals(a, b, { deviations = [], compareWallClock = false } = {}) {
  const differences = []

  // Deviations are declared per write index and field; flattening them to a
  // dotted path up front is what lets the leaf comparison find one without
  // knowing how deep it is.
  const resolved = deviations.map((d) => ({ ...d, path: `write[${d.write}].${d.field}` }))
  for (const d of resolved) {
    if (!('from' in d) || !('to' in d)) {
      throw new Error(`deviation at ${d.path} must state both \`from\` and \`to\``)
    }
  }
  const ctx = { deviations: resolved, compareWallClock, satisfied: new Set() }

  if (a.length !== b.length) {
    differences.push(`write count: ${a.length} vs ${b.length}`)
  }

  const n = Math.min(a.length, b.length)
  for (let i = 0; i < n; i += 1) {
    const label = `write[${i}]`
    if (a[i].op !== b[i].op) differences.push(`${label}.op: ${a[i].op} vs ${b[i].op}`)
    if (a[i].path !== b[i].path) differences.push(`${label}.path: ${a[i].path} vs ${b[i].path}`)
    comparePayload(a[i].payload, b[i].payload, `${label}.`, differences, ctx)
  }

  // A declared deviation that never fired is a difference too. Otherwise the
  // list becomes a set of claims nobody checks — and the first thing that
  // rots is the one whose reason has been fixed.
  for (const d of resolved) {
    if (!ctx.satisfied.has(d)) {
      differences.push(`${d.path}: declared deviation never occurred — the field was not compared, or is absent`)
    }
  }

  // Writes past the shorter journal are reported individually — "count differs"
  // alone does not say WHICH extra write appeared, and that is the whole
  // question when an engine writes one document too many.
  for (let i = n; i < a.length; i += 1) differences.push(`${`write[${i}]`}: only in A — ${a[i].op} ${a[i].path}`)
  for (let i = n; i < b.length; i += 1) differences.push(`${`write[${i}]`}: only in B — ${b[i].op} ${b[i].path}`)

  return { identical: differences.length === 0, differences }
}
