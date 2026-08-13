import { Pencil, Eye } from 'lucide-react'
import { cleanSubjectName } from '../../../../../components/teacher/studio/utils/subjectName.js'
import { SCHOOL_RESOURCE_LEVELS } from '../../../../../config/schoolResources.js'
import {
  OPTIONAL_SECTION_LABELS,
  PAGE_BUDGET_LABELS,
  WRITING_STYLE_LABELS,
} from '../../../../../utils/lessonPlanFormat.js'

const FORMAT_LABELS = { modern: 'Modern Clean', classic: 'Classic', official: 'Official CBC' }
const CURRICULUM_LABELS = {
  cbc: 'CBC — Competency-Based Curriculum',
  previous: 'Previous Curriculum — Outcomes-Based',
}
const ADVANCED_LABELS = {
  compactMetadata: 'Compact metadata layout',
  includeEnrolment: 'Enrolment row',
  includeAttendance: 'Attendance row',
  autoIllustrations: 'Auto AI illustrations',
  localLanguage: 'Written in local language',
}

function resourceLabel(value) {
  return SCHOOL_RESOURCE_LEVELS.find((l) => l.value === value)?.label ?? value ?? '—'
}

function Row({ label, value }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1">
      <dt className="flex-shrink-0 text-[11px] font-bold uppercase tracking-wider text-ink-muted">{label}</dt>
      <dd className="min-w-0 text-right text-[13px] font-semibold leading-snug text-ink">{value || '—'}</dd>
    </div>
  )
}

function Section({ title, stepIndex, onEditStep, children }) {
  return (
    <section className="rounded-2xl border-2 border-card-border bg-card p-4 shadow-[0_2px_0_var(--zt-card-border)]">
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <h3 className="lps-eyebrow">{title}</h3>
        <button
          type="button"
          onClick={() => onEditStep(stepIndex)}
          aria-label={`Edit ${title}`}
          className="inline-flex min-h-[36px] items-center gap-1.5 rounded-lg px-2.5 py-1 text-[12px] font-bold text-accent-text hover:bg-accent-tint"
        >
          <Pencil size={14} aria-hidden="true" />
          Edit
        </button>
      </div>
      <dl>{children}</dl>
    </section>
  )
}

/**
 * Step 5 — Review & Generate.
 *
 * A compact, grouped summary of every choice with per-section Edit links that
 * jump back to the owning step (all other values are kept — the draft is the
 * single source of truth). The Generate action itself lives in the sticky
 * wizard navigation, so it appears exactly once, on this step only.
 *
 * Props:
 *   studioState : full useStudioState() value (read-only here)
 *   onEditStep  : (stepIndex) => void
 *   hasPlan     : boolean — a plan exists OR a generation is in flight/failed
 *   onViewPlan  : () => void — reopen the document canvas view
 */
export function ReviewGenerateStep({ studioState, onEditStep, hasPlan = false, onViewPlan }) {
  const generating = studioState.generationStatus === 'loading'
  const {
    curriculumMode,
    lessonDetails,
    topicData,
    selectedOutcomes,
    learningEnvironments,
    lessonSeries,
    lessonBreakdown,
    formatOptions,
  } = studioState

  const planningMode = lessonSeries?.planningMode ?? 'single'
  const advancedOn = Object.entries(formatOptions.advanced ?? {})
    .filter(([, v]) => v === true)
    .map(([k]) => ADVANCED_LABELS[k] ?? k)
  // §2.4 — name the sections the teacher switched OFF, not the ones left on.
  // A list of everything included is noise; a list of what is missing is the
  // thing a teacher wants to check before submitting the plan.
  const sectionsOff = Object.entries(formatOptions.sections ?? {})
    .filter(([, v]) => v === false)
    .map(([k]) => OPTIONAL_SECTION_LABELS[k] ?? k)

  return (
    <div className="space-y-3.5">
      {hasPlan && (
        <button
          type="button"
          onClick={onViewPlan}
          className="lps-btn-ghost w-full min-h-[48px] px-4 text-[13px]"
        >
          <Eye size={18} aria-hidden="true" />
          {generating ? 'View generation progress' : 'View the plan you already generated'}
        </button>
      )}

      <Section title="Lesson Setup" stepIndex={0} onEditStep={onEditStep}>
        <Row label="Curriculum" value={CURRICULUM_LABELS[curriculumMode] ?? '—'} />
        <Row label="Class" value={lessonDetails.grade} />
        <Row label="Subject" value={cleanSubjectName(lessonDetails.subject)} />
        <Row label="Duration" value={lessonDetails.duration ? `${lessonDetails.duration} minutes` : ''} />
        <Row label="Date" value={lessonDetails.date} />
        <Row label="Time" value={lessonDetails.time || 'Not set'} />
        <Row label="Teacher" value={lessonDetails.teacherName} />
        <Row label="School" value={lessonDetails.school} />
        <Row label="School resources" value={resourceLabel(lessonDetails.resources)} />
      </Section>

      <Section title="Topic & Curriculum" stepIndex={1} onEditStep={onEditStep}>
        <Row label="Topic" value={topicData.topic} />
        <Row label="Subtopic" value={topicData.subtopic} />
        {curriculumMode === 'cbc' && (
          <Row label="Specific competence" value={topicData.subtopicRow?.specificCompetence} />
        )}
        {curriculumMode === 'previous' && (
          <Row
            label="Specific outcomes"
            value={selectedOutcomes.length ? `${selectedOutcomes.length} selected` : ''}
          />
        )}
      </Section>

      {curriculumMode === 'cbc' && (
        <Section title="Lesson Context" stepIndex={2} onEditStep={onEditStep}>
          <Row label="Learning environment" value={learningEnvironments.join(', ')} />
          <Row label="Planning mode" value={planningMode === 'series' ? 'Lesson Series' : 'Single Lesson'} />
          {planningMode === 'single' && (
            <Row label="Lesson focus" value={lessonSeries?.lessonFocus?.trim() || 'Not set'} />
          )}
          {planningMode === 'series' && (
            <Row label="Lessons in series" value={String(lessonBreakdown?.length ?? 0)} />
          )}
        </Section>
      )}

      <Section title="Format & Options" stepIndex={3} onEditStep={onEditStep}>
        <Row label="Page budget" value={PAGE_BUDGET_LABELS[formatOptions.pageBudget] ?? formatOptions.pageBudget} />
        <Row label="Writing style" value={WRITING_STYLE_LABELS[formatOptions.writingStyle] ?? formatOptions.writingStyle} />
        <Row label="Format" value={FORMAT_LABELS[formatOptions.format] ?? formatOptions.format} />
        <Row label="Margins" value={formatOptions.marginMm ? `${formatOptions.marginMm} mm` : ''} />
        <Row label="Medium" value={lessonDetails.medium || 'English'} />
        {sectionsOff.length > 0 && <Row label="Sections off" value={sectionsOff.join(', ')} />}
        {advancedOn.length > 0 && <Row label="Advanced" value={advancedOn.join(', ')} />}
      </Section>
    </div>
  )
}
