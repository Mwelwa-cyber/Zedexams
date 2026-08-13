/**
 * The one object the paper is measured from, and its identity.
 *
 * ## Why there is a single object
 *
 * The pagination hook used to accept `passages`, `parts` and `pagebreaks`,
 * fingerprint them, and then hand the measurement only `assessment` and
 * `questions`. Two consequences, both silent:
 *
 *   - a change to a passage marked the result stale and triggered a measurement
 *     of a document that did not contain the change, so the "fresh" answer was
 *     the same as the old one;
 *   - anything the renderer reads that was NOT fingerprinted could change the
 *     printed page with no measurement at all.
 *
 * So there is one canonical object. It is what gets fingerprinted and it is what
 * gets measured, and `assertMeasurable` refuses a caller that tries to measure
 * something else. Fingerprinting data the renderer never receives, or rendering
 * data absent from the fingerprint, are the same bug from two directions.
 *
 * ## Why identity is a hash of the whole model rather than a summary
 *
 * The first version recorded text LENGTHS, option COUNTS and a hand-picked list
 * of fields. Three ways that misses a real layout change:
 *
 *   - two strings of the same length wrap differently. "IIII" and "WWWW" are
 *     four characters and about half a line apart at the same font size, so a
 *     teacher rewording a question could push it onto the next page while the
 *     count on screen never moved.
 *   - rewording an option with the same number of options changed nothing.
 *   - diagram params, image dimensions, the school logo, the footer code,
 *     margins, typography and the marking-scheme toggle were simply not in it.
 *
 * A hash of the canonical serialisation of the whole model cannot miss any of
 * them, because anything the renderer reads is in the object by construction.
 * The one thing it cannot see is an image whose BYTES changed behind an
 * unchanged URL, which no client-side identity can.
 */

/**
 * Deterministic JSON: object keys in sorted order, arrays in their own order.
 *
 * `JSON.stringify` preserves insertion order, so two structurally identical
 * papers built by different code paths serialise differently and read as an
 * edit. That would mark a paper stale on every reload.
 */
export function stableStringify(value) {
  if (value === null || value === undefined) return 'null'
  const t = typeof value
  if (t === 'number') return Number.isFinite(value) ? String(value) : 'null'
  if (t === 'boolean' || t === 'bigint') return String(value)
  if (t === 'string') return JSON.stringify(value)
  if (t === 'function' || t === 'symbol') return 'null'
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  if (value instanceof Date) return JSON.stringify(value.toISOString())
  const keys = Object.keys(value).sort()
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(',')}}`
}

/**
 * FNV-1a, 32-bit, with the length appended.
 *
 * Not a security hash — an identity for "is this the same document". The length
 * is appended because a 32-bit digest alone collides often enough to matter over
 * a teacher's editing session, and two documents that collide AND have the same
 * length is a different order of unlikely.
 */
export function hashString(input) {
  const s = String(input ?? '')
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return `${h.toString(16).padStart(8, '0')}-${s.length.toString(16)}`
}

/**
 * The canonical printable model.
 *
 * Field for field what `measurePagination` renders — nothing summarised, nothing
 * dropped. The keys are fixed here rather than spread from the caller so a new
 * field cannot arrive in the fingerprint without also arriving in the render.
 */
export function buildPrintableModel({
  assessment = null,
  questions = [],
  passages = [],
  parts = [],
  pagebreaks = [],
  mode = 'paper',
  attribution = false,
} = {}) {
  return {
    assessment: assessment || null,
    questions: Array.isArray(questions) ? questions : [],
    passages: Array.isArray(passages) ? passages : [],
    parts: Array.isArray(parts) ? parts : [],
    pagebreaks: Array.isArray(pagebreaks) ? pagebreaks : [],
    mode: mode === 'scheme' ? 'scheme' : 'paper',
    attribution: Boolean(attribution),
  }
}

/**
 * The identity of a printable model.
 *
 * Anything that changes the printed page changes this, because everything the
 * renderer reads is in the model. Lengths and counts are never used.
 */
export function printableFingerprint(model) {
  return hashString(stableStringify(model))
}

/**
 * The assessment document the renderer is actually handed.
 *
 * `buildPrintableHtml` reads passages, parts and pagebreaks off the ASSESSMENT,
 * not as separate arguments, so the model's copies are folded back onto it here
 * — in one place, rather than at each call site where one of them could be
 * forgotten and the fingerprint would then describe a document nobody rendered.
 */
export function renderableAssessment(model) {
  const { assessment, passages, parts, pagebreaks } = model || {}
  return {
    ...(assessment || {}),
    passages: passages ?? assessment?.passages ?? [],
    parts: parts ?? assessment?.parts ?? [],
    pagebreaks: pagebreaks ?? assessment?.pagebreaks ?? [],
  }
}

/**
 * Refuse to measure something the fingerprint does not describe.
 *
 * The failure this prevents is silent by nature: a measurement of a different
 * document still returns a confident page count.
 */
export function assertMeasurable(model) {
  if (!model || typeof model !== 'object') {
    throw new TypeError('the pagination measurement needs a printable model')
  }
  for (const key of ['assessment', 'questions', 'passages', 'parts', 'pagebreaks', 'mode']) {
    if (!(key in model)) {
      throw new TypeError(`printable model is missing "${key}" — build it with buildPrintableModel()`)
    }
  }
  return model
}
