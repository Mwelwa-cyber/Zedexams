/**
 * Name & avatar — the decisions, with no React and no Firestore around them.
 *
 * The screen is small; what is easy to get wrong is when it may save and what
 * it saves, and both are the kind of thing that only misbehaves against a
 * particular sequence of edits. So they live here and are tested as arithmetic.
 *
 * ── "Dirty" is a comparison against what is STORED ─────────────────────────
 *
 * Not a flag set by an onChange handler. A child who types a letter and deletes
 * it again has changed nothing, and a Save button that lights up for that is
 * offering to write a document that is already correct — which on a slow
 * connection means a spinner, a toast, and a write, for nothing. Typing into a
 * field and restoring it therefore returns the form to clean.
 *
 * Whitespace is normalised before the comparison AND before the write, so
 * "Lydia " and "Lydia" are the same value rather than two. That matters more
 * than it looks: a trailing space is invisible on screen, so without it the bar
 * stays lit with no visible reason and the child cannot make it go away.
 *
 * ── The preferred name is the public one ───────────────────────────────────
 *
 * `preferredName` is what Zed says and what the leaderboard prints;
 * `displayName` is the full name, seen by a guardian and a teacher. The preview
 * therefore shows the preferred name, falling back to the FIRST WORD of the
 * full name — never the whole thing, because a leaderboard row showing
 * "Lydia Banda" beside nine first names is the one row that leaks a surname.
 */

/** Collapse runs of whitespace and trim. */
export function normaliseName(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim()
}

/** The first word of a name — what a public surface may show. */
export function firstWordOf(value) {
  return normaliseName(value).split(' ')[0] || ''
}

/**
 * What the leaderboard row and Zed call this learner: the preferred name if
 * they set one, otherwise their first name, otherwise a neutral placeholder so
 * the preview is never an empty row.
 *
 * @param {{preferredName?: string, displayName?: string}} form
 * @return {string}
 */
export function previewName(form) {
  return normaliseName(form?.preferredName)
    || firstWordOf(form?.displayName)
    || 'You'
}

/**
 * The editable fields, read off a stored profile. One place, so the form's
 * baseline and its diff can never be built from different sets of keys — which
 * is how a field ends up permanently dirty (in the diff, absent from the
 * baseline) or permanently unsaveable (the reverse).
 *
 * @param {object|null|undefined} profile
 * @return {{preferredName: string, displayName: string, avatarCharacter: string, avatarPhotoUrl: string}}
 */
export function formFromProfile(profile) {
  return {
    preferredName: normaliseName(profile?.preferredName),
    displayName: normaliseName(profile?.displayName),
    avatarCharacter: String(profile?.avatarCharacter || ''),
    avatarPhotoUrl: String(profile?.avatarPhotoUrl || ''),
  }
}

const FIELDS = ['preferredName', 'displayName', 'avatarCharacter', 'avatarPhotoUrl']

/**
 * The fields that differ from the baseline, normalised. Empty object = clean.
 *
 * Names are compared normalised; the avatar fields are compared raw, since a
 * data URL is not a name and trimming one would corrupt it.
 *
 * @param {object} baseline  from formFromProfile
 * @param {object} form      the live form
 * @return {object} a patch — only what changed
 */
export function dirtyPatch(baseline, form) {
  const patch = {}
  for (const key of FIELDS) {
    const isName = key === 'preferredName' || key === 'displayName'
    const before = isName ? normaliseName(baseline?.[key]) : String(baseline?.[key] || '')
    const after = isName ? normaliseName(form?.[key]) : String(form?.[key] || '')
    if (before !== after) patch[key] = after
  }
  return patch
}

/** True when anything on the form differs from what is stored. */
export function isDirty(baseline, form) {
  return Object.keys(dirtyPatch(baseline, form)).length > 0
}

/**
 * Whether Save may run, and why not when it may not.
 *
 * A full name is required because it is what a guardian and a teacher identify
 * the child by; a preferred name is not, because "call me nothing in
 * particular" is a real answer and the first name covers it.
 *
 * @param {object} baseline
 * @param {object} form
 * @param {{saving?: boolean}} [state]
 * @return {{ok: boolean, reason: string|null}}
 */
export function canSave(baseline, form, state = {}) {
  if (state.saving) return { ok: false, reason: 'saving' }
  if (!isDirty(baseline, form)) return { ok: false, reason: 'clean' }
  if (!normaliseName(form?.displayName)) {
    return { ok: false, reason: 'We need your full name so your guardian and teacher know it is you.' }
  }
  if (normaliseName(form?.displayName).length > 80) {
    return { ok: false, reason: 'That name is too long.' }
  }
  if (normaliseName(form?.preferredName).length > 24) {
    return { ok: false, reason: 'Pick something shorter for us to call you.' }
  }
  return { ok: true, reason: null }
}

/**
 * Choosing a character clears an uploaded photo, and vice versa — the profile
 * holds both fields but a face is one picture, and leaving the other set means
 * two surfaces can disagree about which one is showing.
 *
 * @param {'character'|'photo'|'none'} kind
 * @param {string} [value]
 * @return {{avatarCharacter: string, avatarPhotoUrl: string}}
 */
export function avatarSelection(kind, value = '') {
  if (kind === 'character') return { avatarCharacter: String(value || ''), avatarPhotoUrl: '' }
  if (kind === 'photo') return { avatarCharacter: '', avatarPhotoUrl: String(value || '') }
  return { avatarCharacter: '', avatarPhotoUrl: '' }
}
