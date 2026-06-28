import { useEffect, useState } from 'react'
import AiGenerationProgress from '../../ui/AiGenerationProgress'
import LessonPlanEditor from './LessonPlanEditor'

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
  onExportWord,
  illustrationMode = 'automatic',
  illustrationStatus = 'idle',
  illustrationError = null,
  onAddIllustration,
  // Editing
  viewMode = 'preview',
  onViewModeChange,
  planJson = null,
  curriculumMode = 'cbc',
  lessonContext = {},
  onPlanChange,
}) {
  const [showAdd, setShowAdd] = useState(false)
  const [desc, setDesc] = useState('')
  // Inject lesson.css from /public/studio/ on mount.
  // The file lives in public/ so Vite won't bundle it; we inject a <link>
  // instead. We intentionally do NOT remove it on unmount — the styles are
  // needed for window.print() even after client-side navigation.
  useEffect(() => {
    const id = 'studio-lesson-css'
    if (!document.getElementById(id)) {
      const link = document.createElement('link')
      link.rel = 'stylesheet'
      link.href = '/studio/lesson.css'
      link.id = id
      document.head.appendChild(link)
    }
  }, [])

  const isDone    = generationStatus === 'done'
  const isLoading = generationStatus === 'loading'
  const isError   = generationStatus === 'error'
  const isEditing = viewMode === 'edit'
  const canEdit   = isDone && !!planJson && typeof onPlanChange === 'function'

  function setMode(mode) {
    if (typeof onViewModeChange === 'function') onViewModeChange(mode)
  }

  function handlePrint() {
    // Print always shows the formatted document, never the editor. The parent
    // keeps the preview HTML in sync with edits, so flipping to preview first
    // prints the latest version.
    if (isEditing) {
      setMode('preview')
      requestAnimationFrame(() => window.print())
      return
    }
    window.print()
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
    <div className="flex-1 min-w-0 overflow-hidden flex flex-col">

      {/* ── Topbar ────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-2 px-4 py-2 border-b border-[#e5ddd0] bg-[#faf7f2]">
        {isDone && (
          <>
            {/* Preview / Edit segmented toggle */}
            {canEdit && (
              <div className="mr-1 inline-flex rounded-lg border border-[#d9cfc3] bg-white p-0.5">
                <button
                  type="button"
                  data-mode="preview"
                  onClick={() => setMode('preview')}
                  aria-pressed={!isEditing}
                  className={`rounded-md px-3 py-1 text-[13px] font-semibold transition-colors ${!isEditing ? 'bg-[#5c4a3a] text-white' : 'text-[#5c4a3a] hover:bg-[#f5f0ea]'}`}
                >
                  Preview
                </button>
                <button
                  type="button"
                  data-mode="edit"
                  onClick={() => setMode('edit')}
                  aria-pressed={isEditing}
                  className={`inline-flex items-center gap-1 rounded-md px-3 py-1 text-[13px] font-semibold transition-colors ${isEditing ? 'bg-[#5c4a3a] text-white' : 'text-[#5c4a3a] hover:bg-[#f5f0ea]'}`}
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

            <button
              type="button"
              onClick={handlePrint}
              className="inline-flex items-center gap-1.5 rounded-lg border border-[#d9cfc3] bg-white px-3 py-1.5 text-[13px] font-medium text-[#3d3530] hover:bg-[#f5f0ea] active:bg-[#ede7df] transition-colors"
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
              className="inline-flex items-center gap-1.5 rounded-lg border border-[#d9cfc3] bg-white px-3 py-1.5 text-[13px] font-medium text-[#3d3530] hover:bg-[#f5f0ea] active:bg-[#ede7df] transition-colors"
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

            {illustrationMode === 'manual' && (
              <button
                type="button"
                data-action="add-illustration"
                onClick={() => setShowAdd((v) => !v)}
                disabled={illustrationBusy}
                className="inline-flex items-center gap-1.5 rounded-lg border border-[#d9cfc3] bg-white px-3 py-1.5 text-[13px] font-medium text-[#3d3530] hover:bg-[#f5f0ea] active:bg-[#ede7df] transition-colors disabled:opacity-50"
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
        <div className="flex items-center gap-2 px-4 py-2 border-b border-[#e5ddd0] bg-[#fbf9f5]">
          <input
            type="text"
            value={desc}
            onChange={(e) => setDesc(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') handleAddSubmit() }}
            placeholder="Describe the illustration to add (e.g. water cycle diagram)"
            className="flex-1 rounded-md border border-[#d9cfc3] bg-white px-3 py-1.5 text-[13px] text-[#3d3530] focus:outline-none focus:ring-1 focus:ring-blue-400"
          />
          <button
            type="button"
            onClick={handleAddSubmit}
            disabled={!desc.trim() || illustrationBusy}
            className="rounded-md bg-blue-600 px-3 py-1.5 text-[13px] font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            Generate
          </button>
        </div>
      )}

      {/* ── Workspace ─────────────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto bg-[#f2ede6] flex items-start justify-center p-6">

        {/* 1. Idle / empty state */}
        {generationStatus === 'idle' && (
          <div className="flex flex-col items-center justify-center text-center max-w-sm pt-20">
            <div className="mb-4 text-[#9e8e7e]">
              <svg
                width="48" height="48"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.4"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" />
                <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" />
              </svg>
            </div>
            <h2 className="text-[18px] font-bold text-[#3d3530] mb-2">
              An empty page is waiting
            </h2>
            <p className="text-[14px] text-[#7a6d5d] leading-relaxed">
              Fill in your details on the left, then hit{' '}
              <strong>Generate Lesson Plan</strong>.
            </p>
          </div>
        )}

        {/* 2. Loading state */}
        {isLoading && (
          <div className="w-full max-w-md pt-10">
            <AiGenerationProgress
              variant="card"
              preset="lessonPlan"
              running
              title="Composing your lesson plan…"
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

        {/* 3b. Generated / done state (preview) */}
        {isDone && !isEditing && generatedPlan && (
          /* Safe: generatedPlan is our own renderPlanHtml() output (HTML escaped), never raw user input */
          <div
            id="doc"
            className="doc"
            dangerouslySetInnerHTML={{ __html: generatedPlan }}
          />
        )}
        {isDone && !isEditing && !generatedPlan && (
          <div className="flex flex-col items-center justify-center text-center max-w-sm pt-20">
            <p className="text-[14px] text-[#9e8e7e]">The plan is empty. Try generating again.</p>
          </div>
        )}

        {/* 4. Error state */}
        {isError && (
          <div className="flex flex-col items-center justify-center text-center max-w-sm pt-20">
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
