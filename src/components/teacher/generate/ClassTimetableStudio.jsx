/**
 * Class Timetable studio — /teacher/generate/class-timetable
 *
 * Pure client-side tool (no AI call, no usage meter). The teacher sets the
 * class, the teaching days and the period times, then either auto-fills the
 * week from the curriculum subjects (a deterministic, balanced spread — see
 * src/utils/classTimetable.js) or fills cells by hand. Subjects are seeded
 * from the site curriculum for the chosen grade.
 *
 * Outputs the official timetable grid on screen and as DOCX / XLSX / PDF,
 * and saves to the teacher's library. Drafts autosave to localStorage per
 * teacher so a half-built week survives a refresh.
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../../../contexts/AuthContext'
import { TEACHER_GRADES } from '../../../utils/teacherTools'
import {
  DAYS_OF_WEEK,
  DEFAULT_DAYS,
  DEFAULT_TIMING,
  buildPeriods,
  lessonPeriods as lessonRowsOf,
  lessonCapacity,
  curriculumSubjectsForGrade,
  newSubject,
  defaultPeriodsPerWeek,
  recommendedLessonPeriods,
  autoFillTimetable,
  validateTimetable,
  totalAllocated,
  filledCount,
  buildTimetableArtifact,
  dayEndTime,
  timeToMinutes,
} from '../../../utils/classTimetable'
import { getFrameworkForGrade, FRAMEWORK_SOURCE } from '../../../utils/curriculumFramework'
import { saveClassTimetableGeneration, isFreePlanTeacher } from '../../../utils/teacherLibraryService'
import { downloadClassTimetableDocx } from '../../../utils/classTimetableToDocx'
import { downloadClassTimetableXlsx } from '../../../utils/classTimetableToXlsx'
import { buildDownloadName } from '../../../utils/downloadFilename'
import { downloadClassTimetablePdf } from '../../../utils/classTimetableToPdf'
import { clampInt } from '../../../utils/inputs.js'
import ClassTimetableView from '../views/ClassTimetableView'
import TimetableUploadPanel from './TimetableUploadPanel'
import StudioPageHeader from '../StudioPageHeader'
import SeoHelmet from '../../seo/SeoHelmet'
import ConfirmDialog from '../../ui/ConfirmDialog'
import { useToast } from '../../ui/Toast'

const DRAFT_PREFIX = 'examprep:classtimetable:draft:'
const DRAFT_TTL = 60 * 24 * 60 * 60 * 1000 // 60 days — a timetable spans a term
const draftKey = (uid) => `${DRAFT_PREFIX}${uid || 'anon'}`

const GRADE_OPTIONS = TEACHER_GRADES.filter((g) => g.value)

function seedSubjects(grade) {
  const fromCurriculum = curriculumSubjectsForGrade(grade)
  if (fromCurriculum.length) return fromCurriculum
  // Grades with no catalogued list — start from a minimal core the teacher
  // can rename/extend.
  return ['Mathematics', 'English', 'Science'].map((l) => ({
    id: `s-${l}`, label: l, periodsPerWeek: defaultPeriodsPerWeek(l),
  }))
}

/** Lesson periods/day that fit the framework's weekly load for a grade, or
 * the studio default when the framework doesn't cover it (secondary). */
function lessonPeriodsForGrade(grade, days) {
  const fw = getFrameworkForGrade(grade)
  return fw ? recommendedLessonPeriods(fw.totalPeriods, days) : DEFAULT_TIMING.lessonPeriods
}

function loadDraft(uid) {
  try {
    const raw = localStorage.getItem(draftKey(uid))
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (!parsed?.savedAt || Date.now() - parsed.savedAt > DRAFT_TTL) return null
    return parsed
  } catch { return null }
}

export default function ClassTimetableStudio() {
  const { currentUser, userProfile, isAdmin } = useAuth()
  const toast = useToast()
  const uid = currentUser?.uid

  const initialGrade = 'G5'
  const [header, setHeader] = useState(() => ({
    school: userProfile?.school || userProfile?.schoolName || '',
    grade: initialGrade,
    className: '',
    term: '',
    year: String(new Date().getFullYear()),
    teacherName: userProfile?.displayName || userProfile?.fullName || '',
  }))
  const [days, setDays] = useState(DEFAULT_DAYS)
  const [timing, setTiming] = useState(() => ({
    startTime: DEFAULT_TIMING.startTime,
    endTime: DEFAULT_TIMING.endTime,
    fitToEndTime: DEFAULT_TIMING.fitToEndTime,
    periodMinutes: DEFAULT_TIMING.periodMinutes,
    // Right-size the grid to the framework's weekly load for the starting grade.
    lessonPeriods: lessonPeriodsForGrade(initialGrade, DEFAULT_DAYS),
    breaks: DEFAULT_TIMING.breaks.map((b) => ({ ...b, enabled: true })),
  }))
  const [subjects, setSubjects] = useState(() => seedSubjects(initialGrade))
  const [slots, setSlots] = useState({})

  const [generationId, setGenerationId] = useState(null)
  const [saving, setSaving] = useState(false)
  const [dirtySinceSave, setDirtySinceSave] = useState(false)
  const [confirmClear, setConfirmClear] = useState(false)
  const loadedRef = useRef(false)
  const lastGradeRef = useRef(initialGrade)
  // Skip the mount + draft-restore runs of the dirty-marking effect so a
  // freshly-loaded saved timetable isn't flagged "Update in library".
  const dirtySkipRef = useRef(1)

  const periods = useMemo(() => buildPeriods(timing), [timing])
  const capacity = useMemo(() => lessonCapacity(periods, days), [periods, days])

  /* Timing readouts. In fit mode the period length is derived (shown to the
   * teacher); in fixed mode the day end is computed and checked against the
   * teacher's target knock-off time. */
  const derivedPeriodMinutes = useMemo(() => {
    if (!timing.fitToEndTime) return 0
    const lessons = lessonRowsOf(periods)
    if (!lessons.length) return 0
    const total = lessons.reduce((sum, p) => sum + (timeToMinutes(p.end) - timeToMinutes(p.start)), 0)
    return Math.round(total / lessons.length)
  }, [timing.fitToEndTime, periods])
  const computedEnd = useMemo(() => dayEndTime(periods), [periods])
  const knockOffDelta = useMemo(() => {
    if (timing.fitToEndTime || !computedEnd || !timing.endTime) return null
    return timeToMinutes(computedEnd) - timeToMinutes(timing.endTime)
  }, [timing.fitToEndTime, timing.endTime, computedEnd])
  const allocated = useMemo(() => totalAllocated(subjects), [subjects])
  const filled = useMemo(() => filledCount(slots, periods, days), [slots, periods, days])
  const framework = useMemo(() => getFrameworkForGrade(header.grade), [header.grade])
  const validation = useMemo(
    () => validateTimetable({ slots, subjects, periods, days }),
    [slots, subjects, periods, days],
  )

  const artifact = useMemo(() => buildTimetableArtifact({
    header: { ...header, term: header.term === '' ? '' : Number(header.term) },
    days,
    periods,
    slots,
  }), [header, days, periods, slots])

  /* Restore a saved draft once per mount. */
  useEffect(() => {
    if (loadedRef.current || !uid) return
    loadedRef.current = true
    const draft = loadDraft(uid)
    if (!draft) return
    let restoredDirtyState = false
    if (draft.header) { setHeader((h) => ({ ...h, ...draft.header })); lastGradeRef.current = draft.header.grade || lastGradeRef.current; restoredDirtyState = true }
    if (Array.isArray(draft.days) && draft.days.length) { setDays(draft.days); restoredDirtyState = true }
    if (draft.timing) { setTiming((t) => ({ ...t, ...draft.timing })); restoredDirtyState = true }
    if (Array.isArray(draft.subjects) && draft.subjects.length) { setSubjects(draft.subjects); restoredDirtyState = true }
    if (draft.slots && typeof draft.slots === 'object') { setSlots(draft.slots); restoredDirtyState = true }
    if (draft.generationId) setGenerationId(draft.generationId)
    if (restoredDirtyState) dirtySkipRef.current += 1
  }, [uid])

  /* Reseed the subject list — and right-size the grid — from the curriculum
   * when the grade changes. Skipped on the initial draft restore (the grade
   * matches lastGradeRef there, so a half-built week is never wiped). */
  useEffect(() => {
    if (header.grade === lastGradeRef.current) return
    lastGradeRef.current = header.grade
    setSubjects(seedSubjects(header.grade))
    setTiming((t) => ({ ...t, lessonPeriods: lessonPeriodsForGrade(header.grade, days) }))
    setSlots({})
  }, [header.grade, days])

  /* Debounced autosave. */
  useEffect(() => {
    if (!uid) return undefined
    const t = setTimeout(() => {
      try {
        localStorage.setItem(draftKey(uid), JSON.stringify({
          savedAt: Date.now(), header, days, timing, subjects, slots, generationId,
        }))
      } catch { /* storage full/blocked — the editor still works */ }
    }, 800)
    return () => clearTimeout(t)
  }, [uid, header, days, timing, subjects, slots, generationId])

  /* Any data edit marks the library copy stale. */
  useEffect(() => {
    if (dirtySkipRef.current > 0) { dirtySkipRef.current -= 1; return }
    setDirtySinceSave(true)
  }, [header, days, timing, subjects, slots])

  const setH = (field, value) => setHeader((h) => ({ ...h, [field]: value }))
  const setT = (field, value) => setTiming((t) => ({ ...t, [field]: value }))

  function toggleDay(day) {
    setDays((list) => list.includes(day)
      ? list.filter((d) => d !== day)
      : DAYS_OF_WEEK.filter((d) => d === day || list.includes(d)))
  }

  /* ── subjects ── */
  function updateSubject(id, field, value) {
    setSubjects((list) => list.map((s) => (s.id === id ? { ...s, [field]: value } : s)))
  }
  function addSubject() {
    setSubjects((list) => [...list, newSubject(`Subject ${list.length + 1}`)])
  }
  function removeSubject(id) {
    setSubjects((list) => (list.length > 1 ? list.filter((s) => s.id !== id) : list))
  }
  function resetSubjectsFromCurriculum() {
    setSubjects(seedSubjects(header.grade))
    toast.info('Subjects reset from the curriculum for this grade.')
  }

  /* ── breaks ── */
  function updateBreak(idx, field, value) {
    setTiming((t) => ({
      ...t,
      breaks: t.breaks.map((b, i) => (i === idx ? { ...b, [field]: value } : b)),
    }))
  }

  /* ── grid ── */
  function setCell(pid, day, value) {
    setSlots((prev) => {
      const next = { ...prev, [pid]: { ...(prev[pid] || {}) } }
      if (value) next[pid][day] = value
      else delete next[pid][day]
      return next
    })
  }

  function onAutoFill() {
    if (!days.length) { toast.error('Pick at least one teaching day first.'); return }
    if (!subjects.length) { toast.error('Add at least one subject first.'); return }
    setSlots(autoFillTimetable({ subjects, days, periods }))
    toast.success('Timetable auto-filled — fine-tune any cell below.')
  }

  /* Build a fresh curriculum-based week: reset subjects to the framework
   * allocation for the grade, right-size the grid to fit the weekly load,
   * then spread it with the balanced auto-fill. */
  function onGenerateFromCurriculum() {
    if (!days.length) { toast.error('Pick at least one teaching day first.'); return }
    const fresh = seedSubjects(header.grade)
    setSubjects(fresh)
    let nextPeriods = periods
    if (framework) {
      const rec = recommendedLessonPeriods(framework.totalPeriods, days)
      if (rec !== timing.lessonPeriods) {
        const nextTiming = { ...timing, lessonPeriods: rec }
        setTiming(nextTiming)
        nextPeriods = buildPeriods(nextTiming)
      }
    }
    setSlots(autoFillTimetable({ subjects: fresh, days, periods: nextPeriods }))
    toast.success('Curriculum timetable generated — review and fine-tune below.')
  }

  function onClearGrid() {
    setSlots({})
    setConfirmClear(false)
    toast.info('Grid cleared.')
  }

  /* Apply an uploaded/photographed timetable into the editable grid. Subjects
   * reset to the grade's curriculum allocation so the curriculum check can
   * tell the teacher whether the upload matches the requirements. */
  function onUploadExtracted(result) {
    if (!result) return
    if (Array.isArray(result.days) && result.days.length) setDays(result.days)
    // An uploaded grid carries explicit period lengths, not a knock-off time —
    // reproduce it with the fixed-length builder.
    if (result.timing) setTiming((t) => ({ ...t, ...result.timing, fitToEndTime: false }))
    setSubjects(seedSubjects(header.grade))
    setSlots(result.slots || {})
  }

  /* ── persistence + export ── */
  async function onSaveToLibrary() {
    if (saving) return
    if (filled === 0) { toast.error('Fill at least one lesson before saving.'); return }
    setSaving(true)
    try {
      const id = await saveClassTimetableGeneration({ uid, existingId: generationId, artifact })
      setGenerationId(id)
      setDirtySinceSave(false)
      toast.success(generationId ? 'Library copy updated.' : 'Saved to your library.')
    } catch (err) {
      console.error('[ClassTimetableStudio] save failed', err)
      toast.error(err?.message || 'Could not save to your library. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  function fileBase(ext = 'docx') {
    return buildDownloadName({
      docType: 'Class Timetable',
      grade: header.grade,
      extra: header.className,
      term: header.term,
      year: header.year,
      ext,
    })
  }
  const attribution = isFreePlanTeacher({ userProfile, isAdmin })

  async function onExportDocx() {
    if (filled === 0) { toast.error('Fill the timetable first.'); return }
    try {
      await downloadClassTimetableDocx(artifact, fileBase('docx'), { attribution })
      toast.success('Timetable downloaded.')
    } catch (err) {
      console.error('[ClassTimetableStudio] docx export failed', err)
      toast.error('Could not build the Word file. Please try again.')
    }
  }
  async function onExportXlsx() {
    if (filled === 0) { toast.error('Fill the timetable first.'); return }
    try {
      await downloadClassTimetableXlsx(artifact, fileBase('xlsx'))
      toast.success('Excel workbook downloaded.')
    } catch (err) {
      console.error('[ClassTimetableStudio] xlsx export failed', err)
      toast.error('Could not build the Excel file. Please try again.')
    }
  }
  async function onExportPdf() {
    if (filled === 0) { toast.error('Fill the timetable first.'); return }
    try {
      await downloadClassTimetablePdf(artifact, { attribution, filename: fileBase('pdf') })
      toast.success('Timetable PDF downloaded.')
    } catch (err) {
      console.error('[ClassTimetableStudio] pdf export failed', err)
      toast.error(err?.message || 'Could not build the PDF. Please try again.')
    }
  }

  const overAllocated = allocated > capacity
  const subjectLabels = subjects.map((s) => s.label).filter(Boolean)

  return (
    <div className="min-h-screen py-4 sm:py-6 lg:py-8" style={{ background: '#f5efe1' }}>
      <SeoHelmet title="Class timetable" noIndex />
      <div className="max-w-7xl mx-auto">
        <StudioPageHeader
          eyebrow="Class Timetable"
          title="Build your week from the curriculum"
          subtitle="Pick a grade and the studio knows the 2023 framework subjects and how many periods each needs. Set when school reports and knocks off, with a break and lunch (or just a break), then generate a balanced week in one click and fine-tune any cell. Print it, or export to Word, Excel or PDF."
          emoji="🗓️"
        />

        <div className="space-y-6">
          {/* ── Class details ── */}
          <section className="studio-card p-5 space-y-4">
            <h2 className="studio-display" style={{ fontSize: 18, color: '#0e2a32', margin: 0 }}>Class details</h2>
            <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
              <Field label="School">
                <input type="text" value={header.school} maxLength={120}
                  onChange={(e) => setH('school', e.target.value)}
                  placeholder="School name" className="studio-input" />
              </Field>
              <Field label="Grade">
                <select value={header.grade} onChange={(e) => setH('grade', e.target.value)} className="studio-input">
                  {GRADE_OPTIONS.map((g) => <option key={g.value} value={g.value}>{g.label}</option>)}
                </select>
              </Field>
              <Field label="Class / stream (optional)">
                <input type="text" value={header.className} maxLength={40}
                  onChange={(e) => setH('className', e.target.value)}
                  placeholder="e.g. Grade 5 Blue" className="studio-input" />
              </Field>
              <Field label="Term (optional)">
                <select value={String(header.term)} onChange={(e) => setH('term', e.target.value)} className="studio-input">
                  <option value="">No term</option>
                  {[1, 2, 3].map((t) => <option key={t} value={t}>Term {t}</option>)}
                </select>
              </Field>
              <Field label="Year">
                <input type="text" value={header.year} maxLength={4}
                  onChange={(e) => setH('year', e.target.value.replace(/[^\d]/g, ''))}
                  className="studio-input" />
              </Field>
              <Field label="Class teacher">
                <input type="text" value={header.teacherName} maxLength={80}
                  onChange={(e) => setH('teacherName', e.target.value)}
                  placeholder="Mr / Mrs ..." className="studio-input" />
              </Field>
            </div>

            <Field label="Teaching days">
              <div className="flex flex-wrap gap-2">
                {DAYS_OF_WEEK.map((day) => {
                  const on = days.includes(day)
                  return (
                    <button key={day} type="button" onClick={() => toggleDay(day)}
                      aria-pressed={on}
                      className={`rounded-full px-3 py-1.5 text-xs font-black border transition-all ${
                        on ? 'theme-accent-fill theme-on-accent border-transparent' : 'bg-white theme-text-muted theme-border hover:theme-text'
                      }`}>
                      {day}
                    </button>
                  )
                })}
              </div>
            </Field>
          </section>

          {/* ── Curriculum requirements ── */}
          <section className="studio-card p-5 space-y-3">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <h2 className="studio-display" style={{ fontSize: 18, color: '#0e2a32', margin: 0 }}>Curriculum requirements</h2>
                {framework ? (
                  <p className="text-xs mt-0.5" style={{ color: '#566f76' }}>
                    {framework.bandLabel} · <strong>{framework.totalPeriods} periods/week</strong> · {framework.periodMinutes}-minute periods.
                    The 2023 framework sets which subjects belong to this grade and how many times each should appear in the week.
                  </p>
                ) : (
                  <p className="text-xs mt-0.5" style={{ color: '#566f76' }}>
                    No official framework allocation for this grade yet — subjects below start from the standard list; set the weekly periods yourself.
                  </p>
                )}
              </div>
              <button type="button" onClick={onGenerateFromCurriculum} className="studio-btn-primary whitespace-nowrap">
                ✨ Generate curriculum timetable
              </button>
            </div>

            {framework && (
              <>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                  {framework.subjects.filter((s) => s.periodsPerWeek > 0).map((s) => (
                    <div key={s.label} className="flex items-center justify-between gap-2 rounded-xl border theme-border bg-white px-3 py-1.5">
                      <span className="text-sm font-bold truncate" title={s.timeAllocation ? `${s.label} · ${s.timeAllocation}` : s.label}>
                        {s.label}
                        {s.choiceGroup && <span className="ml-1 text-[10px] font-black uppercase" style={{ color: '#9a7000' }}>· choice</span>}
                      </span>
                      <span className="text-xs font-black whitespace-nowrap" style={{ color: '#1E8449' }}>{s.periodsPerWeek}/wk</span>
                    </div>
                  ))}
                </div>
                <p className="text-[11px]" style={{ color: '#8a7f67' }}>
                  Source: {FRAMEWORK_SOURCE}. Expressive Arts or Home Economics is a one-of choice — swap their weekly periods to match your class.
                </p>
              </>
            )}
          </section>

          {/* ── Upload an existing timetable ── */}
          <TimetableUploadPanel grade={header.grade} days={days} onExtracted={onUploadExtracted} />

          {/* ── Period times ── */}
          <section className="studio-card p-5 space-y-4">
            <h2 className="studio-display" style={{ fontSize: 18, color: '#0e2a32', margin: 0 }}>Period times</h2>

            {/* How the day is timed: fit between report & knock-off, or fixed length */}
            <div className="space-y-1.5">
              <span className="studio-label">How should the day be timed?</span>
              <div className="inline-flex rounded-xl border theme-border overflow-hidden text-xs font-black">
                {[
                  { key: true, label: 'Fit to report & knock-off' },
                  { key: false, label: 'Fixed period length' },
                ].map((opt) => {
                  const on = !!timing.fitToEndTime === opt.key
                  return (
                    <button key={String(opt.key)} type="button"
                      onClick={() => setT('fitToEndTime', opt.key)}
                      aria-pressed={on}
                      className={`px-3 py-2 transition-all ${on ? 'theme-accent-fill theme-on-accent' : 'bg-white theme-text-muted hover:theme-text'}`}>
                      {opt.label}
                    </button>
                  )
                })}
              </div>
              <p className="text-xs" style={{ color: '#566f76' }}>
                {timing.fitToEndTime
                  ? 'Enter when the school reports and when it knocks off — the studio shares the day evenly across the lessons and drops each break in at the time you set.'
                  : 'Set a fixed period length — the studio works out what time the day knocks off.'}
              </p>
            </div>

            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              <Field label="School reports (start)">
                <input type="time" value={timing.startTime}
                  onChange={(e) => setT('startTime', e.target.value)} className="studio-input" />
              </Field>
              <Field label={timing.fitToEndTime ? 'Knock-off (end)' : 'Knock-off target (optional)'}>
                <input type="time" value={timing.endTime}
                  onChange={(e) => setT('endTime', e.target.value)} className="studio-input" />
              </Field>
              {timing.fitToEndTime ? (
                <Field label="Period length (auto)">
                  <div className="studio-input flex items-center font-bold" style={{ background: '#efe9da', color: '#566f76' }} aria-live="polite">
                    {derivedPeriodMinutes ? `≈ ${derivedPeriodMinutes} min` : '—'}
                  </div>
                </Field>
              ) : (
                <Field label="Period length (minutes)">
                  <input type="number" min={5} max={180} value={timing.periodMinutes}
                    onChange={(e) => setT('periodMinutes', clampInt(e.target.value, 5, 180))} className="studio-input" />
                </Field>
              )}
              <Field label="Lesson periods per day">
                <input type="number" min={1} max={14} value={timing.lessonPeriods}
                  onChange={(e) => setT('lessonPeriods', clampInt(e.target.value, 1, 14))} className="studio-input" />
              </Field>
            </div>

            {/* Knock-off readout / check */}
            {timing.fitToEndTime ? (
              <p className="text-xs font-bold" style={{ color: '#566f76' }}>
                The day runs {timing.startTime}–{timing.endTime}.
                {derivedPeriodMinutes ? ` Each of the ${timing.lessonPeriods} lesson periods is about ${derivedPeriodMinutes} minutes.` : ''}
              </p>
            ) : computedEnd ? (
              <p className="text-xs font-bold"
                style={{ color: knockOffDelta && knockOffDelta !== 0 ? '#9a7000' : '#1E8449' }}>
                {knockOffDelta === null || knockOffDelta === 0
                  ? `These periods knock off at ${computedEnd}${timing.endTime ? ' — exactly your target.' : '.'}`
                  : knockOffDelta > 0
                    ? `⚠ These periods run to ${computedEnd} — ${knockOffDelta} min past your ${timing.endTime} knock-off. Shorten a period or a break, or switch to "Fit to report & knock-off".`
                    : `These periods knock off at ${computedEnd} — ${-knockOffDelta} min before your ${timing.endTime} target.`}
              </p>
            ) : null}

            <div className="space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="studio-label !mb-0">Assembly, breaks, lunch &amp; closing</span>
                <span className="text-[11px]" style={{ color: '#8a7f67' }}>
                  No lunch at your school? Just untick it — many government schools run a break only.
                </span>
              </div>
              {timing.breaks.map((b, idx) => {
                const isBookend = b.event === 'assembly' || b.event === 'closing'
                return (
                  <div key={idx} className="flex flex-wrap items-center gap-2 rounded-xl border theme-border bg-white px-3 py-2">
                    <label className="flex items-center gap-1.5 text-xs font-bold">
                      <input type="checkbox" checked={b.enabled !== false}
                        onChange={(e) => updateBreak(idx, 'enabled', e.target.checked)} />
                      <input type="text" value={b.name} maxLength={16}
                        aria-label="Break name"
                        onChange={(e) => updateBreak(idx, 'name', e.target.value.toUpperCase())}
                        className="w-24 outline-none bg-transparent font-black" />
                    </label>
                    {isBookend ? (
                      <span className="text-xs theme-text-secondary">
                        {b.event === 'assembly' ? 'before lessons' : 'after last period'}
                      </span>
                    ) : timing.fitToEndTime ? (
                      <>
                        <span className="text-xs theme-text-secondary">at</span>
                        <input type="time" value={b.time || ''}
                          aria-label="Break time"
                          onChange={(e) => updateBreak(idx, 'time', e.target.value)}
                          className="w-28 text-xs font-bold text-center studio-input !py-1.5" />
                      </>
                    ) : (
                      <>
                        <span className="text-xs theme-text-secondary">after period</span>
                        <input type="number" min={1} max={timing.lessonPeriods} value={b.afterPeriod}
                          aria-label="After period"
                          onChange={(e) => updateBreak(idx, 'afterPeriod', clampInt(e.target.value, 1, timing.lessonPeriods))}
                          className="w-14 text-xs font-bold text-center studio-input !py-1.5" />
                      </>
                    )}
                    <span className="text-xs theme-text-secondary">for</span>
                    <input type="number" min={5} max={120} value={b.minutes}
                      aria-label="Break minutes"
                      onChange={(e) => updateBreak(idx, 'minutes', clampInt(e.target.value, 5, 120))}
                      className="w-16 text-xs font-bold text-center studio-input !py-1.5" />
                    <span className="text-xs theme-text-secondary">min</span>
                  </div>
                )
              })}
            </div>
          </section>

          {/* ── Subjects ── */}
          <section className="studio-card p-5 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h2 className="studio-display" style={{ fontSize: 18, color: '#0e2a32', margin: 0 }}>Subjects &amp; weekly periods</h2>
                <p className="text-xs mt-0.5" style={{ color: '#566f76' }}>
                  Seeded from the curriculum for this grade. Set how many periods a week each subject needs.
                </p>
              </div>
              <button type="button" onClick={resetSubjectsFromCurriculum} className="studio-btn-ghost text-xs">
                ↺ Reset from curriculum
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
              {subjects.map((s) => (
                <div key={s.id} className="flex items-center gap-1.5 rounded-xl border theme-border bg-white px-2.5 py-1.5">
                  <input type="text" value={s.label} maxLength={40}
                    aria-label="Subject name"
                    onChange={(e) => updateSubject(s.id, 'label', e.target.value)}
                    className="flex-1 min-w-0 text-sm font-bold outline-none bg-transparent" />
                  <input type="number" min={0} max={capacity || 40} value={s.periodsPerWeek}
                    aria-label={`${s.label} periods per week`}
                    onChange={(e) => updateSubject(s.id, 'periodsPerWeek', clampInt(e.target.value, 0, capacity || 40))}
                    className="w-12 text-xs font-bold text-center outline-none bg-slate-50 rounded-md py-1" />
                  <span className="text-[10px] theme-text-secondary">/wk</span>
                  <button type="button" onClick={() => removeSubject(s.id)}
                    disabled={subjects.length <= 1}
                    aria-label={`Remove ${s.label}`}
                    className="text-rose-500 hover:text-rose-700 disabled:opacity-30 text-sm font-black px-1">×</button>
                </div>
              ))}
              <button type="button" onClick={addSubject}
                className="rounded-xl border border-dashed theme-border bg-white/60 px-2.5 py-1.5 text-xs font-bold theme-text-secondary hover:theme-text">
                + Add subject
              </button>
            </div>

            <div className={`text-xs font-bold ${overAllocated ? 'text-rose-700' : ''}`} style={overAllocated ? undefined : { color: '#566f76' }}>
              {allocated} periods allocated · {capacity} slots available
              {overAllocated && ' — over capacity: extra periods won\'t be placed.'}
            </div>

            <div className="flex flex-wrap gap-2 pt-1">
              <button type="button" onClick={onAutoFill} className="studio-btn-primary">
                ⚡ Auto-fill timetable
              </button>
              <button type="button" onClick={() => setConfirmClear(true)} className="studio-btn-ghost text-rose-700">
                Clear grid
              </button>
            </div>
          </section>

          {/* ── Editable grid ── */}
          <section className="studio-card p-5">
            <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
              <div>
                <h2 className="studio-display" style={{ fontSize: 18, color: '#0e2a32', margin: 0 }}>The week</h2>
                <p className="text-xs mt-0.5" style={{ color: '#566f76' }}>
                  {filled} of {capacity} lesson slots filled · click any cell to change it.
                </p>
              </div>
            </div>

            {filled > 0 && (
              <div className="mb-4 rounded-xl border p-3 text-xs space-y-1"
                style={validation.ok
                  ? { borderColor: 'rgba(30,132,73,0.3)', background: 'rgba(30,132,73,0.06)' }
                  : { borderColor: 'rgba(212,160,23,0.35)', background: 'rgba(212,160,23,0.08)' }}>
                {validation.ok ? (
                  <div className="font-bold" style={{ color: '#1E8449' }}>
                    ✓ Curriculum check passed — {validation.totalPlaced} of {validation.totalTarget} required periods placed and balanced across the week.
                  </div>
                ) : (
                  <>
                    <div className="font-black uppercase tracking-wide" style={{ color: '#7a5800' }}>
                      Curriculum check
                    </div>
                    {validation.errors.map((m) => (
                      <div key={m} className="font-bold text-rose-700">• {m}</div>
                    ))}
                    {validation.warnings.map((m) => (
                      <div key={m} style={{ color: '#9a7000' }}>• {m}</div>
                    ))}
                  </>
                )}
              </div>
            )}

            {days.length === 0 ? (
              <div className="rounded-xl border border-dashed theme-border bg-white/60 py-14 text-center text-sm" style={{ color: '#566f76' }}>
                Pick at least one teaching day above.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-sm min-w-[680px]">
                  <thead>
                    <tr className="text-[11px] font-black uppercase tracking-wide" style={{ color: '#566f76' }}>
                      <th className="py-1.5 px-2 text-left w-32">Time</th>
                      {days.map((d) => <th key={d} className="py-1.5 px-2 text-center">{d}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {periods.map((p) => {
                      if (p.kind === 'break') {
                        return (
                          <tr key={p.id} className="border-t theme-border">
                            <td className="py-1.5 px-2 text-xs font-bold whitespace-nowrap" style={{ color: '#566f76' }}>
                              {p.start}–{p.end}
                            </td>
                            <td colSpan={days.length} className="py-1.5 px-2 text-center text-xs font-black uppercase tracking-widest"
                              style={{ background: '#efe9da', color: '#7a6f57' }}>
                              {p.label}
                            </td>
                          </tr>
                        )
                      }
                      return (
                        <tr key={p.id} className="border-t theme-border align-middle">
                          <td className="py-1.5 px-2 whitespace-nowrap">
                            <div className="text-xs font-bold">{p.start}–{p.end}</div>
                            <div className="text-[10px] theme-text-secondary">{p.label}</div>
                          </td>
                          {days.map((d) => (
                            <td key={d} className="py-1 px-1">
                              <select
                                value={slots?.[p.id]?.[d] || ''}
                                aria-label={`${p.label} ${d}`}
                                onChange={(e) => setCell(p.id, d, e.target.value)}
                                className="studio-input !py-1.5 !px-1.5 text-xs w-full"
                              >
                                <option value="">—</option>
                                {subjectLabels.map((label) => (
                                  <option key={label} value={label}>{label}</option>
                                ))}
                                {/* Keep a stale value selectable if its subject was renamed/removed. */}
                                {slots?.[p.id]?.[d] && !subjectLabels.includes(slots[p.id][d]) && (
                                  <option value={slots[p.id][d]}>{slots[p.id][d]}</option>
                                )}
                              </select>
                            </td>
                          ))}
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          {/* ── Preview + export ── */}
          <section className="studio-card p-5">
            <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
              <h2 className="studio-display" style={{ fontSize: 18, color: '#0e2a32', margin: 0 }}>Preview &amp; export</h2>
              <div className="flex gap-2 flex-wrap items-center">
                <button type="button" onClick={onSaveToLibrary}
                  disabled={filled === 0 || saving || (generationId && !dirtySinceSave)}
                  className="studio-btn-ghost disabled:opacity-50">
                  {saving ? 'Saving…' : generationId ? (dirtySinceSave ? '💾 Update in library' : '✓ Saved') : '💾 Save to library'}
                </button>
                <button type="button" onClick={onExportXlsx} disabled={filled === 0} className="studio-btn-ghost disabled:opacity-50">
                  📊 .xlsx
                </button>
                <button type="button" onClick={onExportPdf} disabled={filled === 0} className="studio-btn-ghost disabled:opacity-50">
                  🖨️ PDF
                </button>
                <button type="button" onClick={onExportDocx} disabled={filled === 0} className="studio-btn-primary disabled:opacity-50">
                  📄 .docx (landscape)
                </button>
              </div>
            </div>
            {generationId && (
              <p className="text-xs mb-3 -mt-2" style={{ color: '#566f76' }}>
                In your library — <Link to={`/teacher/library/${generationId}`} className="font-bold underline">open the saved copy</Link>.
              </p>
            )}
            {filled > 0 ? (
              <ClassTimetableView timetable={artifact} />
            ) : (
              <div className="rounded-xl border border-dashed theme-border bg-white/60 py-14 text-center text-sm" style={{ color: '#566f76' }}>
                Auto-fill or place a few lessons above — your printable timetable shows here.
              </div>
            )}
          </section>
        </div>
      </div>

      <ConfirmDialog
        open={confirmClear}
        title="Clear the timetable grid?"
        message="Every placed lesson is removed. Your class details, days, periods and subjects are kept."
        confirmLabel="Clear grid"
        variant="danger"
        onConfirm={onClearGrid}
        onCancel={() => setConfirmClear(false)}
      />
    </div>
  )
}

function Field({ label, children }) {
  return (
    <div>
      <label className="studio-label">{label}</label>
      {children}
    </div>
  )
}
