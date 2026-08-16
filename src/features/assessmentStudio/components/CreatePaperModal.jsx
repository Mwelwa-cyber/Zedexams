// "Create paper with AI" — full-paper generation inside the Test Paper
// Studio. Wraps the existing generateAssessment Cloud Function (which is
// grounded on the CBC knowledge base AND the Zambian assessment format
// profiles), then converts the returned paper into editable studio
// blocks via aiPaperToSections. The teacher reviews/edits before saving
// — nothing is auto-saved.

import { useEffect, useMemo, useState, useRef } from 'react'
import { generateAssessment, planAssessment } from '../../../utils/teacherTools'
import { normalizeChoiceCount } from '../../../utils/mcqChoices'
import { paywall } from '../../../engines/payment-engine/paywall'
import { useAuth } from '../../../contexts/AuthContext'
import { useGenerationGate } from '../../../hooks/useGenerationGate'
import { useAiOperationLock } from '../../../hooks/useAiOperationLock'
import { stableFingerprint } from '../../../hooks/aiOperationLockCore'
import { aiAssessmentToStudioBlocks } from '../../../utils/aiPaperToSections'
import {
  useSyllabusTopicOptions, useSyllabusSubjectOptions, useSyllabusLevelOptions,
} from '../../../shared/utils/syllabusTopicOptions'
import { CurriculumPicker } from '../../../shared/components/CurriculumPicker'
import '../../../shared/styles/lessonStudio.css'
import {
  ASSESSMENT_TYPES, TEST_ASSESSMENT_TYPES, EXAMINATION_ASSESSMENT_TYPES,
  isExaminationType, normalizeAssessmentType,
  paperGradeOptions, normalizePaperGrade, maxTopicsFor,
  isCumulativeType, toKbSubjectKey, studioGradeToKbGrade,
} from '../../../shared/utils/paperTaxonomy'
import { useAssessmentBand } from '../hooks/useAssessmentBand'
import LiveGenerationCanvas from '../../../shared/components/LiveGenerationCanvas'
import { FreePreviewUpsell } from '../../teacherPaywall'
import { capture } from '../../../utils/analytics'
import { resolveTeacherPlan, FREE_PREVIEW_LIMITS } from '../../../engines/payment-engine/teacherPlans'
import { QUESTION_ACTIVITIES, isLimitedSupport } from '../../../config/questionActivities'
import PaperPlanPanel from './PaperPlanPanel'
import { presetById } from '../lib/blueprintSummary'

// The chips are DERIVED from the activity registry (src/config/questionActivities.js)
// so the picker can never offer an activity the bands and the server do not both
// know, and so the label a teacher sees is always the educational activity name
// — "Tracing", "Circle the answer" — and never the internal fallback renderer
// ("Structured", "Multiple choice").
//
// `canonical` is the activity id sent to the generator; the server maps it to
// the render structure the schema validates. `key` is the human phrasing folded
// into the prompt text.
export const QUESTION_TYPE_OPTIONS = QUESTION_ACTIVITIES.map((a) => ({
  key: a.label.toLowerCase(),
  canonical: a.id,
  label: a.label,
  support: a.support,
  note: a.note || '',
}))

// The activity ids for the currently-selected chips, deduped. Sent as the
// teacher's request; the band narrows it server-side and the registry converts
// it to render types, so nothing here has to know either mapping.
function canonicalTypesFor(selectedKeys) {
  const out = []
  for (const k of selectedKeys) {
    const opt = QUESTION_TYPE_OPTIONS.find((o) => o.key === k)
    if (!opt) continue
    if (!out.includes(opt.canonical)) out.push(opt.canonical)
  }
  return out
}

// The opening selection for a fresh paper — a plain mixed test. Resolved from
// the chip list so it is always a set of real chip keys.
const DEFAULT_ACTIVITY_KEYS = ['multiple_choice', 'short_answer', 'structured']
  .map((id) => QUESTION_TYPE_OPTIONS.find((o) => o.canonical === id)?.key)
  .filter(Boolean)

const MARKS_OPTIONS = [5, 10, 15, 20, 30, 40, 50, 60, 80, 100]
const DURATION_OPTIONS = [15, 20, 30, 40, 60, 90, 120, 150, 180]

/**
 * The chips a band permits, in the declared order. The band is the ceiling: a
 * type it does not list is not offered at all, which is what stops Nursery
 * being asked for an essay and Form 4 being offered colouring. No rule about
 * WHICH types belong to a level lives here — that is the band document.
 */
function chipsForBand(band) {
  if (!band || !Array.isArray(band.questionTypes)) return QUESTION_TYPE_OPTIONS
  const permitted = new Set(band.questionTypes)
  return QUESTION_TYPE_OPTIONS.filter((o) => permitted.has(o.canonical))
}

// Modal form styling lives in studio/assessmentStudio.css under `.sv-cpm-*`
// (scoped to .studio-v2, using the design tokens directly — no inline objects).

// A scrollable list of tickable options — far faster than a drop-down when a
// teacher needs to pick several topics/sub-topics at once. Unchecked rows are
// disabled once `disabledMore` is set (e.g. the topic cap is reached) so the
// selection can't exceed the limit, while already-checked rows stay tickable
// so a teacher can swap one out.
function CheckboxList({ options, selected, onToggle, disabledMore = false }) {
  return (
    <div className="sv-cpm-checklist" role="group">
      {options.map((opt) => {
        const checked = selected.includes(opt)
        const disabled = !checked && disabledMore
        return (
          // Layout is set inline (not just via .sv-cpm-checkrow) so the
          // checkbox and its label always sit tight together: a fixed-size,
          // non-shrinking box + a flexing label. Relying on the scoped class
          // alone let ambient form CSS stretch the checkbox and shove the
          // topic text far to the right on desktop.
          <label key={opt}
            className="sv-cpm-checkrow"
            style={{
              display: 'flex', alignItems: 'flex-start', gap: 8,
              opacity: disabled ? 0.45 : 1,
              cursor: disabled ? 'not-allowed' : 'pointer',
            }}>
            <input type="checkbox" checked={checked} disabled={disabled}
              onChange={() => onToggle(opt)}
              style={{
                accentColor: 'var(--sv-primary)',
                width: 16, height: 16, flex: '0 0 auto', margin: '2px 0 0',
              }} />
            <span style={{ flex: '1 1 auto', minWidth: 0, fontSize: 13, color: 'var(--sv-text)' }}>{opt}</span>
          </label>
        )
      })}
    </div>
  )
}

// Small "Pick from syllabus / Write my own" segmented toggle shown next to
// the topic + sub-topic labels.
function ModeToggle({ value, onChange, pickLabel = 'From syllabus', writeLabel = 'Write my own', pickDisabled = false }) {
  const baseBtn = {
    border: 'none', background: 'none', cursor: 'pointer',
    fontSize: 11, fontWeight: 700, padding: '3px 9px', borderRadius: 999,
    lineHeight: 1.6, color: 'var(--sv-muted)',
  }
  const onStyle = {
    background: 'var(--sv-tinted)', color: 'var(--sv-text)',
    boxShadow: 'inset 0 0 0 1.5px var(--sv-primary)',
  }
  return (
    <div style={{ display: 'inline-flex', gap: 2, padding: 2, borderRadius: 999, background: 'var(--sv-soft)' }}>
      <button type="button"
        onClick={() => !pickDisabled && onChange('pick')}
        disabled={pickDisabled}
        title={pickDisabled ? 'No syllabus topics on file for this selection yet' : undefined}
        style={{ ...baseBtn, ...(value === 'pick' ? onStyle : null), opacity: pickDisabled ? 0.45 : 1, cursor: pickDisabled ? 'not-allowed' : 'pointer' }}>
        {pickLabel}
      </button>
      <button type="button"
        onClick={() => onChange('write')}
        style={{ ...baseBtn, ...(value === 'write' ? onStyle : null) }}>
        {writeLabel}
      </button>
    </div>
  )
}

export default function CreatePaperModal({ paperMeta, onApply, onClose }) {
  const { currentUser, userProfile } = useAuth()
  // Free teachers generate a 5-question short-test preview (server-clamped);
  // say so up front instead of surprising them after the wait.
  const isFreePreview = resolveTeacherPlan(userProfile) === 'free'
  const { ensureCanGenerate } = useGenerationGate(currentUser?.uid)
  // One modal instance creates at most one paper at a time — a double-click
  // or rapid tap on "Generate paper" must produce exactly one Anthropic call
  // and one saved aiGenerations doc, never two. See useAiOperationLock.js.
  const { run: runGenerateLocked } = useAiOperationLock('assessment-studio:create-paper:generate-full')
  const [form, setForm] = useState(() => {
    // Follow the paper's curriculum choice (set in the builder header / AI
    // slide); '2023' for papers from before the field existed.
    const framework = paperMeta?.framework === '2013' ? '2013' : '2023'
    // Normalise the studio's grade ('4', '8', 'G10') into the modal's value
    // scheme, then keep it only if it's a valid option for this curriculum
    // (secondary is now shown as forms, and Grade 7 / Form 5 don't exist under
    // CBC) — otherwise fall back to Grade 4.
    const seededGrade = normalizePaperGrade(paperMeta?.grade)
    const grade = paperGradeOptions(framework).some((g) => g.value === seededGrade)
      ? seededGrade : '4'
    return {
      grade,
      subject: toKbSubjectKey(paperMeta?.subject) || 'english',
      framework,
      // Every assessment type — tests AND examinations — is selectable from
      // this one modal now (see the ASSESSMENT TYPE grouped picker below), so
      // the seed is just a sane, category-agnostic default; the teacher
      // reopening a saved paper keeps whatever type it already carries.
      assessmentType: paperMeta?.assessmentType
        ? normalizeAssessmentType(paperMeta.assessmentType) : 'end_of_term',
      term: paperMeta?.term || '1',
      topicInput: '',
      topics: [],
      subtopicInput: '',
      subtopics: [],
      totalMarks: 40,
      durationMinutes: 60,
      // Seeded from the chip vocabulary itself so a renamed activity can never
      // leave the default selection pointing at a chip that no longer exists.
      // The band effect below narrows this to what the level actually permits.
      questionTypes: DEFAULT_ACTIVITY_KEYS,
      comprehension: false,
      autoDiagrams: true,
      extra: '',
    }
  })
  // idle → planning → plan (the teacher confirms) → generating → done | error.
  // The plan step is deliberately on the way IN: a teacher who can see the paper
  // before it is written stops paying for papers they were never going to use.
  const [status, setStatus] = useState('idle')
  const [error, setError] = useState('')
  const [result, setResult] = useState(null) // { assessment, blocks, warning }
  // The plan for the CURRENT settings — the same object the generator will be
  // constrained by. Cleared whenever a setting changes, so a stale plan can
  // never be the one confirmed.
  const [plan, setPlan] = useState(null) // { blueprint, problems, topicsOnFile }
  const [presetId, setPresetId] = useState('band')
  const [replanning, setReplanning] = useState(false)
  // Per-run token: stops a resolved callable from hijacking the UI if Stop was
  // clicked before the response landed (or a second run started).
  const runRef = useRef(0)
  // How the teacher supplies topics / sub-topics: 'pick' = choose from the
  // syllabus drop-down, 'write' = type their own. Defaults to the syllabus
  // drop-down; falls back to 'write' automatically when the chosen
  // grade/subject/framework has no syllabus entries on file.
  const [topicMode, setTopicMode] = useState('pick') // 'pick' | 'write'
  const [subtopicMode, setSubtopicMode] = useState('pick') // 'pick' | 'write'
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }))
  // Grade/subject/curriculum changes invalidate the chosen topics — they
  // belong to a different syllabus page.
  const setMeta = (k, v) => setForm((f) => ({
    ...f, [k]: v, topics: [], topicInput: '', subtopics: [], subtopicInput: '',
  }))

  // The pedagogical rules for the selected level, from the assessmentBands
  // collection. Everything stage-specific — which question types may be
  // offered, how long the paper runs, how many marks it carries — comes from
  // here rather than from a constant in this file.
  const { band } = useAssessmentBand(form.grade)
  const typeChips = useMemo(() => chipsForBand(band), [band])

  // A type the new band does not permit is dropped the moment the level
  // changes, so switching Form 4 → Baby Class cannot silently carry "Essay"
  // through to the generator via a chip that is no longer on screen.
  useEffect(() => {
    const permitted = new Set(typeChips.map((c) => c.key))
    setForm((f) => {
      const kept = f.questionTypes.filter((k) => permitted.has(k))
      if (kept.length === f.questionTypes.length) return f
      // Never leave the teacher with nothing selected: fall back to the band's
      // first two types, which are the ones it leads with.
      const next = kept.length > 0 ? kept : typeChips.slice(0, 2).map((c) => c.key)
      return { ...f, questionTypes: next }
    })
  }, [typeChips])

  // Duration and total marks follow the band's defaults for the chosen
  // assessment type — a Baby Class topic test is 15 minutes for 5-10 marks, a
  // Form 4 final examination is 180 minutes for 75-100. Re-applied whenever the
  // level or the type changes, which is exactly when the previous numbers stop
  // making sense; the teacher can still override either afterwards.
  const bandId = band?.id
  useEffect(() => {
    if (!band) return
    const duration = band.defaultDurations?.[form.assessmentType]
    const range = band.markRanges?.[form.assessmentType]
    setForm((f) => {
      const next = { ...f }
      if (Number.isFinite(Number(duration))) next.durationMinutes = Number(duration)
      if (Array.isArray(range) && Number.isFinite(Number(range[0]))) {
        // Land on the closest offered value inside the band's range rather than
        // the raw bound, so the <select> always has the value it is showing.
        const [lo, hi] = range.map(Number)
        const inRange = MARKS_OPTIONS.filter((m) => m >= lo && m <= hi)
        next.totalMarks = inRange.length > 0 ? inRange[inRange.length - 1] : lo
      }
      return next
    })
    // `bandId` rather than `band`: the object identity changes when the
    // Firestore read swaps in, but the defaults only matter per band.
  }, [bandId, band, form.assessmentType])

  const maxTopics = maxTopicsFor(form.assessmentType)
  const cumulative = isCumulativeType(form.assessmentType)
  // Copy reacts to whichever type is CURRENTLY selected in the grouped
  // picker, not to a route-level variant — an "exam standard" framing
  // follows the Mock Examination / Examination / Final Examination choice
  // wherever the modal was opened from.
  const isExam = isExaminationType(form.assessmentType)
  // Levels come from the Syllabi Studio for the chosen curriculum — the same
  // ordered, curriculum-aware list the paper header shows. Never a flat 1–12.
  const { levels: gradeOptions, loading: levelsLoading } =
    useSyllabusLevelOptions(form.framework, form.grade)
  const noLevels = !levelsLoading && gradeOptions.length === 0
  // The level currently chosen, with its availability. A level whose syllabus
  // is not on file is still shown and still selected if it was already set —
  // we explain it and refuse to generate, rather than quietly swapping the
  // teacher onto another curriculum's content.
  const selectedLevel = gradeOptions.find((g) => g.value === form.grade) || null

  // Keep the selected grade valid for the curriculum — e.g. Grade 7 doesn't
  // exist under CBC, so switching curriculum snaps back to the first available
  // level (and drops the now-stale topics). Wait for the syllabi to settle so a
  // transient empty list doesn't reset a legitimate seeded grade.
  useEffect(() => {
    if (levelsLoading || gradeOptions.length === 0) return
    if (!gradeOptions.some((g) => g.value === form.grade)) {
      // Snap to the first level that is actually usable, not merely the first
      // listed — the list now includes recognised-but-unavailable levels.
      const firstUsable = gradeOptions.find((g) => !g.unavailable) || gradeOptions[0]
      setForm((f) => ({
        ...f, grade: firstUsable.value,
        topics: [], topicInput: '', subtopics: [], subtopicInput: '',
      }))
    }
  }, [levelsLoading, gradeOptions, form.grade])

  // Subjects come STRICTLY from the Syllabus Studio for this curriculum +
  // grade — no static fallback. CBC shows exactly the CBC syllabus subjects and
  // the previous curriculum shows exactly its own, so the two never collapse to
  // an identical hardcoded list. When a grade genuinely has no syllabus
  // subjects the picker shows an explicit empty state rather than inventing any.
  const { subjects: syllabusSubjects, loading: subjectsLoading } =
    useSyllabusSubjectOptions(form.grade, form.framework)
  const subjectChoices = subjectsLoading ? [] : syllabusSubjects
  const noSubjects = !subjectsLoading && subjectChoices.length === 0

  // Keep the selected subject valid for the chosen grade. When the syllabus
  // for a grade doesn't carry the current subject, snap to the first one it
  // does (and drop now-stale topics).
  useEffect(() => {
    if (subjectsLoading || syllabusSubjects.length === 0) return
    if (!syllabusSubjects.some((s) => s.key === form.subject)) {
      setForm((f) => ({
        ...f, subject: syllabusSubjects[0].key,
        topics: [], topicInput: '', subtopics: [], subtopicInput: '',
      }))
    }
  }, [subjectsLoading, syllabusSubjects, form.subject])

  const { topics: topicOptions, subtopics: subtopicOptions, loading: syllabiLoading } =
    useSyllabusTopicOptions(form.grade, form.subject, form.topics, form.framework)
  // The topic drop-down only makes sense once we know the grade/subject has
  // rows in the merged syllabi — i.e. after the fetch settles. While loading
  // we keep "pick" enabled so it can populate.
  const topicPickEmpty = !syllabiLoading && topicOptions.length === 0

  // When the chosen grade/subject/framework genuinely has no syllabus rows,
  // the drop-down would be a dead end — drop the teacher into "Write my own".
  // Their explicit choice is otherwise kept. Guarded by !loading so the
  // async syllabi fetch doesn't flip the default before data arrives.
  useEffect(() => {
    if (topicPickEmpty && topicMode === 'pick') setTopicMode('write')
  }, [topicPickEmpty, topicMode])

  const topicList = useMemo(() => {
    const fromChips = form.topics
    const typed = form.topicInput.trim()
    return typed && !fromChips.includes(typed) ? [...fromChips, typed] : fromChips
  }, [form.topics, form.topicInput])

  const subtopicList = useMemo(() => {
    const fromChips = form.subtopics
    const typed = form.subtopicInput.trim()
    return typed && !fromChips.includes(typed) ? [...fromChips, typed] : fromChips
  }, [form.subtopics, form.subtopicInput])

  // Add a topic chip from either the typed input or the syllabus drop-down.
  function addTopicValue(value) {
    const t = String(value || '').trim().slice(0, 80)
    if (!t) return
    setForm((f) => (f.topics.includes(t) || f.topics.length >= maxTopicsFor(f.assessmentType)
      ? f
      : { ...f, topics: [...f.topics, t], topicInput: '' }))
  }
  function addTopic() {
    addTopicValue(form.topicInput)
  }
  // Tick / untick a syllabus topic. Adds when there's room (respecting the
  // per-test-type cap) and removes when already selected.
  function toggleTopic(value) {
    const t = String(value || '').trim()
    if (!t) return
    setForm((f) => {
      if (f.topics.includes(t)) {
        return { ...f, topics: f.topics.filter((x) => x !== t), topicInput: '' }
      }
      if (f.topics.length >= maxTopicsFor(f.assessmentType)) return f
      return { ...f, topics: [...f.topics, t], topicInput: '' }
    })
  }
  // Cumulative papers (end of term / mock) cover everything learned — let the
  // teacher tick every syllabus topic in one click, up to the type's cap.
  function addAllTopics() {
    setForm((f) => {
      const cap = maxTopicsFor(f.assessmentType)
      const next = [...f.topics]
      for (const t of topicOptions) {
        if (next.length >= cap) break
        if (!next.includes(t)) next.push(t)
      }
      return { ...f, topics: next, topicInput: '' }
    })
  }
  // Switching to the drop-down clears any half-typed free text so it can't
  // silently leak into the generated paper (topicList folds a non-empty
  // topicInput in as a topic).
  function changeTopicMode(mode) {
    if (mode === 'pick') set('topicInput', '')
    setTopicMode(mode)
  }

  function addSubtopicValue(value) {
    const s = String(value || '').trim().slice(0, 80)
    if (!s) return
    setForm((f) => (f.subtopics.includes(s)
      ? f
      : { ...f, subtopics: [...f.subtopics, s], subtopicInput: '' }))
  }
  function addSubtopic() {
    addSubtopicValue(form.subtopicInput)
  }
  // Tick / untick a syllabus sub-topic (no cap on sub-topics).
  function toggleSubtopic(value) {
    const s = String(value || '').trim()
    if (!s) return
    setForm((f) => (f.subtopics.includes(s)
      ? { ...f, subtopics: f.subtopics.filter((x) => x !== s), subtopicInput: '' }
      : { ...f, subtopics: [...f.subtopics, s], subtopicInput: '' }))
  }
  function changeSubtopicMode(mode) {
    if (mode === 'pick') set('subtopicInput', '')
    setSubtopicMode(mode)
  }

  // Changing the test type re-scopes how many topics are allowed; trim any
  // overflow so the count never exceeds the new cap.
  function changeAssessmentType(value) {
    setForm((f) => ({
      ...f, assessmentType: value,
      topics: f.topics.slice(0, maxTopicsFor(value)),
    }))
  }

  function toggleType(key) {
    setForm((f) => ({
      ...f,
      questionTypes: f.questionTypes.includes(key) ?
        f.questionTypes.filter((t) => t !== key) : [...f.questionTypes, key],
    }))
  }

  function buildInstructions() {
    const bits = []
    if (form.questionTypes.length > 0) {
      bits.push(`Use ONLY these question types: ${form.questionTypes.join(', ')}.`)
    }
    if (form.comprehension) {
      bits.push('Include a reading comprehension passage with questions on it.')
    }
    if (isExam) {
      // Every examination-category type is a full, formal paper at ECZ standard.
      bits.push(
        'This is a formal examination at full exam standard: pitch the ' +
        'difficulty at a final/mock examination, write it in authentic ' +
        'ECZ style, and make it cumulative — distribute the questions across ' +
        'ALL the listed topics, weighting each by how much it matters rather ' +
        'than over-focusing on one topic.',
      )
    } else if (form.assessmentType === 'end_of_term') {
      bits.push(
        'This is a cumulative paper that tests EVERYTHING the learners have ' +
        'covered: distribute the questions across ALL the listed topics, ' +
        'weighting each by how much it matters — do not over-focus on one topic.',
      )
    } else if (form.assessmentType === 'monthly_test') {
      bits.push(
        'This is a monthly test covering only what was taught this month: ' +
        'keep it tightly focused on the listed topics and sub-topics.',
      )
    } else if (topicList.length > 1) {
      bits.push('Spread the questions across all the listed topics.')
    }
    if (subtopicList.length > 0) {
      bits.push(`Restrict the questions to these sub-topics only: ${subtopicList.join(', ')}.`)
    }
    if (form.extra.trim()) bits.push(form.extra.trim())
    return bits.join(' ').slice(0, 500)
  }

  // Everything the form is asking for, in the shape both the plan step and the
  // generator take. One builder, so the paper that is planned and the paper that
  // is written can never be described differently.
  //
  // The teacher's chosen type reaches the backend UNCHANGED — every
  // canonical value (topic_test/weekly_test/mid_term/end_of_term/
  // mock_exam/examination/final_exam) is a real server-recognised
  // ASSESSMENT_TYPE (functions/teacherTools/assessmentFormats.js).
  // Previously every examination type was collapsed to the literal
  // 'mock_exam' here, so choosing "Examination" silently generated and
  // saved as a Mock Examination — fixed: the format profile a type has
  // no dedicated seeds for (examination/final_exam) still borrows the
  // mock_exam paper STRUCTURE server-side via FORMAT_TYPE_ALIASES, but
  // the type/title/label stay the one the teacher actually picked.
  function buildPayload() {
    return {
      grade: studioGradeToKbGrade(form.grade),
      subject: toKbSubjectKey(form.subject),
      framework: form.framework,
      topic: topicList.join('; ').slice(0, 240),
      subtopic: subtopicList.join('; ').slice(0, 300),
      term: form.term ? Number(form.term) : null,
      totalMarks: Number(form.totalMarks),
      durationMinutes: Number(form.durationMinutes),
      assessmentType: form.assessmentType,
      // Canonical question types — the generator filters the paper format to
      // these and refuses to emit any other type. Sent alongside the
      // human-readable instruction (buildInstructions) so the prompt also
      // phrases fill-in-the-blank as blanks rather than open short answers.
      questionTypes: canonicalTypesFor(form.questionTypes),
      instructions: buildInstructions(),
      // The teacher's chosen difficulty spread, as weights. null = whatever this
      // level normally does, which is what the band already says.
      difficultyMix: presetById(presetId).weights,
      // §3 — how many answer choices the paper is set to. Sent so the generator
      // writes exactly that many rather than the studio trimming the surplus
      // afterwards: a model given the target writes better distractors than one
      // whose fifth option is thrown away. The server enforces it either way.
      answerChoiceCount: normalizeChoiceCount(paperMeta?.mcqAnswerChoiceCount) ?? null,
    }
  }

  // The checks that must pass before either planning or generating. Returns true
  // when the request is worth sending.
  function readyToSend() {
    // A recognised level with no syllabus content on file cannot be generated
    // for: the paper would be invented rather than grounded. Say which level and
    // what to do, and never fall back to the other curriculum's content.
    if (selectedLevel?.unavailable) {
      setError(selectedLevel.message)
      setStatus('error')
      return false
    }
    if (noSubjects || !form.subject) {
      setError('This grade has no subjects in the chosen syllabus — pick another grade or curriculum.')
      setStatus('error')
      return false
    }
    if (topicList.length === 0) {
      setError('Add at least one topic.')
      setStatus('error')
      return false
    }
    if (form.questionTypes.length === 0) {
      setError('Pick at least one question type.')
      setStatus('error')
      return false
    }
    return true
  }

  /**
   * Work out the paper before writing it (§3.1) and show it to the teacher.
   *
   * Costs nothing — no model call — so the quota gate stays where it belongs, on
   * generation. A level+subject with no syllabus on file is refused HERE, before
   * the teacher waits for anything.
   */
  async function onPlan(preset = presetId) {
    if (!readyToSend()) return
    const run = ++runRef.current
    setError('')
    if (plan) setReplanning(true)
    else setStatus('planning')
    const res = await planAssessment({ ...buildPayload(), difficultyMix: presetById(preset).weights })
    if (run !== runRef.current) return
    setReplanning(false)
    if (!res.ok) {
      setStatus('error')
      setError(res.error || 'Could not work out a plan for this paper. Please try again.')
      return
    }
    setPlan({
      blueprint: res.data?.blueprint || null,
      problems: res.data?.problems || [],
      topicsOnFile: res.data?.topicsOnFile || 0,
    })
    setStatus('plan')
  }

  function changePreset(id) {
    setPresetId(id)
    onPlan(id)
  }

  async function onGenerate() {
    if (!readyToSend()) return
    // Fail fast: assessments are a Max studio — a capped Free/Pro teacher gets
    // the pay/upgrade prompt now, not after a wasted generation round-trip.
    if (!ensureCanGenerate('assessment')) return

    // The plan the teacher just confirmed travels with the request, so the paper
    // they were shown is the paper the model is bound by. The server re-checks it
    // (acceptClientBlueprint) and rebuilds it if anything is off — a blueprint
    // from a browser is still an input.
    const payload = { ...buildPayload(), blueprint: plan?.blueprint || null }

    const run = ++runRef.current
    setStatus('generating')
    setError('')
    // useAiOperationLock: a synchronous ref-based lock (set before any
    // await) plus a client-generated idempotency key that survives refresh —
    // the server-side reservation in generateAssessment.js is what actually
    // guarantees one Anthropic call + one saved paper + one usage charge per
    // logical request; this is the client-side belt on top of that buckle.
    const lockResult = await runGenerateLocked({
      fingerprint: stableFingerprint(payload),
      action: async (idempotencyKey) => {
        const outcome = await generateAssessment({ ...payload, idempotencyKey })
        if (!outcome.ok) {
          // generateAssessment() resolves rather than throws on failure, but
          // the lock only keeps an idempotencyKey reserved for a same-input
          // retry (§7/§14) on its CATCH path — so a genuine failure has to
          // be thrown here, not returned, or a retry with unchanged inputs
          // would mint a fresh key and the server would treat it as a brand
          // new (separately billable) request instead of resuming/retrying.
          const err = new Error(outcome.error || 'Generation failed')
          err.response = outcome
          throw err
        }
        return outcome
      },
    })
    if (run !== runRef.current) return
    if (lockResult.reason === 'locked') {
      // A generation for this modal is already in flight (the button
      // should already be disabled — this only fires if a click slipped
      // through before the disabled state applied). The in-flight call
      // owns the UI update; nothing to do here.
      return
    }
    const res = lockResult.ok ? lockResult.data : (lockResult.error?.response || {
      ok: false, error: lockResult.error?.message || 'Generation failed. Please try again.',
    })
    if (res.ok && res.data?.status === 'processing') {
      // The server already has this EXACT request in flight (a retried
      // network call, or another browser tab) — not an error. Leave
      // "Generating…" showing; whichever call actually owns the reservation
      // will complete it, and reopening/reusing this modal later resumes via
      // the same idempotency key.
      return
    }
    if (!res.ok) {
      // Defensive fallback: ensureCanGenerate('assessment') above is the
      // primary gate, but if a stale client meter let the call through and
      // the server rejects on quota, open the matching paywall (contextual
      // copy per plan) rather than dumping the raw error. Assessment Papers
      // are an allowance-based entitlement now, so exhaustion is 'monthly-limit'
      // (the paywall adapts Free→Pro / Pro→Max copy); 'max-only' stays
      // handled for any tool still anchored to Max.
      const reason = res.details?.reason
      if (reason === 'max-only') {
        paywall.show('max-feature', { feature: 'Assessment papers' })
        setStatus('idle')
        return
      }
      if (reason === 'monthly-limit' || reason === 'daily-cap') {
        paywall.show(reason, { feature: 'assessment papers', tool: 'assessment' })
        setStatus('idle')
        return
      }
      // Stay on the confirmed plan rather than throwing the teacher back to the
      // form: the plan is still good, the write failed. Re-pressing "Write this
      // paper" retries with the SAME idempotency key, which is what resumes a
      // request the server may already have in flight.
      setStatus(plan ? 'plan' : 'error')
      setError(res.error || 'Generation failed. Please try again.')
      return
    }
    const assessment = res.data?.assessment
    const blocks = aiAssessmentToStudioBlocks(assessment)
    if (blocks.questionCount === 0) {
      setStatus('error')
      setError('The AI returned no usable questions — try again or adjust the topics.')
      return
    }
    setResult({
      assessment,
      blocks,
      warning: res.data?.warning || '',
      sourcing: res.data?.sourcing || null,
      quality: res.data?.quality || null,
      // Server-stamped free-preview marker (5-question short test) — drives
      // the post-generation upgrade prompt below.
      preview: res.data?.preview || null,
      // What the generator planned before writing — see blueprintDrift.js.
      blueprint: res.data?.blueprint || null,
    })
    if (res.data?.preview) capture('free_preview_generated', { tool: 'assessment' })
    setStatus('done')
  }

  function apply(mode) {
    if (!result) return
    // The blueprint the paper was generated against travels with it, so the
    // studio can verify the paper against its own stated intent.
    onApply({
      blocks: result.blocks,
      assessment: result.assessment,
      form: { ...form, blueprint: result.blueprint || null },
      mode,
    })
  }

  // Any change to what is being asked for invalidates the plan on screen. A
  // teacher must never be able to confirm a plan for 3 topics and generate a
  // paper for 5 — so the plan is dropped the moment its inputs move, and they
  // are taken back to the form to plan again.
  const planKey = JSON.stringify([
    form.grade, form.subject, form.framework, form.assessmentType, form.term,
    topicList, subtopicList, form.totalMarks, form.durationMinutes,
    form.questionTypes, form.comprehension, form.extra,
  ])
  const lastPlanKey = useRef(planKey)
  useEffect(() => {
    if (lastPlanKey.current === planKey) return
    lastPlanKey.current = planKey
    setPlan((current) => {
      if (!current) return current
      // Cancel any in-flight plan/generate for the previous settings.
      runRef.current += 1
      setStatus('idle')
      setReplanning(false)
      return null
    })
  }, [planKey])

  const showAddAll = topicMode === 'pick' && cumulative &&
    topicOptions.some((t) => !form.topics.includes(t)) &&
    form.topics.length < maxTopics

  return (
    <div className="sv-cpm-overlay" onClick={status === 'generating' ? undefined : onClose}>
      <div className="sv-cpm-modal" onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
          <div>
            <h3 style={{ margin: 0, fontWeight: 900, fontSize: 19, color: 'var(--sv-text)' }}>
              {isExam ? '🎓 Create exam with AI' : '📄 Create paper with AI'}
            </h3>
            <p style={{ margin: '4px 0 0', fontSize: 13, color: 'var(--sv-muted)' }}>
              {isExam
                ? 'The exam follows the Zambian examination format at full exam ' +
                  'standard and lands as editable blocks — review every question ' +
                  'before saving.'
                : 'The paper follows the Zambian format for the chosen test type ' +
                  'and lands as editable blocks — review every question before saving.'}
            </p>
          </div>
          <button type="button" onClick={onClose} disabled={status === 'generating'}
            style={{ fontSize: 22, lineHeight: 1, border: 'none', background: 'none', cursor: 'pointer' }}
            aria-label="Close">×</button>
        </div>

        {(status === 'idle' || status === 'error' || status === 'planning') && (
          <div style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div className="sv-cpm-grid2">
              <div>
                <label className="sv-cpm-label" htmlFor="cpm-grade">Grade / level</label>
                <select id="cpm-grade" className="sv-cpm-input" value={form.grade}
                  disabled={levelsLoading || noLevels}
                  onChange={(e) => setMeta('grade', e.target.value)}>
                  {levelsLoading && <option value={form.grade}>Loading education levels…</option>}
                  {noLevels && <option value="">No syllabus levels for this curriculum</option>}
                  {!levelsLoading && !noLevels && gradeOptions.map((g) => (
                    // A recognised level whose syllabus is not loaded stays
                    // VISIBLE but unselectable, so the teacher sees that the
                    // level exists and why it cannot be used — rather than a gap
                    // in the list with no explanation.
                    <option key={g.value} value={g.value} disabled={g.unavailable}>
                      {g.label}{g.unavailable ? ' — not available yet' : ''}
                    </option>
                  ))}
                </select>
                {noLevels && (
                  <p className="sv-cpm-hint">No syllabus levels are available for this curriculum.</p>
                )}
                {selectedLevel?.unavailable && (
                  <p className="sv-cpm-warn" role="status">{selectedLevel.message}</p>
                )}
              </div>
              <div>
                <label className="sv-cpm-label">Subject</label>
                <select className="sv-cpm-input" value={noSubjects ? '' : form.subject}
                  disabled={subjectsLoading || noSubjects}
                  onChange={(e) => setMeta('subject', e.target.value)}>
                  {subjectsLoading && <option value={form.subject}>Loading subjects…</option>}
                  {noSubjects && <option value="">No subjects in this syllabus</option>}
                  {subjectChoices.map((s) => (
                    <option key={s.key} value={s.key}>{s.label}</option>
                  ))}
                </select>
                {noSubjects && (
                  <p className="sv-cpm-hint">
                    This grade has no subjects in the{' '}
                    {form.framework === '2013' ? 'previous' : 'CBC'} syllabus yet.
                  </p>
                )}
              </div>
            </div>
            <div>
              <CurriculumPicker
                curriculumMode={form.framework === '2013' ? 'previous' : 'cbc'}
                onSelect={(mode) => setMeta('framework', mode === 'previous' ? '2013' : '2023')}
              />
            </div>
            <div className="sv-cpm-grid2">
              <div>
                <label className="sv-cpm-label" htmlFor="cpm-assessment-type">Assessment type</label>
                <select id="cpm-assessment-type" className="sv-cpm-input" value={form.assessmentType}
                  onChange={(e) => changeAssessmentType(e.target.value)}>
                  <optgroup label="Tests">
                    {TEST_ASSESSMENT_TYPES.map((t) => (
                      <option key={t} value={t}>{ASSESSMENT_TYPES[t].label}</option>
                    ))}
                  </optgroup>
                  <optgroup label="Examinations">
                    {EXAMINATION_ASSESSMENT_TYPES.map((t) => (
                      <option key={t} value={t}>{ASSESSMENT_TYPES[t].label}</option>
                    ))}
                  </optgroup>
                </select>
              </div>
              <div>
                <label className="sv-cpm-label">Term</label>
                <select className="sv-cpm-input" value={form.term}
                  onChange={(e) => set('term', e.target.value)}>
                  {['1', '2', '3'].map((t) => <option key={t} value={t}>Term {t}</option>)}
                </select>
              </div>
            </div>

            <div>
              <div className="sv-cpm-labelrow">
                <label className="sv-cpm-label" style={{ marginBottom: 0 }}>
                  Topics from the syllabus (up to {maxTopics}) *
                </label>
                <ModeToggle value={topicMode} onChange={changeTopicMode} pickDisabled={topicPickEmpty} />
              </div>
              {cumulative && (
                <p style={{ fontSize: 12, color: 'var(--sv-muted)', margin: '0 0 6px' }}>
                  This is a cumulative paper — add every topic the class has covered.
                </p>
              )}
              {form.topics.length > 0 && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 6 }}>
                  {form.topics.map((t) => (
                    <span key={t} className="sv-cpm-chip">
                      {t}
                      <button type="button" aria-label={`Remove ${t}`}
                        onClick={() => set('topics', form.topics.filter((x) => x !== t))}
                        style={{ border: 'none', background: 'none', cursor: 'pointer', fontWeight: 700 }}>×</button>
                    </span>
                  ))}
                </div>
              )}
              {topicMode === 'pick' ? (
                syllabiLoading ? (
                  <p className="sv-cpm-hint">Loading syllabus topics…</p>
                ) : topicOptions.length === 0 ? (
                  <p className="sv-cpm-hint">No syllabus topics on file — switch to “Write my own”.</p>
                ) : (
                  <>
                    <CheckboxList
                      options={topicOptions}
                      selected={form.topics}
                      onToggle={toggleTopic}
                      disabledMore={form.topics.length >= maxTopics}
                    />
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginTop: 6 }}>
                      {showAddAll && (
                        <button type="button" className="sv-btn" onClick={addAllTopics}>
                          Select all {topicOptions.length}
                        </button>
                      )}
                      {form.topics.length > 0 && (
                        <button type="button" className="sv-btn" onClick={() => set('topics', [])}>
                          Clear
                        </button>
                      )}
                      <span className="sv-cpm-hint" style={{ margin: 0, marginLeft: 'auto' }}>
                        {form.topics.length}/{maxTopics} selected
                      </span>
                    </div>
                  </>
                )
              ) : form.topics.length >= maxTopics ? (
                <p style={{ fontSize: 12, color: 'var(--sv-muted)', margin: 0 }}>
                  Maximum of {maxTopics} topics added — remove one to change it.
                </p>
              ) : (
                <div style={{ display: 'flex', gap: 6 }}>
                  <input
                    className="sv-cpm-input" style={{ flex: 1 }}
                    list="cpm-topic-options"
                    value={form.topicInput}
                    onChange={(e) => set('topicInput', e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addTopic() } }}
                    placeholder={topicOptions[0] ? `e.g. ${topicOptions[0]}` : 'Type a topic'}
                  />
                  <button type="button" className="sv-btn"
                    onClick={addTopic}
                    disabled={!form.topicInput.trim() || form.topics.length >= maxTopics}>
                    + Add
                  </button>
                  <datalist id="cpm-topic-options">
                    {topicOptions.map((t) => <option key={t} value={t} />)}
                  </datalist>
                </div>
              )}
            </div>

            <div>
              <div className="sv-cpm-labelrow">
                <label className="sv-cpm-label" style={{ marginBottom: 0 }}>Sub-topics (optional)</label>
                <ModeToggle value={subtopicMode} onChange={changeSubtopicMode}
                  pickDisabled={subtopicOptions.length === 0} />
              </div>
              <p style={{ fontSize: 12, color: 'var(--sv-muted)', margin: '0 0 6px' }}>
                Pick the sub-topics actually covered — handy for a monthly test
                that only did part of a topic. Leave empty to cover the whole topic.
              </p>
              {form.subtopics.length > 0 && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 6 }}>
                  {form.subtopics.map((s) => (
                    <span key={s} className="sv-cpm-chip">
                      {s}
                      <button type="button" aria-label={`Remove ${s}`}
                        onClick={() => set('subtopics', form.subtopics.filter((x) => x !== s))}
                        style={{ border: 'none', background: 'none', cursor: 'pointer', fontWeight: 700 }}>×</button>
                    </span>
                  ))}
                </div>
              )}
              {subtopicMode === 'pick' ? (
                subtopicOptions.length === 0 ? (
                  <p className="sv-cpm-hint">Add a topic first to see its sub-topics.</p>
                ) : (
                  <>
                    <CheckboxList
                      options={subtopicOptions}
                      selected={form.subtopics}
                      onToggle={toggleSubtopic}
                    />
                    {form.subtopics.length > 0 && (
                      <button type="button" className="sv-btn" style={{ marginTop: 6 }}
                        onClick={() => set('subtopics', [])}>
                        Clear
                      </button>
                    )}
                  </>
                )
              ) : (
                <div style={{ display: 'flex', gap: 6 }}>
                  <input className="sv-cpm-input" style={{ flex: 1 }} list="cpm-subtopic-options"
                    value={form.subtopicInput}
                    onChange={(e) => set('subtopicInput', e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addSubtopic() } }}
                    placeholder="Type a sub-topic" />
                  <button type="button" className="sv-btn"
                    onClick={addSubtopic}
                    disabled={!form.subtopicInput.trim()}>
                    + Add
                  </button>
                  <datalist id="cpm-subtopic-options">
                    {subtopicOptions.map((s) => <option key={s} value={s} />)}
                  </datalist>
                </div>
              )}
            </div>

            {isFreePreview && (
              <p style={{ margin: '10px 0 0', fontSize: 12.5, fontWeight: 700, color: 'var(--sv-muted)' }}>
                Free plan: you’ll get a short test of up to {FREE_PREVIEW_LIMITS.maxShortTestQuestions} questions
                — upgrade for full-length papers.
              </p>
            )}

            <div className="sv-cpm-grid2">
              <div>
                <label className="sv-cpm-label">Total marks</label>
                <select className="sv-cpm-input" value={String(form.totalMarks)}
                  onChange={(e) => set('totalMarks', Number(e.target.value))}>
                  {MARKS_OPTIONS.map((m) => <option key={m} value={m}>{m} marks</option>)}
                </select>
              </div>
              <div>
                <label className="sv-cpm-label">Duration</label>
                <select className="sv-cpm-input" value={String(form.durationMinutes)}
                  onChange={(e) => set('durationMinutes', Number(e.target.value))}>
                  {DURATION_OPTIONS.map((m) => <option key={m} value={m}>{m} min</option>)}
                </select>
              </div>
            </div>

            <div>
              <label className="sv-cpm-label">Question types</label>
              {band?.reading?.requirement === 'none' && (
                <p className="sv-cpm-hint" style={{ marginTop: 0 }}>
                  Children at this level are not expected to read, so every question
                  is answered by looking at a picture or listening to you. A sheet of
                  what to read aloud is made along with the worksheet.
                </p>
              )}
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {typeChips.map((t) => {
                  const on = form.questionTypes.includes(t.key)
                  // An activity with no faithful layout yet is marked, so the UI
                  // never implies a finished worksheet experience it cannot
                  // deliver. It is still offered — it generates and prints, just
                  // as a figure plus a work area.
                  const limited = isLimitedSupport(t.canonical)
                  return (
                    <button key={t.key} type="button" onClick={() => toggleType(t.key)}
                      className={`sv-cpm-pill ${on ? 'active' : ''}`}
                      title={t.note || undefined}>
                      {t.label}
                      {limited && <span className="sv-cpm-pill-basic"> · basic</span>}
                    </button>
                  )
                })}
                {/* A reading passage only makes sense once learners can read it. */}
                {band?.reading?.requirement !== 'none' && (
                  <button type="button" onClick={() => set('comprehension', !form.comprehension)}
                    className={`sv-cpm-pill ${form.comprehension ? 'active' : ''}`}>
                    Comprehension passage
                  </button>
                )}
              </div>
              {typeChips.some((t) => isLimitedSupport(t.canonical)) && (
                <p className="sv-cpm-hint">
                  Activities marked <strong>· basic</strong> print as a picture with
                  space to work — the specially drawn versions (dotted letters to
                  trace, shapes made for colouring, labelled sorting boxes) are
                  still being built.
                </p>
              )}
            </div>

            <div>
              <label className="sv-cpm-label">Anything else? (optional)</label>
              <textarea className="sv-cpm-input" style={{ resize: 'vertical' }} rows={2}
                maxLength={300}
                value={form.extra}
                onChange={(e) => set('extra', e.target.value)}
                placeholder="e.g. Focus on word problems about money." />
            </div>

            <label style={{
              display: 'flex', alignItems: 'flex-start', gap: 8, cursor: 'pointer',
              border: '1px solid var(--sv-border)', borderRadius: 10, padding: '10px 12px',
            }}>
              <input type="checkbox" checked={form.autoDiagrams}
                onChange={(e) => set('autoDiagrams', e.target.checked)}
                style={{ marginTop: 2 }} />
              <span style={{ fontSize: 13, color: 'var(--sv-text)' }}>
                <strong>Draw diagrams automatically</strong>
                <span style={{ display: 'block', fontSize: 12, color: 'var(--sv-muted)', marginTop: 2 }}>
                  When the paper needs figures (science diagrams, picture options,
                  shapes), generate black-and-white line art for them right away.
                  Adds a few seconds per figure; you can still fine-tune or replace any of them.
                </span>
              </span>
            </label>

            {status === 'error' && (
              <div style={{ borderRadius: 10, border: '1px solid #fca5a5', background: '#fef2f2', color: '#991b1b', padding: '8px 12px', fontSize: 13 }}>
                ⚠️ {error}
              </div>
            )}

            <button type="button" className="sv-btn sv-btn-primary sv-btn-full"
              onClick={() => onPlan()} disabled={status === 'planning'}>
              {status === 'planning' ? 'Working out the plan…' : '✦ Plan the paper'}
            </button>
            <p className="sv-cpm-hint" style={{ textAlign: 'center', margin: 0 }}>
              You’ll see what the paper will cover before it’s written — nothing is
              generated yet.
            </p>
          </div>
        )}

        {(status === 'plan' || status === 'generating') && (
          <div style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 14 }}>
            {error && (
              <div style={{ borderRadius: 10, border: '1px solid #fca5a5', background: '#fef2f2', color: '#991b1b', padding: '8px 12px', fontSize: 13 }}>
                ⚠️ {error}
              </div>
            )}
            <PaperPlanPanel
              blueprint={plan?.blueprint || null}
              problems={plan?.problems || []}
              topicsOnFile={plan?.topicsOnFile || 0}
              paperMeta={paperMeta}
              presetId={presetId}
              onPresetChange={changePreset}
              onGenerate={onGenerate}
              onBack={() => { runRef.current += 1; setPlan(null); setStatus('idle') }}
              replanning={replanning}
              generating={status === 'generating'}
            />
            {status === 'generating' && (
              <LiveGenerationCanvas
                variant="embedded"
                tool="assessment"
                status="generating"
                title={isExam ? 'Writing your exam…' : 'Writing your paper…'}
                onStop={() => { runRef.current += 1; setStatus('plan'); }}
              />
            )}
          </div>
        )}

        {status === 'done' && result && (
          <div style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 12 }}>
            <LiveGenerationCanvas
              variant="embedded"
              tool="assessment"
              status="success"
              result={result.assessment}
              docTitle={result.assessment?.header?.title}
              title={isExam ? 'Your exam' : 'Your paper'}
            />
            {result.preview && (
              <FreePreviewUpsell
                context="short-test"
                title={`Your ${result.blocks.questionCount}-question short test is ready.`}
                text="Upgrade to add more questions, sections, marking keys, diagrams and Word downloads — you can save this short test either way."
              />
            )}
            <div style={{ borderRadius: 10, border: '1px solid var(--sv-border)', padding: 12, fontSize: 14, color: 'var(--sv-text)' }}>
              <strong>{result.assessment?.header?.title || 'Paper ready'}</strong>
              <div style={{ fontSize: 13, color: 'var(--sv-muted)', marginTop: 4 }}>
                {result.blocks.questionCount} questions · {result.blocks.totalMarks} marks ·{' '}
                {result.blocks.parts.length} section{result.blocks.parts.length === 1 ? '' : 's'} —
                with answers and a marking guide on every question.
              </div>
              {result.sourcing?.fromBank > 0 && (
                <div style={{ fontSize: 12, color: 'var(--success-fg)', marginTop: 6, fontWeight: 700 }}>
                  ♻️ Reused {result.sourcing.fromBank} approved question{result.sourcing.fromBank === 1 ? '' : 's'} from the Master Bank
                  {result.sourcing.generated > 0 ? ` · AI wrote the other ${result.sourcing.generated}` : ''}.
                </div>
              )}
              {result.quality && (
                <div style={{ marginTop: 6 }}>
                  {result.quality.reordered && (
                    <div style={{ fontSize: 12, color: 'var(--success-fg)', fontWeight: 700 }}>
                      🔀 Mixed the topics through the paper so it reads like a real test, not a worksheet.
                    </div>
                  )}
                  {result.quality.verdict === 'pass' ? (
                    <div style={{ fontSize: 12, color: 'var(--success-fg)', fontWeight: 700 }}>
                      ✓ Quality checks passed — topics mixed, thinking skills varied, coverage balanced.
                    </div>
                  ) : (
                    Array.isArray(result.quality.warnings) && result.quality.warnings.length > 0 && (
                      <ul style={{ margin: '2px 0 0', paddingLeft: 18, fontSize: 12, color: '#92400e' }}>
                        {result.quality.warnings.slice(0, 4).map((w, i) => (
                          <li key={i}>{w}</li>
                        ))}
                      </ul>
                    )
                  )}
                </div>
              )}
              {result.warning && (
                <div style={{ fontSize: 12, color: '#92400e', marginTop: 6 }}>⚠️ {result.warning}</div>
              )}
              {result.blocks.warnings.length > 0 && (
                <div style={{ fontSize: 12, color: '#92400e', marginTop: 6 }}>
                  {result.blocks.warnings.length} question(s) flagged for your review
                  (diagrams to attach or answers to confirm) — they're marked in the builder.
                </div>
              )}
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button type="button" className="sv-btn sv-btn-primary" style={{ flex: 1 }}
                onClick={() => apply('replace')}>
                Use as the paper (replace)
              </button>
              <button type="button" className="sv-btn" style={{ flex: 1 }}
                onClick={() => apply('append')}>
                Add to existing questions
              </button>
            </div>
            <button type="button" className="sv-btn" onClick={() => { setResult(null); setStatus('idle') }}>
              ← Change settings and regenerate
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
