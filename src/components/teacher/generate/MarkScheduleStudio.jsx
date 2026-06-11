/**
 * Mark Schedule studio — /teacher/generate/mark-schedule
 *
 * Pure client-side tool (no AI call, no usage meter): the teacher enters
 * pupils and per-subject marks, and the studio computes totals, class
 * positions (dense ranking — ties share a place) and suggested report
 * comments in a teacher's voice, with raw-marks and percentage views of
 * the same data. Outputs the official two-page document (schedule +
 * Report Comments Sheet) on screen and as DOCX.
 *
 * Comments: each pupil row's comment input shows the suggestion as its
 * placeholder; typing replaces it, clearing falls back to the suggestion.
 *
 * Drafts autosave to localStorage per teacher so an 80-pupil class
 * survives a refresh.
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import { useAuth } from '../../../contexts/AuthContext'
import { TEACHER_GRADES } from '../../../utils/teacherTools'
import { buildSchedule, suggestComment, rankPupils } from '../../../utils/markSchedule'
import { downloadMarkScheduleDocx } from '../../../utils/markScheduleToDocx'
import { downloadMarkScheduleXlsx } from '../../../utils/markScheduleToXlsx'
import { downloadReportCardsDocx } from '../../../utils/reportCardsToDocx'
import { saveMarkScheduleGeneration } from '../../../utils/teacherLibraryService'
import { clampInt } from '../../../utils/inputs.js'
import { Link } from 'react-router-dom'
import MarkScheduleView from '../views/MarkScheduleView'
import StudioPageHeader from '../StudioPageHeader'
import SeoHelmet from '../../seo/SeoHelmet'
import ConfirmDialog from '../../ui/ConfirmDialog'
import { useToast } from '../../ui/Toast'

const DRAFT_PREFIX = 'examprep:markschedule:draft:'
const DRAFT_TTL = 30 * 24 * 60 * 60 * 1000 // 30 days — a schedule spans a marking period
const draftKey = (uid) => `${DRAFT_PREFIX}${uid || 'anon'}`

const DEFAULT_SUBJECTS = [
  { key: 's1', label: 'MATHS', max: 25 },
  { key: 's2', label: 'ENGLISH', max: 25 },
  { key: 's3', label: 'SCIENCE', max: 26 },
  { key: 's4', label: 'SOCIAL STUDIES', max: 26 },
  { key: 's5', label: 'C.T.S', max: 25 },
]

let rowSeq = 0
const newPupil = () => ({ id: `p${Date.now()}-${rowSeq += 1}`, name: '', marks: {}, comment: '' })
const blankPupils = (n) => Array.from({ length: n }, () => newPupil())

function loadDraft(uid) {
  try {
    const raw = localStorage.getItem(draftKey(uid))
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (!parsed?.savedAt || Date.now() - parsed.savedAt > DRAFT_TTL) return null
    return parsed
  } catch { return null }
}

export default function MarkScheduleStudio() {
  const { currentUser, userProfile } = useAuth()
  const toast = useToast()
  const uid = currentUser?.uid

  const [header, setHeader] = useState(() => ({
    school: userProfile?.schoolName || '',
    grade: 'G4',
    term: 1,
    year: String(new Date().getFullYear()),
    nextTermOpens: '',
  }))
  const [subjects, setSubjects] = useState(DEFAULT_SUBJECTS)
  const [pupils, setPupils] = useState(() => blankPupils(5))
  const [mode, setMode] = useState('marks')
  const [confirmClear, setConfirmClear] = useState(false)
  // Library persistence: the saved generation id (create once, then
  // update) and whether edits happened after the last save.
  const [generationId, setGenerationId] = useState(null)
  const [saving, setSaving] = useState(false)
  const [dirtySinceSave, setDirtySinceSave] = useState(false)
  const loadedRef = useRef(false)

  // Restore a saved draft once per mount.
  useEffect(() => {
    if (loadedRef.current || !uid) return
    loadedRef.current = true
    const draft = loadDraft(uid)
    if (!draft) return
    if (draft.header) setHeader((h) => ({ ...h, ...draft.header }))
    if (Array.isArray(draft.subjects) && draft.subjects.length) setSubjects(draft.subjects)
    if (Array.isArray(draft.pupils) && draft.pupils.length) setPupils(draft.pupils)
    if (draft.mode) setMode(draft.mode)
    if (draft.generationId) setGenerationId(draft.generationId)
  }, [uid])

  // Debounced autosave (the library doc id rides along so "Update in
  // library" survives a refresh).
  useEffect(() => {
    if (!uid) return undefined
    const t = setTimeout(() => {
      try {
        localStorage.setItem(draftKey(uid), JSON.stringify({ savedAt: Date.now(), header, subjects, pupils, mode, generationId }))
      } catch { /* storage full/blocked — the editor still works */ }
    }, 800)
    return () => clearTimeout(t)
  }, [uid, header, subjects, pupils, mode, generationId])

  // Any data edit marks the library copy stale.
  useEffect(() => {
    setDirtySinceSave(true)
  }, [header, subjects, pupils])

  const setH = (field, value) => setHeader((h) => ({ ...h, [field]: value }))

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

  /* ── derived schedule ── */
  const named = useMemo(() => pupils.filter((p) => p.name.trim()), [pupils])

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
    setHeader({ school: userProfile?.schoolName || '', grade: 'G4', term: 1, year: String(new Date().getFullYear()), nextTermOpens: '' })
    setSubjects(DEFAULT_SUBJECTS)
    setPupils(blankPupils(5))
    setMode('marks')
    setGenerationId(null) // the library copy (if any) stays; a new save creates a fresh entry
    try { localStorage.removeItem(draftKey(uid)) } catch { /* ignore */ }
    setConfirmClear(false)
    toast.info('Cleared. Starting a fresh schedule.')
  }

  async function onSaveToLibrary() {
    if (!artifact || saving) return
    setSaving(true)
    try {
      const id = await saveMarkScheduleGeneration({ uid, existingId: generationId, artifact })
      setGenerationId(id)
      setDirtySinceSave(false)
      toast.success(generationId ? 'Library copy updated.' : 'Saved to your library.')
    } catch (err) {
      console.error('[MarkScheduleStudio] save failed', err)
      toast.error(err?.message || 'Could not save to your library. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  async function onExportDocx() {
    if (!artifact) return
    const name = `${header.grade}_term${header.term}_${header.year}_mark-schedule.docx`
    try {
      await downloadMarkScheduleDocx(artifact, name, { mode })
      toast.success('Mark schedule downloaded.')
    } catch (err) {
      console.error('[MarkScheduleStudio] docx export failed', err)
      toast.error('Could not build the Word file. Please try again.')
    }
  }

  async function onExportXlsx() {
    if (!artifact) return
    const name = `${header.grade}_term${header.term}_${header.year}_mark-schedule.xlsx`
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
    const name = `${header.grade}_term${header.term}_${header.year}_report-cards.docx`
    try {
      await downloadReportCardsDocx(artifact, name)
      toast.success(`Report cards downloaded — one page per pupil (${artifact.pupils.length}).`)
    } catch (err) {
      console.error('[MarkScheduleStudio] report cards export failed', err)
      toast.error('Could not build the report cards. Please try again.')
    }
  }

  return (
    <div className="min-h-screen p-4 sm:p-6 lg:p-8" style={{ background: '#f5efe1' }}>
      <SeoHelmet title="Mark schedule" noIndex />
      <div className="max-w-7xl mx-auto">
        <StudioPageHeader
          eyebrow="Mark Schedule"
          title="Marks in — positions and comments out"
          subtitle="Enter each pupil's marks once. Totals, class positions and report comments are calculated for you, in raw marks or percentages."
          emoji="🧮"
        />

        <div className="space-y-6">
          {/* ── Class details ── */}
          <section className="studio-card p-5 space-y-4">
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              <div>
                <label className="studio-label">School</label>
                <input type="text" value={header.school} maxLength={120}
                  onChange={(e) => setH('school', e.target.value)}
                  placeholder="School name" className="studio-input" />
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
              <div className="col-span-2">
                <label className="studio-label">Next term opens (printed on report cards, optional)</label>
                <input type="text" value={header.nextTermOpens || ''} maxLength={40}
                  onChange={(e) => setH('nextTermOpens', e.target.value)}
                  placeholder="e.g. Monday 12th January 2027" className="studio-input" />
              </div>
            </div>

            {/* Subjects + max marks */}
            <div>
              <label className="studio-label">Subjects and maximum marks</label>
              <div className="flex flex-wrap gap-2">
                {subjects.map((s) => (
                  <div key={s.key} className="flex items-center gap-1.5 rounded-xl border theme-border bg-white px-2 py-1.5">
                    <input
                      type="text"
                      value={s.label}
                      maxLength={20}
                      aria-label="Subject name"
                      onChange={(e) => updateSubject(s.key, 'label', e.target.value.toUpperCase())}
                      className="w-28 text-xs font-bold outline-none"
                    />
                    <span className="text-xs theme-text-secondary">/</span>
                    <input
                      type="number"
                      min={1}
                      max={300}
                      value={s.max}
                      aria-label="Maximum marks"
                      onChange={(e) => updateSubject(s.key, 'max', clampInt(e.target.value, 1, 300))}
                      className="w-14 text-xs font-bold outline-none text-center"
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
                <h2 className="studio-display" style={{ fontSize: 20, color: '#0e2a32', margin: 0 }}>Pupils and marks</h2>
                <p className="text-xs mt-0.5" style={{ color: '#566f76' }}>
                  {named.length} pupil{named.length === 1 ? '' : 's'} entered · rows without a name are ignored
                </p>
              </div>
              <div className="flex gap-2 flex-wrap">
                <button type="button" onClick={() => addPupils(1)} className="studio-btn-ghost text-xs">+ Add pupil</button>
                <button type="button" onClick={() => addPupils(5)} className="studio-btn-ghost text-xs">+ Add 5</button>
                <button type="button" onClick={() => setConfirmClear(true)} className="studio-btn-ghost text-xs text-rose-700">Clear all</button>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-sm border-collapse min-w-[680px]">
                <thead>
                  <tr className="text-left text-[11px] font-black uppercase tracking-wide" style={{ color: '#566f76' }}>
                    <th className="py-1.5 pr-2 w-8">SN</th>
                    <th className="py-1.5 pr-2">Pupil's name</th>
                    {subjects.map((s) => (
                      <th key={s.key} className="py-1.5 px-1 text-center">{s.label || '—'} /{s.max}</th>
                    ))}
                    <th className="py-1.5 pl-2">Comment (optional — suggestion shown)</th>
                    <th className="w-8" />
                  </tr>
                </thead>
                <tbody>
                  {pupils.map((p, idx) => (
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
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          {/* ── Document preview ── */}
          <section className="studio-card p-5">
            <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
              <div>
                <h2 className="studio-display" style={{ fontSize: 20, color: '#0e2a32', margin: 0 }}>Your mark schedule</h2>
                <p className="text-xs mt-0.5" style={{ color: '#566f76' }}>
                  Positions update as you type — ties share a position.
                </p>
              </div>
              <div className="flex gap-2 flex-wrap items-center">
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
                  className="studio-btn-ghost disabled:opacity-50"
                >
                  {saving ? 'Saving…' : generationId ? (dirtySinceSave ? '💾 Update in library' : '✓ Saved') : '💾 Save to library'}
                </button>
                <button type="button" onClick={onExportXlsx} disabled={!artifact} className="studio-btn-ghost disabled:opacity-50">
                  📊 Download .xlsx (live formulas)
                </button>
                <button type="button" onClick={onExportReportCards} disabled={!artifact} className="studio-btn-ghost disabled:opacity-50">
                  🪪 Report cards (.docx)
                </button>
                <button type="button" onClick={onExportDocx} disabled={!artifact} className="studio-btn-primary disabled:opacity-50">
                  📄 Download .docx (landscape)
                </button>
              </div>
            </div>
            {generationId && (
              <p className="text-xs mb-3 -mt-2" style={{ color: '#566f76' }}>
                In your library — <Link to={`/teacher/library/${generationId}`} className="font-bold underline">open the saved copy</Link>.
              </p>
            )}

            {artifact ? (
              <MarkScheduleView schedule={artifact} mode={mode} />
            ) : (
              <div className="rounded-xl border border-dashed theme-border bg-white/60 py-14 text-center text-sm" style={{ color: '#566f76' }}>
                Add pupils and their marks above — the schedule builds itself here as you type.
              </div>
            )}
          </section>
        </div>
      </div>

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
