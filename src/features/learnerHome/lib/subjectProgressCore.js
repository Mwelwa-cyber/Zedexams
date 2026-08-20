/**
 * subjectProgressCore — the ONE answer to "how far through this subject is
 * this learner, this term".
 *
 * WHY THIS FILE EXISTS. There were two answers and neither was measuring what
 * the screen said it was.
 *
 *   Home  (`useLearnerDashboard`) folded three ratios together — notes read /
 *         notes published, distinct `topicScores` KEYS / catalogue topics, and
 *         a daily-exam term that was never passed in — and printed the result
 *         beside a topic count taken from a DIFFERENT list. A Grade 7 row read
 *         "Term 1 · 3 topics" while the percentage divided by the five
 *         all-year catalogue topics. The label and the measurement were not
 *         about the same thing.
 *
 *   The subject screen used a third formula (mean per-topic quiz completion,
 *         half-weighted against term notes read) and computed it into a
 *         variable nothing rendered.
 *
 * Three faults produced the reported numbers, and each is worth naming because
 * each is a way a progress bar can lie quietly:
 *
 *   1. `topicScores` keys are FREE TEXT. They come from `question.topic`,
 *      falling back to the literal string 'General' (`utils/quizScoring.js`).
 *      Nothing tied them to the grade's catalogue, so any distinct string
 *      counted as a topic covered.
 *   2. That count was then CLAMPED — `Math.min(keys.size, topics.length)` —
 *      which silently converts junk into completion. One quiz whose eight
 *      questions carried eight different topic strings read as 6/6 topics in a
 *      six-topic subject: **Home Economics, 100%, with nothing published in it
 *      and nothing opened.** That is the screenshot.
 *   3. ATTEMPTED was treated as COMPLETED. A topic scored 12% counted exactly
 *      as much as one scored 95%, and one quiz result mentioning a topic
 *      finished it forever.
 *
 * WHAT THIS MODULE MEASURES INSTEAD.
 *
 *   - **The denominator is the term's own topic rows** — the same list the
 *     subject screen renders and the same number the home row prints. If the
 *     row says "7 topics", the percentage is out of those seven.
 *   - **Evidence is attributed to a topic, never counted blind.** A quiz result
 *     reaches a topic through the quiz's own `topic`, or through a
 *     `topicScores` key that MATCHES a row by the repo's own title matcher
 *     (`gradeTermPlan.titlesMatch`). Each key is attributed to its single best
 *     row, so one key cannot credit three topics, and a key that matches
 *     nothing — 'General', a stray free-text label, a topic from another
 *     grade — credits nothing. There is no clamp: unmatched evidence is
 *     unmatched, not rounded up into a full mark.
 *   - **A topic is DONE when it was actually done**: its note read to the end,
 *     or a quiz on it passed at {@link TOPIC_PASS_MARK}% — the same 60% line
 *     `learnerHomeCore.extractWeakTopics` already uses to call a topic weak.
 *     Below that it is in progress, which is true and is not completion.
 *   - **A subject with nothing published is not measured at all.** No note, no
 *     quiz, nothing to do → `state: 'no-material'` and `percent: null`. A
 *     percentage over material that does not exist is not a small error; it is
 *     the whole of what the learner was shown.
 *
 * Pure: no DOM, no React, no Firebase. Both callers hand it the same inputs,
 * which is what stops the two screens disagreeing again.
 */
import { getTopics, getSubtopics } from '../../../config/curriculum.js'
import {
  getTermPlan, planTopicsForTerm, strandLabel, strandTone, unplacedCatalogueTopics,
  bestTitleMatch, titlesMatch,
} from '../../../config/gradeTermPlan.js'
import { deriveTermPlan } from '../../../config/termDivision.js'
import { deriveTopicTerms, topicsForTerm, normalizeTerm } from './learnerHomeCore.js'

/**
 * The score at which a quiz result finishes its topic.
 *
 * 60 because that is already the line this app draws between knowing a topic
 * and not: `extractWeakTopics` calls anything under 60% weak and offers it
 * back as practice. A topic cannot be both "needs practice" and "complete".
 */
export const TOPIC_PASS_MARK = 60

const clean = (value) => String(value ?? '').trim()
const lower = (value) => clean(value).toLowerCase()

/**
 * Labels that name no topic and must reach no row — on either path.
 *
 * 'General' is the literal string `computeQuizScore` files every question
 * carrying no topic under — it is the ABSENCE of a topic, written down. Left
 * in, it matches any row whose name contains the word (Grade 7 has none, but
 * "General Science" is one content edit away) and, more to the point, it is
 * the single largest bucket in the data: crediting it would hand a learner
 * every untagged question they have ever answered as topic coverage.
 * `QuizRunnerV2` records that whitespace-only topics also key as themselves on
 * the legacy path, so those are dropped here too.
 */
const NON_TOPIC_KEYS = new Set(['general', 'untagged', 'other', 'n/a', 'none'])

const isRealTopicKey = (key) => {
  const k = lower(key)
  return Boolean(k) && !NON_TOPIC_KEYS.has(k)
}

/**
 * The term's topic rows for one subject — the list the subject screen renders,
 * and the denominator every percentage here is measured against.
 *
 * Unchanged in behaviour from the derivation that lived inside
 * LearnerSubjectPage; lifted out so the home row and the subject screen count
 * the same topics. The three sources, in order:
 *
 *   1. the owner's published term plan (`config/gradeTermPlan`),
 *   2. the catalogue divided into three consecutive slices
 *      (`config/termDivision`) — pacing, labelled as suggested on screen,
 *   3. the term tags on the subject's quizzes.
 *
 * With an authored plan, catalogue content the plan does not place is appended
 * to EVERY term rather than dropped: it is real syllabus material.
 */
export function buildSubjectTermRows({ subjectId, grade, term, quizzes = [] } = {}) {
  const gradeNum = Number(grade)
  const termNum = normalizeTerm(term) || 1
  const catalogueTopics = getTopics(subjectId, gradeNum) || []
  const subtopicsOf = (topic) => getSubtopics(subjectId, gradeNum, topic) || []

  const authored = getTermPlan(subjectId, gradeNum)
  const plan = authored || deriveTermPlan(catalogueTopics, subtopicsOf)
  const planRows = plan ? planTopicsForTerm(plan, termNum) : []
  const unplaced = authored
    ? unplacedCatalogueTopics(authored, catalogueTopics.flatMap((t) => {
        const subs = subtopicsOf(t)
        return subs.length > 0 ? subs : [t]
      }))
    : []

  const rows = plan
    ? [
        ...planRows.map((r) => ({
          name: r.title,
          icon: r.icon || null,
          planned: true,
          note: r.note || null,
          strand: r.strand ? strandLabel(r.strand) : null,
          tone: r.tone || strandTone(r.strand),
          // A planned row already IS the sub-topic; listing its children under
          // it would repeat the syllabus at two levels on one line.
          subtopics: [],
        })),
        ...unplaced.map((name) => ({
          name, icon: null, strand: null, tone: null, planned: false, note: null,
          subtopics: subtopicsOf(name),
        })),
      ]
    : topicsForTerm(catalogueTopics, deriveTopicTerms(quizzes), termNum).map((name) => ({
        name, icon: null, strand: null, tone: null, planned: false, note: null,
        subtopics: subtopicsOf(name),
      }))

  return {
    rows,
    catalogueTopics,
    planSource: authored ? 'authored' : (plan ? 'derived' : null),
    hasPlan: Boolean(plan),
    unplacedCount: unplaced.length,
  }
}

/**
 * Send each item to the ONE row it best names, or to no row at all.
 *
 * Exact name first, then the repo's shared title matcher scored by
 * `bestTitleMatch` — the same ranking the note lookup uses, for the same
 * reason: a loose matcher that returns the FIRST overlap credits "Energy" to
 * both "Energy" and "Materials and Energy". One item, one row, or none.
 *
 * Rows are indexed rather than compared by name because a name is only unique
 * within its parent topic — Grade 7 Mathematics carries "Multiplication" under
 * both Fractions and Decimals.
 */
function attributeToRows(rows, items, getName) {
  const buckets = rows.map(() => [])
  if (!Array.isArray(items) || items.length === 0) return buckets
  const indexed = rows.map((row, index) => ({ row, index }))
  const exact = new Map()
  indexed.forEach(({ row, index }) => {
    const key = lower(row.name)
    if (key && !exact.has(key)) exact.set(key, index)
  })

  for (const item of items) {
    const raw = getName(item)
    const name = lower(raw)
    // Filtered HERE rather than at each call site, so a quiz whose own `topic`
    // field says "General" is refused on the same terms as a topicScores key
    // that does. Both are the absence of a topic written down.
    if (!name || !isRealTopicKey(name)) continue
    let index = exact.has(name) ? exact.get(name) : -1
    if (index < 0) {
      const candidates = indexed.filter(({ row }) => titlesMatch(row.name, raw))
      const hit = candidates.length > 0
        ? bestTitleMatch(candidates, raw, (c) => c.row.name)
        : null
      index = hit ? hit.index : -1
    }
    if (index >= 0) buckets[index].push(item)
  }
  return buckets
}

/**
 * The note a topic row opens.
 *
 * The plan names its own note, so that is looked up first and exactly — the
 * two Grade 7 Science "Fruits & Seeds" rows are different topics whose titles
 * share every meaningful word, and no similarity score can separate them.
 * Otherwise: an exact topic tag, then a title containing the row's name, then
 * the shared fuzzy match. The term's notes are searched first and the whole
 * subject second, because a note filed under another term is still this
 * topic's note.
 */
function findNoteForRow(row, termNotes, subjectNotes) {
  const name = clean(row?.name)
  if (!name) return null
  const needle = name.toLowerCase()
  const findIn = (pool) => {
    if (!Array.isArray(pool) || pool.length === 0) return null
    if (row.note) {
      const named = pool.find((n) => clean(n?.title) === row.note)
      if (named) return named
    }
    return pool.find((n) => lower(n?.topic) === needle)
      || pool.find((n) => lower(n?.title).includes(needle))
      || bestTitleMatch(pool, name, (n) => n?.topic || n?.title)
      || null
  }
  return findIn(termNotes) || findIn(subjectNotes) || null
}

/**
 * The learner's mark for a finished attempt, or null when there isn't one.
 *
 * `finalScore` is authoritative only once marking has settled; `coerceResult`
 * reports null while a text answer is still awaiting the AI grader. A
 * provisional attempt is therefore evidence the learner STARTED the topic and
 * no evidence at all about how they did — which is exactly how it is treated
 * below. Reading the partial percentage instead would let a throttled grader
 * finish a topic on a mark nobody awarded.
 */
function settledScore(result) {
  if (!result) return null
  if (result.scoreStatus === 'provisional' || result.gradingStatus === 'pending') return null
  const value = Number.isFinite(Number(result.finalScore))
    ? Number(result.finalScore)
    : Number(result.percentage)
  return Number.isFinite(value) ? Math.max(0, Math.min(100, value)) : null
}

/**
 * Every topic row for the term, each carrying the evidence behind its status.
 *
 * @param {object} args
 * @param {Array}  args.rows          from {@link buildSubjectTermRows}
 * @param {Array}  args.subjectNotes  published notes for the subject (all terms)
 * @param {Array}  args.termNotes     those of them filed under this term
 * @param {Array}  args.subjectQuizzes published quizzes for the subject
 * @param {Array}  args.results       the learner's results for this subject
 * @param {Array}  args.noteProgress  the learner's noteProgress docs
 */
export function buildSubjectTopics({
  rows = [], subjectNotes = [], termNotes = [], subjectQuizzes = [],
  results = [], noteProgress = [],
} = {}) {
  const readNoteIds = new Set()
  const openedNoteIds = new Set()
  for (const np of noteProgress) {
    if (!np?.noteId) continue
    openedNoteIds.add(np.noteId)
    if (np.status === 'completed') readNoteIds.add(np.noteId)
  }

  // Best settled mark per quiz, plus which quizzes were attempted at all —
  // an attempt still awaiting marking has no mark but is not nothing.
  const bestByQuizId = new Map()
  const attemptedQuizIds = new Set()
  // topicScores aggregated per free-text key, across every result for the
  // subject. Marks, not question counts: `computeQuizScore` weights by marks.
  const keyTotals = new Map()
  for (const r of results) {
    if (r?.quizId) {
      attemptedQuizIds.add(r.quizId)
      const score = settledScore(r)
      if (score != null) {
        const prev = bestByQuizId.get(r.quizId)
        if (prev == null || score > prev) bestByQuizId.set(r.quizId, score)
      }
    }
    const scores = r?.topicScores
    if (!scores || typeof scores !== 'object') continue
    for (const [key, value] of Object.entries(scores)) {
      const total = Number(value?.total)
      const correct = Number(value?.correct)
      if (!Number.isFinite(total) || total <= 0) continue
      const agg = keyTotals.get(key) || { correct: 0, total: 0 }
      agg.total += total
      agg.correct += Number.isFinite(correct) ? Math.max(0, correct) : 0
      keyTotals.set(key, agg)
    }
  }

  const quizBuckets = attributeToRows(rows, subjectQuizzes, (q) => q?.topic)
  const keyBuckets = attributeToRows(
    rows,
    [...keyTotals.entries()].map(([key, agg]) => ({ key, ...agg })),
    (entry) => entry.key,
  )

  return rows.map((row, i) => {
    const noteTarget = findNoteForRow(row, termNotes, subjectNotes)
    const noteRead = Boolean(noteTarget && readNoteIds.has(noteTarget.id))
    const noteOpened = Boolean(noteTarget && openedNoteIds.has(noteTarget.id))

    const topicQuizzes = quizBuckets[i]
    const quizScores = topicQuizzes
      .map((q) => bestByQuizId.get(q?.id))
      .filter((v) => v != null)
    const attemptedQuizCount = topicQuizzes.filter((q) => q?.id && attemptedQuizIds.has(q.id)).length

    const keyAgg = keyBuckets[i].reduce(
      (acc, entry) => ({ correct: acc.correct + entry.correct, total: acc.total + entry.total }),
      { correct: 0, total: 0 },
    )
    const keyScore = keyAgg.total > 0
      ? Math.round((keyAgg.correct / keyAgg.total) * 100)
      : null

    const scores = [...quizScores, ...(keyScore == null ? [] : [keyScore])]
    const bestScore = scores.length > 0 ? Math.max(...scores) : null
    const attempted = attemptedQuizCount > 0 || keyAgg.total > 0

    const completed = noteRead || (bestScore != null && bestScore >= TOPIC_PASS_MARK)
    const status = completed
      ? 'completed'
      : (noteOpened || attempted ? 'in-progress' : 'available')

    return {
      // Not the name: a sub-topic name is only unique within its parent, and
      // two siblings sharing a React key leave the previous term's rows
      // standing when the learner switches tab.
      key: `${i}:${row.strand || ''}:${row.name}`,
      name: row.name,
      icon: row.icon,
      strand: row.strand,
      tone: row.tone,
      planned: row.planned,
      position: i + 1,
      subtopics: Array.isArray(row.subtopics) ? row.subtopics : [],
      noteTarget,
      noteRead,
      noteOpened,
      quizCount: topicQuizzes.length,
      hasQuiz: topicQuizzes.length > 0,
      attemptedQuizCount,
      bestScore,
      status,
      // Is there anything to DO here? A row with neither a note nor a quiz
      // cannot be progressed through, so it must not be counted as material
      // the learner has failed to cover.
      //
      // Evidence counts as material, and that clause is load-bearing rather
      // than generous: a learner who has answered questions on a topic
      // demonstrably had something to answer. Without it, a quiz unpublished
      // since the attempt — or a truncated catalogue read — would erase a real
      // score and report the subject as "coming soon".
      hasMaterial: Boolean(noteTarget) || topicQuizzes.length > 0 || noteOpened || attempted,
    }
  })
}

/**
 * Fold the term's topics into the one verdict both screens print.
 *
 * `percent` is `done / total` over the term's rows — never over "rows we
 * happen to have published", which would report a subject finished the moment
 * its single note was read. When nothing at all is published for the term
 * there is no measurement to make and `percent` is **null**, not 0: "we have
 * not built this yet" and "you have not started it" are different facts and
 * the row says which one it is.
 */
export function summariseSubjectProgress(topics = [], { materialsKnown = true } = {}) {
  const list = Array.isArray(topics) ? topics : []
  const total = list.length
  const done = list.filter((t) => t.status === 'completed').length
  const inProgress = list.filter((t) => t.status === 'in-progress').length
  const withMaterial = list.filter((t) => t.hasMaterial).length
  const touched = done + inProgress

  let state
  if (total === 0) state = 'no-topics'
  // A read that FAILED is not a catalogue that is empty. Reporting "material
  // coming soon" because the notes query was denied, or came back short, is
  // the same class of mistake this whole module exists to remove — an absence
  // of evidence rendered as a finding. The row says nothing instead.
  else if (withMaterial === 0) state = materialsKnown ? 'no-material' : 'unknown'
  else if (touched === 0) state = 'not-started'
  else if (done >= total) state = 'complete'
  else state = 'in-progress'

  const measurable = state === 'not-started' || state === 'in-progress' || state === 'complete'

  return {
    total,
    done,
    inProgress,
    touched,
    withMaterial,
    state,
    measurable,
    started: touched > 0,
    percent: measurable ? Math.round((done / total) * 100) : null,
  }
}

/**
 * Rows + statuses + verdict in one call — what both screens actually use.
 *
 * The caller filters `results`, `subjectNotes` and `subjectQuizzes` to the
 * subject (each screen already knows how it stores a subject) and hands over
 * the same shapes. Everything downstream of that is this module's, so home and
 * the subject screen cannot arrive at different numbers.
 */
export function computeSubjectProgress({
  subjectId, grade, term,
  subjectNotes = [], termNotes = [], subjectQuizzes = [],
  results = [], noteProgress = [], materialsKnown = true,
} = {}) {
  const { rows, planSource, hasPlan, unplacedCount, catalogueTopics } =
    buildSubjectTermRows({ subjectId, grade, term, quizzes: subjectQuizzes })
  const topics = buildSubjectTopics({
    rows, subjectNotes, termNotes, subjectQuizzes, results, noteProgress,
  })
  return {
    topics,
    summary: summariseSubjectProgress(topics, { materialsKnown }),
    planSource,
    hasPlan,
    unplacedCount,
    catalogueTopics,
  }
}

/**
 * The one line the home row prints under a subject name.
 *
 * It states the term, the topic count the percentage is measured against, and
 * — only once there is something true to say — how far through it the learner
 * is. The states are separate strings rather than a percentage with a caveat,
 * because "0%" and "nothing published yet" render identically as an empty bar
 * and mean opposite things.
 */
export function subjectRowMeta({ term, summary } = {}) {
  const s = summary || {}
  const termLabel = term ? `Term ${term}` : null
  const topicWord = s.total === 1 ? 'topic' : 'topics'
  if (s.state === 'no-topics') return [termLabel, 'Topics coming soon'].filter(Boolean).join(' · ')
  // Nothing is claimed about a subject whose catalogue could not be read.
  if (s.state === 'unknown') return [termLabel, `${s.total} ${topicWord}`].filter(Boolean).join(' · ')
  if (s.state === 'no-material') {
    return [termLabel, `${s.total} ${topicWord}`, 'Material coming soon'].filter(Boolean).join(' · ')
  }
  if (s.state === 'not-started') {
    return [termLabel, `${s.total} ${topicWord}`, 'Not started'].filter(Boolean).join(' · ')
  }
  return [termLabel, `${s.done} of ${s.total} ${topicWord} done`].filter(Boolean).join(' · ')
}
