/**
 * Studio descriptors for the Universal Draft Manager.
 *
 * A descriptor teaches the (studio-agnostic) draft core how to serialise,
 * restore and validate ONE studio's state. Most AI-generator studios share the
 * same `{ form, curr }` input shape, so `makeInputDescriptor` is a thin factory
 * that whitelists which state keys to persist and how to decide "is there work
 * worth recovering?". A studio with a bespoke shape can hand-write its own
 * descriptor object instead (see draftCore.js for the contract).
 */

/**
 * @param {object} opts
 *   studioId      unique id, also the localStorage/IDB namespace segment
 *   keys          state keys to persist + restore (e.g. ['form','curr'])
 *   isNonEmpty    (payload) => bool — is there real work here?
 *   schemaVersion bump when the persisted shape changes (default 1)
 */
export function makeInputDescriptor({ studioId, keys, isNonEmpty, schemaVersion = 1 }) {
  const pick = (obj) => {
    const out = {}
    for (const k of keys) if (obj && obj[k] !== undefined) out[k] = obj[k]
    return out
  }
  return {
    studioId,
    schemaVersion,
    serialize: pick,
    hydrate: pick,
    isNonEmpty,
  }
}

// A worksheet/notes/homework/etc. input form is worth recovering once the
// teacher has chosen a topic (or grade) or typed any extra instructions.
const inputHasWork = (p) =>
  Boolean(p?.curr?.topic || p?.curr?.grade || p?.form?.instructions?.trim())

export const worksheetInputDescriptor = makeInputDescriptor({
  studioId: 'worksheet',
  keys: ['form', 'curr'],
  isNonEmpty: inputHasWork,
})

export const notesInputDescriptor = makeInputDescriptor({
  studioId: 'notes',
  keys: ['form', 'curr', 'mode'],
  isNonEmpty: (p) => Boolean(p?.curr?.topic || p?.form?.instructions?.trim() || p?.form?.lessonPlanId),
})

export const homeworkInputDescriptor = makeInputDescriptor({
  studioId: 'homework',
  keys: ['form', 'curr'],
  isNonEmpty: inputHasWork,
})

export const rubricInputDescriptor = makeInputDescriptor({
  studioId: 'rubric',
  keys: ['form', 'curr'],
  // Rubric stops at subject (no topic) and its real content is the task
  // description — recover once the teacher has described a task or picked a class.
  isNonEmpty: (p) => Boolean(p?.form?.taskDescription?.trim() || p?.curr?.grade || p?.form?.instructions?.trim()),
})

export const schemeInputDescriptor = makeInputDescriptor({
  studioId: 'scheme_of_work',
  keys: ['form', 'curr'],
  isNonEmpty: inputHasWork,
})

export const flashcardsInputDescriptor = makeInputDescriptor({
  studioId: 'flashcards',
  keys: ['form', 'curr'],
  isNonEmpty: inputHasWork,
})

// SBA Task holds grade/subject inside a single `form` (no curriculum selector).
export const sbaTaskInputDescriptor = makeInputDescriptor({
  studioId: 'sba_task',
  keys: ['form'],
  isNonEmpty: (p) => Boolean(p?.form?.topic?.trim() || p?.form?.outcome?.trim() || p?.form?.instructions?.trim()),
})
