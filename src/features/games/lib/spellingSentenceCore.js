/**
 * The Word Choice sentence record — its shape, and the checks that stop a
 * broken one reaching a child.
 *
 * A sentence is a smaller thing than a spelling word and it deliberately
 * reuses the word model's machinery rather than restating it: the gap token,
 * the leak check, the American-form list and the four statuses all come from
 * `spellingContentCore`. Two collections holding reviewed English content
 * must not disagree about what "approved" means or about which spellings ECZ
 * marks.
 *
 * WHAT IS ITS OWN, because a word record has no equivalent:
 *
 *   EXACTLY TWO DISTRACTORS. The road has three lanes and every row fills all
 *   three, so an item with one distractor cannot be rendered and an item with
 *   three would silently drop one. It is the shape of the game, not a style
 *   rule, which is why it is refused rather than trimmed.
 *
 *   A DISTRACTOR IS NEVER THE ANSWER. Case-insensitively — `Their` under
 *   `their` would put two correct lanes on the road and mark one of them
 *   wrong, and the learner would be right and told they were not.
 *
 *   THE ANSWER CARRIES BRITISH FORMS; THE DISTRACTORS ARE EXEMPT. A
 *   distractor's whole job is to be the wrong spelling a Grade 7 writes, so
 *   running the American-form check over it would refuse the good ones.
 *
 * Pure. No React, no DOM, no Firebase.
 */

import {
  GAP,
  LEARNER_STATUS,
  STATUSES,
  americanisms,
  gapCount,
  sentenceLeaksWord,
} from './spellingContentCore.js'

export { GAP, LEARNER_STATUS, STATUSES }

/** Three lanes, one right: an item carries exactly this many distractors. */
export const DISTRACTOR_COUNT = 2

/** A stable document id from the item's own id, or from its answer. */
export function sentenceDocId({ id, answer }) {
  const slug = String(id || answer || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
  return slug || 'sentence'
}

/**
 * An item with every field defaulted, whatever it arrived as — a row of the
 * bundled bank, an admin form, or a Firestore document.
 */
export function normaliseSentence(raw = {}) {
  const distractors = Array.isArray(raw.distractors)
    ? raw.distractors.map((d) => String(d ?? '').trim()).filter(Boolean)
    : []
  return {
    id: String(raw.id ?? '').trim(),
    text: String(raw.text ?? '').trim(),
    answer: String(raw.answer ?? '').trim(),
    distractors,
    note: String(raw.note ?? '').trim(),
    grade: raw.grade == null || raw.grade === '' ? null : Number(raw.grade),
    status: STATUSES.includes(raw.status) ? raw.status : 'draft',
    approved: raw.approved === true,
    active: raw.active !== false,
  }
}

/**
 * Everything wrong with an item, as sentences an admin can act on. An empty
 * list is the only thing that may be saved.
 */
export function validateSentence(raw = {}) {
  const item = normaliseSentence(raw)
  const problems = []

  if (!item.text) problems.push('The sentence is empty.')
  if (!item.answer) problems.push('The answer is empty.')

  const gaps = gapCount(item.text)
  if (item.text && gaps !== 1) {
    problems.push(gaps === 0
      ? `The sentence needs one gap, written ${GAP}.`
      : `The sentence has ${gaps} gaps — it needs exactly one.`)
  }

  if (item.text && item.answer && sentenceLeaksWord(item.answer, item.text)) {
    problems.push(`The sentence already contains "${item.answer}", so it gives the answer away.`)
  }

  if (item.distractors.length !== DISTRACTOR_COUNT) {
    problems.push(`Word Choice needs exactly ${DISTRACTOR_COUNT} wrong options — this has ${item.distractors.length}.`)
  }

  const seen = new Set([item.answer.toLowerCase()])
  for (const distractor of item.distractors) {
    const key = distractor.toLowerCase()
    if (seen.has(key)) {
      problems.push(`"${distractor}" is already on the road — every lane must be different.`)
    }
    seen.add(key)
  }

  // The ANSWER only. See the docblock: a distractor is supposed to be wrong.
  const us = americanisms(item.answer)
  if (us.length) {
    problems.push(`"${us[0][0]}" is the American form — ECZ marks "${us[0][1]}".`)
  }

  return problems
}

/**
 * May this item be shown to a learner?
 *
 * FAILS CLOSED, exactly as `servableToLearner` does for words: `approved` and
 * `status` are two fields, and a record carrying one without the other is not
 * shown. A record that passes the flags but fails a machine check is refused
 * too — an approval is only as good as the checks it sits on top of.
 */
export function servableSentence(raw = {}) {
  const item = normaliseSentence(raw)
  if (!item.active) return false
  if (item.status !== LEARNER_STATUS) return false
  if (!item.approved) return false
  return validateSentence(item).length === 0
}

/**
 * The three lanes for an item, in a stable order for a given salt.
 *
 * The shuffle is SEEDED by the caller rather than reaching for `Math.random`,
 * so a test can assert which lane holds the answer, and so the same row drawn
 * twice in one ride cannot come out identically by accident.
 */
export function laneOptions(item, rng = Math.random) {
  const normalised = normaliseSentence(item)
  const options = [normalised.answer, ...normalised.distractors]
  for (let i = options.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1))
    const swap = options[i]
    options[i] = options[j]
    options[j] = swap
  }
  return options
}
