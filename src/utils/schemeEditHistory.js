/**
 * schemeEditHistory — record when a teacher edits a saved generation.
 *
 * Firestore rules (firestore.rules) let a generation's owner update only
 * `output | teacherEdited | visibility | exportedFormats | library` — a
 * top-level `updatedAt`/`editHistory` field would be rejected. So the edit
 * trail lives INSIDE `output.meta`, which rides along the allowed `output`
 * write via updateGenerationOutput(). We use a client ISO timestamp because a
 * Firestore serverTimestamp() sentinel can't be nested inside `output`.
 *
 * Shape written under output.meta:
 *   { lastEditedAt: ISOString, editCount: number,
 *     editHistory: [{ at: ISOString, summary: string }] }  // capped, newest last
 *
 * Pure + injectable clock so `node` can test it.
 */

const HISTORY_CAP = 20

/** Append an edit to output.meta, returning a NEW output (input untouched). */
export function stampEditHistory(output, summary = 'edited', { now } = {}) {
  if (!output || typeof output !== 'object') return output
  const at = now || new Date().toISOString()
  const prevMeta = output.meta && typeof output.meta === 'object' ? output.meta : {}
  const prevHistory = Array.isArray(prevMeta.editHistory) ? prevMeta.editHistory : []
  const editHistory = [...prevHistory, { at, summary: String(summary || 'edited') }].slice(-HISTORY_CAP)
  return {
    ...output,
    meta: {
      ...prevMeta,
      lastEditedAt: at,
      editCount: Number(prevMeta.editCount || 0) + 1,
      editHistory,
    },
  }
}

/** The ISO timestamp of the last edit, or null when never edited. */
export function lastEditedAt(output) {
  const at = output?.meta?.lastEditedAt
  return typeof at === 'string' && at ? at : null
}

/** The edit trail (newest last), or [] when never edited. */
export function editHistoryOf(output) {
  return Array.isArray(output?.meta?.editHistory) ? output.meta.editHistory : []
}

/** How many times a teacher has edited this output. */
export function editCountOf(output) {
  return Number(output?.meta?.editCount || 0)
}
