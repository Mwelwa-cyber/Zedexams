import { useState, useEffect, useMemo } from 'react'
import { useAuth } from '../../../contexts/AuthContext'
import { useGenerationGate } from '../../../hooks/useGenerationGate'
import { useIsMounted } from '../../../hooks/useIsMounted'
import {
  generateSchemeOfWork,
  TEACHER_LANGUAGES,
  SCHEME_TERMS,
} from '../../../utils/teacherTools'
import { downloadSchemeOfWorkDocx } from '../../../utils/schemeOfWorkToDocx'
import { downloadSchemeOfWorkPdf } from '../../../utils/schemeOfWorkToPdf'
import { buildDownloadName } from '../../../utils/downloadFilename'
import SchemeOfWorkView from '../views/SchemeOfWorkView'
import SchemeEditableTable from './SchemeEditableTable'
import SchemePreviewCard from './SchemePreviewCard'
import { useFormDefaultsFromUrl } from '../../../utils/useFormDefaultsFromUrl'
import StudioPageHeader from '../StudioPageHeader'
import SeoHelmet from '../../seo/SeoHelmet'
import {
  attachLibraryToGeneration,
  isFreePlanTeacher,
  listMyGenerations,
  titleForGeneration,
  updateGenerationOutput,
} from '../../../utils/teacherLibraryService'
import { LIBRARY_TYPES } from '../../../config/library'
import LiveGenerationCanvas from '../../ui/LiveGenerationCanvas'
import StudioCurriculumSelector from '../curriculum/StudioCurriculumSelector'
import { curriculumSeedFromProfile } from '../../../utils/teacherDefaults'
import { SOURCE_META } from '../views/SchemeOfWorkView'
import { FieldText, FieldTextarea, FieldSelect } from './studioFields'
import StudioOutputBoundary from '../StudioOutputBoundary'
import { useStudioInputDraft } from '../../../hooks/draft/useStudioInputDraft'
import { schemeInputDescriptor } from '../../../hooks/draft/descriptors'
import DraftStatusIndicator from '../../draft/DraftStatusIndicator'
import DraftRecoveryPrompt from '../../draft/DraftRecoveryPrompt'
import { getCalendarYears } from '../../../utils/moeCalendar'
import {
  buildTermPlan,
  reserveWeeks,
  toWeekPlanPayload,
  reservedWeekCount,
  deliveryWeekCount,
  defaultRevisionWeeks,
} from '../../../utils/schemeTermPlan'
import { matchFrameworkSubject, periodsPerWeekLabel } from '../../../utils/frameworkSubjectMatch'
import { evaluate as evaluateReadiness } from '../../../utils/schemeReadiness'
import { normalizeCurriculum, curriculumLabel } from '../../../utils/schemeFormat'
import { stampEditHistory } from '../../../utils/schemeEditHistory'
import { useSubjectTopics } from '../studio/hooks/useSubjectTopics'
import SchemeTermPreview from './SchemeTermPreview'
import { toTopicSelectionPayload } from '../../../utils/schemeTermDivision'

const CALENDAR_YEARS = getCalendarYears()

/** Parse a comma/space-separated list of week numbers within 1..max. */
function parseWeeks(str, max) {
  return Array.from(new Set(
    String(str || '')
      .split(/[,\s]+/)
      .map((s) => parseInt(s, 10))
      .filter((n) => Number.isFinite(n) && n >= 1 && n <= max),
  ))
}

export default function SchemeOfWorkGenerator() {
  const { currentUser, userProfile, isAdmin } = useAuth()
  const { ensureCanGenerate } = useGenerationGate(currentUser?.uid)
  const urlDefaults = useFormDefaultsFromUrl()
  // Selector seed: a deep-link handoff (?grade=…) wins; otherwise the teacher's
  // saved curriculum defaults. Read once on mount by the selector; recovering a
  // draft re-seeds it and bumps selectorKey to remount on the saved curriculum.
  const [selectorSeed, setSelectorSeed] = useState(() =>
    urlDefaults && (urlDefaults.grade || urlDefaults.subject || urlDefaults.topic)
      ? urlDefaults
      : curriculumSeedFromProfile(userProfile),
  )
  const [selectorKey, setSelectorKey] = useState(0)
  const [form, setForm] = useState(() => ({
    term: 1,
    year: CALENDAR_YEARS.includes(new Date().getFullYear())
      ? new Date().getFullYear()
      : CALENDAR_YEARS[0],
    weeksOverride: '', // '' = use the calendar's teaching-week count
    examWeeks: '', // comma-separated week numbers; '' → defaults to the last week
    revisionWeeks: '',
    manualPeriods: '', // periods/week the teacher types when the framework has none
    language: 'english',
    teacherName: userProfile?.displayName || userProfile?.fullName || '',
    school: userProfile?.school || userProfile?.schoolName || '',
    instructions: '',
    ...urlDefaults,
  }))
  const [curr, setCurr] = useState({})
  const [status, setStatus] = useState('idle')
  const [errorMessage, setErrorMessage] = useState('')
  const isMounted = useIsMounted()
  const [scheme, setScheme] = useState(null)
  const [generationId, setGenerationId] = useState(null)
  const [usage, setUsage] = useState(null)
  const [warning, setWarning] = useState('')
  const [advisories, setAdvisories] = useState([])
  const [curriculumSource, setCurriculumSource] = useState('')
  const [qualityChecks, setQualityChecks] = useState(null)
  const [handedOff, setHandedOff] = useState(false)
  const [savingEdit, setSavingEdit] = useState(false)
  const [saveMsg, setSaveMsg] = useState('')
  // Step flow: 'form' (settings) → 'preview' (review & edit term topics) →
  // generated output. planScope decides whether the preview shows one term or
  // all three of the divided syllabus.
  const [step, setStep] = useState('form')
  const [planScope, setPlanScope] = useState('single')
  // The approved overrides (term + topicSelection) for the current generation,
  // kept so "Regenerate" reruns the same approved plan.
  const [genOverrides, setGenOverrides] = useState({})

  // Universal Draft Manager: auto-save the scheme-of-work inputs.
  const draft = useStudioInputDraft({
    descriptor: schemeInputDescriptor,
    uid: currentUser?.uid,
    form, setForm, curr, setCurr,
    onReseedSelector: (c) => { setSelectorSeed(c); setSelectorKey((k) => k + 1) },
  })

  // Teacher's saved Class Timetables — attaching one makes the scheme
  // timetable-aware (periods/week + teaching days for the chosen subject).
  const [timetables, setTimetables] = useState([])
  const [timetableId, setTimetableId] = useState('')

  useEffect(() => {
    let cancelled = false
    const uid = userProfile?.uid
    if (!uid) return undefined
    listMyGenerations({ uid, tool: 'class_timetable' })
      .then((rows) => { if (!cancelled) setTimetables(rows || []) })
      .catch(() => { if (!cancelled) setTimetables([]) })
    return () => { cancelled = true }
  }, [userProfile?.uid])

  const timetableOptions = useMemo(() => {
    const opts = [{ value: '', label: 'None — pace by curriculum only' }]
    const sorted = [...timetables].sort((a, b) => {
      const am = a.inputs?.grade === curr.grade ? 0 : 1
      const bm = b.inputs?.grade === curr.grade ? 0 : 1
      return am - bm
    })
    for (const t of sorted) {
      const grade = t.inputs?.grade
      const mismatch = grade && grade !== curr.grade ? ` · ${grade}` : ''
      opts.push({ value: t.id, label: `${titleForGeneration(t)}${mismatch}` })
    }
    return opts
  }, [timetables, curr.grade])

  // ── Curriculum-aware derivation (Syllabus + Framework + Calendar) ──────────
  const curriculum = normalizeCurriculum(curr.curriculum)

  // School Calendar → teaching-week skeleton for the chosen year + term.
  const termPlan = useMemo(
    () => buildTermPlan({ year: form.year, term: form.term }),
    [form.year, form.term],
  )
  const calendarWeeks = termPlan?.weeks.length || 0
  const effectiveWeeks = form.weeksOverride
    ? Math.max(1, Math.min(20, Number(form.weeksOverride)))
    : calendarWeeks

  // Teacher-marked exam / revision weeks (calendar reservation). Exam defaults
  // to the last week when nothing is typed (how a term normally closes), and a
  // blank revision field defaults to the standard term shape — 2 revision
  // weeks before the exam, 3 in Term 3 (end-of-year exams revise the whole
  // year). Typing anything (even "none") overrides the default.
  const examWeeksArr = parseWeeks(form.examWeeks, effectiveWeeks)
  const effectiveExamWeeks = examWeeksArr.length
    ? examWeeksArr
    : (effectiveWeeks ? [effectiveWeeks] : [])
  const revisionIsDefault = !String(form.revisionWeeks || '').trim()
  const revisionWeeksArr = revisionIsDefault
    ? defaultRevisionWeeks({ totalWeeks: effectiveWeeks, examWeeks: effectiveExamWeeks, term: form.term })
    : parseWeeks(form.revisionWeeks, effectiveWeeks)
  const reservedPlan = useMemo(() => {
    if (!termPlan) return null
    return reserveWeeks(termPlan, { examWeeks: effectiveExamWeeks, revisionWeeks: revisionWeeksArr })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [termPlan, form.examWeeks, form.revisionWeeks, form.term, effectiveWeeks])

  // Curriculum Framework 2013/2023 → official periods + time per week.
  const frameworkMatch = useMemo(
    () => (curr.grade && curr.subject ? matchFrameworkSubject(curr.grade, curr.subject) : null),
    [curr.grade, curr.subject],
  )
  const periodsCount = frameworkMatch?.periodsPerWeek || (Number(form.manualPeriods) || 0)
  const periodsPerWeekStr = frameworkMatch
    ? periodsPerWeekLabel(curr.grade, curr.subject)
    : (form.manualPeriods ? `${form.manualPeriods} periods per week` : '')
  const timePerWeekStr = frameworkMatch?.timeAllocation || ''

  const readiness = useMemo(() => evaluateReadiness({
    curriculum: curr.curriculumMode ? curriculum : '',
    grade: curr.grade,
    subject: curr.subject,
    term: form.term,
    teachingWeeks: effectiveWeeks,
    periodsPerWeek: periodsCount,
  }), [curr.curriculumMode, curriculum, curr.grade, curr.subject, form.term, effectiveWeeks, periodsCount])

  // ── Intelligent term division (client preview) ────────────────────────────
  // The full grade+subject syllabus outline, from the SAME data layer the
  // curriculum selector uses. Divided across the three terms so the preview can
  // show this term's slice (and Term 2/3 continue where the prior term ended).
  const { topics: syllabusTopics, loading: topicsLoading } = useSubjectTopics(
    curr.subjectKey, curr.gradeLabel, curr.curriculumMode,
  )
  const hasSyllabusTopics = Array.isArray(syllabusTopics) && syllabusTopics.length > 0

  // Per-term calendar meta (teaching weeks after reserving the exam week) so the
  // division is weighted by each term's real length and the preview can show it.
  const termCalendars = useMemo(() => {
    const out = {}
    for (const t of [1, 2, 3]) {
      const plan = buildTermPlan({ year: form.year, term: t })
      if (!plan) {
        out[t] = { totalWeeks: 0, deliveryWeeks: 0, hasExam: false, hasRevision: false }
        continue
      }
      const total = plan.weeks.length
      const revision = defaultRevisionWeeks({ totalWeeks: total, examWeeks: [total], term: t })
      const reserved = reserveWeeks(plan, { examWeeks: [total], revisionWeeks: revision })
      out[t] = {
        totalWeeks: total,
        deliveryWeeks: deliveryWeekCount(reserved),
        hasExam: true,
        hasRevision: revision.length > 0,
      }
    }
    return out
  }, [form.year])
  const weeksByTerm = useMemo(() => {
    const w = {}
    for (const t of [1, 2, 3]) w[t] = termCalendars[t]?.deliveryWeeks || 0
    return w
  }, [termCalendars])

  function updateField(key, value) {
    setForm((f) => ({ ...f, [key]: value }))
  }

  function selectedTimetablePayload() {
    if (!timetableId) return null
    const gen = timetables.find((t) => t.id === timetableId)
    const out = gen?.output
    if (!out || typeof out !== 'object') return null
    return {
      header: out.header || {},
      days: out.days || [],
      subjects: out.subjects || [],
      slots: out.slots || {},
    }
  }

  function buildInputs(overrides = {}) {
    const term = overrides.term || form.term
    // For a term other than the one the form is focused on (all-terms mode),
    // derive that term's own calendar reservation so its weekPlan is correct.
    let weekPlanForTerm = reservedPlan
    let weeksForTerm = effectiveWeeks
    if (term !== form.term) {
      const plan = buildTermPlan({ year: form.year, term })
      if (plan) {
        const total = plan.weeks.length
        weekPlanForTerm = reserveWeeks(plan, {
          examWeeks: [total],
          revisionWeeks: defaultRevisionWeeks({ totalWeeks: total, examWeeks: [total], term }),
        })
        weeksForTerm = total
      }
    }
    return {
      ...form,
      term,
      grade: curr.grade,
      subject: curr.subject,
      curriculum: curr.curriculum,
      framework: curr.framework,
      year: form.year,
      numberOfWeeks: weeksForTerm || 12,
      periodsPerWeek: periodsPerWeekStr,
      timePerWeek: timePerWeekStr,
      weekPlan: weekPlanForTerm ? toWeekPlanPayload(weekPlanForTerm) : [],
      timetable: selectedTimetablePayload(),
      weeksByTerm,
      topicSelection: Array.isArray(overrides.topicSelection) ? overrides.topicSelection : [],
    }
  }

  async function regenerateSection(sectionId) {
    const res = await generateSchemeOfWork(buildInputs(genOverrides))
    if (res.ok && res.data?.schemeOfWork) {
      const fresh = res.data.schemeOfWork
      setScheme((prev) => (prev ? { ...prev, [sectionId]: fresh[sectionId] } : fresh))
      return fresh
    }
    return null
  }

  function saveToLibrary() {
    if (!generationId) return
    attachLibraryToGeneration(generationId, {
      libraryType: LIBRARY_TYPES.SCHEMES_OF_WORK,
      grade:       curr.grade,
      term:        form.term,
      subject:     curr.subject,
      syllabusHint: curriculum === 'obc' ? 'OBC' : 'CBC',
    }).catch((err) => console.error('[library attach]', err))
  }

  // Persist teacher edits made in the editable draft to the saved generation.
  async function onSaveEdits() {
    if (!generationId || !scheme) return
    setSavingEdit(true)
    setSaveMsg('')
    const stamped = stampEditHistory(scheme, 'edited in studio')
    const ok = await updateGenerationOutput(generationId, stamped)
    if (!isMounted.current) return
    if (ok) {
      setScheme(stamped)
      setSaveMsg('Saved to your library.')
    } else {
      setSaveMsg('Could not save — please try again.')
    }
    setSavingEdit(false)
  }

  /** Validate the settings, then either open the term preview or generate. */
  function onGenerate(e) {
    e?.preventDefault?.()
    if (!curr.curriculumMode) {
      setErrorMessage('Please choose a curriculum.')
      setStatus('error')
      return
    }
    if (!curr.grade || !curr.subject) {
      setErrorMessage('Please select a class and subject.')
      setStatus('error')
      return
    }
    if (!readiness.ready) {
      setErrorMessage(readiness.messages.find((m) => m.level === 'error')?.text || 'Some details are missing.')
      setStatus('error')
      return
    }
    setErrorMessage('')
    // When we have real syllabus topics, route through the review-and-approve
    // step so the teacher confirms the term's plan. With no syllabus data (the
    // AI-inferred path) there is nothing to preview — generate directly.
    if (hasSyllabusTopics) {
      setStep('preview')
      return
    }
    runGenerate({})
  }

  /** Approve handler from the preview — generate with the edited term plan. */
  function onApproveTermPlan(term, items) {
    runGenerate({ term, topicSelection: toTopicSelectionPayload(items) })
  }

  async function runGenerate(overrides = {}) {
    if (!ensureCanGenerate('scheme_of_work')) return
    setGenOverrides(overrides)
    if (overrides.term) updateField('term', overrides.term)
    setHandedOff(false)
    setSaveMsg('')
    setStatus('generating')
    setErrorMessage('')
    setWarning('')
    setAdvisories([])
    setCurriculumSource('')
    setQualityChecks(null)
    setScheme(null)
    setStep('form')

    const genTerm = overrides.term || form.term
    const res = await generateSchemeOfWork(buildInputs(overrides))
    if (!isMounted.current) return
    if (!res.ok) {
      setStatus('error')
      setErrorMessage(res.error)
      return
    }
    setScheme(res.data.schemeOfWork)
    setGenerationId(res.data.generationId)
    setUsage(res.data.usage)
    setWarning(res.data.warning || '')
    setAdvisories(Array.isArray(res.data.advisories) ? res.data.advisories : [])
    setCurriculumSource(res.data.curriculumSource || '')
    setQualityChecks(res.data.qualityChecks || null)
    setStatus('success')
    draft.clear().catch(() => {})

    if (res.data.generationId) {
      attachLibraryToGeneration(res.data.generationId, {
        libraryType: LIBRARY_TYPES.SCHEMES_OF_WORK,
        grade:       curr.grade,
        term:        genTerm,
        subject:     curr.subject,
        syllabusHint: curriculum === 'obc' ? 'OBC' : 'CBC',
      }).catch(() => { /* non-fatal — doc still readable via legacy path */ })
    }
  }

  function onExportDocx() {
    if (!scheme) return
    const name = buildDownloadName({
      docType: 'Scheme of Work',
      grade: curr.grade,
      subject: curr.subjectLabel || curr.subject,
      term: form.term,
    })
    downloadSchemeOfWorkDocx(scheme, name, { attribution: isFreePlanTeacher({ userProfile, isAdmin }) })
  }

  function onExportPdf() {
    if (!scheme) return
    const name = buildDownloadName({
      docType: 'Scheme of Work',
      grade: curr.grade,
      subject: curr.subjectLabel || curr.subject,
      term: form.term,
      ext: 'pdf',
    })
    downloadSchemeOfWorkPdf(scheme, name, { attribution: isFreePlanTeacher({ userProfile, isAdmin }) })
  }

  const subjectLabel = curr.subjectLabel || (curr.subject
    ? String(curr.subject).replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
    : '')
  const gradeLabel = curr.grade ? String(curr.grade).replace(/^G/i, 'Grade ') : ''
  const holidayWeeks = (reservedPlan?.weeks || []).filter((w) => w.holidays?.length)

  return (
    <div className="studio-page">
      <SeoHelmet title="Scheme of work" noIndex />
      <div className="w-full">
        <StudioPageHeader
          eyebrow="Scheme of Work"
          title="Plan your whole term"
          subtitle="A curriculum-aware planner: sequences your Syllabus Studio topics across the real teaching weeks from the School Calendar, paced to the Curriculum Framework — in the correct CBC or OBC format."
          emoji="🦁"
        />

        <div className="space-y-6">
          <div className="studio-form">
            <DraftRecoveryPrompt {...draft} label="scheme of work" />
          </div>
          <form
            onSubmit={onGenerate}
            className="studio-card p-5 space-y-4 studio-form"
          >
            <div className="flex justify-end">
              <DraftStatusIndicator status={draft.status} savedAt={draft.savedAt} online={draft.online} />
            </div>
            <StudioCurriculumSelector
              key={selectorKey}
              value={selectorSeed}
              onChange={setCurr}
              showTopicSubtopic={false}
            />
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <FieldSelect
                label="Term"
                value={String(form.term)}
                options={SCHEME_TERMS.map((t) => ({ value: String(t.value), label: t.label }))}
                onChange={(v) => updateField('term', Number(v))}
              />
              <FieldSelect
                label="Academic year"
                value={String(form.year)}
                options={CALENDAR_YEARS.map((y) => ({ value: String(y), label: String(y) }))}
                onChange={(v) => updateField('year', Number(v))}
              />
            </div>

            {/* Calendar-derived teaching weeks + reservation */}
            <div className="rounded-xl border theme-border p-3.5 space-y-3" style={{ background: '#fbfaf5' }}>
              <div className="flex items-center justify-between flex-wrap gap-2">
                <span className="text-sm font-bold" style={{ color: '#0e2a32' }}>
                  📅 Teaching weeks
                </span>
                <span className="text-sm" style={{ color: '#566f76' }}>
                  {calendarWeeks
                    ? <>School Calendar: <b>{calendarWeeks} weeks</b> · Term {form.term} {form.year}</>
                    : 'No calendar data for this year/term'}
                </span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <FieldText
                  label={`Weeks (override)`}
                  placeholder={calendarWeeks ? String(calendarWeeks) : '12'}
                  value={form.weeksOverride}
                  onChange={(v) => updateField('weeksOverride', v.replace(/[^0-9]/g, ''))}
                  maxLength={2}
                />
                <FieldText
                  label="Exam week(s)"
                  placeholder={effectiveWeeks ? String(effectiveWeeks) : 'e.g. 13'}
                  value={form.examWeeks}
                  onChange={(v) => updateField('examWeeks', v)}
                  maxLength={20}
                />
                <FieldText
                  label="Revision week(s)"
                  placeholder={revisionIsDefault && revisionWeeksArr.length > 0
                    ? revisionWeeksArr.join(', ')
                    : 'e.g. 11, 12'}
                  value={form.revisionWeeks}
                  onChange={(v) => updateField('revisionWeeks', v)}
                  maxLength={20}
                />
              </div>
              {reservedPlan && (
                <p className="text-xs" style={{ color: '#566f76' }}>
                  {deliveryWeekCount(reservedPlan)} teaching weeks ·{' '}
                  {reservedWeekCount(reservedPlan)} reserved (exam/revision)
                  {revisionIsDefault && revisionWeeksArr.length > 0 && (
                    <> · revision suggested in week{revisionWeeksArr.length > 1 ? 's' : ''}{' '}
                      {revisionWeeksArr.join(', ')} — type your own weeks (or &ldquo;none&rdquo;) to change</>
                  )}
                  {holidayWeeks.length > 0 && (
                    <> · holidays in week{holidayWeeks.length > 1 ? 's' : ''}{' '}
                      {holidayWeeks.map((w) => w.weekNumber).join(', ')}</>
                  )}
                </p>
              )}
            </div>

            {/* Framework time allocation — auto or manual */}
            <div className="rounded-xl border theme-border p-3.5 space-y-2" style={{ background: '#fbfaf5' }}>
              <span className="text-sm font-bold" style={{ color: '#0e2a32' }}>⏱️ Time allocation</span>
              {frameworkMatch ? (
                <p className="text-sm" style={{ color: '#566f76' }}>
                  Curriculum Framework: <b>{frameworkMatch.periodsPerWeek} periods × {frameworkMatch.periodMinutes} min</b>
                  {frameworkMatch.timeAllocation ? <> · {frameworkMatch.timeAllocation}/week</> : null}
                </p>
              ) : (
                <>
                  <p className="text-xs" style={{ color: '#b45309' }}>
                    Time allocation for this subject is missing. Please update Curriculum Framework data or enter periods manually.
                  </p>
                  <FieldText
                    label="Periods per week (manual)"
                    placeholder="e.g. 5"
                    value={form.manualPeriods}
                    onChange={(v) => updateField('manualPeriods', v.replace(/[^0-9]/g, ''))}
                    maxLength={2}
                  />
                </>
              )}
            </div>

            <div>
              <FieldSelect
                label="Class timetable (optional)"
                value={timetableId}
                options={timetableOptions}
                onChange={setTimetableId}
              />
              <p className="text-xs mt-1" style={{ color: '#566f76' }}>
                {timetables.length
                  ? 'Attach a saved timetable to pace the scheme around your real periods and teaching days.'
                  : 'No saved timetables yet — create one in the Class Timetable Studio to make schemes timetable-aware.'}
              </p>
            </div>
            <FieldSelect
              label="Language"
              value={form.language}
              options={TEACHER_LANGUAGES}
              onChange={(v) => updateField('language', v)}
            />
            <FieldText
              label="School"
              placeholder="School name"
              value={form.school}
              onChange={(v) => updateField('school', v)}
              maxLength={120}
            />
            <FieldText
              label="Teacher name"
              placeholder="Mr / Mrs ..."
              value={form.teacherName}
              onChange={(v) => updateField('teacherName', v)}
              maxLength={80}
            />
            <FieldTextarea
              label="Extra instructions (optional)"
              placeholder="e.g. Emphasise revision in the last two weeks. Include a mock exam in Week 11."
              value={form.instructions}
              onChange={(v) => updateField('instructions', v)}
              maxLength={500}
            />

            {/* Smart preview card — the studio only lets you generate once valid */}
            {curr.curriculumMode && (
              <SchemePreviewCard
                curriculum={curriculum}
                gradeLabel={gradeLabel}
                subjectLabel={subjectLabel}
                term={form.term}
                teachingWeeks={effectiveWeeks}
                weeksSource={calendarWeeks && !form.weeksOverride ? 'from School Calendar' : (form.weeksOverride ? 'manual override' : '')}
                timePerWeek={timePerWeekStr}
                periodsPerWeek={periodsPerWeekStr}
                readiness={readiness}
              />
            )}

            <button
              type="submit"
              disabled={status === 'generating' || !readiness.ready}
              className="studio-btn-primary w-full py-3 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {status === 'generating'
                ? 'Generating…'
                : hasSyllabusTopics
                  ? '🦁 Review term topics →'
                  : '▶ Generate Scheme of Work'}
            </button>
            {hasSyllabusTopics && (
              <p className="text-xs text-center" style={{ color: '#566f76' }}>
                We'll divide the syllabus across the terms and let you review Term {form.term}'s topics before generating.
              </p>
            )}

            {usage && (
              <div className="text-xs theme-text-secondary text-center">
                {usage.used}/{usage.limit} schemes used on the{' '}
                <span className="font-bold capitalize">{usage.plan}</span> plan this month
              </div>
            )}
          </form>

          {step === 'preview' ? (
            <StudioOutputBoundary onRetry={() => setStep('form')}>
              <SchemeTermPreview
                topics={syllabusTopics}
                focusTerm={form.term}
                scope={planScope}
                onScopeChange={setPlanScope}
                weeksByTerm={weeksByTerm}
                termMeta={termCalendars}
                gradeLabel={gradeLabel}
                subjectLabel={subjectLabel}
                curriculumLabel={curriculumLabel(curriculum)}
                loading={topicsLoading}
                busy={status === 'generating'}
                onApprove={onApproveTermPlan}
                onBack={() => setStep('form')}
              />
            </StudioOutputBoundary>
          ) : (
          <StudioOutputBoundary onRetry={() => setStatus('idle')}>
          {handedOff && status === 'success' && scheme ? (
          <section className="studio-card p-5 min-h-[400px]">
              <>
                <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
                  <div>
                    <h2 className="studio-display" style={{ fontSize: 22, margin: '0 0 2px' }}>Edit your Scheme of Work</h2>
                    <p className="text-xs" style={{ color: '#566f76' }}>
                      {scheme.header?.numberOfWeeks || scheme.weeks?.length} weeks · Term {scheme.header?.term} · you're in control — edit anything before or after saving
                    </p>
                  </div>
                  <div className="flex gap-2 flex-wrap">
                    <button onClick={onSaveEdits} disabled={savingEdit} className="studio-btn-primary disabled:opacity-50">
                      {savingEdit ? 'Saving…' : '💾 Save changes'}
                    </button>
                    <button onClick={onExportDocx} className="studio-btn-ghost">
                      📄 .docx
                    </button>
                    <button onClick={onExportPdf} className="studio-btn-ghost">
                      📄 .pdf
                    </button>
                    <button onClick={() => setStatus('idle')} className="studio-btn-ghost">
                      ▶ Generate Another
                    </button>
                  </div>
                </div>
                {saveMsg && (
                  <div className="mb-4 rounded-xl border border-emerald-300 bg-emerald-50 text-emerald-900 px-4 py-2 text-sm">
                    ✓ {saveMsg}
                  </div>
                )}
                {warning && (
                  <div className="mb-4 rounded-xl border border-amber-300 bg-amber-50 text-amber-900 px-4 py-3 text-sm">
                    ⚠️ {warning}
                  </div>
                )}
                <AdvisoryPanel advisories={advisories} curriculumSource={curriculumSource} />
                <QualityChecklist result={qualityChecks} />
                <SchemeEditableTable scheme={scheme} onChange={setScheme} />
                <div className="mt-6">
                  <details open>
                    <summary className="text-xs font-bold cursor-pointer" style={{ color: '#566f76' }}>
                      Preview the printed page
                    </summary>
                    <div className="mt-3">
                      <SchemeOfWorkView scheme={scheme} />
                    </div>
                  </details>
                </div>
                {generationId && (
                  <div className="mt-6 text-xs theme-text-secondary">
                    Saved as generation <code>{generationId}</code>.
                  </div>
                )}
              </>
          </section>
          ) : (
            <LiveGenerationCanvas
              tool="scheme"
              status={status}
              result={scheme}
              docTitle={scheme?.header ? `Scheme of Work — Term ${scheme.header.term || ''}`.trim() : undefined}
              title="Mapping your scheme of work…"
              livePreview={<LiveSchemeReveal scheme={scheme} status={status} />}
              emptyState={<EmptyState />}
              errorMessage={errorMessage}
              savedToLibrary={Boolean(generationId)}
              onStop={() => setStatus('idle')}
              onRegenerate={() => runGenerate(genOverrides)}
              onRegenerateSection={regenerateSection}
              onSaveToLibrary={saveToLibrary}
              onContinueEditing={() => setHandedOff(true)}
              onRetry={() => setStatus('idle')}
              continueLabel="Continue to editing & export"
            />
          )}
          </StudioOutputBoundary>
          )}
        </div>
      </div>
    </div>
  )
}

/* ── Curriculum advisories + provenance ─────────────────────── */

function AdvisoryPanel({ advisories, curriculumSource }) {
  const list = Array.isArray(advisories) ? advisories : []
  const sourceMeta = SOURCE_META[curriculumSource]
  if (list.length === 0 && !sourceMeta) return null

  return (
    <div className="mb-5 space-y-2">
      {sourceMeta && (
        <div
          className="rounded-xl border px-4 py-2.5 text-sm flex items-center gap-2"
          style={{ background: '#f0f7f4', borderColor: '#bfe3d4', color: '#0e2a32' }}
        >
          <span>🧭</span>
          <span>
            Curriculum source:{' '}
            <strong style={{ color: sourceMeta.fg }}>{sourceMeta.label}</strong>
            {curriculumSource === 'ai_inferred' &&
              ' — no official outline was found, so general CBC knowledge was used.'}
            {curriculumSource === 'uploaded_module' &&
              ' — grounded on an uploaded module.'}
            {curriculumSource === 'syllabi_studio' &&
              ' — topics pulled from the official Syllabi Studio outline.'}
          </span>
        </div>
      )}
      {list.map((a, i) => {
        const warn = a.level === 'warning'
        return (
          <div
            key={`${a.code || 'adv'}-${i}`}
            className="rounded-xl border px-4 py-2.5 text-sm flex items-start gap-2"
            style={warn
              ? { background: '#fffbeb', borderColor: '#fcd34d', color: '#92400e' }
              : { background: '#eff6ff', borderColor: '#bfdbfe', color: '#1e40af' }}
          >
            <span>{warn ? '⚠️' : 'ℹ️'}</span>
            <span>{a.message}</span>
          </div>
        )
      })}
    </div>
  )
}

/* ── Quality checklist (deterministic, from the server) ─────── */

function QualityChecklist({ result }) {
  const checks = Array.isArray(result?.checks) ? result.checks : []
  if (checks.length === 0) return null
  const failedCount = checks.filter((c) => !c.ok).length
  const allOk = failedCount === 0
  return (
    <details
      className="mb-5 rounded-xl border px-4 py-2.5 text-sm"
      style={allOk
        ? { background: '#f0fdf4', borderColor: '#bbf7d0', color: '#14532d' }
        : { background: '#fffbeb', borderColor: '#fcd34d', color: '#92400e' }}
      open={!allOk}
    >
      <summary className="cursor-pointer font-bold">
        {allOk ? '✅' : '⚠️'} Quality checks — {checks.length - failedCount}/{checks.length} passed
        {!allOk && ' · review the items below (every cell is editable)'}
      </summary>
      <ul className="mt-2 space-y-1">
        {checks.map((c) => (
          <li key={c.code} className="flex items-start gap-2">
            <span aria-hidden="true">{c.ok ? '✓' : '✗'}</span>
            <span>
              {c.label}
              {!c.ok && c.detail ? <span style={{ opacity: 0.85 }}> — {c.detail}</span> : null}
            </span>
          </li>
        ))}
      </ul>
    </details>
  )
}

/* ── States ─────────────────────────────────────────────────── */

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center h-full py-12 text-center">
      <div style={{ width: 86, height: 86, borderRadius: '50%', background: '#faecb8', display: 'grid', placeItems: 'center', fontSize: 44 }}>
        🦁
      </div>
      <h3 className="studio-display mt-4" style={{ fontSize: 20 }}>Plan a whole term at once</h3>
      <p className="text-sm max-w-md mt-1" style={{ color: '#566f76' }}>
        Pick curriculum, grade, subject and term. You'll get a full week-by-week
        scheme of work, paced to the calendar — ready to edit and print.
      </p>
    </div>
  )
}

/* ── Live printed-page preview ──────────────────────────────────────
 * Shows the REAL scheme-of-work document (the exact printed page) inside the
 * generation canvas. While the model is still working it shows a page skeleton;
 * once the scheme lands, the weeks reveal row by row so the teacher watches the
 * document being built — an honest, paced unveiling of the real result (the
 * generator returns the whole scheme at once). Respects reduced-motion. */
function LiveSchemeReveal({ scheme, status }) {
  const total = Array.isArray(scheme?.weeks) ? scheme.weeks.length : 0
  const [shown, setShown] = useState(0)

  useEffect(() => {
    if (status !== 'success' || total === 0) {
      setShown(0)
      return undefined
    }
    const reduce = typeof window !== 'undefined' && window.matchMedia &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (reduce) {
      setShown(total)
      return undefined
    }
    setShown(1)
    let i = 1
    const id = setInterval(() => {
      i += 1
      setShown((s) => Math.min(total, Math.max(s, i)))
      if (i >= total) clearInterval(id)
    }, 180)
    return () => clearInterval(id)
  }, [scheme, status, total])

  if (status === 'generating' || !scheme || total === 0) {
    return <SchemeSkeleton />
  }

  const visible = shown === 0 ? total : shown
  const partial = { ...scheme, weeks: scheme.weeks.slice(0, visible) }
  return (
    <div>
      <SchemeOfWorkView scheme={partial} />
      {visible < total && (
        <p className="mt-2 text-center text-xs animate-pulse" style={{ color: '#566f76' }}>
          Writing week {visible + 1} of {total}…
        </p>
      )}
    </div>
  )
}

function SchemeSkeleton() {
  return (
    <div className="rounded-xl border theme-border bg-white p-5" aria-hidden="true">
      <div className="mx-auto h-4 w-2/3 rounded bg-slate-200 animate-pulse" />
      <div className="mx-auto mt-2 h-3 w-1/2 rounded bg-slate-100 animate-pulse" />
      <div className="mt-5 space-y-2">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="flex gap-2">
            <div className="h-3 w-8 rounded bg-slate-200 animate-pulse" />
            <div className="h-3 flex-1 rounded bg-slate-100 animate-pulse" />
            <div className="h-3 w-1/4 rounded bg-slate-100 animate-pulse" />
          </div>
        ))}
      </div>
    </div>
  )
}
