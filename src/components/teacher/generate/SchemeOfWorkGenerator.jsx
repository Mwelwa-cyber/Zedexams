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
} from '../../../utils/schemeTermPlan'
import { matchFrameworkSubject, periodsPerWeekLabel } from '../../../utils/frameworkSubjectMatch'
import { evaluate as evaluateReadiness } from '../../../utils/schemeReadiness'
import { normalizeCurriculum } from '../../../utils/schemeFormat'
import { stampEditHistory } from '../../../utils/schemeEditHistory'

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
  const [handedOff, setHandedOff] = useState(false)
  const [savingEdit, setSavingEdit] = useState(false)
  const [saveMsg, setSaveMsg] = useState('')

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
  // to the last week when nothing is typed (how a term normally closes).
  const examWeeksArr = parseWeeks(form.examWeeks, effectiveWeeks)
  const revisionWeeksArr = parseWeeks(form.revisionWeeks, effectiveWeeks)
  const reservedPlan = useMemo(() => {
    if (!termPlan) return null
    const exam = examWeeksArr.length ? examWeeksArr : (effectiveWeeks ? [effectiveWeeks] : [])
    return reserveWeeks(termPlan, { examWeeks: exam, revisionWeeks: revisionWeeksArr })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [termPlan, form.examWeeks, form.revisionWeeks, effectiveWeeks])

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

  function buildInputs() {
    return {
      ...form,
      grade: curr.grade,
      subject: curr.subject,
      curriculum: curr.curriculum,
      framework: curr.framework,
      year: form.year,
      numberOfWeeks: effectiveWeeks || 12,
      periodsPerWeek: periodsPerWeekStr,
      timePerWeek: timePerWeekStr,
      weekPlan: reservedPlan ? toWeekPlanPayload(reservedPlan) : [],
      timetable: selectedTimetablePayload(),
    }
  }

  async function regenerateSection(sectionId) {
    const res = await generateSchemeOfWork(buildInputs())
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

  async function onGenerate(e) {
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
    if (!ensureCanGenerate('scheme_of_work')) return
    setHandedOff(false)
    setSaveMsg('')
    setStatus('generating')
    setErrorMessage('')
    setWarning('')
    setAdvisories([])
    setCurriculumSource('')
    setScheme(null)

    const res = await generateSchemeOfWork(buildInputs())
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
    setStatus('success')
    draft.clear().catch(() => {})

    if (res.data.generationId) {
      attachLibraryToGeneration(res.data.generationId, {
        libraryType: LIBRARY_TYPES.SCHEMES_OF_WORK,
        grade:       curr.grade,
        term:        form.term,
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
                  placeholder="e.g. 11, 12"
                  value={form.revisionWeeks}
                  onChange={(v) => updateField('revisionWeeks', v)}
                  maxLength={20}
                />
              </div>
              {reservedPlan && (
                <p className="text-xs" style={{ color: '#566f76' }}>
                  {deliveryWeekCount(reservedPlan)} teaching weeks ·{' '}
                  {reservedWeekCount(reservedPlan)} reserved (exam/revision)
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
              {status === 'generating' ? 'Generating…' : '▶ Generate Scheme of Work'}
            </button>

            {usage && (
              <div className="text-xs theme-text-secondary text-center">
                {usage.used}/{usage.limit} schemes used on the{' '}
                <span className="font-bold capitalize">{usage.plan}</span> plan this month
              </div>
            )}
          </form>

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
                <SchemeEditableTable scheme={scheme} onChange={setScheme} />
                <div className="mt-6">
                  <details>
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
              emptyState={<EmptyState />}
              errorMessage={errorMessage}
              savedToLibrary={Boolean(generationId)}
              onStop={() => setStatus('idle')}
              onRegenerate={() => onGenerate()}
              onRegenerateSection={regenerateSection}
              onSaveToLibrary={saveToLibrary}
              onContinueEditing={() => setHandedOff(true)}
              onRetry={() => setStatus('idle')}
              continueLabel="Continue to editing & export"
            />
          )}
          </StudioOutputBoundary>
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
