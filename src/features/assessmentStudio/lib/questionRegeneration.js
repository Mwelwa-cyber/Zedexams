/**
 * questionRegeneration — rewrite ONE question without touching the paper.
 *
 * §3.6: "Regenerating one question must never rebuild the paper. Locked
 * questions and teacher edits must survive any regeneration. Regeneration of a
 * single item must respect that item's blueprint slot, so the paper stays
 * balanced."
 *
 * The acceptance criterion is unusually precise — "regenerating question 4 leaves
 * questions 1–3 and 5+ byte-identical" — and that is a statement about object
 * identity, not about a diff looking small. So `replaceQuestionInSections` returns
 * a new array in which every section and every question the teacher did not ask
 * to change is the SAME OBJECT it was before. Nothing is re-serialised, nothing is
 * re-defaulted, nothing is normalised on the way past. If a field is dropped or a
 * number re-derived for an untouched question, that is a bug this module's tests
 * catch.
 *
 * Three separate protections, because they fail differently:
 *
 *   1. A LOCKED question is not regenerated at all. The teacher has said this one
 *      is finished.
 *   2. An EDITED question warns before it is overwritten — the studio asks first
 *      rather than silently discarding work.
 *   3. Whatever survives regeneration is merged FIELD BY FIELD
 *      (`mergeRegeneratedQuestion`), so the identity a question carries in the
 *      studio — its local id, its Firestore id, which Part it belongs to, an
 *      image the teacher uploaded themselves — is never replaced by a model's
 *      idea of it.
 *
 * Pure: no React, no Firebase. Tested under plain `node`.
 */

import { getQuestionKey } from '../../../utils/quizSections.js'

/** Every question in a section, whether it is standalone or under a passage. */
function sectionQuestions(section) {
  if (!section || typeof section !== 'object') return []
  if (section.question) return [section.question]
  if (section.passage && Array.isArray(section.passage.questions)) {
    return section.passage.questions
  }
  return []
}

/** Every question across every section, in paper order. */
export function flattenQuestions(sections = []) {
  return (Array.isArray(sections) ? sections : []).flatMap(sectionQuestions)
}

/**
 * The blueprint slot a question occupies, by its 1-based position in the paper.
 *
 * Regeneration is bound by the slot, not by whatever the question happens to look
 * like now: a teacher who dragged a 5-mark analysis question into position 2
 * should get a replacement for the slot the plan put there, so the paper's balance
 * survives the rewrite. Returns null when the paper has no plan or the position is
 * outside it — the caller then regenerates unconstrained rather than refusing.
 */
export function slotForQuestionNumber(blueprint, number) {
  if (!blueprint || !Array.isArray(blueprint.sections)) return null
  const items = blueprint.sections
    .flatMap((s) => (Array.isArray(s.items) ? s.items : []))
  const n = Number(number)
  if (!Number.isInteger(n) || n < 1 || n > items.length) return null
  return items[n - 1] || null
}

/**
 * May this question be regenerated, and does the teacher need to be asked first?
 *
 * @returns {{allowed: boolean, reason: string, message: string, confirm: boolean}}
 */
export function canRegenerateQuestion(question) {
  if (!question || typeof question !== 'object') {
    return {
      allowed: false, reason: 'missing', confirm: false,
      message: 'That question is no longer on the paper.',
    }
  }
  if (question.locked) {
    return {
      allowed: false, reason: 'locked', confirm: false,
      message: 'This question is locked. Unlock it first if you want it rewritten.',
    }
  }
  if (question.teacherEdited) {
    return {
      allowed: true, reason: 'edited', confirm: true,
      message: 'You have edited this question. Rewriting it will replace your changes.',
    }
  }
  return { allowed: true, reason: 'ok', confirm: false, message: '' }
}

/**
 * The fields a regeneration is allowed to write. Everything else on the question
 * — its identity in the studio and in Firestore, its place in the paper, the
 * teacher's own attachments — is carried across untouched.
 *
 * `marks` is included because the slot's marks are the point: the plan says this
 * position is worth N, and a rewrite that changed it would break the header
 * total. The caller passes the SLOT's marks, not the model's.
 */
const REGENERABLE_FIELDS = [
  'text', 'options', 'correctAnswer', 'explanation', 'marks', 'type',
  'detectedType', 'subtype', 'topic', 'subtopic', 'competency',
  'specificOutcome', 'diagramText', 'sharedInstruction', 'numericTolerance',
  'numericUnit', 'matchingPairs', 'sequenceItems', 'subParts',
]

/**
 * Fields the studio derives or the teacher owns. Listed explicitly rather than
 * implied by REGENERABLE_FIELDS so that adding a new field to the question shape
 * does not silently make it overwritable.
 */
const PRESERVED_FIELDS = [
  'localId', '_id', 'id', 'order', 'partId', 'passageId', 'locked',
  'imageAssetId', 'sourcePage', 'sourceQuestionNumber', 'sourceBankId',
]

/**
 * Merge a regenerated question over an existing one.
 *
 * @param {object} existing the question currently on the paper
 * @param {object} incoming the model's replacement
 * @param {object} [options]
 * @param {object} [options.slot] the blueprint slot this position must satisfy;
 *   its marks and tags win over the model's, so the paper stays balanced
 * @param {boolean} [options.keepImage] true (default) keeps an image the teacher
 *   attached when the replacement brings none of its own — a rewritten stem about
 *   the same diagram should not lose the diagram
 * @returns {object} a NEW question object
 */
export function mergeRegeneratedQuestion(existing = {}, incoming = {}, options = {}) {
  const { slot = null, keepImage = true } = options
  const next = { ...existing }

  for (const field of REGENERABLE_FIELDS) {
    if (incoming[field] === undefined) continue
    next[field] = incoming[field]
  }

  // The slot is the authority on what this position is worth and what it
  // assesses — that is what keeps the paper balanced across a rewrite.
  if (slot) {
    if (Number.isInteger(Number(slot.marks)) && Number(slot.marks) > 0) {
      next.marks = Number(slot.marks)
    }
    if (slot.topic) next.topic = slot.topic
    if (slot.subtopic) next.subtopic = slot.subtopic
    if (slot.learningOutcome) next.specificOutcome = slot.learningOutcome
  }

  // Images: a replacement that brings its own figure wins; otherwise the
  // teacher's stays. An uploaded image is never silently dropped.
  const incomingHasImage = Boolean(incoming.imageUrl || incoming.imageDiagram)
  if (incomingHasImage) {
    next.imageUrl = incoming.imageUrl || ''
    next.imageAlt = incoming.imageAlt || ''
    next.imageDiagram = incoming.imageDiagram || null
  } else if (!keepImage) {
    next.imageUrl = ''
    next.imageAlt = ''
    next.imageDiagram = null
  }

  // Identity and placement are never the model's to decide.
  for (const field of PRESERVED_FIELDS) {
    if (field in existing) next[field] = existing[field]
  }

  // A rewritten question is a fresh AI question again: the teacher has not edited
  // THIS text, and any review flags belonged to the text that was replaced.
  next.teacherEdited = false
  next.requiresReview = Boolean(incoming.requiresReview)
  next.reviewNotes = Array.isArray(incoming.reviewNotes) ? incoming.reviewNotes : []
  next.regeneratedAt = options.at || existing.regeneratedAt || null
  next.regenerationCount = (Number(existing.regenerationCount) || 0) + 1
  return next
}

/**
 * Replace exactly one question inside the studio's section tree.
 *
 * The guarantee: every section and every question other than the target comes
 * back as the same object reference it went in as. That is what makes
 * "questions 1–3 and 5+ are byte-identical" true rather than merely likely.
 *
 * @param {object[]} sections the studio's sections
 * @param {string} questionKey the target's stable key (getQuestionKey)
 * @param {function} rewrite (existingQuestion) => newQuestion
 * @returns {{sections: object[], replaced: boolean}}
 */
export function replaceQuestionInSections(sections, questionKey, rewrite) {
  const list = Array.isArray(sections) ? sections : []
  if (!questionKey || typeof rewrite !== 'function') {
    return { sections: list, replaced: false }
  }
  let replaced = false
  const next = list.map((section) => {
    if (replaced || !section || typeof section !== 'object') return section

    if (section.question) {
      if (getQuestionKey(section.question) !== questionKey) return section
      replaced = true
      return { ...section, question: rewrite(section.question) }
    }

    const questions = section.passage && Array.isArray(section.passage.questions)
      ? section.passage.questions : null
    if (!questions) return section
    const index = questions.findIndex((q) => getQuestionKey(q) === questionKey)
    if (index === -1) return section
    replaced = true
    const nextQuestions = questions.slice()
    nextQuestions[index] = rewrite(questions[index])
    return { ...section, passage: { ...section.passage, questions: nextQuestions } }
  })
  // Nothing matched: hand back the ORIGINAL array, not a shallow copy of it, so a
  // failed lookup cannot make the studio think the paper changed.
  return replaced ? { sections: next, replaced } : { sections: list, replaced: false }
}

/**
 * The fields a HUMAN types. Editing one of these marks the question as the
 * teacher's work, which is what makes a later rewrite ask before replacing it.
 *
 * Deliberately not "every field": an image finishing its upload, a review flag
 * clearing, a Part reassignment or a renumber are all the studio's own doing, and
 * treating them as teacher edits would put a confirmation dialog in front of
 * every rewrite whether the teacher had touched the question or not — which
 * trains people to click through it.
 */
export const AUTHORED_FIELDS = new Set([
  'text', 'options', 'correctAnswer', 'explanation', 'marks', 'topic',
  'subtopic', 'sharedInstruction', 'diagramText', 'competency',
  'specificOutcome', 'numericTolerance', 'numericUnit', 'matchingPairs',
  'matchingAnswer', 'sequenceItems', 'sequenceAnswer', 'subParts',
  'statements', 'wordBank', 'type',
])

/** Did a human just change something they would not want overwritten? */
export function isAuthoredEdit(field) {
  return AUTHORED_FIELDS.has(String(field))
}

/**
 * A question's stem as plain text — markup stripped, whitespace collapsed,
 * truncated. Used for anything that has to be READ rather than rendered: the
 * "avoid these" list, and telling the model what it is replacing.
 */
export function plainStem(value, max = 1200) {
  return String(value == null ? '' : value)
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max)
}

/**
 * The other questions on the paper, as short stems, so a regeneration can be told
 * what NOT to write again. Capped — this goes into a prompt, and the point is to
 * avoid a near-duplicate, not to resend the whole paper.
 */
export function avoidList(sections, questionKey, { limit = 20, stemLength = 160 } = {}) {
  const out = []
  for (const question of flattenQuestions(sections)) {
    if (getQuestionKey(question) === questionKey) continue
    const text = plainStem(question.text, stemLength)
    if (!text) continue
    out.push(text)
    if (out.length >= limit) break
  }
  return out
}

/**
 * Toggle the lock on one question, with the same identity guarantee as a rewrite:
 * every other question object is untouched.
 */
export function setQuestionLock(sections, questionKey, locked) {
  return replaceQuestionInSections(sections, questionKey,
    (question) => ({ ...question, locked: Boolean(locked) }))
}
