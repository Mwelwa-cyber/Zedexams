/**
 * StudioCurriculumSelector — the platform-standard curriculum picker.
 *
 * Presents the SAME workflow the Lesson Plan Studio pioneered — a CBC vs
 * Previous curriculum-type choice, then a cascade grade → subject → topic →
 * subtopic where every level only offers options valid for the prior choice —
 * and drops into any teacher studio as a single controlled component.
 *
 * It reuses the Lesson Plan Studio's own primitives (the CurriculumPicker cards,
 * the four syllabi-backed data hooks and the curriculumDataService data layer),
 * so there is ONE curriculum source (the Syllabus Studio / merged syllabi) and
 * no duplicated curriculum database. The reference studio's files are NOT
 * modified — this component imports the shared pieces and re-implements only the
 * cascade/reset glue (copied into curriculumSelectorConstants.js) so the
 * reference stays byte-for-byte intact.
 *
 * The component owns its own state and emits the full selection on every change
 * via onChange(payload). Hosts keep the payload and, at generate time, spread
 * the server-ready fields (grade/subject/curriculum/framework) straight into
 * their existing Cloud Function call.
 *
 * Props:
 *   value              optional loose seed — deep link / Teaching-Kit handoff /
 *                      edited record. Read once on mount and normalized via
 *                      normalizeSelectorSeed, so legacy shapes (grade 'G5',
 *                      subject slug 'mathematics', framework '2013') seed
 *                      correctly. A seeded subject slug is resolved against the
 *                      loaded syllabi keys once they arrive.
 *   onChange(payload)  fired on any change with the payload documented below.
 *   showTopicSubtopic  default true; false for roster/marks tools (Class
 *                      Register, Mark Schedule) that stop at subject.
 *   showSubject        default true; false for tools where the subject list
 *                      lives elsewhere (Mark Schedule's per-column subjects)
 *                      — the cascade then stops at grade.
 *   showSpecificOutcome default false; true adds a per-outcome dropdown under
 *                      the subtopic where EACH specific outcome is
 *                      independently selectable (selecting one never selects
 *                      its siblings). '' = whole subtopic.
 *   showCurriculumPicker default true.
 *   curriculumPickerVariant  'cards' (default — the reference two-card
 *                      picker) or 'segmented' (the compact CurriculumToggle
 *                      row used by generator studios).
 *   defaultCurriculumMode  optional 'cbc'|'previous' applied when the seed
 *                      carries no curriculum — generator studios pass 'cbc'
 *                      so the cascade is live immediately instead of a
 *                      chain of disabled "Choose a curriculum first…"
 *                      dropdowns.
 *   gradeFieldLabel / subjectFieldLabel  optional label text overrides for the
 *                      two cascade fields (e.g. the Teaching Profile's
 *                      "Grade or Form") — the cascade behaviour is identical.
 *   gradeOptions       optional [{group, value, label}] override. When given,
 *                      this exact list is offered for BOTH curricula (no
 *                      syllabi-availability filtering, no validity clearing) —
 *                      for tools whose grade set is their own data model (the
 *                      Class Register's Baby/Middle classes) rather than the
 *                      syllabi's.
 *   subjectFallback    optional string[] offered when the syllabi have no
 *                      subjects for the chosen grade — keeps roster tools
 *                      usable for classes the syllabi don't cover.
 *   disabled           default false.
 *   className / labelClassName / inputClassName  theming hooks.
 *
 * onChange payload:
 *   {
 *     curriculumMode: 'cbc'|'previous'|null,
 *     framework: '2023'|'2013',
 *     curriculum: 'cbc'|'previous',
 *     gradeLabel, subjectKey, subjectLabel, topic, subtopic,
 *     subtopicRow,                 // CBC {specificCompetence,…}|Previous {specificOutcomes[]}
 *     specificOutcome,             // '' or the single independently-chosen outcome
 *                                  // (only user-settable when showSpecificOutcome)
 *     grade, subject,              // server-ready shapes (G5 / mathematics)
 *   }
 */

import { useEffect, useId, useRef, useState } from 'react'
import { CurriculumPicker } from '../studio/sections/CurriculumPicker.jsx'
import CurriculumToggle from './CurriculumToggle.jsx'
import { useAvailableGrades } from '../studio/hooks/useAvailableGrades.js'
import { useSubjectsForGrade } from '../studio/hooks/useSubjectsForGrade.js'
import { useSubjectTopics } from '../studio/hooks/useSubjectTopics.js'
import { useSubtopicDetail } from '../studio/hooks/useSubtopicDetail.js'
import { cleanSubjectName } from '../studio/utils/subjectName.js'
import { splitSpecificOutcomes } from '../../../utils/curriculum2013Parser.js'
import {
  gradeListFor,
  gradeValuesFor,
  groupedGrades,
  normalizeSelectorSeed,
  selectorPayloadToServerInputs,
  subjectSlugOf,
} from './curriculumSelectorConstants.js'
// The CurriculumPicker cards use `.lps-*` classes; importing the reference CSS
// once makes them styled wherever this shared component is mounted.
import '../studio/lessonStudio.css'

export default function StudioCurriculumSelector({
  value = null,
  onChange,
  showTopicSubtopic = true,
  showSubject = true,
  showSpecificOutcome = false,
  showCurriculumPicker = true,
  curriculumPickerVariant = 'cards',
  defaultCurriculumMode = null,
  gradeOptions = null,
  subjectFallback = null,
  disabled = false,
  className = '',
  labelClassName = 'studio-label',
  inputClassName = 'studio-input',
  gradeFieldLabel = 'Class / Grade',
  subjectFieldLabel = 'Subject',
}) {
  const uid = useId()
  // Normalize the loose seed once (state initializers run only on mount).
  const [seed] = useState(() => normalizeSelectorSeed(value))
  const [curriculumMode, setCurriculumMode] = useState(seed.curriculumMode || defaultCurriculumMode)
  const [gradeLabel, setGradeLabel] = useState(seed.gradeLabel)
  const [subjectKey, setSubjectKey] = useState(seed.subjectKey)
  const [topic, setTopic] = useState(seed.topic)
  const [subtopic, setSubtopic] = useState(seed.subtopic)
  // Independent specific-outcome selection (opt-in via showSpecificOutcome).
  // Selecting one outcome never selects its siblings — the value is the single
  // chosen outcome string; '' means "whole subtopic" (the legacy behaviour).
  const [specificOutcome, setSpecificOutcome] = useState('')

  const hasCustomGrades = Array.isArray(gradeOptions) && gradeOptions.length > 0

  // Grades that actually resolve to subjects for this curriculum (data-driven,
  // so a grade with no syllabus data is never offered — matches the reference).
  // Skipped entirely when the host supplies its own grade list.
  const candidateGradeValues = !hasCustomGrades && curriculumMode
    ? gradeListFor(curriculumMode).map((g) => g.value)
    : []
  const { available: availableGrades, loading: gradesLoading } = useAvailableGrades(
    candidateGradeValues,
    curriculumMode,
  )
  // Treat an EMPTY availability list the same as "unknown": the data layer
  // swallows fetch failures into an empty syllabi object, so [] can mean "the
  // syllabi failed to load" — never empty the picker (or clear a selection)
  // on what may be a transient failure. A curriculum with genuinely zero
  // grades would be a data emergency where the full list is the safer offer.
  const gradesKnown = Array.isArray(availableGrades) && availableGrades.length > 0

  const { subjects, loading: subjectsLoading } = useSubjectsForGrade(gradeLabel, curriculumMode)
  const { topics, loading: topicsLoading, error: topicsError } = useSubjectTopics(
    subjectKey,
    gradeLabel,
    curriculumMode,
  )
  const { subtopicRow } = useSubtopicDetail(
    subjectKey,
    gradeLabel,
    topic,
    subtopic,
    curriculumMode,
  )

  // Syllabi empty for this grade → offer the host's fallback subjects (roster
  // tools cover classes the syllabi don't). Values pass through unchanged.
  const usingFallbackSubjects = Boolean(
    subjectFallback && subjectFallback.length > 0 &&
    gradeLabel && !subjectsLoading && subjects.length === 0,
  )
  const subjectOptions = usingFallbackSubjects ? subjectFallback : subjects

  // ── Cascading resets: changing a level clears everything below it ──────────
  function chooseCurriculum(mode) {
    if (mode === curriculumMode) return
    setCurriculumMode(mode)
    setGradeLabel('')
    setSubjectKey('')
    setTopic('')
    setSubtopic('')
    setSpecificOutcome('')
  }
  function chooseGrade(v) {
    setGradeLabel(v)
    setSubjectKey('')
    setTopic('')
    setSubtopic('')
    setSpecificOutcome('')
  }
  function chooseSubject(v) {
    setSubjectKey(v)
    setTopic('')
    setSubtopic('')
    setSpecificOutcome('')
  }
  function chooseTopic(v) {
    setTopic(v)
    setSubtopic('')
    setSpecificOutcome('')
  }
  function chooseSubtopic(v) {
    setSubtopic(v)
    setSpecificOutcome('')
  }

  // Clear a grade that isn't valid for the active curriculum's grade list
  // (guards a seeded mode/grade mismatch). Hosts with a custom grade list own
  // their values for both curricula, so this check doesn't apply there.
  useEffect(() => {
    if (!curriculumMode || hasCustomGrades) return
    if (gradeLabel && !gradeValuesFor(curriculumMode).has(gradeLabel)) {
      setGradeLabel('')
      setSubjectKey('')
      setTopic('')
      setSubtopic('')
    }
  }, [curriculumMode, gradeLabel, hasCustomGrades])

  // Clear a grade that resolves to no subjects once availability is KNOWN
  // (non-empty — see gradesKnown above for why [] doesn't count).
  useEffect(() => {
    if (!gradesKnown || hasCustomGrades) return
    if (gradeLabel && !availableGrades.includes(gradeLabel)) {
      setGradeLabel('')
      setSubjectKey('')
      setTopic('')
      setSubtopic('')
    }
  }, [availableGrades, gradesKnown, gradeLabel, hasCustomGrades])

  // Reconcile the subject against the loaded list. A seeded subject may be a
  // canonical slug ('mathematics' from a legacy deep link) or a stale key from
  // another grade: try to resolve it to the matching syllabi key by slug
  // before clearing, so old links and edited records land on the right option
  // instead of dead-ending.
  useEffect(() => {
    if (!subjectKey || subjectsLoading || subjects.length === 0) return
    if (subjects.includes(subjectKey)) return
    const slug = subjectSlugOf(subjectKey)
    const match = subjects.find((s) => subjectSlugOf(s) === slug)
    if (match) {
      setSubjectKey(match)
    } else if (!usingFallbackSubjects) {
      setSubjectKey('')
      setTopic('')
      setSubtopic('')
    }
  }, [subjects, subjectsLoading, subjectKey, usingFallbackSubjects])

  // ── Emit the full selection on any change ─────────────────────────────────
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange
  useEffect(() => {
    const server = selectorPayloadToServerInputs({
      curriculumMode,
      gradeLabel,
      subjectKey,
      topic,
      subtopic,
    })
    onChangeRef.current?.({
      curriculumMode,
      framework: server.framework,
      curriculum: server.curriculum,
      gradeLabel,
      subjectKey,
      subjectLabel: server.subjectLabel,
      topic,
      subtopic,
      subtopicRow: subtopicRow ?? null,
      specificOutcome: specificOutcome || '',
      grade: server.grade,
      subject: server.subject,
    })
  }, [curriculumMode, gradeLabel, subjectKey, topic, subtopic, subtopicRow, specificOutcome])

  // Grades to render: the host's own list verbatim, or the curriculum's list
  // filtered to grades with data once availability is known (falling back to
  // the full candidate list until then / on a failed load).
  const gradeList = hasCustomGrades
    ? gradeOptions
    : gradesKnown
      ? gradeListFor(curriculumMode).filter((g) => availableGrades.includes(g.value))
      : gradeListFor(curriculumMode)
  const grouped = groupedGrades(gradeList)

  const selectedTopicObj = topics.find((t) => t.label === topic) ?? null

  // Per-outcome options for the selected subtopic. 2013 rows carry an already-
  // split specificOutcomes[]; CBC rows carry a specificCompetence string that
  // can itself hold several coded competences (the ECE sheets join
  // "0.1.1.6.1 Name… 0.1.1.6.2 Use…") — split so each is its own option.
  const outcomeOptions = !subtopicRow
    ? []
    : Array.isArray(subtopicRow.specificOutcomes)
      ? subtopicRow.specificOutcomes.filter(Boolean)
      : subtopicRow.specificCompetence
        ? splitSpecificOutcomes(subtopicRow.specificCompetence)
            .map((o) => (o.code ? `${o.code} ${o.statement}` : o.statement))
            .filter(Boolean)
        : []

  const cascadeDisabled = disabled || !curriculumMode
  const subjectDisabled = cascadeDisabled || !gradeLabel || subjectsLoading
  const topicDisabled = cascadeDisabled || !subjectKey || topicsLoading

  let topicPlaceholder = 'Select topic…'
  if (topicsLoading) topicPlaceholder = 'Loading topics…'
  else if (topicsError) topicPlaceholder = `Error: ${topicsError}`

  return (
    <div className={`space-y-4 ${className}`.trim()}>
      {showCurriculumPicker && curriculumPickerVariant === 'segmented' && (
        <CurriculumToggle
          value={curriculumMode}
          onSelect={chooseCurriculum}
          disabled={disabled}
        />
      )}
      {showCurriculumPicker && curriculumPickerVariant !== 'segmented' && (
        <div className="overflow-hidden rounded-2xl border border-[#e5ddd0]">
          <CurriculumPicker
            curriculumMode={curriculumMode}
            onSelect={disabled ? () => {} : chooseCurriculum}
          />
        </div>
      )}

      {/* Grade */}
      <div>
        <label htmlFor={`${uid}-grade`} className={labelClassName}>{gradeFieldLabel}</label>
        <select
          id={`${uid}-grade`}
          className={inputClassName}
          value={gradeLabel}
          onChange={(e) => chooseGrade(e.target.value)}
          disabled={cascadeDisabled}
        >
          <option value="">
            {!curriculumMode
              ? 'Choose a curriculum first…'
              : gradesLoading && !gradesKnown
                ? 'Loading classes…'
                : 'Select class…'}
          </option>
          {[...grouped.entries()].map(([groupLabel, items]) => (
            <optgroup key={groupLabel} label={groupLabel}>
              {items.map((g) => (
                <option key={g.value} value={g.value}>{g.label}</option>
              ))}
            </optgroup>
          ))}
        </select>
      </div>

      {/* Subject */}
      {showSubject && (
      <div>
        <label htmlFor={`${uid}-subject`} className={labelClassName}>{subjectFieldLabel}</label>
        <select
          id={`${uid}-subject`}
          className={inputClassName}
          value={subjectKey}
          onChange={(e) => chooseSubject(e.target.value)}
          disabled={subjectDisabled || (subjectOptions.length === 0 && !subjectsLoading)}
        >
          <option value="">
            {!gradeLabel
              ? 'Select a class first…'
              : subjectsLoading
                ? 'Loading subjects…'
                : subjectOptions.length === 0
                  ? 'No subjects for this class yet'
                  : 'Select subject…'}
          </option>
          {subjectOptions.map((s) => (
            <option key={s} value={s}>{cleanSubjectName(s)}</option>
          ))}
        </select>
        {/* Configured-empty state: never silently fall back to a generic
            all-subjects list — tell the teacher, and give admins the exact
            curriculum + grade coordinates to check in the Syllabus Studio. */}
        {gradeLabel && !subjectsLoading && subjectOptions.length === 0 && (
          <p role="status" className="mt-1 text-sm text-amber-700">
            No subjects have been configured for this curriculum and grade.
            <span className="block text-xs opacity-80">
              Administrators: check the syllabus catalog for curriculum “{curriculumMode || 'none'}”, grade “{gradeLabel}”.
            </span>
          </p>
        )}
      </div>
      )}

      {showTopicSubtopic && (
        <>
          {/* Topic */}
          <div>
            <label htmlFor={`${uid}-topic`} className={labelClassName}>Topic</label>
            <select
              id={`${uid}-topic`}
              className={inputClassName}
              value={topic}
              onChange={(e) => chooseTopic(e.target.value)}
              disabled={topicDisabled}
            >
              <option value="">{!subjectKey ? 'Select a subject first…' : topicPlaceholder}</option>
              {!topicsLoading && !topicsError &&
                topics.map((t) => (
                  <option key={t.label} value={t.label}>{t.label}</option>
                ))}
            </select>
          </div>

          {/* Subtopic */}
          <div>
            <label htmlFor={`${uid}-subtopic`} className={labelClassName}>Subtopic</label>
            <select
              id={`${uid}-subtopic`}
              className={inputClassName}
              value={subtopic}
              onChange={(e) => chooseSubtopic(e.target.value)}
              disabled={cascadeDisabled || !selectedTopicObj}
            >
              <option value="">
                {!topic ? 'Select a topic first…' : 'Select subtopic…'}
              </option>
              {selectedTopicObj &&
                selectedTopicObj.subtopics.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
            </select>
          </div>

          {/* Specific outcome (opt-in): each outcome from the selected subtopic
              is independently selectable — choosing one never selects its
              siblings. '' = the whole subtopic (legacy behaviour preserved). */}
          {showSpecificOutcome && (
            <div>
              <label htmlFor={`${uid}-outcome`} className={labelClassName}>Specific outcome</label>
              <select
                id={`${uid}-outcome`}
                className={inputClassName}
                value={specificOutcome}
                onChange={(e) => setSpecificOutcome(e.target.value)}
                disabled={cascadeDisabled || !subtopic || outcomeOptions.length === 0}
              >
                <option value="">
                  {!subtopic
                    ? 'Select a subtopic first…'
                    : outcomeOptions.length === 0
                      ? 'No listed outcomes — whole subtopic'
                      : 'All outcomes for this subtopic'}
                </option>
                {outcomeOptions.map((o) => (
                  <option key={o} value={o}>{o}</option>
                ))}
              </select>
            </div>
          )}
        </>
      )}
    </div>
  )
}
