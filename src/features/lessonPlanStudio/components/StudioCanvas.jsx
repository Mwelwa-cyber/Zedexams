import { useCallback, useEffect, useRef, useState } from 'react'
import LiveLessonPlanPreview from './LiveLessonPlanPreview'
import LessonPlanEditor from './LessonPlanEditor'
import PaginatedPlanPreview from './PaginatedPlanPreview'
import { measurePlanPages } from '../lib/paginatePlan'
import { fitToPage, pageCountVerdict } from '../lib/lessonPlanPagination'
import { formatCssVariableString, lessonPlanPrintCss } from '../../../utils/lessonPlanPrintCss'
import { useLessonPlanDocumentCss } from '../hooks/useLessonPlanDocumentCss'
import { useStudioLessonCss } from '../hooks/useStudioLessonCss'
import { resolveLessonFormat } from '../../../utils/lessonPlanFormat'

/**
 * Wrap the rendered lesson-plan HTML (renderPlanHtml output, already escaped)
 * in a standalone, print-ready A4 document. It reuses the studio's own
 * stylesheet (/studio/lesson.css) and the same DOM scaffold the preview uses
 * (#view-plans > .doc-wrap > .doc), so the printed page / saved PDF matches the
 * on-screen preview exactly, and the lesson.css @media print rules (A4 size,
 * margins, chrome hidden) take effect. The inline <script> waits for the
 * stylesheet + images to load, then prints once.
 */
function buildPrintableDocument(planHtml, format) {
  const fmt = resolveLessonFormat(format)
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Lesson Plan</title>
<style>
  html,body{margin:0;padding:0;background:#fff}
  body{padding:${fmt.marginMm}mm;max-width:210mm;margin:0 auto}
${lessonPlanPrintCss(fmt, { includePageRule: true })}
  /* Last, so it wins — and so the fragmentation rules above stay where a
     rasteriser reading screen media can still see them. */
  @media print{ body{padding:0;max-width:none} }
</style>
</head>
<body>${planHtml}
  <script>
    (function(){
      function go(){ try{ window.focus(); window.print(); }catch(e){} }
      if (document.readyState === 'complete') { setTimeout(go, 350); }
      else { window.addEventListener('load', function(){ setTimeout(go, 350); }); }
    })();
  </script>
</body>
</html>`
}

/**
 * StudioCanvas — right panel of the Lesson Plan Studio.
 *
 * Displays the generated lesson plan, a toolbar with print/export actions,
 * and four mutually exclusive states: idle, loading, done, error.
 *
 * Props:
 *   generatedPlan      — string | null  HTML string from the Cloud Function
 *   generationStatus   — 'idle' | 'loading' | 'done' | 'error'
 *   generationError    — string | null  shown in the error state
 *
 * Note: lessonDetails and topicData are reserved for the lesson kit bar
 * (Task 13 — StudioShell) and are not consumed here yet.
 */
export function StudioCanvas({
  generatedPlan,
  generationStatus,
  generationError,
  onStop,
  onExportWord,
  illustrationMode = 'automatic',
  illustrationStatus = 'idle',
  illustrationError = null,
  onAddIllustration,
  // Editing
  viewMode = 'preview',
  onViewModeChange,
  planJson = null,
  // Render meta (school, teacher, grade, subject, topic, …) built from the form
  // at generate time. Drives the live "writing itself" preview's document header
  // so the plan is being built on screen from the very first frame.
  liveMeta = null,
  curriculumMode = 'cbc',
  lessonContext = {},
  onPlanChange,
  // Paper: the resolved lesson format (page budget, margins, typography) and
  // the way back to the studio state when Fit to page changes it.
  lessonFormat = null,
  onLessonFormatChange,
  onCondenseToFit,
  // Save to library
  onSaveToLibrary,
  saveStatus = 'idle',
  saveError = null,
  canSave = false,
  onViewLibrary,
}) {
  const [showAdd, setShowAdd] = useState(false)
  const [desc, setDesc] = useState('')
  // Live section-by-section reveal: play once right after a fresh generation
  // finishes (loading → done), then hand off to the full print-ready preview.
  // Existing/reopened plans (mounted already-done) skip straight to the preview.
  const [revealDone, setRevealDone] = useState(true)
  const prevStatusRef = useRef(generationStatus)
  useEffect(() => {
    if (prevStatusRef.current === 'loading' && generationStatus === 'done') {
      setRevealDone(false)
    }
    prevStatusRef.current = generationStatus
  }, [generationStatus])
  // The studio's document stylesheet. Shared with every other surface that
  // draws a plan, so none of them can drift onto a different one.
  useStudioLessonCss()

  const [fitting, setFitting] = useState(false)
  const fmt = resolveLessonFormat(lessonFormat || {})

  // The measured page count, KEYED to the document it was measured for.
  //
  // `null` reads as "Measuring…", never as a pass — a budget the app has not
  // checked is not a budget the app can promise. Keying it is what makes that
  // true: an effect that reset the count when the document changed would run
  // AFTER the child's layout effect had already reported the new measurement,
  // and would throw it away. Comparing keys instead means a count for a
  // different document simply cannot be displayed.
  const measureKey = `${generatedPlan?.length ?? 0}:${fmt.marginMm}:${fmt.pageBudget}:${fmt.density}:${fmt.typography.tablePt}`
  const [measured, setMeasured] = useState({ key: null, pages: null })
  const pageCount = measured.key === measureKey ? measured.pages : null
  const verdict = pageCountVerdict(pageCount, fmt)
  const handlePageCount = useCallback((pages) => {
    setMeasured({ key: measureKey, pages })
  }, [measureKey])

  // Inject the document stylesheet here, not only in the paginated preview:
  // the live "writing itself" preview mounts the moment Generate is clicked and
  // renders the same document, so an injection that waited for the sheets left
  // it unstyled for the whole generation.
  useLessonPlanDocumentCss(fmt)

  const handleFitToPage = useCallback(() => {
    if (!generatedPlan || typeof onLessonFormatChange !== 'function') return
    setFitting(true)
    try {
      const result = fitToPage(fmt, (candidate) => measurePlanPages({
        html: generatedPlan,
        marginMm: candidate.marginMm,
        cssVars: formatCssVariableString(candidate),
      }))
      onLessonFormatChange(result.format)
      // The layout levers are spent. The only one left changes the WORDS, and
      // that is the teacher's call, not a silent rewrite.
      if (result.needsCondense && typeof onCondenseToFit === 'function') onCondenseToFit(result)
    } finally {
      setFitting(false)
    }
  }, [generatedPlan, fmt, onLessonFormatChange, onCondenseToFit])

  const isDone    = generationStatus === 'done'
  const isLoading = generationStatus === 'loading'
  const isError   = generationStatus === 'error'
  const isEditing = viewMode === 'edit'
  const canEdit   = isDone && !!planJson && typeof onPlanChange === 'function'

  function setMode(mode) {
    if (typeof onViewModeChange === 'function') onViewModeChange(mode)
  }

  function handlePrint() {
    // Print/Save-as-PDF must show ONLY the lesson plan, never the studio chrome.
    // A bare window.print() on this React studio printed the whole app, because
    // the print-isolation CSS in lesson.css is scoped to the OLD vanilla studio
    // (#view-plans) which doesn't exist here. Instead, open a clean window that
    // contains just the rendered plan, wrapped exactly like the preview
    // (#view-plans > .doc-wrap > .doc) and linked to the same lesson.css — so the
    // print/PDF output is byte-for-byte the preview, and the lesson.css @media
    // print rules (A4 page, margins) apply. `generatedPlan` is the live preview
    // HTML and is kept in sync with edits, so this works in edit mode too.
    if (!generatedPlan) return
    const printable = buildPrintableDocument(generatedPlan, fmt)
    const win = window.open('', '_blank', 'width=900,height=1100')
    if (!win) {
      // Pop-up blocked — fall back to the (chrome-isolated where possible) inline
      // print so the teacher still gets a dialog rather than nothing.
      if (isEditing) {
        setMode('preview')
        requestAnimationFrame(() => window.print())
      } else {
        window.print()
      }
      return
    }
    win.document.open()
    win.document.write(printable)
    win.document.close()
  }

  // A short "Subject • Grade · Topic" title for the document toolbar.
  const lessonTitle = [
    lessonContext.subject,
    lessonContext.grade,
  ].filter(Boolean).join(' • ') + (lessonContext.topic ? ` · ${lessonContext.topic}` : '')

  function handleExportWord() {
    if (typeof onExportWord === 'function') onExportWord()
  }

  const illustrationBusy = illustrationStatus === 'generating'

  function handleAddSubmit() {
    const text = desc.trim()
    if (!text || illustrationBusy) return
    if (typeof onAddIllustration === 'function') onAddIllustration(text)
    setDesc('')
    setShowAdd(false)
  }

  return (
    <div className="flex-1 min-w-0 flex flex-col md:overflow-hidden min-h-[60vh] md:min-h-0">

      {/* ── Topbar ────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-2 px-4 py-2 border-b border-[#e5ddd0] bg-[#F5EFE1]">
        {isDone && (
          <>
            {/* Preview / Edit segmented toggle */}
            {canEdit && (
              <div className="mr-1 inline-flex rounded-xl border border-[#d9cfc3] bg-white p-0.5 shadow-[0_2px_0_#0F1B2D]">
                <button
                  type="button"
                  data-mode="preview"
                  onClick={() => setMode('preview')}
                  aria-pressed={!isEditing}
                  className={`rounded-md px-3 py-1 text-[13px] font-bold transition-colors ${!isEditing ? 'bg-[#0F1B2D] text-white' : 'text-[#0F1B2D] hover:bg-[#FFF4E8]'}`}
                >
                  Preview
                </button>
                <button
                  type="button"
                  data-mode="edit"
                  onClick={() => setMode('edit')}
                  aria-pressed={isEditing}
                  className={`inline-flex items-center gap-1 rounded-md px-3 py-1 text-[13px] font-bold transition-colors ${isEditing ? 'bg-[#0F1B2D] text-white' : 'text-[#0F1B2D] hover:bg-[#FFF4E8]'}`}
                >
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                    <path d="M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                  </svg>
                  Edit
                </button>
              </div>
            )}

            {lessonTitle && (
              <span className="hidden md:inline-block truncate max-w-[28ch] text-[13px] font-medium text-[#7a6d5d]" title={lessonTitle}>
                {lessonTitle}
              </span>
            )}

            <div className="flex-1" />

            {/* Measured page count (§3.3) — amber/red when the plan exceeds the
                budget the teacher chose, with the one-tap way to recover it. */}
            {!isEditing && (
              <span
                data-testid="page-badge"
                title={verdict.target ? `Budget: ${verdict.target} ${verdict.target === 1 ? 'page' : 'pages'}` : 'No page limit'}
                className={[
                  'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[12px] font-semibold',
                  verdict.level === 'red' ? 'bg-red-100 text-red-800'
                    : verdict.level === 'amber' ? 'bg-amber-100 text-amber-900'
                      : verdict.level === 'measuring' ? 'bg-[#efe7d8] text-[#7a6d5d]'
                        : 'bg-green-100 text-green-800',
                ].join(' ')}
              >
                {verdict.label}
              </span>
            )}
            {!isEditing && verdict.level !== 'ok' && verdict.level !== 'measuring' && typeof onLessonFormatChange === 'function' && (
              <button
                type="button"
                data-action="fit-to-page"
                onClick={handleFitToPage}
                disabled={fitting}
                className="lps-btn-ghost px-3 py-1.5 text-[13px]"
              >
                {fitting ? 'Fitting…' : 'Fit to page'}
              </button>
            )}

            <button
              type="button"
              onClick={handlePrint}
              className="lps-btn-ghost px-3 py-1.5 text-[13px]"
            >
              <svg
                width="14" height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <polyline points="6 9 6 2 18 2 18 9" />
                <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" />
                <rect x="6" y="14" width="12" height="8" />
              </svg>
              Print
            </button>

            <button
              type="button"
              data-export="word"
              onClick={handleExportWord}
              className="lps-btn-ghost px-3 py-1.5 text-[13px]"
            >
              <svg
                width="14" height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <rect x="3" y="3" width="18" height="18" rx="2" />
                <path d="M7 8 9.5 16 12 10 14.5 16 17 8" strokeWidth="1.7" />
              </svg>
              Export Word
            </button>

            {/* Save to library */}
            {typeof onSaveToLibrary === 'function' && (
              <>
                {!canSave && saveStatus === 'saved' ? (
                  <span
                    data-testid="save-state"
                    className="inline-flex items-center gap-1.5 rounded-lg border-2 border-[#0F1B2D] bg-green-50 px-3 py-1.5 text-[13px] font-bold text-green-700 shadow-[0_2px_0_#0F1B2D]"
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12" /></svg>
                    Saved
                    {typeof onViewLibrary === 'function' && (
                      <button type="button" onClick={onViewLibrary} className="ml-1 underline hover:no-underline">View</button>
                    )}
                  </span>
                ) : (
                  <button
                    type="button"
                    data-action="save-library"
                    onClick={onSaveToLibrary}
                    disabled={!canSave}
                    className="lps-btn-primary px-3 py-1.5 text-[13px]"
                  >
                    {saveStatus === 'saving' ? (
                      <>
                        <span className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/40 border-t-white" />
                        Saving…
                      </>
                    ) : (
                      <>
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                          <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" />
                          <polyline points="17 21 17 13 7 13 7 21" />
                          <polyline points="7 3 7 8 15 8" />
                        </svg>
                        {saveStatus === 'saved' ? 'Save changes' : 'Save to library'}
                      </>
                    )}
                  </button>
                )}
                {saveStatus === 'error' && saveError && (
                  <span data-testid="save-error" className="text-[12px] text-red-600" title={saveError}>
                    Save failed
                  </span>
                )}
              </>
            )}

            {illustrationMode === 'manual' && (
              <button
                type="button"
                data-action="add-illustration"
                onClick={() => setShowAdd((v) => !v)}
                disabled={illustrationBusy}
                className="lps-btn-ghost px-3 py-1.5 text-[13px]"
              >
                <svg
                  width="14" height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <rect x="3" y="3" width="18" height="18" rx="2" />
                  <circle cx="8.5" cy="8.5" r="1.5" />
                  <path d="M21 15l-5-5L5 21" />
                </svg>
                Add Illustration
              </button>
            )}

            {/* Illustration status (covers both automatic + manual flows) */}
            {illustrationBusy && (
              <span data-testid="illustration-status" className="text-[12px] text-[#7a6d5d]">
                Adding illustration…
              </span>
            )}
            {illustrationStatus === 'error' && illustrationError && (
              <span data-testid="illustration-error" className="text-[12px] text-red-600" title={illustrationError}>
                Illustration failed
              </span>
            )}
          </>
        )}
      </div>

      {/* Manual illustration input row */}
      {isDone && illustrationMode === 'manual' && showAdd && (
        <div className="flex items-center gap-2 px-4 py-2 border-b border-[#e5ddd0] bg-[#F5EFE1]">
          <input
            type="text"
            value={desc}
            onChange={(e) => setDesc(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') handleAddSubmit() }}
            placeholder="Describe the illustration to add (e.g. water cycle diagram)"
            className="flex-1 rounded-md border border-[#d9cfc3] bg-white px-3 py-1.5 text-[13px] text-[#0F1B2D] focus:outline-none"
          />
          <button
            type="button"
            onClick={handleAddSubmit}
            disabled={!desc.trim() || illustrationBusy}
            className="lps-btn-primary rounded-md px-3 py-1.5 text-[13px]"
          >
            Generate
          </button>
        </div>
      )}

      {/* ── Workspace ─────────────────────────────────────────────────── */}
      {/* Mobile: grows with content so the plan is fully visible in the page
          scroll, with bottom padding to clear the fixed "Create for this
          lesson" bar. Desktop: scrolls internally within the full-height pane. */}
      <div className="flex-1 md:overflow-y-auto bg-[#EFE9DB] flex items-start justify-center p-3 pb-28 md:p-6 md:pb-6">

        {/* 1. Idle / empty state */}
        {generationStatus === 'idle' && (
          <div className="flex w-full max-w-sm flex-col items-center rounded-3xl border border-[#ece4d6] bg-white/70 px-8 py-10 text-center lps-soft-shadow lps-section-enter mt-12 md:mt-20">
            <div className="lps-tile mb-5 h-16 w-16 rounded-[18px] text-white lps-brand-gradient">
              <svg
                width="30" height="30"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" />
                <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" />
              </svg>
            </div>
            <span className="lps-eyebrow mb-2">Your canvas</span>
            <h2 className="font-display mb-2 text-[20px] font-extrabold tracking-tight text-[#0F1B2D]">
              An empty page is waiting
            </h2>
            <p className="text-[14px] leading-relaxed text-[#4A5A6E]">
              Fill in your details on the left, then hit{' '}
              <strong>Generate Lesson Plan</strong>.
            </p>
          </div>
        )}

        {/* 2. Live "writing itself" preview — a single continuous instance that
             spans the whole generation. While loading it types the document
             header in from the form (planJson=null); the moment the plan lands
             it reveals the body section by section, then hands off (onComplete)
             to the full print-ready preview below. Keeping ONE mounted instance
             across loading→reveal means the header never flickers. */}
        {(isLoading || (isDone && !isEditing && !revealDone && planJson)) && (
          <div className="w-full max-w-[820px] pt-1">
            <LiveLessonPlanPreview
              meta={liveMeta || {}}
              curriculumMode={curriculumMode}
              planJson={isLoading ? null : planJson}
              onStop={typeof onStop === 'function' ? onStop : undefined}
              onComplete={() => setRevealDone(true)}
            />
          </div>
        )}

        {/* 3a. Edit mode — structured manual + AI editor */}
        {isDone && isEditing && canEdit && (
          <LessonPlanEditor
            planJson={planJson}
            curriculumMode={curriculumMode}
            context={lessonContext}
            onChange={onPlanChange}
          />
        )}

        {/* 3b. Generated / done state (preview) — after the live reveal, or
             immediately for reopened plans that have no structured planJson. */}
        {isDone && !isEditing && generatedPlan && (revealDone || !planJson) && (
          /* Real A4 sheets (§3.3), not a continuous column — a teacher has to be
             able to see what comes out of the printer, including where the page
             breaks fall. The sheets scale to the viewport rather than reflowing,
             because a sheet that reflowed would no longer be the sheet that
             prints and the page count would be a count of something else. */
          <div className="mx-auto w-full max-w-[900px] lps-section-enter">
            <PaginatedPlanPreview
              html={generatedPlan}
              format={fmt}
              onPageCount={handlePageCount}
            />
          </div>
        )}
        {isDone && !isEditing && !generatedPlan && (
          <div className="flex flex-col items-center justify-center text-center max-w-sm pt-20">
            <p className="text-[14px] text-[#9e8e7e]">The plan is empty. Try generating again.</p>
          </div>
        )}

        {/* 4. Error state */}
        {isError && (
          <div className="mt-12 flex w-full max-w-sm flex-col items-center rounded-3xl border border-red-100 bg-white/70 px-8 py-10 text-center lps-soft-shadow lps-section-enter md:mt-20">
            <div className="mb-4 text-red-500">
              <svg
                width="40" height="40"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="8" x2="12" y2="12" />
                <line x1="12" y1="16" x2="12.01" y2="16" />
              </svg>
            </div>
            <p className="text-[15px] font-semibold text-[#3d3530] mb-1">
              Something went wrong. Please try again.
            </p>
            {generationError && (
              <p className="text-[12px] text-[#9e8e7e] mt-1">
                {generationError}
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
