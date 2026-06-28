import { ActivityChip } from '../cards/ActivityChip.jsx'

const SECTION_LABEL_CLS = 'block text-[10px] font-bold uppercase tracking-widest text-[#a39d8e] mb-1'
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
export function CurriculumSummaryCard({ subtopicRow, curriculumMode, selectedOutcomes = [] }) {
  if (!subtopicRow) return null

  return (
    <div className="mx-4 mb-4 rounded-lg border border-amber-200 bg-amber-50 p-4">
      {/* Card header */}
      <p className="mb-3 text-[12px] font-semibold text-[#3d3529]">
        📋 Curriculum Summary
      </p>

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
