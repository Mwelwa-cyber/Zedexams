/**
 * Mark Schedule studio — /teacher/generate/mark-schedule
 *
 * Pure client-side tool (no AI call, no usage meter): the teacher enters
 * pupils and per-subject marks, and the studio computes totals, class
 * positions (dense ranking — ties share a place) and suggested report
 * comments in a teacher's voice, with raw-marks and percentage views of
 * the same data. Outputs the official two-page document (schedule +
 * Report Comments Sheet) on screen and as DOCX/XLSX, plus per-pupil
 * report cards.
 *
 * The marks table shows LIVE Total / % / Position columns (computed via
 * shared/utils/markSchedule's rankPupils — the same maths the exports use), and
 * pupils can be imported straight from a Class Register class list
 * (ImportFromClassListModal): active learners fill the rows in register
 * order, rows the teacher already named are never wiped.
 *
 * Comments: each pupil row's comment input shows the suggestion as its
 * placeholder; typing replaces it, clearing falls back to the suggestion.
 *
 * Drafts autosave (Universal Draft Manager) so an 80-pupil class survives
 * a refresh.
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import { useAuth } from '../../../contexts/AuthContext'
import { SUBJECTS } from '../../../config/curriculum'
import { buildSchedule, suggestComment, rankPupils } from '../../../shared/utils/markSchedule'
import { downloadMarkScheduleDocx } from '../../../engines/export-engine/markScheduleToDocx'
import { buildDownloadName } from '../../../utils/downloadFilename'
import { downloadMarkScheduleXlsx } from '../../../engines/export-engine/markScheduleToXlsx'
import { downloadReportCardsDocx } from '../../../engines/export-engine/reportCardsToDocx'
import { saveMarkScheduleGeneration, isFreePlanTeacher } from '../../../utils/teacherLibraryService'
import { listTeacherRegisters } from '../../../utils/classRegister'
import { formatClassGrade } from '../../../schemas/classRegister'
import { useLibraryAutoSave } from '../../../hooks/useLibraryAutoSave'
import { clampInt } from '../../../utils/inputs.js'
import { Link } from 'react-router-dom'
import { Calculator, Users, Download, Plus } from 'lucide-react'
import MarkScheduleView from '../components/MarkScheduleView'
import StudioCurriculumSelector from '../../../components/teacher/curriculum/StudioCurriculumSelector'
import StudioPageHeader from '../../../shared/components/StudioPageHeader'
import ImportFromClassListModal from'../../../components/teacher/generate/ImportFromClassListModal'
import SeoHelmet from '../../../shared/components/SeoHelmet'
import ConfirmDialog from '../../../shared/components/ConfirmDialog'
import ActionMenu from '../../../shared/components/ActionMenu'
import { useToast } from '../../../shared/components/Toast'
import { useDraftManager } from '../../../hooks/draft/useDraftManager'
import { markScheduleDescriptor } from '../../../hooks/draft/descriptors/handBuilt'
import { usePlatformSettings } from '../../../contexts/PlatformSettingsContext'
import DraftRecoveryPrompt from '../../../shared/components/DraftRecoveryPrompt'
import DraftStatusIndicator from '../../../shared/components/DraftStatusIndicator'

const DEFAULT_SUBJECTS = [
  { key: 's1', label: 'MATHS', max: 25 },
  { key: 's2', label: 'ENGLISH', max: 25 },
  { key: 's3', label: 'SCIENCE', max: 26 },
  { key: 's4', label: 'SOCIAL STUDIES', max: 26 },
  { key: 's5', label: 'C.T.S', max: 25 },
]

// Combobox suggestions for the "Subjects and maximum marks" row. Both fields
// stay free-text (rendered as inputs backed by a <datalist>), so a teacher can
// pick a value from the dropdown OR type their own — picking is faster than
// typing, but nothing is locked to the list.
//
// The subject suggestions are exactly the CBC syllabus learning areas, shown
// in Title Case; what the teacher TYPES is kept verbatim (no forced
// uppercasing — the old `.toUpperCase()` on change is gone on purpose).
const SUBJECT_SUGGESTIONS = SUBJECTS.map((s) => s.label)
// Common out-of marks teachers set per subject. Not exhaustive — the field
// still accepts any 1–300 value typed by hand.
const MAX_MARK_SUGGESTIONS = [10, 15, 20, 25, 30, 40, 50, 60, 70, 75, 80, 100]

let rowSeq = 0
const newPupil = () => ({ id: `p${Date.now()}-${rowSeq += 1}`, name: '', marks: {}, comment: '' })
const blankPupils = (n) => Array.from({ length: n }, () => newPupil())

/**
 * Class Register grade scheme ('4' | 'form-1' | 'nursery') → the studio's
 * wire code + human label. Digits map to G-codes, 'form-N' to F-codes;
 * anything else (nursery/reception/baby/middle) returns null so the
 * schedule header's grade is left untouched.
 */
function registerGradeToWire(grade) {
  const g = String(grade ?? '').trim()
  if (/^\d+$/.test(g)) return { grade: `G${g}`, gradeLabel: formatClassGrade(g) }
  const m = g.match(/^form-(\d+)$/i)
  if (m) return { grade: `F${m[1]}`, gradeLabel: formatClassGrade(g) }
  return null
}

export default function MarkScheduleStudio() {
  const { currentUser, userProfile, isAdmin } = useAuth()
  const toast = useToast()
  const uid = currentUser?.uid

  const [header, setHeader] = useState(() => ({
    school: userProfile?.school || userProfile?.schoolName || '',
    grade: 'G4',
    term: 1,
    year: String(new Date().getFullYear()),
    nextTermOpens: '',
  }))
  const [subjects, setSubjects] = useState(DEFAULT_SUBJECTS)
  const [pupils, setPupils] = useState(() => blankPupils(5))
  const [mode, setMode] = useState('marks')
  // Standardized curriculum selection (curriculum → grade; the marks grid
  // keeps its own per-column subjects, so the selector's subject step is off).
  const [curr, setCurr] = useState({})
  const [confirmClear, setConfirmClear] = useState(false)
  // Class Register import: the teacher's registers (null until the lazy
  // fire-and-forget fetch lands — silent on failure, the modal refetches).
  const [registers, setRegisters] = useState(null)
  const [importOpen, setImportOpen] = useState(false)
  // Library persistence: the saved generation id (create once, then
  // update) and whether edits happened after the last save.
  const [generationId, setGenerationId] = useState(null)
  const [saving, setSaving] = useState(false)
  const [dirtySinceSave, setDirtySinceSave] = useState(false)
  // The dirty-marking effect below fires on the initial mount and again on the
  // re-render the draft-restore triggers. Skip those runs so a freshly-loaded
  // saved sheet shows "Saved" rather than "Update in library".
  const dirtySkipRef = useRef(1)

  // Universal Draft Manager: cross-device auto-save + recovery (replaces the old
  // localStorage-only draft). The library copy (aiGenerations) is saved
  // separately by useLibraryAutoSave below.
  const { featureFlags } = usePlatformSettings().settings
  const draft = useDraftManager({
    studioId: 'mark_schedule',
    uid,
    draftId: 'mark_schedule-current',
    descriptor: markScheduleDescriptor,
    state: { header, subjects, pupils, mode, generationId },
    enabled: Boolean(uid && featureFlags?.universalDrafts !== false),
    onRestore: (p) => {
      if (p.header) setHeader((h) => ({ ...h, ...p.header }))
      if (Array.isArray(p.subjects) && p.subjects.length) setSubjects(p.subjects)
      if (Array.isArray(p.pupils) && p.pupils.length) setPupils(p.pupils)
      if (p.mode) setMode(p.mode)
      if (p.generationId !== undefined) setGenerationId(p.generationId)
      dirtySkipRef.current += 1
    },
  })

  // Any data edit marks the library copy stale. (Skips the mount + restore
  // runs via dirtySkipRef so a just-loaded saved sheet isn't flagged dirty.)
  useEffect(() => {
    if (dirtySkipRef.current > 0) { dirtySkipRef.current -= 1; return }
    setDirtySinceSave(true)
  }, [header, subjects, pupils])

  const setH = (field, value) => setHeader((h) => ({ ...h, [field]: value }))

  // Feed the standardized selector's grade into the schedule header. Grade
  // keeps BOTH shapes: `grade` ('G5'/'F1') is the wire code the download names
  // and legacy consumers use, `gradeLabel` ('Grade 5'/'Form 1') is the human
  // label the headings prefer (so Form picks don't print "GRADE F1"). Only
  // overwrite once the selector yields a value so the default grade isn't
  // wiped beforehand. (The selector's subject step is hidden here — the old
  // header.subject write was dead: nothing ever read it.)
  useEffect(() => {
    if (curr.grade) {
      setHeader((h) => ({ ...h, grade: curr.grade, gradeLabel: curr.gradeLabel || '' }))
    }
  }, [curr.grade, curr.gradeLabel])

  // Lazy learner-count badge for the Import button: fire-and-forget, silent
  // on failure (the modal does its own fetch if this one never landed).
  useEffect(() => {
    if (!uid) return undefined
    let on = true
    listTeacherRegisters(uid)
      .then((list) => { if (on) setRegisters(list) })
      .catch(() => {})
    return () => { on = false }
  }, [uid])
  const learnerTotal = useMemo(
    () => (Array.isArray(registers)
      ? registers.reduce((n, r) => n + (Number(r.learnerCount) || 0), 0)
      : 0),
    [registers],
  )

  /* ── subjects ── */
  function updateSubject(key, field, value) {
    setSubjects((list) => list.map((s) => (s.key === key ? { ...s, [field]: value } : s)))
  }
  function addSubject() {
    setSubjects((list) => [...list, { key: `s${Date.now()}`, label: `SUBJECT ${list.length + 1}`, max: 100 }])
  }
  function removeSubject(key) {
    setSubjects((list) => (list.length > 1 ? list.filter((s) => s.key !== key) : list))
  }

  /* ── pupils ── */
  function updatePupil(id, updater) {
    setPupils((list) => list.map((p) => (p.id === id ? updater(p) : p)))
  }
  function setMark(id, subjectKey, raw, max) {
    const value = raw === '' ? undefined : clampInt(raw, 0, max)
    updatePupil(id, (p) => {
      const marks = { ...p.marks }
      if (value === undefined) delete marks[subjectKey]
      else marks[subjectKey] = value
      return { ...p, marks }
    })
  }
  const addPupils = (n) => setPupils((list) => [...list, ...blankPupils(n)])
  const removePupil = (id) => setPupils((list) => list.filter((p) => p.id !== id))

  /**
   * Apply a Class Register import: active learners become pupil rows in
   * register order. REPLACES rows with no name, APPENDS after existing named
   * rows — typed data is never wiped. Header school/year/grade are seeded
   * only where the teacher hasn't set them (grade only while it is still the
   * untouched default AND the selector hasn't been used).
   */
  function applyImport({ register, entries }) {
    setImportOpen(false)
    if (!entries.length) {
      toast.info(`"${register.className}" has no active learners yet — add learners in the Class Register first.`)
      return
    }
    const kept = pupils.filter((p) => p.name.trim())
    const seen = new Set(kept.map((p) => p.id))
    const imported = entries
      .map((e) => ({ id: `p-${e.id}`, name: e.fullName || '', marks: {}, comment: '' }))
      .filter((p) => !seen.has(p.id)) // re-importing the same class never duplicates rows
    setPupils([...kept, ...imported])

    const wire = registerGradeToWire(register.grade)
    const gradeStillDefault = !curr.grade && !header.gradeLabel && (!header.grade || header.grade === 'G4')
    setHeader((h) => {
      const next = { ...h }
      if (!String(h.school || '').trim() && register.school) next.school = register.school
      if (register.year) next.year = String(register.year)
      if (wire && gradeStillDefault) {
        next.grade = wire.grade
        next.gradeLabel = wire.gradeLabel
      }
      return next
    })
    toast.success(`Imported ${imported.length} learner${imported.length === 1 ? '' : 's'} from ${register.className}.`)
  }

  /* ── derived schedule ── */
  const named = useMemo(() => pupils.filter((p) => p.name.trim()), [pupils])

  // Live Total / % / Position columns for the marks table — the same
  // rankPupils maths the exports use (dense ranking, ties share a place).
  const maxTotal = useMemo(
    () => subjects.reduce((sum, s) => sum + (Number(s.max) || 0), 0),
    [subjects],
  )
  const rankedById = useMemo(() => {
    if (!named.length) return new Map()
    return new Map(rankPupils(named, subjects).map((p) => [p.id, p]))
  }, [named, subjects])

  // Suggested comment per row (placeholder text) follows live ranking.
  const suggestions = useMemo(() => {
    if (!named.length) return {}
    const ranked = rankPupils(named, subjects)
    const last = ranked[ranked.length - 1].position
    return Object.fromEntries(ranked.map((p) => [p.id, suggestComment(p, subjects, last)]))
  }, [named, subjects])

  const artifact = useMemo(() => {
    if (!named.length) return null
    const completed = buildSchedule(named, subjects)
    // Print order = entry order (SN follows the class register, like the
    // real schedules), positions already computed from totals.
    const byId = new Map(completed.map((p) => [p.id, p]))
    return {
      schemaVersion: 'mark-schedule-1.0',
      header,
      subjects,
      pupils: named.map((p, i) => ({ ...byId.get(p.id), sn: i + 1 })),
    }
  }, [named, subjects, header])

  function clearAll() {
    setHeader({ school: userProfile?.school || userProfile?.schoolName || '', grade: 'G4', term: 1, year: String(new Date().getFullYear()), nextTermOpens: '' })
    setSubjects(DEFAULT_SUBJECTS)
    setPupils(blankPupils(5))
    setMode('marks')
    setGenerationId(null) // the library copy (if any) stays; a new save creates a fresh entry
    draft.clear().catch(() => {})
    setConfirmClear(false)
    toast.info('Cleared. Starting a fresh schedule.')
  }

  async function onSaveToLibrary({ silent = false } = {}) {
    if (!artifact || saving) return
    setSaving(true)
    try {
      const id = await saveMarkScheduleGeneration({ uid, existingId: generationId, artifact })
      setGenerationId(id)
      setDirtySinceSave(false)
      if (!silent) toast.success(generationId ? 'Library copy updated.' : 'Saved to your library.')
    } catch (err) {
      console.error('[MarkScheduleStudio] save failed', err)
      if (!silent) toast.error(err?.message || 'Could not save to your library. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  // Auto-save to the library so a hand-built schedule is never lost.
  useLibraryAutoSave({
    enabled: !!artifact,
    dirty: dirtySinceSave,
    saving,
    onSave: () => onSaveToLibrary({ silent: true }),
  })

  async function onExportDocx() {
    if (!artifact) return
    const name = buildDownloadName({ docType: 'Mark Schedule', grade: header.grade, term: header.term, year: header.year })
    try {
      await downloadMarkScheduleDocx(artifact, name, { mode, attribution: isFreePlanTeacher({ userProfile, isAdmin }) })
      toast.success('Mark schedule downloaded.')
    } catch (err) {
      console.error('[MarkScheduleStudio] docx export failed', err)
      toast.error('Could not build the Word file. Please try again.')
    }
  }

  async function onExportXlsx() {
    if (!artifact) return
    const name = buildDownloadName({ docType: 'Mark Schedule', grade: header.grade, term: header.term, year: header.year, ext: 'xlsx' })
    try {
      await downloadMarkScheduleXlsx(artifact, name)
      toast.success('Excel workbook downloaded — totals and positions stay live when you edit marks.')
    } catch (err) {
      console.error('[MarkScheduleStudio] xlsx export failed', err)
      toast.error('Could not build the Excel file. Please try again.')
    }
  }

  async function onExportReportCards() {
    if (!artifact) return
    const name = buildDownloadName({ docType: 'Report Cards', grade: header.grade, term: header.term, year: header.year })
    try {
      await downloadReportCardsDocx(artifact, name, { attribution: isFreePlanTeacher({ userProfile, isAdmin }) })
      toast.success(`Report cards downloaded — one page per pupil (${artifact.pupils.length}).`)
    } catch (err) {
      console.error('[MarkScheduleStudio] report cards export failed', err)
      toast.error('Could not build the report cards. Please try again.')
    }
  }

  const exportDisabledReason = 'Add pupils and marks first'

  return (
    <div className="studio-page">
      <SeoHelmet title="Mark schedule" noIndex />
      <div className="w-full">
        <StudioPageHeader
          eyebrow="Class administration"
          title="Mark Schedule Studio"
          subtitle="Marks in — positions and comments out. Enter each pupil's marks once; totals, class positions and report comments are calculated for you."
          icon={Calculator}
        />

        <div className="space-y-6">
          <DraftRecoveryPrompt {...draft} label="mark schedule" />
          {/* ── Class details ── */}
          <section className="studio-card p-5 space-y-4">
            {/* Segmented curriculum row on top (CBC pre-selected so the grade
                cascade is live immediately), then Class/Grade | Term | Year on
                one row ≥640px. The selector renders `display: contents` so its
                two children (toggle row + grade field) sit directly in this
                grid — the toggle spans the full row, the grade takes column 1. */}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <StudioCurriculumSelector
                curriculumPickerVariant="segmented"
                defaultCurriculumMode="cbc"
                showSubject={false}
                showTopicSubtopic={false}
                onChange={setCurr}
                className="contents [&>*+*]:!mt-0 sm:[&>*:first-child]:col-span-3"
              />
              <div>
                <label className="studio-label">Term</label>
                <select value={String(header.term)} onChange={(e) => setH('term', Number(e.target.value))} className="studio-input">
                  {[1, 2, 3].map((t) => <option key={t} value={t}>Term {t}</option>)}
                </select>
              </div>
              <div>
                <label className="studio-label">Year</label>
                <input type="text" value={header.year} maxLength={4}
                  onChange={(e) => setH('year', e.target.value.replace(/[^\d]/g, ''))}
                  className="studio-input" />
              </div>
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label className="studio-label">School</label>
                <input type="text" value={header.school} maxLength={120}
                  onChange={(e) => setH('school', e.target.value)}
                  placeholder="School name" className="studio-input" />
              </div>
              <div>
                <label className="studio-label">Next term opens (printed on report cards, optional)</label>
                <input type="text" value={header.nextTermOpens || ''} maxLength={40}
                  onChange={(e) => setH('nextTermOpens', e.target.value)}
                  placeholder="e.g. Monday 12th January 2027" className="studio-input" />
              </div>
            </div>

            {/* Subjects + max marks */}
            <div>
              <label className="studio-label">Subjects and maximum marks</label>
              <p className="text-xs mb-1.5" style={{ color: 'var(--zt-text-muted)' }}>
                Pick a subject and an out-of mark from the dropdowns, or type your own.
              </p>
              {/* Shared option lists for the comboboxes below — a teacher chooses
                  from the dropdown or keeps typing (both fields stay free-text). */}
              <datalist id="markschedule-subject-options">
                {SUBJECT_SUGGESTIONS.map((label) => <option key={label} value={label} />)}
              </datalist>
              <datalist id="markschedule-marks-options">
                {MAX_MARK_SUGGESTIONS.map((m) => <option key={m} value={m} />)}
              </datalist>
              <div className="flex flex-wrap gap-2">
                {subjects.map((s) => (
                  <div key={s.key} className="flex items-center gap-1.5 rounded-xl border theme-border bg-white px-2 py-1.5">
                    <input
                      type="text"
                      list="markschedule-subject-options"
                      value={s.label}
                      maxLength={20}
                      aria-label="Subject name"
                      onChange={(e) => updateSubject(s.key, 'label', e.target.value)}
                      className="w-28 text-xs font-bold outline-none bg-transparent"
                    />
                    <span className="text-xs theme-text-secondary">/</span>
                    <input
                      type="number"
                      list="markschedule-marks-options"
                      min={1}
                      max={300}
                      value={s.max}
                      aria-label="Maximum marks"
                      onChange={(e) => updateSubject(s.key, 'max', clampInt(e.target.value, 1, 300))}
                      className="w-14 text-xs font-bold outline-none text-center bg-transparent"
                    />
                    <button
                      type="button"
                      onClick={() => removeSubject(s.key)}
                      disabled={subjects.length <= 1}
                      aria-label={`Remove ${s.label}`}
                      className="text-rose-500 hover:text-rose-700 disabled:opacity-30 text-sm font-black px-1"
                    >
                      ×
                    </button>
                  </div>
                ))}
                <button type="button" onClick={addSubject} className="studio-btn-ghost text-xs">
                  + Add subject
                </button>
              </div>
            </div>
          </section>

          {/* ── Pupils & marks ── */}
          <section className="studio-card p-5">
            <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
              <div>
                <h2 className="m-0 text-[15px] font-bold">Pupils and marks</h2>
                <p className="text-xs mt-0.5" style={{ color: 'var(--zt-text-muted)' }}>
                  {named.length} pupil{named.length === 1 ? '' : 's'} entered · rows without a name are
                  ignored · positions update as you type — ties share a position
                </p>
              </div>
              <div className="flex gap-2 flex-wrap">
                <button
                  type="button"
                  onClick={() => setImportOpen(true)}
                  className="studio-btn-primary text-xs inline-flex items-center gap-1.5"
                >
                  <Users size={14} aria-hidden="true" />
                  Import from Class List{learnerTotal > 0 ? ` · ${learnerTotal}` : ''}
                </button>
                <button type="button" onClick={() => addPupils(1)} className="studio-btn-ghost text-xs inline-flex items-center gap-1">
                  <Plus size={13} aria-hidden="true" />
                  Add pupil
                </button>
                <button type="button" onClick={() => addPupils(5)} className="studio-btn-ghost text-xs inline-flex items-center gap-1">
                  <Plus size={13} aria-hidden="true" />
                  Add 5
                </button>
                <button type="button" onClick={() => setConfirmClear(true)} className="studio-btn-ghost text-xs text-rose-700">Clear all</button>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-sm border-collapse min-w-[860px]">
                <thead>
                  <tr className="text-left text-[11px] font-black uppercase tracking-wide" style={{ color: 'var(--zt-text-muted)' }}>
                    <th className="py-1.5 pr-2 w-8">SN</th>
                    <th className="py-1.5 pr-2">Pupil's name</th>
                    {subjects.map((s) => (
                      <th key={s.key} className="py-1.5 px-1 text-center">{s.label || '—'} /{s.max}</th>
                    ))}
                    <th className="py-1.5 px-2 text-center">Total /{maxTotal}</th>
                    <th className="py-1.5 px-2 text-center">%</th>
                    <th className="py-1.5 px-2 text-center">Pos</th>
                    <th className="py-1.5 pl-2">Comment (optional — suggestion shown)</th>
                    <th className="w-8" />
                  </tr>
                </thead>
                <tbody>
                  {pupils.map((p, idx) => {
                    const ranked = rankedById.get(p.id) || null
                    const percent = ranked && maxTotal > 0 ? Math.round((ranked.total / maxTotal) * 100) : null
                    return (
                      <tr key={p.id} className="border-t theme-border align-middle">
                        <td className="py-1.5 pr-2 text-xs theme-text-secondary">{idx + 1}</td>
                        <td className="py-1.5 pr-2">
                          <input
                            type="text"
                            value={p.name}
                            maxLength={60}
                            placeholder="Full name"
                            aria-label={`Pupil ${idx + 1} name`}
                            onChange={(e) => updatePupil(p.id, (row) => ({ ...row, name: e.target.value }))}
                            className="studio-input !py-1.5 text-sm"
                          />
                        </td>
                        {subjects.map((s) => (
                          <td key={s.key} className="py-1.5 px-1 text-center">
                            <input
                              type="number"
                              inputMode="numeric"
                              min={0}
                              max={s.max}
                              value={p.marks?.[s.key] ?? ''}
                              aria-label={`${p.name || `Pupil ${idx + 1}`} ${s.label} mark`}
                              onChange={(e) => setMark(p.id, s.key, e.target.value, s.max)}
                              className="studio-input !py-1.5 !px-1 text-sm text-center w-16"
                            />
                          </td>
                        ))}
                        {/* Live computed columns — visually distinct from the inputs. */}
                        <td data-testid={`pupil-total-${idx}`} className="py-1.5 px-2 text-center font-bold tabular-nums bg-[#FDFBF5]">
                          {ranked ? ranked.total : '—'}
                        </td>
                        <td data-testid={`pupil-percent-${idx}`} className="py-1.5 px-2 text-center font-bold tabular-nums bg-[#FDFBF5]">
                          {percent == null ? '—' : `${percent}%`}
                        </td>
                        <td data-testid={`pupil-pos-${idx}`} className="py-1.5 px-2 text-center font-bold tabular-nums bg-[#FDFBF5]">
                          {ranked ? ranked.position : '—'}
                        </td>
                        <td className="py-1.5 pl-2">
                          <input
                            type="text"
                            value={p.comment}
                            maxLength={160}
                            placeholder={p.name.trim() ? (suggestions[p.id] || '') : '—'}
                            aria-label={`${p.name || `Pupil ${idx + 1}`} comment`}
                            onChange={(e) => updatePupil(p.id, (row) => ({ ...row, comment: e.target.value }))}
                            className="studio-input !py-1.5 text-xs min-w-[220px]"
                          />
                        </td>
                        <td className="py-1.5 text-center">
                          <button
                            type="button"
                            onClick={() => removePupil(p.id)}
                            aria-label={`Remove ${p.name || `pupil ${idx + 1}`}`}
                            className="text-rose-500 hover:text-rose-700 font-black"
                          >
                            ×
                          </button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </section>

          {/* ── Document preview ── */}
          <section className="studio-card p-5">
            <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
              <div>
                <h2 className="m-0 text-[15px] font-bold">Your mark schedule</h2>
                <p className="text-xs mt-0.5" style={{ color: 'var(--zt-text-muted)' }}>
                  Positions update as you type — ties share a position.
                </p>
              </div>
              <div className="flex gap-2 flex-wrap items-center">
                <DraftStatusIndicator status={draft.status} savedAt={draft.savedAt} online={draft.online} />
                <div className="inline-flex gap-1 rounded-full bg-white border theme-border p-1" role="group" aria-label="Schedule view">
                  {[['marks', 'Raw marks'], ['percent', 'Percentages']].map(([key, label]) => (
                    <button
                      key={key}
                      type="button"
                      onClick={() => setMode(key)}
                      aria-pressed={mode === key}
                      className={`rounded-full px-3 py-1.5 text-xs font-black transition-all ${
                        mode === key ? 'theme-accent-fill theme-on-accent' : 'theme-text-muted hover:theme-text'
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <button
                  type="button"
                  onClick={onSaveToLibrary}
                  disabled={!artifact || saving || (generationId && !dirtySinceSave)}
                  className="studio-btn-primary disabled:opacity-50"
                >
                  {saving ? 'Saving…' : generationId ? (dirtySinceSave ? 'Update in library' : 'Saved') : 'Save to library'}
                </button>
                <ActionMenu
                  label="Download"
                  icon={Download}
                  caret
                  ariaLabel="Download"
                  buttonClassName="studio-btn-ghost"
                  items={[
                    {
                      label: 'Excel (live formulas)',
                      onSelect: onExportXlsx,
                      disabled: !artifact,
                      disabledReason: exportDisabledReason,
                    },
                    {
                      label: 'Word (landscape)',
                      onSelect: onExportDocx,
                      disabled: !artifact,
                      disabledReason: exportDisabledReason,
                    },
                    {
                      label: 'Report cards (.docx)',
                      onSelect: onExportReportCards,
                      disabled: !artifact,
                      disabledReason: exportDisabledReason,
                    },
                  ]}
                />
              </div>
            </div>
            {generationId && (
              <p className="text-xs mb-3 -mt-2" style={{ color: 'var(--zt-text-muted)' }}>
                In your library — <Link to={`/teacher/library/${generationId}`} className="font-bold underline">open the saved copy</Link>.
              </p>
            )}

            {artifact ? (
              <MarkScheduleView schedule={artifact} mode={mode} />
            ) : (
              <div className="rounded-xl border border-dashed theme-border bg-white/60 py-14 text-center text-sm" style={{ color: 'var(--zt-text-muted)' }}>
                Add pupils and their marks above — the schedule builds itself here as you type.
              </div>
            )}
          </section>
        </div>
      </div>

      {importOpen && (
        <ImportFromClassListModal
          uid={uid}
          registers={registers}
          onClose={() => setImportOpen(false)}
          onImport={applyImport}
        />
      )}

      <ConfirmDialog
        open={confirmClear}
        title="Clear the whole schedule?"
        message="Every pupil, mark and comment is removed, and the saved draft is deleted. This cannot be undone."
        confirmLabel="Clear everything"
        variant="danger"
        onConfirm={clearAll}
        onCancel={() => setConfirmClear(false)}
      />
    </div>
  )
}
