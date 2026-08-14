import { useId, useState } from 'react'
import RichContent from '../../editor/RichContent'
import ZoomableImage from './ZoomableImage'
import TextToSpeechButton from './TextToSpeechButton'
import { toSpokenText } from '../../utils/readAloudText'

/**
 * PassageViewer — the dedicated English-comprehension passage card, shared by
 * every learner runner that renders passage sections (QuizRunnerV2,
 * DailyExamRunner). It keeps the reading text in its own scrollable card so a
 * long passage never pushes the question off-screen, and adds the reading
 * controls the redesign calls for:
 *   • Collapse / show passage (hidden when the learner's "keep passage open"
 *     preference is on, so it never auto-collapses).
 *   • Passage-local text-size stepper (A− / A+) on top of the global size.
 *   • Read passage aloud (reuses the Phase 2 TextToSpeechButton).
 *   • Optional line numbers (the "show passage line numbers" preference).
 * Formatting (bold / underline / italic / highlight / tables / images) is
 * preserved because the body still renders through the shared RichContent.
 */

const SIZE_SCALES = [0.92, 1, 1.18]

export default function PassageViewer({
  passage,
  questionCount = 0,
  ttsId,
  tts,
  showLineNumbers = false,
  keepOpen = false,
}) {
  const [open, setOpen] = useState(true)
  const [sizeStep, setSizeStep] = useState(1)
  const bodyId = useId()

  if (!passage) return null

  const scale = SIZE_SCALES[sizeStep] ?? 1
  const kindLabel = passage.passageKind === 'map' ? 'Map Questions' : 'Comprehension Passage'
  const collapsible = !keepOpen
  const isOpen = keepOpen || open

  return (
    <div className="zx-card-shared overflow-hidden">
      <div className="border-b-2 border-slate-900 bg-orange-50 px-4 py-4 sm:px-5">
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <span className="zx-pill-dark zx-pill-orange">{kindLabel}</span>
          <span className="zx-pill-dark zx-pill-light">
            {questionCount} question{questionCount === 1 ? '' : 's'}
          </span>
        </div>
        <div className="flex items-start justify-between gap-2">
          {passage.title && <h2 className="text-base font-black text-slate-900 sm:text-lg">{passage.title}</h2>}
          <div className="ml-auto flex shrink-0 items-center gap-1.5">
            {/* Passage-local text-size stepper */}
            <div role="group" aria-label="Passage text size" className="inline-flex items-center overflow-hidden rounded-full border-2 border-slate-900/70 bg-white/90">
              <button
                type="button"
                onClick={() => setSizeStep((s) => Math.max(0, s - 1))}
                disabled={sizeStep === 0}
                aria-label="Smaller passage text"
                title="Smaller passage text"
                className="px-2 py-1 text-xs font-black text-slate-800 disabled:opacity-40"
              >
                A−
              </button>
              <span aria-hidden="true" className="h-4 w-px bg-slate-300" />
              <button
                type="button"
                onClick={() => setSizeStep((s) => Math.min(SIZE_SCALES.length - 1, s + 1))}
                disabled={sizeStep === SIZE_SCALES.length - 1}
                aria-label="Larger passage text"
                title="Larger passage text"
                className="px-2 py-1 text-sm font-black text-slate-800 disabled:opacity-40"
              >
                A+
              </button>
            </div>
            <TextToSpeechButton
              id={ttsId}
              label="passage"
              getText={() => toSpokenText(passage.passageText)}
              tts={tts}
            />
            {collapsible && (
              <button
                type="button"
                onClick={() => setOpen((o) => !o)}
                aria-expanded={isOpen}
                aria-controls={bodyId}
                className="rounded-full border-2 border-slate-900/70 bg-white/90 px-3 py-1 text-xs font-bold text-slate-800"
              >
                {isOpen ? 'Hide passage' : 'Show passage'}
              </button>
            )}
          </div>
        </div>
        {passage.instructions && (
          <RichContent value={passage.instructions} className="mt-2 text-sm text-slate-700" />
        )}
      </div>

      {isOpen && (
        <>
          {passage.imageUrl && (
            <div className="border-b-2 border-slate-900 bg-slate-50 p-3 sm:p-4">
              <ZoomableImage
                src={passage.imageUrl}
                alt="Passage illustration"
                fallbackText={passage.diagramText || passage.title || ''}
                priority
                className="mx-auto max-h-[80vh] w-full rounded-2xl object-contain"
              />
            </div>
          )}
          <div
            id={bodyId}
            className="passage-body max-h-[60vh] overflow-y-auto p-4 sm:p-5"
            data-line-numbers={showLineNumbers ? 'true' : 'false'}
            style={{ '--passage-local-scale': scale }}
          >
            <RichContent value={passage.passageText} className="passage-text" />
          </div>
        </>
      )}
    </div>
  )
}
