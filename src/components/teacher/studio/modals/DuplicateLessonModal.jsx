/**
 * DuplicateLessonModal — guards against accidentally creating a second copy of
 * a lesson that already exists for a subtopic (requirement #6). Shown when the
 * teacher triggers generation for a lesson number that is already saved in
 * memory. Offers the three resolutions from the spec:
 *   - Continue existing lesson   → open the saved plan to keep editing
 *   - Duplicate lesson           → generate another copy of the same number
 *   - Create next lesson         → generate the next free lesson number instead
 *
 * Pure presentational; the parent owns the state + actions.
 *
 * Props:
 *   open            : boolean
 *   lessonNumber    : number   — the number that already exists
 *   nextLessonNumber: number   — the next free number ("Create next" target)
 *   subtopicName    : string
 *   onContinue      : () => void
 *   onDuplicate     : () => void
 *   onCreateNext    : () => void
 *   onCancel        : () => void
 */
export function DuplicateLessonModal({
  open,
  lessonNumber,
  nextLessonNumber,
  subtopicName,
  onContinue,
  onDuplicate,
  onCreateNext,
  onCancel,
}) {
  if (!open) return null

  return (
    <div
      className="lps-game fixed inset-0 z-[60] flex items-center justify-center bg-black/40 px-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="dup-lesson-title"
      onClick={onCancel}
    >
      <div
        className="w-full max-w-sm rounded-2xl border-2 border-[#0F1B2D] bg-white p-5 shadow-[0_3px_0_#0F1B2D,0_18px_34px_-22px_rgba(15,27,45,0.5)]"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="dup-lesson-title" className="font-display text-[16px] font-extrabold tracking-tight text-[#0F1B2D]">
          Lesson {lessonNumber} already exists
        </h2>
        <p className="mt-1.5 text-[12.5px] text-[#6b6452]">
          You have already created Lesson {lessonNumber}
          {subtopicName ? ` for ${subtopicName}` : ''}. What would you like to do?
        </p>

        <div className="mt-4 flex flex-col gap-2">
          <button
            type="button"
            onClick={onContinue}
            className="w-full rounded-xl border border-[#d9cfbe] bg-white px-3 py-2.5 text-left text-[12.5px] font-semibold text-[#3d3529] transition-colors hover:bg-[#f5f0e8]"
          >
            Continue existing lesson
            <span className="block text-[11px] font-normal text-[#a39d8e]">Open Lesson {lessonNumber} to keep editing</span>
          </button>
          <button
            type="button"
            onClick={onCreateNext}
            className="lps-lift w-full rounded-xl px-3 py-2.5 text-left text-[12.5px] font-semibold text-white lps-brand-gradient lps-soft-shadow transition-all hover:brightness-105"
          >
            Create Lesson {nextLessonNumber}
            <span className="block text-[11px] font-normal text-white/85">Plan the next lesson in this subtopic</span>
          </button>
          <button
            type="button"
            onClick={onDuplicate}
            className="w-full rounded-xl border border-[#d9cfbe] bg-white px-3 py-2.5 text-left text-[12.5px] font-semibold text-[#3d3529] transition-colors hover:bg-[#f5f0e8]"
          >
            Duplicate lesson
            <span className="block text-[11px] font-normal text-[#a39d8e]">Generate another version of Lesson {lessonNumber}</span>
          </button>
        </div>

        <button
          type="button"
          onClick={onCancel}
          className="mt-3 w-full rounded-lg px-3 py-2 text-[12px] font-semibold text-[#8a7d6b] hover:bg-[#f5f0e8]"
        >
          Cancel
        </button>
      </div>
    </div>
  )
}
