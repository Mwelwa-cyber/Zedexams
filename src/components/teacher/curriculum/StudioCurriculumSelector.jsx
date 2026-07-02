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
 *   value              optional initial seed { curriculumMode, gradeLabel,
 *                      subjectKey, topic, subtopic } — used for deep-link /
 *                      Teaching-Kit prefill (read once on mount).
 *   onChange(payload)  fired on any change with the payload documented below.
 *   showTopicSubtopic  default true; false for roster/marks tools (Class
 *                      Register, Mark Schedule) that stop at subject.
 *   showCurriculumPicker default true.
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
 *     grade, subject,              // server-ready shapes (G5 / mathematics)
 *   }
 */

import { useEffect, useId, useRef, useState } from 'react'
import { CurriculumPicker } from '../studio/sections/CurriculumPicker.jsx'
import { useAvailableGrades } from '../studio/hooks/useAvailableGrades.js'
import { useSubjectsForGrade } from '../studio/hooks/useSubjectsForGrade.js'
import { useSubjectTopics } from '../studio/hooks/useSubjectTopics.js'
import { useSubtopicDetail } from '../studio/hooks/useSubtopicDetail.js'
import { cleanSubjectName } from '../studio/utils/subjectName.js'
import {
  gradeListFor,
  gradeValuesFor,
  groupedGrades,
  selectorPayloadToServerInputs,
} from './curriculumSelectorConstants.js'
// The CurriculumPicker cards use `.lps-*` classes; importing the reference CSS
// once makes them styled wherever this shared component is mounted.
import '../studio/lessonStudio.css'

export default function StudioCurriculumSelector({
  value = null,
  onChange,
  showTopicSubtopic = true,
  showCurriculumPicker = true,
  disabled = false,
  className = '',
  labelClassName = 'studio-label',
  inputClassName = 'studio-input',
}) {
  const uid = useId()
  const seed = value || {}
  const [curriculumMode, setCurriculumMode] = useState(seed.curriculumMode ?? null)
  const [gradeLabel, setGradeLabel] = useState(seed.gradeLabel ?? '')
  const [subjectKey, setSubjectKey] = useState(seed.subjectKey ?? '')
  const [topic, setTopic] = useState(seed.topic ?? '')
  const [subtopic, setSubtopic] = useState(seed.subtopic ?? '')

  // Grades that actually resolve to subjects for this curriculum (data-driven,
  // so a grade with no syllabus data is never offered — matches the reference).
  const candidateGradeValues = curriculumMode
    ? gradeListFor(curriculumMode).map((g) => g.value)
    : []
  const { available: availableGrades, loading: gradesLoading } = useAvailableGrades(
    candidateGradeValues,
    curriculumMode,
  )
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

  // ── Cascading resets: changing a level clears everything below it ──────────
  function chooseCurriculum(mode) {
    if (mode === curriculumMode) return
    setCurriculumMode(mode)
    setGradeLabel('')
    setSubjectKey('')
    setTopic('')
    setSubtopic('')
  }
  function chooseGrade(v) {
    setGradeLabel(v)
    setSubjectKey('')
    setTopic('')
    setSubtopic('')
  }
  function chooseSubject(v) {
    setSubjectKey(v)
    setTopic('')
    setSubtopic('')
  }
  function chooseTopic(v) {
    setTopic(v)
    setSubtopic('')
  }

  // Clear a grade that isn't valid for the active curriculum's grade list
  // (guards a seeded mode/grade mismatch).
  useEffect(() => {
    if (!curriculumMode) return
    if (gradeLabel && !gradeValuesFor(curriculumMode).has(gradeLabel)) {
      setGradeLabel('')
      setSubjectKey('')
      setTopic('')
      setSubtopic('')
    }
  }, [curriculumMode, gradeLabel])

  // Clear a grade that resolves to no subjects once availability is known.
  useEffect(() => {
    if (!availableGrades) return
    if (gradeLabel && !availableGrades.includes(gradeLabel)) {
      setGradeLabel('')
      setSubjectKey('')
      setTopic('')
      setSubtopic('')
    }
  }, [availableGrades, gradeLabel])

  // Clear a subject that's no longer offered for the current grade.
  useEffect(() => {
    if (subjectKey && !subjectsLoading && subjects.length > 0 && !subjects.includes(subjectKey)) {
      setSubjectKey('')
      setTopic('')
      setSubtopic('')
    }
  }, [subjects, subjectsLoading, subjectKey])

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
      grade: server.grade,
      subject: server.subject,
    })
  }, [curriculumMode, gradeLabel, subjectKey, topic, subtopic, subtopicRow])

  // Grades to render: only those with data once availability resolves; until
  // then (or on a load failure → null) fall back to the full candidate list.
  const gradeList = availableGrades
    ? gradeListFor(curriculumMode).filter((g) => availableGrades.includes(g.value))
    : gradeListFor(curriculumMode)
  const grouped = groupedGrades(gradeList)

  const selectedTopicObj = topics.find((t) => t.label === topic) ?? null

  const cascadeDisabled = disabled || !curriculumMode
  const subjectDisabled = cascadeDisabled || !gradeLabel || subjectsLoading
  const topicDisabled = cascadeDisabled || !subjectKey || topicsLoading

  let topicPlaceholder = 'Select topic…'
  if (topicsLoading) topicPlaceholder = 'Loading topics…'
  else if (topicsError) topicPlaceholder = `Error: ${topicsError}`

  return (
    <div className={`space-y-4 ${className}`.trim()}>
      {showCurriculumPicker && (
        <div className="overflow-hidden rounded-2xl border border-[#e5ddd0]">
          <CurriculumPicker
            curriculumMode={curriculumMode}
            onSelect={disabled ? () => {} : chooseCurriculum}
          />
        </div>
      )}

      {/* Grade */}
      <div>
        <label htmlFor={`${uid}-grade`} className={labelClassName}>Class / Grade</label>
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
              : gradesLoading && !availableGrades
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
      <div>
        <label htmlFor={`${uid}-subject`} className={labelClassName}>Subject</label>
        <select
          id={`${uid}-subject`}
          className={inputClassName}
          value={subjectKey}
          onChange={(e) => chooseSubject(e.target.value)}
          disabled={subjectDisabled}
        >
          <option value="">
            {!gradeLabel
              ? 'Select a class first…'
              : subjectsLoading
                ? 'Loading subjects…'
                : subjects.length === 0
                  ? 'No subjects for this class yet'
                  : 'Select subject…'}
          </option>
          {subjects.map((s) => (
            <option key={s} value={s}>{cleanSubjectName(s)}</option>
          ))}
        </select>
      </div>

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
              onChange={(e) => setSubtopic(e.target.value)}
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
        </>
      )}
    </div>
  )
}
