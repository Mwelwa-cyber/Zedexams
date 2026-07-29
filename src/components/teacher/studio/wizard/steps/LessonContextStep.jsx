import { Trees, School, Monitor, Check, Info } from 'lucide-react'
import { LessonProgressionForm } from '../../sections/LessonProgressionForm.jsx'

/**
 * Environment options — value is the short name stored in state (unchanged
 * from the pre-wizard studio, so saved drafts and the generation prompt keep
 * working); label/description/icon are presentation only.
 */
const ENVIRONMENTS = [
  {
    value: 'Natural',
    label: 'Natural Environment',
    description: 'Outdoors, field trips, community',
    Icon: Trees,
  },
  {
    value: 'Artificial',
    label: 'Artificial Environment',
    description: 'Classroom, lab, workshop',
    Icon: School,
  },
  {
    value: 'Technological',
    label: 'Technological Environment',
    description: 'Computer, TV, projector',
    Icon: Monitor,
  },
]

/**
 * EnvironmentCards — multi-select learning-environment cards (CBC only).
 * Same multi-select toggle semantics as the pre-wizard studio; Lucide icons
 * instead of emoji, selection shown by border + check glyph (never colour
 * alone).
 */
export function EnvironmentCards({ learningEnvironments = [], onToggle, disabled = false }) {
  return (
    <div className="space-y-2.5" role="group" aria-label="Learning environment">
      {ENVIRONMENTS.map(({ value, label, description, Icon }) => {
        const checked = learningEnvironments.includes(value)
        return (
          <button
            key={value}
            id={`lpw-env-${value.toLowerCase()}`}
            type="button"
            aria-pressed={checked}
            disabled={disabled}
            onClick={() => onToggle(value)}
            className={[
              'lps-lift flex w-full min-h-[56px] items-center gap-3 rounded-2xl border px-3.5 py-3 text-left transition-all',
              checked
                ? 'border-blue-500 bg-blue-50 lps-card-glow'
                : 'border-line bg-card hover:border-line hover:bg-surface',
            ].join(' ')}
          >
            <span
              className={[
                'grid h-10 w-10 flex-shrink-0 place-items-center rounded-xl',
                checked ? 'bg-blue-100 text-blue-600' : 'bg-surface text-ink-muted',
              ].join(' ')}
              aria-hidden="true"
            >
              <Icon size={20} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-[13px] font-bold text-ink">{label}</span>
              <span className="block text-[11.5px] text-ink-muted">{description}</span>
            </span>
            {checked && (
              <span
                className="grid h-5 w-5 flex-shrink-0 place-items-center rounded-full bg-blue-600 text-white"
                aria-hidden="true"
              >
                <Check size={12} strokeWidth={3} />
              </span>
            )}
          </button>
        )
      })}
    </div>
  )
}

/**
 * Step 3 — Lesson Context (CBC): learning environment(s) + planning mode
 * (Single Lesson / Lesson Series segmented control), lesson focus and the
 * series builder. Series-only fields stay hidden in Single Lesson mode
 * (handled inside LessonProgressionForm, unchanged).
 *
 * The Previous (Outcomes-Based) curriculum has no learning environments or
 * lesson series — it gets an explanatory card and the step is always valid.
 */
export function LessonContextStep({
  curriculumMode,
  learningEnvironments,
  onToggleEnvironment,
  lessonSeries,
  lessonBreakdown,
  subtopicRow,
  onUpdateSeries,
  onUpdateBreakdown,
  aiState,
}) {
  if (curriculumMode !== 'cbc') {
    return (
      <div className="flex items-start gap-3 rounded-2xl border-2 border-card-border bg-card p-4 shadow-[0_2px_0_var(--zt-card-border)]">
        <span className="grid h-9 w-9 flex-shrink-0 place-items-center rounded-xl bg-accent-tint text-accent-text" aria-hidden="true">
          <Info size={18} />
        </span>
        <p className="text-[13px] leading-relaxed text-ink">
          The Previous (Outcomes-Based) curriculum doesn&rsquo;t use learning
          environments or lesson series — there&rsquo;s nothing to set here.
          Continue to Format &amp; Options.
        </p>
      </div>
    )
  }

  const { recommendation, loading: aiLoading, error: aiError, fetchRecommendation } = aiState ?? {}

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border-2 border-card-border bg-card p-4 shadow-[0_2px_0_var(--zt-card-border)]">
        <p className="lps-eyebrow mb-2.5">Learning Environment</p>
        <EnvironmentCards
          learningEnvironments={learningEnvironments}
          onToggle={onToggleEnvironment}
          disabled={!subtopicRow}
        />
        {!subtopicRow && (
          <p className="mt-2 text-[11.5px] font-semibold text-ink-muted">
            Choose a topic and subtopic first.
          </p>
        )}
      </div>

      <div className="rounded-2xl border-2 border-card-border bg-card p-4 shadow-[0_2px_0_var(--zt-card-border)]">
        <p className="lps-eyebrow mb-2.5">Lesson Progression</p>
        <LessonProgressionForm
          embedded
          lessonSeries={lessonSeries}
          lessonBreakdown={lessonBreakdown}
          subtopicRow={subtopicRow}
          onUpdateSeries={onUpdateSeries}
          onUpdateBreakdown={onUpdateBreakdown}
          recommendation={recommendation}
          loading={aiLoading}
          error={aiError}
          onFetchRecommendation={fetchRecommendation}
        />
      </div>
    </div>
  )
}
