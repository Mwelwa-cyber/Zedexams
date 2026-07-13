/**
 * Recent Documents — central capability resolver (risk review, item 3).
 *
 * One place decides which actions the dashboard's document menu offers, so
 * the menu never shows an action that would fail after selection. Each
 * capability states WHY it is or isn't available today:
 *
 *  - open       — always: every row routes to its document view.
 *  - rename     — test/exam papers only: `title` is a first-class Firestore
 *                 field there. Generation titles are DERIVED from content
 *                 (titleForGeneration), so a dashboard rename would silently
 *                 not stick for most tools.
 *  - duplicate  — client-created tools only (the caller passes the Library's
 *                 CLIENT_CREATED_TOOLS list; AI-generated docs are created
 *                 server-side and cannot be client-copied).
 *  - download   — never on the dashboard: PDF/DOCX exporters are per-type
 *                 modules living inside each document view. The honest path
 *                 is Open → export there. (Lazy per-type download = backlog.)
 *  - trash      — never yet: no soft-delete lifecycle (trashedAt/restore/
 *                 retention/rules) exists. Until it does, the dashboard
 *                 offers NO destructive action — permanent delete stays in
 *                 the Library and is not a trash substitute.
 *
 * Pure and dependency-free so it runs under plain `node` in
 * documentActions.test.js — the tool list is injected rather than imported
 * from teacherLibraryService (which pulls in the Firebase SDK).
 *
 * @param {{ kind: 'generation'|'assessment', tool: string }} doc
 * @param {{ clientCreatedTools?: string[] }} deps
 */
export function getDocumentActions(doc = {}, { clientCreatedTools = [] } = {}) {
  const kind = doc.kind || ''
  const tool = doc.tool || ''
  return {
    canOpen: true,
    canRename: kind === 'assessment',
    canDuplicate: kind === 'generation' && clientCreatedTools.includes(tool),
    canDownload: false,
    canTrash: false,
  }
}

/**
 * Validate a rename before it is submitted. Returns null when valid, or a
 * user-presentable problem string.
 */
export function validateDocumentTitle(title) {
  const t = String(title ?? '').trim()
  if (!t) return 'Enter a name before saving.'
  if (t.length > 140) return 'Names are limited to 140 characters.'
  return null
}
