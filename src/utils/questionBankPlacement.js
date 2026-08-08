/**
 * Where a banked question is allowed to land in a paper.
 *
 * Pressing **Use** in the Question Bank never inserts silently. It asks where,
 * and the list of answers is computed from the paper's own structure — because
 * the two ways to get this wrong are both silent: dropping a multiple-choice
 * question into a structured section, or "fixing" the mismatch by converting
 * the question's type on the way in. Either produces a paper the teacher never
 * asked for and would only notice at the printer.
 *
 * ## A section's type is DERIVED, not configured
 *
 * A Part (`parts[]`) carries a title, marks settings and an answer-choice
 * count — it does not carry a question type. So the type of a section is the
 * type of the questions already in it:
 *
 *   - no questions yet      → `empty`  — accepts anything (that is what an
 *                                        empty section is FOR)
 *   - every question agrees → that type
 *   - questions disagree    → `mixed`  — accepts anything, because refusing a
 *                                        third type from a section that already
 *                                        holds two would be an invented rule
 *
 * Deriving rather than storing means a section that has only ever held MCQs
 * reads as an MCQ section without anybody having declared it one, and a teacher
 * who deliberately mixes types is never told their own paper is invalid.
 *
 * ## Numbering
 *
 * Insertion points are named by the number the inserted question WOULD take
 * ("as Q3"), and that number is position in the serialized question list —
 * exactly what `buildQuestionNumberMap` computes and what the renderers print.
 * Counting here rather than reading the existing number map is deliberate: the
 * map names questions that exist, and an insertion point is a gap between them.
 * Both count the same way (a pagebreak contributes no number; a passage
 * contributes one per follow-up), and `questionBankPlacement.test.js` pins that
 * the two agree.
 *
 * ## Grouping follows the paper, not the parts array
 *
 * Groups are CONSECUTIVE runs of `sections[]` sharing a `partId`, not one group
 * per Part. A paper whose sections interleave (possible after a reorder) then
 * offers each contiguous region as its own set of insertion points, which is
 * the truth about where a question can physically go. Grouping by Part instead
 * would offer a position that splits the run and renumbers half the paper.
 *
 * Pure + environment-neutral: no React, no DOM, no Firestore. Exercised by
 * `npm run test:question-bank-placement`.
 */

/** Section letters, matching assessmentPaperLayout's printed A/B/C. */
const SECTION_LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('')

/**
 * Legacy spellings of a type that the quiz path, the importer and older bank
 * rows all still carry. Folding them here means placement asks one question
 * ("are these the same kind of question?") instead of every caller knowing
 * which of its neighbours writes `fill` and which writes `fill_blanks`.
 */
const TYPE_ALIASES = {
  fill: 'fill_blanks',
  fill_blank: 'fill_blanks',
  fill_in_blank: 'fill_blanks',
  fill_in_blanks: 'fill_blanks',
  short: 'short_answer',
  shortanswer: 'short_answer',
  true_false: 'tf',
  truefalse: 'tf',
  'true/false': 'tf',
  boolean: 'tf',
  structured: 'diagram',
  written: 'diagram',
}

/** Human labels. `tf` is deliberately its own family — see `isTypeCompatible`. */
export const PLACEMENT_TYPE_LABELS = {
  mcq: 'Multiple choice',
  tf: 'True / False',
  short_answer: 'Short answer',
  diagram: 'Structured',
  essay: 'Essay',
  numeric: 'Numeric',
  matching: 'Matching',
  sequence: 'Sequence',
  fill_blanks: 'Fill in the blanks',
  mixed: 'Mixed types',
  empty: 'Empty',
}

/** Canonical form of a question type, tolerant of every spelling in the repo. */
export function normalizePlacementType(type) {
  const raw = String(type ?? '').toLowerCase().trim()
  if (!raw) return 'mcq'
  return TYPE_ALIASES[raw] || raw
}

/** Display label for a type, falling back to the raw value for an unknown one. */
export function placementTypeLabel(type) {
  const key = normalizePlacementType(type)
  return PLACEMENT_TYPE_LABELS[key] || key
}

/**
 * May a question of type `questionType` sit in a section of type `sectionType`?
 *
 * Strict equality after normalisation, with two openings: an `empty` section
 * accepts anything, and so does a `mixed` one. True/False is NOT folded into
 * multiple-choice even though both print options — a T/F question placed in an
 * MCQ section is the silent conversion this whole module exists to prevent.
 */
export function isTypeCompatible(sectionType, questionType) {
  const section = normalizePlacementType(sectionType)
  if (section === 'empty' || section === 'mixed') return true
  return section === normalizePlacementType(questionType)
}

/** How many printed question numbers a section consumes. */
export function sectionQuestionCount(section) {
  if (!section || typeof section !== 'object') return 0
  // A pagebreak occupies an order slot in serializeQuizSections but pushes no
  // question, and buildQuestionNumberMap numbers the question list — so it
  // contributes nothing to the number an inserted question would take.
  if (section.kind === 'pagebreak') return 0
  if (section.kind === 'passage') {
    const list = section.passage?.questions
    return Array.isArray(list) ? list.length : 0
  }
  return 1
}

/** Every question object a section holds, in printed order. */
function sectionQuestions(section) {
  if (!section || typeof section !== 'object') return []
  if (section.kind === 'pagebreak') return []
  if (section.kind === 'passage') {
    const list = section.passage?.questions
    return Array.isArray(list) ? list.filter(Boolean) : []
  }
  return section.question ? [section.question] : []
}

/** A section's Part membership, however the section stores it. */
function sectionPartId(section) {
  if (!section || typeof section !== 'object') return null
  if (section.kind === 'passage') return section.partId ?? section.passage?.partId ?? null
  if (section.kind === 'pagebreak') return section.partId ?? null
  return section.question?.partId ?? null
}

/**
 * The type of a set of questions: `empty` when there are none, the shared type
 * when they agree, `mixed` when they do not.
 */
export function deriveSectionType(questions = []) {
  const types = new Set()
  for (const question of questions) {
    if (!question) continue
    types.add(normalizePlacementType(question.type))
  }
  if (types.size === 0) return 'empty'
  if (types.size === 1) return [...types][0]
  return 'mixed'
}

/**
 * Is the paper still the single blank starter question a fresh studio seeds?
 * Mirrors `hasOnlyEmptyStarterSection` in quizSections.js, restated here so
 * this module stays free of the 1,400-line editor module. The consequence for
 * placement is that the one insertion point REPLACES the starter rather than
 * landing after it, which is what `option.replaceStarter` tells the caller.
 */
function isBlankStarterPaper(sections) {
  if (!Array.isArray(sections)) return false
  // A paper with no sections at all is blank in the only sense that matters
  // here: it has one position, it accepts anything, and the alternative —
  // falling through to "no compatible section" — would tell a teacher starting
  // a new paper that their empty paper cannot hold the question they picked.
  if (sections.length === 0) return true
  if (sections.length !== 1) return false
  const only = sections[0]
  if (!only || only.kind !== 'standalone') return false
  const question = only.question || {}
  const stem = typeof question.text === 'string' ? question.text.trim() : ''
  const hasStem = Boolean(stem) && stem !== '<p></p>'
  const hasOptions = Array.isArray(question.options)
    && question.options.some(option => String(option ?? '').trim() !== '')
  return !hasStem && !hasOptions
}

function groupLabelFor(part, partIndex) {
  if (!part) return 'Questions not in a section'
  const letter = SECTION_LETTERS[partIndex] ?? '?'
  const title = String(part.title ?? '').trim()
  return title ? `Section ${letter} — ${title}` : `Section ${letter}`
}

/**
 * Build the list of places a question of a given type may be inserted.
 *
 * @param {object} paper          `{ sections, parts }` straight from the studio.
 * @param {object} target         `{ type }` — the banked question's type.
 * @returns {object} `{ groups, hasCompatible, defaultOptionId, neededType,
 *                      neededTypeLabel, isBlankPaper }`
 *
 * Each group is `{ key, partId, label, sectionType, sectionTypeLabel,
 * compatible, reason, options[] }`, and each option is `{ id, anchorId, mode,
 * number, label, compatible, reason, isEnd, replaceStarter }`.
 *
 * INCOMPATIBLE POSITIONS ARE RETURNED, NOT FILTERED OUT. A picker that simply
 * omitted them would leave a teacher looking for Q8 and unable to see why it is
 * not offered; the reason travels with the option so the UI can disable it and
 * say what is wrong.
 */
export function buildPlacementPlan({ sections = [], parts = [] } = {}, { type } = {}) {
  const list = Array.isArray(sections) ? sections : []
  const partList = Array.isArray(parts) ? parts : []
  const neededType = normalizePlacementType(type)
  const neededTypeLabel = placementTypeLabel(neededType)

  if (isBlankStarterPaper(list)) {
    const option = {
      id: 'start',
      anchorId: list[0]?.id ?? null,
      partId: null,
      mode: 'before',
      number: 1,
      label: 'as Q1',
      compatible: true,
      reason: '',
      isEnd: true,
      replaceStarter: true,
    }
    return {
      groups: [{
        key: 'blank',
        partId: null,
        label: 'This paper is empty',
        sectionType: 'empty',
        sectionTypeLabel: PLACEMENT_TYPE_LABELS.empty,
        compatible: true,
        reason: '',
        options: [option],
      }],
      hasCompatible: true,
      defaultOptionId: 'start',
      neededType,
      neededTypeLabel,
      isBlankPaper: true,
    }
  }

  // Walk the paper once, splitting it into consecutive runs of one partId and
  // counting printed question numbers as we go.
  const runs = []
  let running = 0
  let current = null
  list.forEach((section, index) => {
    const partId = sectionPartId(section)
    if (!current || current.partId !== partId) {
      current = { partId, entries: [], startNumber: running + 1 }
      runs.push(current)
    }
    current.entries.push({ section, index, numberBefore: running + 1 })
    running += sectionQuestionCount(section)
    current.endNumber = running
  })

  const groups = runs.map((run, runIndex) => {
    const partIndex = run.partId ? partList.findIndex(part => part.id === run.partId) : -1
    const part = partIndex >= 0 ? partList[partIndex] : null
    const questions = run.entries.flatMap(entry => sectionQuestions(entry.section))
    const sectionType = deriveSectionType(questions)
    const compatible = isTypeCompatible(sectionType, neededType)
    const label = groupLabelFor(part, partIndex)
    const sectionTypeLabel = placementTypeLabel(sectionType)
    const reason = compatible
      ? ''
      : `${label} holds ${sectionTypeLabel.toLowerCase()} questions; this is a ${neededTypeLabel.toLowerCase()} question.`

    const options = run.entries.map((entry, entryIndex) => ({
      id: `${runIndex}:${entryIndex}`,
      anchorId: entry.section.id ?? null,
      // The inserted question joins the Part it lands inside, so it prints
      // under that section's heading and inherits its marks/answer-choice
      // settings. Carried on the option because the caller splices by anchor
      // and would otherwise have to re-derive membership from the anchor.
      partId: run.partId,
      mode: 'before',
      number: entry.numberBefore,
      label: `as Q${entry.numberBefore}`,
      compatible,
      reason: compatible
        ? ''
        : `Q${entry.numberBefore} is in ${label} — ${sectionTypeLabel}; this is a ${neededTypeLabel.toLowerCase()} question.`,
      isEnd: false,
      replaceStarter: false,
    }))

    const lastEntry = run.entries[run.entries.length - 1]
    const endNumber = (run.endNumber ?? run.startNumber - 1) + 1
    options.push({
      id: `${runIndex}:end`,
      anchorId: lastEntry?.section?.id ?? null,
      partId: run.partId,
      mode: 'after',
      number: endNumber,
      label: `as Q${endNumber} (end of section)`,
      compatible,
      reason: compatible
        ? ''
        : `${label} holds ${sectionTypeLabel.toLowerCase()} questions; this is a ${neededTypeLabel.toLowerCase()} question.`,
      isEnd: true,
      replaceStarter: false,
    })

    return {
      key: run.partId ? `part:${run.partId}:${runIndex}` : `ungrouped:${runIndex}`,
      partId: run.partId,
      label,
      sectionType,
      sectionTypeLabel,
      compatible,
      reason,
      options,
    }
  })

  // The default is the END of a matching section — an exact type match first,
  // and only then a section that would merely accept the question (empty or
  // mixed). Offering a mixed section by default would quietly steer every
  // insert into the one place the paper has no opinion about.
  const exact = groups.find(group => group.sectionType === neededType)
  const permissive = groups.find(group => group.compatible)
  const chosen = exact || permissive || null
  const defaultOption = chosen ? chosen.options.find(option => option.isEnd) : null

  return {
    groups,
    hasCompatible: groups.some(group => group.compatible),
    defaultOptionId: defaultOption?.id ?? null,
    neededType,
    neededTypeLabel,
    isBlankPaper: false,
  }
}

/**
 * Does this question carry more answer options than the paper prints?
 *
 * Returns `{ have, allowed }` when it does and `null` otherwise. Nothing here
 * trims anything: an A–E question going into an A–D paper is a decision for the
 * teacher, and the only outcome this module refuses to make possible is losing
 * option E without being told. Non-option question types never conflict.
 */
export function optionCountConflict(question, allowedChoices) {
  const type = normalizePlacementType(question?.type)
  if (type !== 'mcq' && type !== 'tf') return null
  const options = Array.isArray(question?.options)
    ? question.options.filter(option => String(option ?? '').trim() !== '')
    : []
  const allowed = Number(allowedChoices)
  if (!Number.isFinite(allowed) || allowed <= 0) return null
  if (options.length <= allowed) return null
  return { have: options.length, allowed }
}

/**
 * The paper's copy of a banked question.
 *
 * A DEEP clone, so nothing nested — options, diagram params, answer key,
 * marking guide — is shared with the bank row. Editing the paper's copy after
 * this must not be able to reach the canonical record, and a shallow spread
 * leaves exactly that path open through every array and object on the question.
 *
 * The provenance fields record where the copy came from. They enable a future
 * "update from bank" and imply nothing automatic now: nothing in the studio
 * reads them back, and no code path writes from a paper to the bank record.
 *
 * `sourceBankId` is kept alongside the newer `sourceQuestionId` because papers
 * saved before this carry it, and dropping it would strip the provenance those
 * papers already have.
 *
 * @param {object} question the parsed bank question
 * @param {object} row      the bank row it came from
 * @param {object} opts     `{ uid, now }` — `now` is injectable so the test can
 *                          assert the stamp instead of racing the clock.
 */
export function buildInsertedQuestion(question, row = {}, opts = {}) {
  if (!question || typeof question !== 'object') return null
  const clone = typeof structuredClone === 'function'
    ? structuredClone(question)
    : JSON.parse(JSON.stringify(question))

  const uid = opts.uid || null
  const ownerId = row?.ownerId || null
  clone.sourceQuestionId = row?.id || null
  // Which bank the copy came from, decided by ownership rather than by which
  // filter the teacher happened to be looking at: a Master-Bank row is one the
  // teacher does not own, whoever surfaced it.
  clone.sourceBank = row?.id
    ? (uid && ownerId && ownerId === uid ? 'mine' : 'master')
    : null
  clone.insertedAt = row?.id ? (opts.now || new Date().toISOString()) : null
  const version = Number(row?.version)
  clone.sourceVersion = Number.isFinite(version) ? version : null
  // Legacy field, still written so a paper's provenance reads the same whether
  // it was inserted before or after this flow existed.
  clone.sourceBankId = row?.id || null

  // A copy is a fresh question in this paper, not the bank's reviewed one: it
  // has never been saved here, no human has edited THIS copy yet, and it must
  // not arrive pre-locked (a locked question refuses the regeneration and
  // rewrite paths, which is not something an insert should decide).
  clone._id = null
  clone.locked = false
  clone.teacherEdited = false

  // In-paper identity is minted by the insert, never carried in from a stored
  // row. `createStandaloneSection` spreads these overrides LAST, so a stale
  // localId on a legacy row would win — and two questions sharing a localId
  // collapse to one entry in the number map, which renumbers the paper wrongly
  // and mis-addresses every validation message keyed on it.
  delete clone.localId
  delete clone.partId
  delete clone.passageId
  delete clone.order
  return clone
}
