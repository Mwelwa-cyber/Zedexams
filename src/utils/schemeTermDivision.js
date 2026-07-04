/**
 * schemeTermDivision — divide an ordered syllabus topic list intelligently
 * across the three school terms.
 *
 * The Scheme of Work Studio used to hand the model the WHOLE grade+subject
 * topic outline every term, so Term 2 and Term 3 both restarted from the first
 * topic ("Human Body") — the syllabus was never progressed. This module fixes
 * that at the root: it splits the ordered topic list into three consecutive
 * slices so Term 2 continues where Term 1 ended and Term 3 continues where
 * Term 2 ended. A topic is placed in exactly ONE term — it is never repeated
 * across terms (unless the teacher deliberately re-adds it as revision).
 *
 * Everything here is PURE — no DOM, no Firestore, no network — so it runs both
 * in the browser (the live preview) and under plain `node` (its unit tests).
 * The server keeps a lock-step copy at
 * functions/teacherTools/schemeTermDivision.js — keep the two in sync.
 */

export const TERMS = [1, 2, 3]

const DEFAULT_SUBTOPICS_PER_WEEK = 2
const MAX_WEEKS_PER_TOPIC = 4

/** A topic may arrive as `{topic}` (server outline) or `{label}` (client hook). */
export function topicName(t) {
  return String((t && (t.topic ?? t.label)) || '').trim()
}

/** Flatten a sub-topic (plain string OR `{name}` object) to its display name. */
export function subtopicName(s) {
  if (s == null) return ''
  if (typeof s === 'string') return s.trim()
  if (typeof s === 'object' && typeof s.name === 'string') return s.name.trim()
  return String(s).trim()
}

function cleanSubtopics(t) {
  const raw = Array.isArray(t && t.subtopics) ? t.subtopics : []
  const seen = new Set()
  const out = []
  for (const s of raw) {
    const name = subtopicName(s)
    if (!name) continue
    const key = name.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(name)
  }
  return out
}

/**
 * Estimate how many teaching weeks a topic needs from its sub-topic count.
 * Short topics (0–1 sub-topics) fit in one week; content-heavy topics are
 * split across several weeks (capped so one topic never eats a whole term).
 */
export function estimateTopicWeeks(topic, opts = {}) {
  const per = Math.max(1, opts.subtopicsPerWeek || DEFAULT_SUBTOPICS_PER_WEEK)
  const cap = Math.max(1, opts.maxWeeksPerTopic || MAX_WEEKS_PER_TOPIC)
  const n = cleanSubtopics(topic).length
  if (n <= 1) return 1
  return Math.min(cap, Math.ceil(n / per))
}

/** Normalise a `{1,2,3}` weeks-per-term map, filling gaps with a sane default. */
function normalizeWeeksByTerm(weeksByTerm) {
  const w = weeksByTerm || {}
  const val = (t, def) => {
    const n = Number(w[t])
    return Number.isFinite(n) && n > 0 ? Math.round(n) : def
  }
  // Zambian terms run ~12–13 teaching weeks; Term 3 is usually a little shorter.
  return { 1: val(1, 12), 2: val(2, 12), 3: val(3, 11) }
}

/**
 * Turn a raw ordered topic list into normalised division items.
 * Each item: {index, topic, subtopics[], weeks, source}.
 */
export function toDivisionItems(topics, opts = {}) {
  return (Array.isArray(topics) ? topics : [])
    .map((t, i) => ({ raw: t, i }))
    .filter(({ raw }) => topicName(raw))
    .map(({ raw, i }) => ({
      index: i,
      topic: topicName(raw),
      subtopics: cleanSubtopics(raw),
      weeks: estimateTopicWeeks(raw, opts),
      source: String((raw && raw.source) || 'syllabi_studio'),
    }))
}

/**
 * Divide an ordered topic list across Term 1, Term 2, Term 3.
 *
 * Greedy, order-preserving fill: pour topics into Term 1 until its teaching-week
 * budget is met, then Term 2, then Term 3. This guarantees each term simply
 * CONTINUES the syllabus — no topic is repeated, none is skipped, and the
 * sequence never restarts.
 *
 * @param {Array} topics  ordered topics ([{topic|label, subtopics}])
 * @param {{weeksByTerm?:{1,2,3}, subtopicsPerWeek?:number, maxWeeksPerTopic?:number}} opts
 * @returns {{ byTerm: {1:Item[],2:Item[],3:Item[]}, items: Item[], weeksByTerm }}
 */
export function divideTopicsByTerm(topics, opts = {}) {
  const items = toDivisionItems(topics, opts)
  const weeksByTerm = normalizeWeeksByTerm(opts.weeksByTerm)
  const byTerm = { 1: [], 2: [], 3: [] }

  let ti = 0
  let usedInTerm = 0
  for (const item of items) {
    // Advance to the next term once this one is full — but never leave a term
    // completely empty (place at least one topic before moving on, so a single
    // oversized topic can't skip a whole term).
    while (
      ti < TERMS.length - 1 &&
      usedInTerm > 0 &&
      usedInTerm + item.weeks > weeksByTerm[TERMS[ti]]
    ) {
      ti += 1
      usedInTerm = 0
    }
    byTerm[TERMS[ti]].push(item)
    usedInTerm += item.weeks
  }

  return { byTerm, items, weeksByTerm }
}

/** The ordered topic slice for a single term (Term 2 continues Term 1, etc.). */
export function topicsForTerm(topics, term, opts = {}) {
  const t = Math.min(3, Math.max(1, Number(term) || 1))
  return divideTopicsByTerm(topics, opts).byTerm[t] || []
}

/** Total teaching weeks a list of division items needs. */
export function weeksNeeded(items) {
  return (Array.isArray(items) ? items : []).reduce(
    (n, it) => n + (Number(it && it.weeks) || 1), 0,
  )
}

/**
 * Validate a single term's edited topic selection against its teaching-week
 * budget and the calendar reservations. Returns an ordered advisory list the
 * preview surfaces to the teacher (never throws).
 *
 * @param {{items:Item[], deliveryWeeks:number, hasRevision?:boolean,
 *          hasExam?:boolean, removedCount?:number}} args
 * @returns {Array<{code:string, level:'error'|'warning'|'info', message:string}>}
 */
export function validateTermSelection({
  items = [],
  deliveryWeeks = 0,
  hasRevision = false,
  hasExam = false,
} = {}) {
  const out = []
  const list = Array.isArray(items) ? items : []
  const needed = weeksNeeded(list)

  if (list.length === 0) {
    out.push({
      code: 'empty',
      level: 'error',
      message: 'No topics selected for this term — add at least one before generating.',
    })
    return out
  }

  // Duplicate topics within the term (a repeat that isn't deliberate revision).
  const seen = new Map()
  for (const it of list) {
    const key = String(it.topic || '').toLowerCase()
    if (!key) continue
    if (seen.has(key) && !it.isRevision) {
      out.push({
        code: 'duplicate',
        level: 'warning',
        message: `"${it.topic}" appears more than once — remove the repeat unless it is deliberate revision.`,
      })
    }
    seen.set(key, true)
  }

  if (deliveryWeeks > 0) {
    if (needed > deliveryWeeks) {
      out.push({
        code: 'overloaded',
        level: 'warning',
        message: `These topics need about ${needed} teaching weeks but only ${deliveryWeeks} are available — some topics will be combined or carried into the next term. Consider removing or shortening a topic.`,
      })
    } else if (needed < deliveryWeeks - 1) {
      out.push({
        code: 'underfilled',
        level: 'info',
        message: `These topics fill about ${needed} of ${deliveryWeeks} teaching weeks — you have room to add more, or the scheme will include extra revision.`,
      })
    }
  }

  // Overloaded single topics (too much content for the weeks it was given).
  for (const it of list) {
    const subs = Array.isArray(it.subtopics) ? it.subtopics.length : 0
    if (subs > (it.weeks || 1) * DEFAULT_SUBTOPICS_PER_WEEK + 2) {
      out.push({
        code: 'topic-heavy',
        level: 'info',
        message: `"${it.topic}" has ${subs} sub-topics — it will be spread across ${it.weeks} week${it.weeks === 1 ? '' : 's'}. Increase its weeks if that feels rushed.`,
      })
    }
  }

  if (!hasRevision) {
    out.push({
      code: 'no-revision',
      level: 'info',
      message: 'No revision week is marked — most terms reserve one before the exam.',
    })
  }
  if (!hasExam) {
    out.push({
      code: 'no-exam',
      level: 'info',
      message: 'No end-of-term test/exam week is marked — the last week is usually reserved for it.',
    })
  }

  return out
}

/**
 * Flag topics that appear in more than one term (a cross-term repeat the
 * "no restart" rule forbids). Used by the Plan-all-three-terms preview.
 * @returns {string[]} topic names that repeat across terms
 */
export function crossTermDuplicates(byTerm) {
  const counts = new Map()
  for (const t of TERMS) {
    for (const it of (byTerm && byTerm[t]) || []) {
      const key = String(it.topic || '').toLowerCase()
      if (!key) continue
      const rec = counts.get(key) || { name: it.topic, terms: new Set() }
      rec.terms.add(t)
      counts.set(key, rec)
    }
  }
  return Array.from(counts.values())
    .filter((r) => r.terms.size > 1)
    .map((r) => r.name)
}

/**
 * Project an edited term selection into the compact `topicSelection` payload
 * the Cloud Function reads — an ordered, sanitised topic backbone the prompt
 * paces across the term's teaching weeks. Keeps only the fields the server
 * trusts and drops anything the teacher removed.
 */
export function toTopicSelectionPayload(items) {
  return (Array.isArray(items) ? items : [])
    .filter((it) => topicName(it))
    .map((it) => ({
      topic: topicName(it),
      subtopics: (Array.isArray(it.subtopics) ? it.subtopics : [])
        .map(subtopicName).filter(Boolean).slice(0, 12),
      weeks: Math.max(1, Math.min(6, Number(it.weeks) || 1)),
      source: it.source === 'teacher' ? 'teacher' : 'syllabi_studio',
      isRevision: Boolean(it.isRevision),
    }))
}
