/**
 * Read-only rendering of an AI-generated test/exam paper (an `aiGenerations`
 * doc with tool `'assessment'` or `'exam_paper'`). Shared by the Library detail
 * view so a generated paper prints as a real school paper — the same
 * marble-banner layout the Assessment Studio uses — instead of opening blank.
 *
 * The generation's `output` is converted to the studio render shape via
 * `aiPaperToStudioDoc`, laid out by `buildPaperLayout`, then drawn by
 * `PaperDocument`. `showAnswers` switches the paper into marking-key mode
 * (model answers + explanations beneath each question).
 */

import { useMemo } from 'react'
import { aiPaperToStudioDoc } from '../../../utils/aiPaperToSections'
import { buildPaperLayout } from '../../../utils/assessmentPaperLayout'
import { PaperDocument } from '../../../engines/paper-render/PaperBlocks'

export default function AssessmentPaperView({ assessment, tool = 'assessment', showAnswers = false }) {
  const { blocks, questionCount } = useMemo(() => {
    try {
      const { doc, questions, questionCount } = aiPaperToStudioDoc(assessment, tool)
      const layout = buildPaperLayout(doc, questions, { mode: showAnswers ? 'scheme' : 'paper' })
      return { blocks: layout, questionCount }
    } catch {
      // Malformed/partial generation — fall through to the empty state below
      // rather than crashing the whole library detail page.
      return { blocks: [], questionCount: 0 }
    }
  }, [assessment, tool, showAnswers])

  if (!assessment || questionCount === 0) {
    return (
      <p className="text-sm theme-text-secondary italic">
        This paper has no questions to display.
      </p>
    )
  }

  return <PaperDocument blocks={blocks} />
}
