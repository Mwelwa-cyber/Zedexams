/**
 * Move a saved library document into a different folder.
 *
 * The decisions behind the "Move to folder" dialog, kept pure so the plain-node
 * suite can hold them: which dimensions a document can be moved along, what
 * each one may be set to, and what the resulting library coords are.
 *
 * THE STUDIO IS NOT ONE OF THE DIMENSIONS. `bucketIntoTree`
 * (src/utils/teacherLibraryService.js) derives the top-level folder from the
 * row's `tool` via librarySectionForGeneration, NOT from `library.libraryType`
 * — so a libraryType written here that disagreed with the tool would be
 * ignored, and the dialog would be offering a control that silently does
 * nothing. A lesson plan is re-filed WITHIN Lesson Plans.
 *
 * EVERY DIMENSION MAY BE CLEARED. Unsorted is a real destination: a teacher who
 * filed something into the wrong term needs to be able to say "I don't know"
 * as well as "it's Term 2", and a move that could only ever add detail would
 * make a wrong answer permanent.
 *
 * Pure — no React, no Firebase — so `moveTarget.test.js` imports it directly.
 */

import {
  SYLLABUS_OPTIONS,
  SYLLABUS_TYPES,
  TERMS,
  buildLibraryCoords,
  getActiveGradeForms,
  getAssessmentTypesForGradeForm,
  getSubjectsForGradeForm,
} from '../../../config/library.js'

/** The value every dimension takes when the teacher clears it. */
export const UNSORTED = ''

/**
 * The dimensions this document can be moved along, in folder order.
 * `hasTerm` / `hasAssessmentType` come from the section itself, so a Syllabi
 * document is never offered a term it has no folder level for.
 */
export function moveDimensions(section) {
  if (!section) return []
  return [
    'syllabus',
    'gradeForm',
    ...(section.hasTerm ? ['term'] : []),
    'subject',
    ...(section.hasAssessmentType ? ['assessmentType'] : []),
  ]
}

// The old spelling of OBC, folded on read exactly as bucketIntoTree folds it
// (see normalizeSyllabus in src/utils/teacherLibraryService.js). Without this a
// legacy document would open the dialog showing a curriculum no option offers,
// and re-saving it would write 'CDC' back out.
function normalizeSyllabus(value) {
  return value === 'CDC' ? SYLLABUS_TYPES.OBC : (value || UNSORTED)
}

/**
 * The dialog's starting state: where the document is filed right now.
 * A dimension the section does not have is omitted, never carried through as a
 * stale value — moving a Syllabi document must not preserve a term.
 */
export function buildMoveDraft(row, section) {
  const lib = (row && row.library) || {}
  const dims = moveDimensions(section)
  const draft = {}
  for (const dim of dims) {
    draft[dim] = dim === 'syllabus'
      ? normalizeSyllabus(lib.syllabus)
      : (lib[dim] || UNSORTED)
  }
  return draft
}

/**
 * The options for one dimension, given the rest of the draft.
 *
 * `current` — the value the document holds TODAY — is always offered even when
 * the registry does not list it. Two real cases depend on that: an early-
 * childhood document whose subject is a raw syllabus key rather than one of the
 * canonical subject names, and a document filed under a grade that has since
 * been retired. Dropping either from the list would turn "move this document"
 * into "move this document and silently lose where it was", and the teacher
 * would have no way to put it back.
 *
 * Returns `[{ value, label, isCurrent }]`, Unsorted last — it is a destination,
 * not a default, and should not sit at the top of the list.
 */
export function optionsFor(dimension, draft = {}, current = UNSORTED) {
  const raw = registryOptions(dimension, draft)
  const seen = new Set(raw.map((o) => o.value))
  const options = [...raw]

  if (current && current !== UNSORTED && !seen.has(current)) {
    options.push({ value: current, label: current, isCurrent: true })
  }

  return [
    ...options.map((o) => ({ ...o, isCurrent: o.value === current })),
    { value: UNSORTED, label: 'Unsorted', isCurrent: !current || current === UNSORTED },
  ]
}

function registryOptions(dimension, draft) {
  const syllabus = draft.syllabus || null
  const gradeForm = draft.gradeForm || null

  switch (dimension) {
    case 'syllabus':
      return SYLLABUS_OPTIONS.map((o) => ({ value: o.value, label: o.label }))
    case 'gradeForm':
      return getActiveGradeForms(syllabus).map((g) => ({ value: g.value, label: g.label }))
    case 'term':
      return TERMS.map((t) => ({ value: t.value, label: t.label }))
    case 'subject':
      return getSubjectsForGradeForm(syllabus, gradeForm).map((s) => ({ value: s, label: s }))
    case 'assessmentType':
      return getAssessmentTypesForGradeForm(syllabus, gradeForm)
        .map((t) => ({ value: t.value, label: t.label }))
    default:
      return []
  }
}

/**
 * Apply one change, then drop any selection the change invalidated.
 *
 * Subjects and assessment types are declared per (syllabus, grade), so
 * switching a document from Grade 4 to Nursery must not leave "Integrated
 * Science" selected underneath — that pair names no folder any teacher could
 * navigate to. A selection the new pair still declares is kept, so stepping
 * Grade 4 → Grade 5 does not cost the teacher their subject.
 *
 * The cascade checks the REGISTRY only — deliberately not `optionsFor`, which
 * also offers whatever the document holds today. That preservation exists so an
 * unrepresentable value (an early-childhood subject stored as a raw syllabus
 * key) stays selectable and is not lost by opening the dialog; it is not a
 * licence for that value to follow the document into a grade that does not
 * declare it. Changing the grade is the teacher saying this belongs somewhere
 * else, and a subject that outlived the move would rebuild the same
 * unnavigable folder one level down. Every other change — term, and the
 * dimension itself — cascades nothing, so a document filed under an
 * unrepresentable subject can still be re-termed without losing it.
 */
export function applyMoveChange(draft, section, dimension, value) {
  const next = { ...draft, [dimension]: value }
  if (dimension !== 'syllabus' && dimension !== 'gradeForm') return next

  for (const dim of ['subject', 'assessmentType']) {
    if (!(dim in next) || !next[dim]) continue
    if (!registryOptions(dim, next).some((o) => o.value === next[dim])) next[dim] = UNSORTED
  }
  return next
}

/**
 * The draft as library coords, ready to write.
 *
 * `libraryType` is the section's — see the note at the top of this file.
 * `buildLibraryCoords` rebuilds `path` from the parts, so the stored path can
 * never drift from the folder the document now sits in.
 */
export function coordsFromDraft(draft, section) {
  if (!section) return null
  const dims = moveDimensions(section)
  const pick = (dim) => (dims.includes(dim) && draft[dim] ? draft[dim] : null)
  return buildLibraryCoords({
    libraryType:    section.id,
    syllabus:       pick('syllabus'),
    gradeForm:      pick('gradeForm'),
    term:           pick('term'),
    subject:        pick('subject'),
    assessmentType: pick('assessmentType'),
  })
}

/** Has anything actually changed? Drives the Move button's disabled state. */
export function isMoved(draft, row, section) {
  const before = buildMoveDraft(row, section)
  return moveDimensions(section).some((dim) => (before[dim] || UNSORTED) !== (draft[dim] || UNSORTED))
}

/**
 * The destination as a readable path, for the dialog's confirmation line.
 * Unsorted levels are named rather than skipped — "Lesson Plans / CBC /
 * Nursery / Unsorted / English" tells a teacher something that
 * "Lesson Plans / CBC / Nursery / English" hides.
 */
export function describeDestination(draft, section) {
  if (!section) return ''
  return [section.folder, ...moveDimensions(section).map((dim) => draft[dim] || 'Unsorted')].join(' / ')
}
