import { ActivityChip } from '../cards/ActivityChip.jsx'
import { Sparkles } from '../../../../shared/components/icons'

const SECTION_LABEL_CLS = 'block text-[10px] font-bold uppercase tracking-widest text-[#4A5A6E] mb-1'
const SECTION_VALUE_CLS = 'text-[13px] text-[#3d3529] leading-snug'

/**
 * CurriculumSummaryCard — read-only card showing curriculum row data for the
 * selected subtopic. Renders nothing when subtopicRow is null.
 *
 * Props:
 *   subtopicRow: CBCSubtopicRow | OldSubtopicRow | null
 *   curriculumMode: 'cbc' | 'previous' | null
 *   selectedOutcomes: string[] — outcomes to highlight (Previous mode only)
 */
export function CurriculumSummaryCard({ subtopicRow, curriculumMode, selectedOutcomes = [], embedded = false }) {
  if (!subtopicRow) return null

  return (
    <div className={[embedded ? '' : 'mx-4 mb-4', 'rounded-2xl bg-[#FFF4E8] p-4 lps-soft-shadow lps-section-enter'].join(' ')}>
      {/* Card header */}
      <div className="mb-3 flex items-center gap-2">
        <span className="grid h-6 w-6 flex-shrink-0 place-items-center rounded-lg border border-[#0F1B2D] bg-[#D97757] text-white" aria-hidden="true">
          <Sparkles size={13} />
        </span>
        <p className="text-[12px] font-semibold text-[#3d3529]">Curriculum Summary</p>
        <span className="ml-auto rounded-md bg-white/70 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide text-indigo-600">
          Auto-filled
        </span>
      </div>

      {curriculumMode === 'cbc' && (
        <div className="space-y-3">
          {/* Specific Competence */}
          <div>
            <span className={SECTION_LABEL_CLS}>Specific Competence</span>
            <p className={SECTION_VALUE_CLS}>{subtopicRow.specificCompetence}</p>
          </div>

          {/* Learning Activities */}
          <div>
            <span className={SECTION_LABEL_CLS}>Learning Activities</span>
            <div className="flex flex-wrap gap-1 mt-1">
              {(subtopicRow.learningActivities ?? []).map((activity) => (
                <ActivityChip key={activity} label={activity} />
              ))}
            </div>
          </div>

          {/* Expected Standard */}
          <div>
            <span className={SECTION_LABEL_CLS}>Expected Standard</span>
            <p className={SECTION_VALUE_CLS}>{subtopicRow.expectedStandard}</p>
          </div>
        </div>
      )}

      {curriculumMode === 'previous' && (
        <div>
          <span className={SECTION_LABEL_CLS}>Specific Outcomes</span>
          <div className="mt-1 space-y-1">
            {(subtopicRow.specificOutcomes ?? []).map((outcome) => {
              const highlighted = selectedOutcomes.includes(outcome)
              return (
                <p
                  key={outcome}
                  className={[
                    'rounded text-[13px] text-[#3d3529] leading-snug px-2 py-0.5',
                    highlighted
                      ? 'border-l-4 border-blue-400 bg-blue-50'
                      : '',
                  ].join(' ')}
                >
                  {outcome}
                </p>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
