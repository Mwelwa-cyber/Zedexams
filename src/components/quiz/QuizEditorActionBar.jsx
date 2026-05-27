/**
 * QuizEditorActionBar — sticky bottom action strip for long quizzes.
 *
 * The legacy editor placed Save / Publish controls at the very bottom of
 * the page, which meant scrolling past 50+ questions on every publish.
 * This bar pins itself to the bottom of the viewport and surfaces:
 *   - Save status (saving / saved / unsaved / autosaved)
 *   - Validation summary (X issues remaining)
 *   - Save Draft, Preview, Publish buttons
 *
 * Styled to feel close to the existing buttons. Uses z-30 so the
 * floating-nav (z-40) sits ON TOP at the bottom-right corner — the
 * nav's round buttons partially overlap the bar's right edge, and if
 * the bar were on top those buttons would be unclickable.
 *
 * Props
 *   onSaveDraft     — () => void
 *   onPublish       — () => void (only used when canPublish === true)
 *   onPreview       — () => void
 *   onShowChecklist — () => void; opens the validation modal
 *   saving          — boolean; in-flight save
 *   uploading       — boolean; an image upload is in flight
 *   dirty           — boolean; unsaved changes
 *   autoSaveState   — 'idle' | 'saving' | 'saved' | 'failed'
 *   issueCount      — number of validation issues blocking publish
 *   canPublish      — boolean; whether the current role can publish
 *   isPublished     — boolean; quiz already live (Publish becomes Update)
 */

export default function QuizEditorActionBar({
  onSaveDraft,
  onPublish,
  onPreview,
  onShowChecklist,
  saving = false,
  uploading = false,
  // Batch-upload progress for imported images. Either null (no batch in
  // flight) or { completed, total }. When set, the status pill shows
  // "Uploading images… 4 / 32" so a 30+ image past-paper save doesn't
  // look like it has frozen.
  uploadProgress = null,
  dirty = false,
  autoSaveState = 'idle',
  autoSaveError = '',
  issueCount = 0,
  canPublish = false,
  isPublished = false,
}) {
  const busy = saving || uploading

  // Truncate long Firestore/Storage error chains so the status pill
  // doesn't break the action bar layout. The full error stays in the
  // browser console (see EditQuizV2's performAutoSave catch block).
  const truncatedError = autoSaveError && autoSaveError.length > 90
    ? `${autoSaveError.slice(0, 87)}…`
    : autoSaveError

  const statusText = (() => {
    if (uploadProgress && uploadProgress.total > 0) {
      // Batch import upload — show concrete progress so the teacher
      // knows the editor isn't stuck. Plural-aware on the noun.
      const { completed, total } = uploadProgress
      return `Uploading images… ${completed}/${total}`
    }
    if (uploading) return 'Uploading image…'
    if (saving) return 'Saving…'
    if (autoSaveState === 'saving') return 'Auto-saving…'
    if (autoSaveState === 'failed') {
      return truncatedError ? `Auto-save failed: ${truncatedError}` : 'Auto-save failed'
    }
    if (dirty) return 'Unsaved changes'
    if (autoSaveState === 'saved') return 'Saved'
    return 'All changes saved'
  })()

  const statusTone = (() => {
    if (autoSaveState === 'failed') return 'text-rose-700 bg-rose-50 ring-rose-200'
    if (uploadProgress || uploading || saving || autoSaveState === 'saving') return 'text-sky-700 bg-sky-50 ring-sky-200'
    if (dirty) return 'text-amber-700 bg-amber-50 ring-amber-200'
    return 'text-emerald-700 bg-emerald-50 ring-emerald-200'
  })()

  return (
    <div
      className="quiz-action-bar fixed inset-x-0 bottom-0 z-30 border-t border-slate-200 bg-white/95 backdrop-blur supports-[backdrop-filter]:bg-white/80 shadow-[0_-6px_22px_-12px_rgba(0,0,0,0.18)]"
      role="region"
      aria-label="Quiz editor actions"
    >
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-2 px-3 py-2 sm:px-5 sm:py-3">
        <div className="flex flex-1 flex-wrap items-center gap-2 min-w-0">
          <span
            className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-bold ring-1 ${statusTone}`}
            aria-live="polite"
          >
            <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden="true" />
            {statusText}
          </span>
          {issueCount > 0 && (
            <button
              type="button"
              onClick={onShowChecklist}
              className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2.5 py-1 text-xs font-bold text-amber-800 ring-1 ring-amber-200 hover:bg-amber-100"
              aria-label={`Show ${issueCount} validation issue${issueCount === 1 ? '' : 's'}`}
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M12 9v4M12 17h.01M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
              </svg>
              {issueCount} to fix
            </button>
          )}
          {issueCount === 0 && !uploading && !saving && (
            <button
              type="button"
              onClick={onShowChecklist}
              className="hidden sm:inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-bold text-emerald-800 ring-1 ring-emerald-200 hover:bg-emerald-100"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="m5 12 5 5L20 7" />
              </svg>
              Ready to publish
            </button>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {onPreview && (
            <button
              type="button"
              onClick={onPreview}
              disabled={busy}
              className="btn-secondary min-h-0 px-3 py-2 text-xs font-bold disabled:opacity-50 disabled:pointer-events-none"
            >
              Preview
            </button>
          )}
          <button
            type="button"
            onClick={onSaveDraft}
            disabled={busy}
            className="btn-secondary min-h-0 px-3 py-2 text-xs font-bold disabled:opacity-50 disabled:pointer-events-none"
          >
            {saving ? 'Saving…' : 'Save draft'}
          </button>
          {canPublish && (
            <button
              type="button"
              onClick={onPublish}
              disabled={busy}
              className="btn-primary min-h-0 px-3 py-2 text-xs font-bold disabled:opacity-50 disabled:pointer-events-none"
              aria-label={isPublished ? 'Update published quiz' : 'Publish quiz'}
            >
              {isPublished ? 'Update' : 'Publish'}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
