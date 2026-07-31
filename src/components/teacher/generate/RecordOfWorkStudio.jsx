/**
 * Record of Work studio — /teacher/generate/record-of-work
 *
 * Pure client-side tool (no AI call, no usage meter). The record of
 * work is the statutory weekly log of what was ACTUALLY taught — head
 * teachers check it against the scheme of work — so the studio builds
 * one FROM a saved scheme: pick a scheme from the library and every
 * week arrives prefilled with its planned work; the teacher then edits
 * the log, marks coverage, and adds remarks as the term progresses.
 * Teachers without a saved scheme can start blank.
 *
 * Outputs the official document (WEEK | WEEK ENDING | TOPIC | SUB-TOPIC |
 * WORK DONE | REMARKS, plus the checked-by signature block) on screen
 * and as landscape DOCX, and saves to the library's Records of Work
 * section.
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useAuth } from '../../../contexts/AuthContext'
import { TEACHER_GRADES, TEACHER_SUBJECTS } from '../../../utils/teacherTools'
import { useCurriculumOptions } from '../../../hooks/useCurriculumOptions'
import { COVERAGE_OPTIONS, blankRecordWeek, buildRecordWeeks, coverageSummary } from '../../../utils/recordOfWork'
import { getTermWeeks, getCurrentForecastWeek } from '../../../utils/moeCalendar'
import { buildRecordOfWorkFromPlan, restoreRecordFromGeneration } from '../../../utils/recordOfWorkPlanning'
import { currentWeekForRecord, weekComparisonStatus, WEEK_STATUS_META, recordAttentionSummary } from '../../../utils/recordOfWorkStatus'
import { weekWithVarianceField, weekHasVariance } from '../../../utils/recordOfWorkVariance'
import { readActiveAssignmentSeed } from '../../../utils/activeAssignmentSeed'
import { downloadRecordOfWorkDocx } from '../../../utils/recordOfWorkToDocx'
import { buildDownloadName } from '../../../utils/downloadFilename'
import {
  listMyGenerations, titleForGeneration, saveRecordOfWorkGeneration, isFreePlanTeacher, getGeneration,
} from '../../../utils/teacherLibraryService'
import { useLibraryAutoSave } from '../../../hooks/useLibraryAutoSave'
import RecordOfWorkView from '../views/RecordOfWorkView'
import StudioPageHeader from '../StudioPageHeader'
import SeoHelmet from '../../seo/SeoHelmet'
import ConfirmDialog from '../../ui/ConfirmDialog'
import { useToast } from '../../ui/Toast'
import { useDraftManager } from '../../../hooks/draft/useDraftManager'
import { recordOfWorkDescriptor } from '../../../hooks/draft/descriptors/handBuilt'
import { usePlatformSettings } from '../../../contexts/PlatformSettingsContext'
import DraftRecoveryPrompt from '../../draft/DraftRecoveryPrompt'
import DraftStatusIndicator from '../../draft/DraftStatusIndicator'
import ListTextarea from '../../ui/ListTextarea'

const SUBJECT_LABEL = Object.fromEntries(
  TEACHER_SUBJECTS.filter((s) => s.value).map((s) => [s.value, s.label]),
)

export default function RecordOfWorkStudio() {
  const { currentUser, userProfile, isAdmin } = useAuth()
  const toast = useToast()
  const uid = currentUser?.uid

  // Fresh-record defaults: the current teaching term (School Calendar) and the
  // active Teaching Profile assignment's grade — the right term/class instead
  // of a fixed Term 1 · Grade 4. Also used to reset when an id-load fails or
  // the teacher navigates back to the plain route.
  const freshHeader = () => {
    const fw = getCurrentForecastWeek()
    const seed = readActiveAssignmentSeed(currentUser?.uid)
    return {
      school: userProfile?.school || userProfile?.schoolName || '',
      teacherName: userProfile?.displayName || '',
      grade: (seed && seed.grade) || 'G4',
      subject: '',
      term: fw?.termNumber || 1,
      year: String(fw?.year || new Date().getFullYear()),
    }
  }
  const [header, setHeader] = useState(freshHeader)
  const [weeks, setWeeks] = useState(() => [blankRecordWeek(1)])

  // Scheme source picker.
  const [schemes, setSchemes] = useState([])
  const [schemesStatus, setSchemesStatus] = useState('loading')
  const [schemeId, setSchemeId] = useState('')
  // Lesson plans — used to pre-fill each week's planned topic when building the
  // term from the School Calendar.
  const [plans, setPlans] = useState([])

  const [confirmClear, setConfirmClear] = useState(false)
  const [generationId, setGenerationId] = useState(null)

  // ── open an existing record by id (?id=…&week=N) ────────────────────────────
  // The stored record is authoritative — its header replaces the calendar/
  // profile defaults entirely. The route id is never trusted as proof of
  // access: the Firestore read itself is owner-gated, and a denied/missing read
  // surfaces the same safe not-found state (no metadata leak).
  const [searchParams] = useSearchParams()
  const openRecordId = searchParams.get('id') || ''
  const openWeekParam = Number(searchParams.get('week'))
  const [openState, setOpenState] = useState(openRecordId ? 'loading' : 'idle') // idle|loading|error
  const [openRetry, setOpenRetry] = useState(0)
  const [highlightWeek, setHighlightWeek] = useState(null)
  const loadedIdRef = useRef('')

  // Reset the studio to a fresh record — used when an id-load fails (so edits
  // and saves can never keep targeting a previously opened library item) and
  // when the teacher navigates from ?id=… back to the plain route (React Router
  // reuses this component instance, so state must be cleared explicitly).
  const resetToFreshRecord = () => {
    loadedIdRef.current = ''
    setHeader(freshHeader())
    setWeeks([blankRecordWeek(1)])
    setGenerationId(null)
    setHighlightWeek(null)
    dirtySkipRef.current += 1
  }

  useEffect(() => {
    if (!openRecordId) {
      // Back on the plain route after viewing a record by id — start fresh so
      // the default flow never silently edits the previously opened record.
      if (loadedIdRef.current) { resetToFreshRecord(); setOpenState('idle') }
      return undefined
    }
    if (!uid || loadedIdRef.current === openRecordId) return undefined
    let cancelled = false
    setOpenState('loading')
    ;(async () => {
      const gen = await getGeneration(openRecordId).catch(() => null)
      if (cancelled) return
      // Ownership: admins can READ any generation, but this is a teacher
      // editing surface — only the owner may hydrate + save through it.
      const restored = gen && gen.ownerUid === uid ? restoreRecordFromGeneration(gen) : null
      if (!restored) {
        // Never leave a previously loaded record (or its generationId) behind a
        // failed load — the error card offers a genuinely fresh start.
        resetToFreshRecord()
        setOpenState('error')
        return
      }
      loadedIdRef.current = openRecordId
      setHeader(restored.header)
      setWeeks(restored.weeks)
      setGenerationId(openRecordId)
      dirtySkipRef.current += 1 // a freshly-opened record isn't "unsaved changes"
      setOpenState('idle')
      if (Number.isInteger(openWeekParam) && openWeekParam >= 1) setHighlightWeek(openWeekParam)
    })()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uid, openRecordId, openRetry])

  // Scroll to + temporarily highlight the deep-linked week; the highlight clears
  // once the teacher starts working (or after a few seconds). Never auto-edits.
  useEffect(() => {
    if (highlightWeek == null) return undefined
    const el = document.getElementById(`record-week-${highlightWeek}`)
    el?.scrollIntoView?.({ behavior: 'smooth', block: 'center' })
    const t = setTimeout(() => setHighlightWeek(null), 8000)
    return () => clearTimeout(t)
  }, [highlightWeek])
  const [saving, setSaving] = useState(false)
  const [dirtySinceSave, setDirtySinceSave] = useState(false)
  // Skip the mount + draft-restore runs of the dirty-marking effect so a
  // freshly-loaded saved record isn't flagged "Update in library".
  const dirtySkipRef = useRef(1)

  // Saved schemes for the picker — quietly degrades to manual entry.
  useEffect(() => {
    if (!uid) return
    let cancelled = false
    listMyGenerations({ uid, tool: 'scheme_of_work' })
      .then((rows) => { if (!cancelled) { setSchemes(rows.filter((r) => r.output)); setSchemesStatus('ready') } })
      .catch(() => { if (!cancelled) setSchemesStatus('error') })
    return () => { cancelled = true }
  }, [uid])

  // Lesson plans (for planned-topic pre-fill). Best-effort — the calendar build
  // still works with no plans (blank topics).
  useEffect(() => {
    if (!uid) return
    let cancelled = false
    listMyGenerations({ uid, tool: 'lesson_plan' })
      .then((rows) => { if (!cancelled) setPlans(rows || []) })
      .catch(() => { if (!cancelled) setPlans([]) })
    return () => { cancelled = true }
  }, [uid])

  // Universal Draft Manager: cross-device auto-save + recovery (replaces the old
  // localStorage-only draft). Persists the working record; the library copy
  // (aiGenerations) is saved separately by useLibraryAutoSave below.
  const { featureFlags } = usePlatformSettings().settings
  const draft = useDraftManager({
    studioId: 'record_of_work',
    uid,
    draftId: 'record_of_work-current',
    descriptor: recordOfWorkDescriptor,
    state: { header, weeks, generationId },
    enabled: Boolean(uid && featureFlags?.universalDrafts !== false),
    onRestore: (p) => {
      if (p.header) setHeader((h) => ({ ...h, ...p.header }))
      if (Array.isArray(p.weeks) && p.weeks.length) setWeeks(p.weeks)
      if (p.generationId !== undefined) setGenerationId(p.generationId)
      // One batched restore render → the dirty effect fires once; skip it so a
      // recovered record doesn't read "Update in library" until a fresh edit.
      dirtySkipRef.current += 1
    },
  })

  useEffect(() => {
    if (dirtySkipRef.current > 0) { dirtySkipRef.current -= 1; return }
    setDirtySinceSave(true)
  }, [header, weeks])

  const setH = (field, value) => setHeader((h) => ({ ...h, [field]: value }))

  // Subjects come from the Syllabi Studio for the chosen grade (with the
  // curriculum-valid fall-back). The record stores the printed subject label,
  // so we map the slug options to label-valued ones and keep any custom value
  // already on the record (e.g. an older draft) selectable.
  const { subjectOptions: curriculumSubjectOptions } = useCurriculumOptions(header.grade)
  const subjectOptions = useMemo(() => {
    const opts = curriculumSubjectOptions.map((o) =>
      (o.group !== undefined ? o : { value: o.label, label: o.label }))
    if (header.subject && !opts.some((o) => o.value === header.subject)) {
      return [{ value: header.subject, label: header.subject }, ...opts]
    }
    return opts
  }, [curriculumSubjectOptions, header.subject])
  const subjectGroups = useMemo(() => {
    const groups = []
    let cur = null
    for (const o of subjectOptions) {
      if (o.group !== undefined) { if (cur) groups.push(cur); cur = { label: o.group, items: [] } }
      else { if (!cur) cur = { label: null, items: [] }; cur.items.push(o) }
    }
    if (cur) groups.push(cur)
    return groups
  }, [subjectOptions])

  const selectedScheme = useMemo(() => schemes.find((s) => s.id === schemeId) || null, [schemes, schemeId])

  function buildFromScheme() {
    if (!selectedScheme) { toast.error('Pick a saved scheme first.'); return }
    const built = buildRecordWeeks(selectedScheme.output)
    if (!built.length) { toast.error('That scheme has no weeks to log.'); return }
    setWeeks(built)
    const out = selectedScheme.output || {}
    setHeader((h) => ({
      ...h,
      grade: selectedScheme.inputs?.grade || h.grade,
      subject: out.header?.subject || SUBJECT_LABEL[selectedScheme.inputs?.subject] || h.subject,
      term: Number(out.header?.term || selectedScheme.inputs?.term || h.term) || h.term,
    }))
    toast.success(`${built.length} weeks loaded — log coverage and remarks as you teach.`)
  }

  // Build the term from the School Calendar (real week-ending dates) with each
  // week's planned topic pre-filled from the teacher's lesson plans.
  function buildFromCalendar() {
    const termWeeks = getTermWeeks(Number(header.year), Number(header.term))
    if (!termWeeks.length) {
      toast.error('School-week information is unavailable for that term and year. Review your School Calendar settings, then try again.')
      return
    }
    // Merge-not-overwrite: weeks already carrying typed work keep every teacher
    // value; only blank topic/subtopic/week-ending cells are filled in.
    const { weeks: built, plannedCount, preservedCount, conflictWeeks } = buildRecordOfWorkFromPlan({
      generations: plans,
      termWeeks,
      existingWeeks: weeks,
      grade: header.grade,
      subject: header.subject,
      termNumber: Number(header.term),
      academicYear: header.year,
    })
    setWeeks(built)
    const bits = [`${built.length} weeks from the calendar`]
    if (plannedCount > 0) bits.push(`${plannedCount} planned topic${plannedCount === 1 ? '' : 's'} filled from your lesson plans`)
    if (preservedCount > 0) bits.push(`${preservedCount} week${preservedCount === 1 ? '' : 's'} you already filled kept as-is`)
    toast.success(`${bits.join(' · ')}. Log the work actually covered as you teach.`)
    if (conflictWeeks.length) {
      toast.info(`Week${conflictWeeks.length === 1 ? '' : 's'} ${conflictWeeks.join(', ')} had more than one planned topic — review ${conflictWeeks.length === 1 ? 'it' : 'them'} before saving.`)
    }
  }

  function updateWeek(index, field, value) {
    setHighlightWeek(null) // teacher started working — drop the deep-link highlight
    setWeeks((list) => list.map((w, i) => (i === index ? { ...w, [field]: value } : w)))
  }

  // Variance detail (digital-only; never printed/exported). The variance key is
  // present on a row only while it holds content, so untouched weeks keep the
  // exact legacy shape.
  function updateVarianceField(index, field, value) {
    setHighlightWeek(null)
    setWeeks((list) => list.map((w, i) => (i === index ? weekWithVarianceField(w, field, value) : w)))
  }

  function addWeek() {
    setWeeks((list) => {
      const last = Number(list[list.length - 1]?.week)
      const next = Number.isFinite(last) ? last + 1 : list.length + 1
      return [...list, blankRecordWeek(next)]
    })
  }

  function removeWeek(index) {
    setWeeks((list) => (list.length > 1 ? list.filter((_, i) => i !== index) : list))
  }

  // Planned-vs-actual comparison (derived at render, never stored). Only the
  // live calendar week for THIS record's term/year produces due/overdue states;
  // an unresolvable calendar means no date-derived state at all — recorded
  // coverage always wins either way.
  const currentWeek = useMemo(
    () => currentWeekForRecord(header, getCurrentForecastWeek()),
    [header],
  )
  const attentionSummary = useMemo(
    () => recordAttentionSummary(weeks, currentWeek),
    [weeks, currentWeek],
  )

  const artifact = useMemo(() => {
    const filled = weeks.filter((w) => w.topic.trim() || w.workDone.length)
    if (!filled.length) return null
    return {
      schemaVersion: 'record-of-work-1.0',
      header,
      weeks,
    }
  }, [weeks, header])

  const summary = useMemo(() => coverageSummary(weeks), [weeks])

  function clearAll() {
    setHeader({
      school: userProfile?.school || userProfile?.schoolName || '',
      teacherName: userProfile?.displayName || '',
      grade: 'G4', subject: '', term: 1,
      year: String(new Date().getFullYear()),
    })
    setWeeks([blankRecordWeek(1)])
    setSchemeId('')
    setGenerationId(null)
    draft.clear().catch(() => {})
    setConfirmClear(false)
    toast.info('Cleared. Starting a fresh record of work.')
  }

  async function onSaveToLibrary({ silent = false } = {}) {
    if (!artifact || saving) return
    setSaving(true)
    try {
      const id = await saveRecordOfWorkGeneration({ uid, existingId: generationId, artifact })
      setGenerationId(id)
      setDirtySinceSave(false)
      if (!silent) toast.success(generationId ? 'Library copy updated.' : 'Saved to your library.')
    } catch (err) {
      console.error('[RecordOfWorkStudio] save failed', err)
      if (!silent) toast.error(err?.message || 'Could not save to your library. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  // Auto-save to the library so a hand-built record of work is never lost.
  useLibraryAutoSave({
    enabled: !!artifact,
    dirty: dirtySinceSave,
    saving,
    onSave: () => onSaveToLibrary({ silent: true }),
  })

  async function onExportDocx() {
    if (!artifact) return
    const name = buildDownloadName({ docType: 'Record of Work', grade: header.grade, subject: header.subject, term: header.term })
    try {
      await downloadRecordOfWorkDocx(artifact, name, { attribution: isFreePlanTeacher({ userProfile, isAdmin }) })
      toast.success('Record of work downloaded.')
    } catch (err) {
      console.error('[RecordOfWorkStudio] docx export failed', err)
      toast.error('Could not build the Word file. Please try again.')
    }
  }

  return (
    <div className="studio-page">
      <SeoHelmet title="Record of work" noIndex />
      <div className="w-full">
        <StudioPageHeader
          eyebrow="Record of Work"
          title="What you actually taught, week by week"
          subtitle="Pull the term straight out of your scheme of work, then log coverage and remarks as you teach — ready for the head teacher's check."
          emoji="🗂️"
        />

        <div className="space-y-6">
          {/* Opening an existing record by id — loading + safe not-found states. */}
          {openState === 'loading' && (
            <div className="rounded-xl border theme-border bg-white px-4 py-3 text-sm" role="status" style={{ color: 'var(--zt-text-muted)' }}>
              Opening your Record of Work…
            </div>
          )}
          {openState === 'error' && (
            <div className="rounded-xl border-2 px-4 py-3 space-y-2" role="alert" style={{ borderColor: '#fecaca', background: '#fef2f2', color: '#991b1b' }}>
              <p className="font-bold">Record of Work not found</p>
              <p className="text-sm">It may have been deleted or moved, or you may not have permission to open it. You can start a fresh record below.</p>
              <div className="flex flex-wrap gap-2">
                <Link to="/teacher/library?tool=record_of_work" className="studio-btn-ghost">Open My Library</Link>
                <Link to="/teacher" className="studio-btn-ghost">Return to Dashboard</Link>
                <button type="button" className="studio-btn-ghost" onClick={() => { loadedIdRef.current = ''; setOpenRetry((n) => n + 1) }}>
                  Try again
                </button>
              </div>
            </div>
          )}
          {/* The shared current-draft recovery is suppressed when a specific
              record was opened by id: restoring an unrelated draft here would
              overwrite the opened record's state (and its save target). The
              stored draft is kept — it reappears on a normal visit. */}
          {!openRecordId && <DraftRecoveryPrompt {...draft} label="record of work" />}
          {/* ── Build from a scheme ── */}
          <section className="studio-card p-5 space-y-3">
            <div>
              <h2 className="studio-display" style={{ fontSize: 20, margin: 0 }}>Start from your scheme of work</h2>
              <p className="text-xs mt-0.5" style={{ color: 'var(--zt-text-muted)' }}>
                {schemesStatus === 'ready' && schemes.length === 0
                  ? 'No saved schemes yet — generate one first, or log the weeks manually below.'
                  : "Every scheme week arrives prefilled with its planned work; edit each log to record what really happened."}
              </p>
            </div>
            <div className="grid grid-cols-1 lg:grid-cols-[3fr_auto] gap-3 items-end">
              <div>
                <label className="studio-label">Saved scheme</label>
                <select value={schemeId} onChange={(e) => setSchemeId(e.target.value)} className="studio-input" disabled={schemesStatus !== 'ready' || !schemes.length}>
                  <option value="">{schemesStatus === 'loading' ? 'Loading your schemes…' : schemesStatus === 'error' ? 'Could not load schemes' : schemes.length ? 'Choose a scheme…' : 'No saved schemes'}</option>
                  {schemes.map((s) => (
                    <option key={s.id} value={s.id}>{titleForGeneration(s)}</option>
                  ))}
                </select>
              </div>
              <button type="button" onClick={buildFromScheme} disabled={!schemeId} className="studio-btn-primary disabled:opacity-50">
                ▶ Build the term
              </button>
            </div>
            {/* Calendar + lesson-plan build — an alternative to a saved scheme:
                real week-ending dates from the School Calendar, planned topics
                pulled from this term's lesson plans. Uses the grade/subject/term
                set in Record details below. */}
            <div className="mt-3 pt-3 border-t theme-border flex flex-wrap items-center gap-3">
              <button type="button" onClick={buildFromCalendar} className="studio-btn-ghost">
                📅 Fill from the School Calendar &amp; my lesson plans
              </button>
              <span className="text-xs" style={{ color: 'var(--zt-text-muted)' }}>
                Uses Term {header.term} · {header.year} and your grade/subject below.
              </span>
            </div>
          </section>

          {/* ── Record details ── */}
          <section className="studio-card p-5 space-y-4">
            <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
              <div>
                <label className="studio-label">School</label>
                <input type="text" value={header.school} maxLength={120} onChange={(e) => setH('school', e.target.value)} placeholder="School name" className="studio-input" />
              </div>
              <div>
                <label className="studio-label">Teacher's name</label>
                <input type="text" value={header.teacherName} maxLength={80} onChange={(e) => setH('teacherName', e.target.value)} placeholder="Mr / Mrs …" className="studio-input" />
              </div>
              <div>
                <label className="studio-label">Grade</label>
                <select value={header.grade} onChange={(e) => setH('grade', e.target.value)} className="studio-input">
                  {TEACHER_GRADES.filter((g) => g.value).map((g) => (
                    <option key={g.value} value={g.value}>{g.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="studio-label">Subject</label>
                <select value={header.subject} onChange={(e) => setH('subject', e.target.value)} className="studio-input">
                  <option value="">Choose a subject…</option>
                  {subjectGroups.map((g, i) => (g.label
                    ? <optgroup key={i} label={g.label}>{g.items.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</optgroup>
                    : g.items.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)
                  ))}
                </select>
              </div>
              <div>
                <label className="studio-label">Term</label>
                <select value={String(header.term)} onChange={(e) => setH('term', Number(e.target.value))} className="studio-input">
                  {[1, 2, 3].map((t) => <option key={t} value={t}>Term {t}</option>)}
                </select>
              </div>
              <div>
                <label className="studio-label">Year</label>
                <input type="text" value={header.year} maxLength={8} onChange={(e) => setH('year', e.target.value)} className="studio-input" />
              </div>
            </div>
          </section>

          {/* ── Week logs ── */}
          <section className="studio-card p-5">
            <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
              <div>
                <h2 className="studio-display" style={{ fontSize: 20, margin: 0 }}>The term, week by week</h2>
                <p className="text-xs mt-0.5" style={{ color: 'var(--zt-text-muted)' }}>
                  One line per item of work done. Mark coverage after each week — remarks are for what to re-teach or carry over.
                </p>
                {attentionSummary && (
                  <p className="text-xs mt-1 font-bold" style={{ color: '#92400e' }} role="status">
                    ⏰ {attentionSummary}
                  </p>
                )}
              </div>
              <button type="button" onClick={addWeek} className="studio-btn-ghost">＋ Add week</button>
            </div>
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
              {weeks.map((w, i) => {
                const status = weekComparisonStatus(w, currentWeek)
                const meta = WEEK_STATUS_META[status]
                const highlighted = highlightWeek != null && Number(w.week) === highlightWeek
                return (
                <div
                  key={i}
                  id={`record-week-${w.week}`}
                  className="rounded-xl border theme-border bg-white p-3 space-y-2"
                  style={highlighted ? { boxShadow: '0 0 0 3px #fcd34d', borderColor: '#f59e0b' } : undefined}
                >
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-xs font-black uppercase tracking-wide" style={{ color: 'var(--zt-text)' }}>Week {w.week || i + 1}</p>
                      {/* Text + icon, never colour alone. Derived, not stored. */}
                      <span
                        className="text-[11px] font-bold px-2 py-0.5 rounded-full border"
                        style={
                          meta.tone === 'good' ? { background: '#ecfdf5', borderColor: '#a7f3d0', color: 'var(--success-fg)' }
                            : meta.tone === 'warn' ? { background: '#fffbeb', borderColor: '#fcd34d', color: '#92400e' }
                              : meta.tone === 'bad' ? { background: '#fef2f2', borderColor: '#fecaca', color: '#991b1b' }
                                : meta.tone === 'info' ? { background: '#eff6ff', borderColor: '#bfdbfe', color: '#1e40af' }
                                  : { background: '#f8fafc', borderColor: '#e2e8f0', color: 'var(--zt-text-muted)' }
                        }
                      >
                        {meta.icon} {meta.label}
                      </span>
                    </div>
                    {weeks.length > 1 && (
                      <button
                        type="button"
                        onClick={() => removeWeek(i)}
                        className="text-xs font-bold px-2 py-1 rounded-lg text-rose-700 hover:bg-rose-50"
                        aria-label={`Remove week ${w.week || i + 1}`}
                      >
                        ✕ Remove
                      </button>
                    )}
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="studio-label">Week number</label>
                      <input type="text" value={w.week} maxLength={4} onChange={(e) => updateWeek(i, 'week', e.target.value)} className="studio-input !py-1.5 text-sm" />
                    </div>
                    <div>
                      <label className="studio-label">Week ending</label>
                      <input type="text" value={w.weekEnding} maxLength={20} onChange={(e) => updateWeek(i, 'weekEnding', e.target.value)} placeholder="e.g. 16 Jan 2026" className="studio-input !py-1.5 text-sm" />
                    </div>
                  </div>
                  <div>
                    <label className="studio-label">Topic</label>
                    <input type="text" value={w.topic} maxLength={120} onChange={(e) => updateWeek(i, 'topic', e.target.value)} className="studio-input !py-1.5 text-sm" />
                    {w.sourceLessonPlanId && (
                      <Link
                        to={`/teacher/library/${w.sourceLessonPlanId}`}
                        className="text-[11px] font-bold underline"
                        style={{ color: 'var(--info-fg)' }}
                        title="Open the lesson plan this planned topic came from"
                      >
                        📘 From your lesson plan
                      </Link>
                    )}
                  </div>
                  <div>
                    <label className="studio-label">Sub-topic</label>
                    <input type="text" value={w.subtopic} maxLength={160} onChange={(e) => updateWeek(i, 'subtopic', e.target.value)} className="studio-input !py-1.5 text-sm" />
                  </div>
                  <div>
                    <label className="studio-label">Work done (one per line)</label>
                    <ListTextarea rows={4} value={w.workDone} onChange={(list) => updateWeek(i, 'workDone', list)} className="studio-input !py-1.5 text-sm resize-none" />
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <div>
                      <label className="studio-label">Coverage</label>
                      <select value={w.coverage} onChange={(e) => updateWeek(i, 'coverage', e.target.value)} className="studio-input !py-1.5 text-sm">
                        {COVERAGE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="studio-label">Remarks (optional)</label>
                      <input type="text" value={w.remarks} maxLength={200} onChange={(e) => updateWeek(i, 'remarks', e.target.value)} placeholder="e.g. re-teach carrying tens" className="studio-input !py-1.5 text-sm" />
                    </div>
                  </div>
                  {/* Variance detail. Per the 2026-07-15 statutory sign-off,
                      ONLY the follow-up action prints (inside REMARKS); date
                      taught, reason and initials stay digital-only. Optional;
                      legacy records need no backfill. */}
                  <details open={weekHasVariance(w)}>
                    <summary className="text-xs font-bold cursor-pointer" style={{ color: 'var(--zt-text-muted)' }}>
                      Variance details (optional — only the follow-up prints, in REMARKS)
                    </summary>
                    <div className="grid grid-cols-2 gap-2 mt-2">
                      <div>
                        <label className="studio-label">Date actually taught</label>
                        <input type="date" value={w.variance?.actualDate || ''} onChange={(e) => updateVarianceField(i, 'actualDate', e.target.value)} className="studio-input !py-1.5 text-sm" />
                      </div>
                      <div>
                        <label className="studio-label">Teacher initials</label>
                        <input type="text" value={w.variance?.initials || ''} maxLength={10} onChange={(e) => updateVarianceField(i, 'initials', e.target.value)} placeholder="e.g. MM" className="studio-input !py-1.5 text-sm" />
                      </div>
                      <div>
                        <label className="studio-label">Reason for variance</label>
                        <input type="text" value={w.variance?.reason || ''} maxLength={300} onChange={(e) => updateVarianceField(i, 'reason', e.target.value)} placeholder="e.g. school event" className="studio-input !py-1.5 text-sm" />
                      </div>
                      <div>
                        <label className="studio-label">Follow-up action (prints in REMARKS)</label>
                        <input type="text" value={w.variance?.followUp || ''} maxLength={300} onChange={(e) => updateVarianceField(i, 'followUp', e.target.value)} placeholder="e.g. complete next lesson" className="studio-input !py-1.5 text-sm" />
                      </div>
                    </div>
                  </details>
                </div>
                )
              })}
            </div>
          </section>

          {/* ── Document preview ── */}
          <section className="studio-card p-5">
            <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
              <div>
                <h2 className="studio-display" style={{ fontSize: 20, margin: 0 }}>Your record of work</h2>
                <p className="text-xs mt-0.5" style={{ color: 'var(--zt-text-muted)' }}>
                  Exactly what prints — with the signature block the head teacher checks.
                  {artifact && ` Coverage so far: ${summary.full} full · ${summary.partial} partial · ${summary.none} not covered · ${summary.blank} not logged.`}
                </p>
              </div>
              <div className="flex gap-2 flex-wrap items-center">
                <DraftStatusIndicator status={draft.status} savedAt={draft.savedAt} online={draft.online} />
                <button type="button" onClick={() => setConfirmClear(true)} className="studio-btn-ghost text-rose-700">Clear all</button>
                <button
                  type="button"
                  onClick={onSaveToLibrary}
                  disabled={!artifact || saving || (generationId && !dirtySinceSave)}
                  className="studio-btn-ghost disabled:opacity-50"
                >
                  {saving ? 'Saving…' : generationId ? (dirtySinceSave ? '💾 Update in library' : '✓ Saved') : '💾 Save to library'}
                </button>
                <button type="button" onClick={onExportDocx} disabled={!artifact} className="studio-btn-primary disabled:opacity-50">
                  📄 Download .docx (landscape)
                </button>
              </div>
            </div>
            {generationId && (
              <p className="text-xs mb-3 -mt-2" style={{ color: 'var(--zt-text-muted)' }}>
                In your library — <Link to={`/teacher/library/${generationId}`} className="font-bold underline">open the saved copy</Link>.
              </p>
            )}
            {artifact ? (
              <RecordOfWorkView record={artifact} />
            ) : (
              <div className="rounded-xl border border-dashed theme-border bg-white/60 py-14 text-center text-sm" style={{ color: 'var(--zt-text-muted)' }}>
                Build the term from your scheme above, or type a week's topic — the record appears here as you go.
              </div>
            )}
          </section>
        </div>
      </div>

      <ConfirmDialog
        open={confirmClear}
        title="Clear the whole record?"
        message="Every week's log is removed and the saved draft is deleted (a copy already saved to your library stays there). This cannot be undone."
        confirmLabel="Clear everything"
        variant="danger"
        onConfirm={clearAll}
        onCancel={() => setConfirmClear(false)}
      />
    </div>
  )
}
