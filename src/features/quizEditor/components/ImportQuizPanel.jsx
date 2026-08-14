/**
 * ImportQuizPanel — Word/PDF document upload UI for quiz creation and
 * editing. Used by both CreateQuizV2 (new quiz from scratch) and
 * EditQuizV2 (e.g. populating a past-paper-linked quiz).
 *
 * The parent owns the busy state, the most-recent import summary, and
 * the actual call to documentQuizImporter.importQuizDocument(). This
 * component is purely presentational + file-picker.
 */

import { useRef, useState } from 'react'
import { QUIZ_DOCUMENT_ACCEPT } from '../../../components/quiz/documentQuizImporter'

// Pull the underlying reason out of a "Smart import unavailable, used
// standard parser. (REASON)" warning so we can render it in a distinct
// sub-banner instead of buried in the warning list.
const SMART_FAIL_PREFIX = /^Smart import unavailable, used standard parser\.\s*\(?/i

function extractSmartImportReason(warnings = []) {
  if (!Array.isArray(warnings)) return ''
  const match = warnings.find(w => SMART_FAIL_PREFIX.test(String(w || '')))
  if (!match) return ''
  return String(match)
    .replace(SMART_FAIL_PREFIX, '')
    .replace(/\)\s*$/, '')
    .trim()
}

// Human-readable label for the vision-import progress phases (scanned PDFs and
// imported pictures share the same pipeline).
function progressLabel(progress) {
  if (!progress || !progress.total) return ''
  if (progress.phase === 'rendering') {
    return `Preparing page ${progress.current} of ${progress.total}…`
  }
  if (progress.phase === 'reading') {
    return `Reading questions — batch ${progress.current} of ${progress.total}…`
  }
  if (progress.phase === 'recovering') {
    return `Re-checking for missed questions — pass ${progress.current} of ${progress.total}…`
  }
  return ''
}

export default function ImportQuizPanel({
  importing,
  importProgress,
  importSummary,
  onImport,
  intro,
  title = 'Import Quiz (Word / PDF / Pictures)',
}) {
  // Bump the input key after each pick so re-selecting the same file
  // still fires onChange — without this, a teacher who chose the wrong
  // file would have to refresh to retry the same path.
  const [inputKey, setInputKey] = useState(0)
  // Cache the last-picked file(s) so the "Retry smart import" button can
  // re-run the importer without making the teacher re-pick the file
  // (which is annoying after smart import quietly fell back).
  const lastFileRef = useRef(null)

  // Import options — both default ON. They are passed to onImport(file, opts)
  // and threaded down to the parser so they actually gate behaviour.
  const [preserveNumbering, setPreserveNumbering] = useState(true)
  const [groupComprehension, setGroupComprehension] = useState(true)
  // How scanned diagrams are handled. Default 'keep' — most Zambian assessment
  // questions depend on their figure, so we never drop diagrams by default.
  // 'text' (leave out) is deliberately NOT the default.
  const [diagramHandling, setDiagramHandling] = useState('keep')

  function currentOptions() {
    return { preserveNumbering, groupComprehension, diagramHandling }
  }

  function handlePick(fileList) {
    const files = Array.from(fileList || []).filter(Boolean)
    if (!files.length) return
    // A single document stays a single File; several pictures pass through as
    // an array (the importer accepts both).
    const picked = files.length === 1 ? files[0] : files
    lastFileRef.current = picked
    onImport(picked, currentOptions())
    setInputKey(current => current + 1)
  }

  function handleRetrySmartImport() {
    const picked = lastFileRef.current
    if (!picked || importing) return
    onImport(picked, currentOptions())
  }

  // Smart-import fell back to the standard parser when smartApplied is
  // explicitly false AND we have a warning message that starts with the
  // canonical fallback prefix. Past papers with messy layouts work much
  // better through smart import than the standard parser, so we want to
  // surface this state prominently with a one-click retry.
  const smartFellBack = importSummary && importSummary.smartApplied === false
  const smartFailReason = smartFellBack
    ? extractSmartImportReason(importSummary?.warnings)
    : ''

  return (
    <div className="theme-accent-bg theme-border space-y-4 rounded-2xl border p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="theme-text font-black">{title}</h2>
          <p className="theme-text mt-1 max-w-3xl text-sm font-bold leading-relaxed">
            {intro || 'Upload a .doc, .docx, or .pdf — or pictures (JPG/PNG/WEBP) of a paper. ZedExams will extract questions, options, short answers, and image-based questions into editable cards, then use smart cleanup on tricky formatting when available. You can select several pictures at once (one per page).'}
          </p>
        </div>
        <label className="theme-accent-fill theme-on-accent cursor-pointer rounded-xl px-4 py-2.5 text-sm font-black">
          {importing ? 'Importing...' : 'Choose File(s)'}
          <input
            key={inputKey}
            type="file"
            accept={QUIZ_DOCUMENT_ACCEPT}
            multiple
            className="hidden"
            disabled={importing}
            onChange={event => handlePick(event.target.files)}
          />
        </label>
      </div>
      <div className="grid gap-3 md:grid-cols-3">
        <div className="theme-card theme-border rounded-xl border p-3">
          <p className="theme-accent-text text-xs font-black uppercase tracking-wide">Editable import</p>
          <p className="theme-text mt-1 text-xs font-bold leading-relaxed">The document is converted into editable quiz cards, not embedded as a static file.</p>
        </div>
        <div className="theme-card theme-border rounded-xl border p-3">
          <p className="theme-accent-text text-xs font-black uppercase tracking-wide">Images</p>
          <p className="theme-text mt-1 text-xs font-bold leading-relaxed">DOCX images and PDF snapshots attach to matching questions and upload when you save.</p>
        </div>
        <div className="theme-card theme-border rounded-xl border p-3">
          <p className="theme-accent-text text-xs font-black uppercase tracking-wide">Scans &amp; pictures</p>
          <p className="theme-text mt-1 text-xs font-bold leading-relaxed">Image-only PDFs and photos/screenshots of a paper are read with AI vision. Answers are left blank for you to set.</p>
        </div>
      </div>

      {importing && importProgress && progressLabel(importProgress) && (
        <div className="rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-blue-900">
          <p className="text-sm font-black">
            <span aria-hidden="true">📷</span> Reading with AI vision…
          </p>
          <p className="mt-1 text-xs font-bold leading-relaxed">{progressLabel(importProgress)}</p>
          <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-blue-100">
            <div
              className="h-full rounded-full bg-blue-500 transition-all"
              style={{ width: `${Math.round((importProgress.current / Math.max(1, importProgress.total)) * 100)}%` }}
            />
          </div>
        </div>
      )}

      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:gap-6">
        <label className="theme-text flex items-center gap-2 text-xs font-bold">
          <input
            type="checkbox"
            checked={preserveNumbering}
            disabled={importing}
            onChange={event => setPreserveNumbering(event.target.checked)}
            className="h-4 w-4"
          />
          Preserve original numbering
        </label>
        <label className="theme-text flex items-center gap-2 text-xs font-bold">
          <input
            type="checkbox"
            checked={groupComprehension}
            disabled={importing}
            onChange={event => setGroupComprehension(event.target.checked)}
            className="h-4 w-4"
          />
          Group comprehension questions under passage
        </label>
      </div>

      <div className="theme-card theme-border rounded-xl border p-3">
        <label htmlFor="diagram-handling" className="theme-text text-xs font-black">
          How should diagrams be handled?
        </label>
        <select
          id="diagram-handling"
          value={diagramHandling}
          disabled={importing}
          onChange={event => setDiagramHandling(event.target.value)}
          className="theme-border theme-text mt-1.5 w-full rounded-lg border bg-white px-3 py-2 text-sm font-bold"
        >
          <option value="keep">Keep diagrams and place them in the correct questions</option>
          <option value="clean">Clean diagrams before adding them</option>
          <option value="text">Leave out diagrams and use text only</option>
          <option value="ask">Ask me for each diagram</option>
        </select>
        <p className="theme-text mt-1.5 text-xs font-bold leading-relaxed opacity-80">
          {diagramHandling === 'text'
            ? '⚠️ Diagrams will be left out. Many questions depend on their figure — only use this for text-only papers.'
            : diagramHandling === 'clean'
              ? 'Each diagram is cropped, straightened and cleaned to sharp black-and-white before it is placed under its question.'
              : diagramHandling === 'ask'
                ? 'Each detected diagram is attached and flagged so you can decide what to do with it after import.'
                : 'Recommended. Each diagram is cropped from the page and kept under the question it belongs to.'}
        </p>
      </div>

      {smartFellBack && (
        <div className="rounded-xl border border-orange-200 bg-orange-50 px-4 py-3 text-orange-900">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-black">
                <span aria-hidden="true">⚠️</span> Smart import didn&apos;t run for this file
              </p>
              <p className="mt-1 text-xs font-bold leading-relaxed">
                Falling back to the standard parser. Smart import handles messy
                past-paper layouts more reliably — retrying often works the
                second time, especially after a Cloud Function cold start.
              </p>
              {smartFailReason && (
                <p className="mt-2 text-xs font-bold text-orange-800">
                  <span className="font-black">Why:</span>{' '}
                  <code className="rounded bg-orange-100 px-1.5 py-0.5 font-mono text-[11px]">{smartFailReason}</code>
                </p>
              )}
            </div>
            {lastFileRef.current && (
              <button
                type="button"
                onClick={handleRetrySmartImport}
                disabled={importing}
                className="shrink-0 rounded-xl bg-orange-600 px-3 py-2 text-xs font-black text-white shadow-sm transition-colors hover:bg-orange-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {importing ? 'Retrying…' : '↻ Retry smart import'}
              </button>
            )}
          </div>
        </div>
      )}

      {importSummary && (
        <div className={`rounded-xl border px-4 py-3 ${
          importSummary.importStatus === 'needs_review'
            ? 'border-amber-200 bg-amber-50 text-amber-900'
            : 'theme-card theme-border theme-text'
        }`}>
          <p className="text-sm font-black">
            Imported {importSummary.questions} question{importSummary.questions === 1 ? '' : 's'} from {importSummary.fileName}
          </p>
          <p className="mt-1 text-xs font-bold leading-relaxed">
            {importSummary.smartApplied ? 'Smart cleanup applied · ' : 'Standard parser · '}
            {importSummary.passages ? `${importSummary.passages} passage${importSummary.passages === 1 ? '' : 's'} detected · ` : ''}
            {importSummary.images} image-based question{importSummary.images === 1 ? '' : 's'} · {importSummary.needsReview} need review · Status: {importSummary.importStatus}
          </p>
          {/* Version stamps — make a stale deploy observable. The client
              (importer) ships via Hosting; for SCANNED imports there is also a
              server engine that ships via the Functions deploy — a missing or
              mismatched engine version there means the live function is running
              OLD code, the silent failure that made past importer fixes look
              broken in prod. Plain Word/PDF document imports run entirely in
              the browser (no engine), so for those only the importer version
              renders — an engine warning there would be a false alarm. */}
          {importSummary.importerVersion ? (
            <p className="mt-1 font-mono text-[11px] font-bold leading-relaxed opacity-80">
              importer {importSummary.importerVersion}
              {importSummary.scanned ? (
                <>
                  {' · engine '}
                  {importSummary.engineVersion
                    ? importSummary.engineVersion === importSummary.importerVersion
                      ? `${importSummary.engineVersion} ✓`
                      : `${importSummary.engineVersion} ⚠ differs from importer — server may be mid-deploy`
                    : '⚠ none reported — the Cloud Function is running OLD code (stale deploy)'}
                </>
              ) : null}
            </p>
          ) : null}
          {importSummary.warnings?.length ? (
            <ul className="mt-2 space-y-0.5">
              {/* Show enough for the per-question formatting checks ("says
                  underlined but none detected", "option B is empty") to be
                  actionable, without letting a noisy import flood the panel. */}
              {importSummary.warnings.slice(0, 8).map((warning, index) => (
                <li key={`${warning}-${index}`} className="text-xs font-bold leading-relaxed">{warning}</li>
              ))}
              {importSummary.warnings.length > 8 ? (
                <li className="text-xs font-bold leading-relaxed opacity-75">
                  +{importSummary.warnings.length - 8} more — the full list is kept on the quiz’s import notes.
                </li>
              ) : null}
            </ul>
          ) : null}

          {/* Import preview — detected parts (in order) and per-part counts,
              plus a warning for any part that ended up with no questions.
              Shown before the quiz is committed so the teacher can spot a
              mis-detected section. */}
          {Array.isArray(importSummary.partBreakdown) && importSummary.partBreakdown.length ? (
            <div className="mt-3 border-t border-current/10 pt-2">
              <p className="text-xs font-black uppercase tracking-wide">Detected structure</p>
              <ul className="mt-1 space-y-0.5">
                {importSummary.partBreakdown.map((part, index) => {
                  const label = String(part.title || '').trim() || 'Unsectioned questions'
                  const empty = String(part.title || '').trim() && part.questions === 0
                  return (
                    <li
                      key={part.partId || `part-${index}`}
                      className={`text-xs font-bold leading-relaxed ${empty ? 'text-red-700' : ''}`}
                    >
                      {label}: {part.questions} question{part.questions === 1 ? '' : 's'}
                      {part.passages ? ` · ${part.passages} passage${part.passages === 1 ? '' : 's'}` : ''}
                      {empty ? ' ⚠️ no questions detected' : ''}
                    </li>
                  )
                })}
              </ul>
              {importSummary.zeroQuestionParts?.length ? (
                <p className="mt-2 text-xs font-black text-red-700">
                  ⚠️ {importSummary.zeroQuestionParts.length} part
                  {importSummary.zeroQuestionParts.length === 1 ? '' : 's'} detected with no questions — review before saving.
                </p>
              ) : null}
            </div>
          ) : null}
        </div>
      )}
    </div>
  )
}
