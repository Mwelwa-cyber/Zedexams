import { useState } from 'react'
import { Target } from '../../../../shared/components/icons'

/**
 * SpecificOutcomeForm — collapsible sidebar section for selecting specific
 * outcomes when using the previous curriculum mode.
 *
 * Only rendered when curriculumMode === 'previous'.
 *
 * Props:
 *   subtopicRow: OldSubtopicRow | null   — { specificOutcomes: string[] }
 *   selectedOutcomes: string[]           — currently selected outcomes
 *   onToggleOutcome: (outcome: string) => void  — add if not in list, remove if already in
 *   disabled: boolean
 *   embedded: boolean — wizard mode: body only, no collapsible section chrome
 */
export function SpecificOutcomeForm({ subtopicRow, selectedOutcomes, onToggleOutcome, disabled, embedded = false }) {
  const [open, setOpen] = useState(true)

  const outcomes = subtopicRow?.specificOutcomes ?? []
  const hasOutcomes = outcomes.length > 0
  const isDone = selectedOutcomes.length > 0

  return (
    <div
      className={[
        embedded ? '' : 'border-b border-[#e5ddd0]',
        disabled ? 'pointer-events-none opacity-50' : '',
      ].join(' ')}
    >
      {/* Section header — always visible (hidden in embedded wizard mode) */}
      {!embedded && (
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between px-4 py-3 text-left"
        aria-expanded={open}
        disabled={disabled}
      >
        <span className="flex items-center gap-2 text-[13px] font-semibold text-[#3d3529]">
          {/* Status dot */}
          <span
            className={[
              'inline-block h-2 w-2 rounded-full flex-shrink-0',
              isDone ? 'bg-green-500' : 'bg-[#c9c0b0]',
            ].join(' ')}
            aria-hidden="true"
          />
          <Target size={15} className="text-[#a99e8b]" aria-hidden="true" />
          Specific Outcome
        </span>

        {/* Chevron */}
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className={[
            'text-[#a39d8e] transition-transform',
            open ? 'rotate-180' : '',
          ].join(' ')}
          aria-hidden="true"
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>
      )}

      {/* Collapsible body */}
      {(open || embedded) && (
        <div className={embedded ? 'space-y-2' : 'px-4 pb-4 space-y-2'} id="sof-outcomes">
          {!hasOutcomes ? (
            <p className="text-[12px] text-[#a39d8e] italic">
              Select a subtopic to see specific outcomes.
            </p>
          ) : (
            <>
              <div className="flex flex-col gap-2">
                {outcomes.map((outcome) => {
                  const isSelected = selectedOutcomes.includes(outcome)
                  return (
                    <button
                      key={outcome}
                      type="button"
                      onClick={() => onToggleOutcome(outcome)}
                      aria-pressed={isSelected}
                      className={[
                        'lps-lift w-full rounded-xl border px-3 py-2.5 text-left text-[12px] leading-snug transition-all',
                        isSelected
                          ? 'border-blue-500 bg-blue-50 text-blue-900 lps-card-glow'
                          : 'border-[#d9cfbe] bg-white text-[#3d3529] hover:bg-[#f9f5ef]',
                      ].join(' ')}
                    >
                      {outcome}
                    </button>
                  )
                })}
              </div>
              <p className="text-[11px] text-[#a39d8e]">
                Select one or more outcomes for this lesson.
              </p>
            </>
          )}
        </div>
      )}
    </div>
  )
}
