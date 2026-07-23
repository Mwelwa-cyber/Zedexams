import { FormatOptionsForm } from '../../sections/FormatOptionsForm.jsx'

/**
 * Step 4 — Format & Options.
 *
 * Detail level (premium cards with icon, title, explanation + check on
 * selection), writing style (segmented pills), lesson-plan format cards with
 * thumbnail + preview, and the Advanced Options accordion (medium of
 * instruction, metadata toggles, local language). Entirely the reused
 * FormatOptionsForm — including the format preview modal — in embedded mode.
 */
export function FormatOptionsStep({
  formatOptions,
  onUpdateFormat,
  onUpdateAdvanced,
  onUpdateMedium,
  lessonMedium,
  curriculumMode,
}) {
  return (
    <div className="rounded-2xl border-2 border-[#0F1B2D] bg-white p-4 shadow-[0_2px_0_#0F1B2D]">
      <FormatOptionsForm
        embedded
        formatOptions={formatOptions}
        onUpdateFormat={onUpdateFormat}
        onUpdateAdvanced={onUpdateAdvanced}
        onUpdateMedium={onUpdateMedium}
        lessonMedium={lessonMedium}
        curriculumMode={curriculumMode}
      />
    </div>
  )
}
