/**
 * SBA Mark Tracker — /teacher/generate/sba-tracker
 *
 * Pure client-side tool (no AI, no usage meter). The teacher picks a subject +
 * grade; the tracker lays out the official ECZ task columns from the blueprint,
 * the teacher keys each pupil's raw marks, and the tool computes the raw total
 * and the converted 10%-per-grade SBA mark for every pupil — the figure
 * schools retain and enter on the ECZ OMES portal. A small combiner turns the
 * three per-grade marks into the cumulative /30 entered in Grade 7.
 *
 * Drafts autosave to localStorage per teacher + subject + grade.
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../../../contexts/AuthContext'
import {
  SBA_GRADES,
  SBA_SUBJECTS,
  getSbaSubject,
  getSbaBlueprint,
  convertSbaMark,
  combineFinalSbaMark,
  SBA_MAX_FINAL_MARK,
} from '../../../config/sba'
import { clampInt } from '../../../utils/inputs.js'
import { downloadSbaTrackerDocx } from '../../../utils/sbaTrackerToDocx'
import { downloadSbaTrackerXlsx } from '../../../utils/sbaTrackerToXlsx'
import { buildDownloadName } from '../../../utils/downloadFilename'
import { isFreePlanTeacher, saveSbaMarkSheetGeneration } from '../../../utils/teacherLibraryService'
import StudioPageHeader from '../StudioPageHeader'
import SeoHelmet from '../../seo/SeoHelmet'
import ConfirmDialog from '../../ui/ConfirmDialog'
import SbaWorkflowNote from '../SbaWorkflowNote'
import { useToast } from '../../ui/Toast'

const DRAFT_PREFIX = 'examprep:sba-tracker:draft:'
const DRAFT_TTL = 120 * 24 * 60 * 60 * 1000 // an SBA grade spans a whole year
const draftKey = (uid, subject, grade) => `${DRAFT_PREFIX}${uid || 'anon'}:${subject}:${grade}`

let rowSeq = 0
const newPupil = () => ({ id: `p${Date.now()}-${rowSeq += 1}`, name: '', marks: {} })
const blankPupils = (n) => Array.from({ length: n }, () => newPupil())

function loadDraft(uid, subject, grade) {
  try {
    const raw = localStorage.getItem(draftKey(uid, subject, grade))
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (!parsed?.savedAt || Date.now() - parsed.savedAt > DRAFT_TTL) return null
    return parsed
  } catch { return null }
}

export default function SbaMarkTracker() {
  const { currentUser, userProfile, isAdmin } = useAuth()
  const toast = useToast()
  const uid = currentUser?.uid

  const [subject, setSubject] = useState('mathematics')
  const [grade, setGrade] = useState('G5')
  const [header, setHeader] = useState(() => ({
    school: userProfile?.school || userProfile?.schoolName || '',
    className: '',
    year: String(new Date().getFullYear()),
  }))
  const [pupils, setPupils] = useState(() => blankPupils(5))
  const [confirmClear, setConfirmClear] = useState(false)

  // Library persistence — one saved doc per subject + grade sheet.
  const [generationId, setGenerationId] = useState(null)
  const [saving, setSaving] = useState(false)
  const [dirtySinceSave, setDirtySinceSave] = useState(false)

  // Cumulative combiner (decoupled — the three grades are different years).
  const [combo, setCombo] = useState({ g5: '', g6: '', g7: '' })

  const subjectMeta = getSbaSubject(subject)
  const blueprint = useMemo(() => getSbaBlueprint(subject, grade), [subject, grade])
  const columns = useMemo(() => blueprint?.columns || [], [blueprint])
  const total = blueprint?.total || 0

  // Group columns into header bands (Term 1 / Listening & Speaking / …).
  const groups = useMemo(() => {
    const out = []
    for (const c of columns) {
      const last = out[out.length - 1]
      if (last && last.group === c.group) last.span += 1
      else out.push({ group: c.group, span: 1 })
    }
    return out
  }, [columns])

  // Restore a draft whenever subject/grade changes (each combo is its own sheet).
  const loadedKeyRef = useRef('')
  useEffect(() => {
    if (!uid) return
    const key = `${subject}:${grade}`
    if (loadedKeyRef.current === key) return
    loadedKeyRef.current = key
    const draft = loadDraft(uid, subject, grade)
    if (draft) {
      if (draft.header) setHeader((h) => ({ ...h, ...draft.header }))
      setPupils(Array.isArray(draft.pupils) && draft.pupils.length ? draft.pupils : blankPupils(5))
      setGenerationId(draft.generationId || null)
    } else {
      setPupils(blankPupils(5))
      setGenerationId(null)
    }
    setDirtySinceSave(false)
  }, [uid, subject, grade])

  // Debounced autosave (the library doc id rides along so "Update in library"
  // survives a refresh).
  useEffect(() => {
    if (!uid) return undefined
    const t = setTimeout(() => {
      try {
        localStorage.setItem(draftKey(uid, subject, grade), JSON.stringify({ savedAt: Date.now(), header, pupils, generationId }))
      } catch { /* storage full/blocked — the editor still works */ }
    }, 700)
    return () => clearTimeout(t)
  }, [uid, subject, grade, header, pupils, generationId])

  // Mark the saved library copy stale on a genuine *user* edit. (Driven from
  // the mutators below rather than a [header, pupils] effect: that effect also
  // fired on mount and on every draft-restore / profile back-fill, so a
  // freshly-loaded sheet always read "Update in library" instead of "Saved".)
  const markDirty = () => setDirtySinceSave(true)

  // Back-fill the school once the profile resolves (it's often null on first
  // render, so the lazy initializer leaves it blank). Fills only an empty field
  // and writes setHeader directly, so it never marks the sheet dirty.
  useEffect(() => {
    if (!userProfile) return
    setHeader((h) => {
      const school = h.school || userProfile.school || userProfile.schoolName || ''
      return school === h.school ? h : { ...h, school }
    })
  }, [userProfile])

  const setH = (field, value) => { markDirty(); setHeader((h) => ({ ...h, [field]: value })) }

  function updatePupil(id, updater) {
    markDirty()
    setPupils((list) => list.map((p) => (p.id === id ? updater(p) : p)))
  }
  function setMark(id, colKey, raw, max) {
    const value = raw === '' ? undefined : clampInt(raw, 0, max)
    updatePupil(id, (p) => {
      const marks = { ...p.marks }
      if (value === undefined) delete marks[colKey]
      else marks[colKey] = value
      return { ...p, marks }
    })
  }
  const addPupils = (n) => { markDirty(); setPupils((list) => [...list, ...blankPupils(n)]) }
  const removePupil = (id) => { markDirty(); setPupils((list) => list.filter((p) => p.id !== id)) }

  const named = useMemo(() => pupils.filter((p) => p.name.trim()), [pupils])

  function rowTotal(p) {
    return columns.reduce((s, c) => s + (Number(p.marks?.[c.key]) || 0), 0)
  }

  const artifact = useMemo(() => ({
    schemaVersion: 'sba-mark-sheet-1.0',
    header: {
      ...header,
      subject,
      grade,
      subjectLabel: subjectMeta?.label || subject,
      gradeLabel: SBA_GRADES.find((g) => g.value === grade)?.label || grade,
    },
    columns,
    total,
    pupils: named.map((p) => ({ name: p.name, marks: p.marks })),
  }), [header, subjectMeta, subject, grade, columns, total, named])

  function clearAll() {
    markDirty()
    setPupils(blankPupils(5))
    try { localStorage.removeItem(draftKey(uid, subject, grade)) } catch { /* ignore */ }
    setConfirmClear(false)
    toast.info('Cleared this sheet.')
  }

  async function onSaveToLibrary() {
    if (!named.length || saving) return
    setSaving(true)
    try {
      const id = await saveSbaMarkSheetGeneration({ uid, existingId: generationId, artifact })
      setGenerationId(id)
      setDirtySinceSave(false)
      toast.success(generationId ? 'Library copy updated.' : 'Saved to your library.')
    } catch (err) {
      console.error('[SbaMarkTracker] save failed', err)
      toast.error(err?.message || 'Could not save to your library. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  async function onExportDocx() {
    if (!named.length) return
    const name = buildDownloadName({ docType: 'SBA Mark Schedule', grade, subject, topic: header.className || header.year })
    try {
      await downloadSbaTrackerDocx(artifact, name, { attribution: isFreePlanTeacher({ userProfile, isAdmin }) })
      toast.success('SBA mark schedule downloaded.')
    } catch (err) {
      console.error('[SbaMarkTracker] docx export failed', err)
      toast.error('Could not build the Word file. Please try again.')
    }
  }

  async function onExportXlsx() {
    if (!named.length) return
    const name = buildDownloadName({ docType: 'SBA Mark Schedule', grade, subject, topic: header.className || header.year, ext: 'xlsx' })
    try {
      await downloadSbaTrackerXlsx(artifact, name)
      toast.success('Excel workbook downloaded — the SBA mark stays live when you edit marks.')
    } catch (err) {
      console.error('[SbaMarkTracker] xlsx export failed', err)
      toast.error('Could not build the Excel file. Please try again.')
    }
  }

  const finalMark = combineFinalSbaMark({
    g5: Number(combo.g5) || 0,
    g6: Number(combo.g6) || 0,
    g7: Number(combo.g7) || 0,
  })

  return (
    <div className="min-h-screen py-4 sm:py-6 lg:py-8" style={{ background: '#f5efe1' }}>
      <SeoHelmet title="SBA Mark Tracker" noIndex />
      <div className="max-w-7xl mx-auto">
        <StudioPageHeader
          eyebrow="SBA Mark Tracker"
          title="Raw marks in — the ECZ 10% out"
          subtitle="Enter each pupil's task marks against the official ECZ blueprint. The converted SBA mark is calculated for you, ready for the OMES portal."
          emoji="🧮"
        />

        <SbaWorkflowNote current="tracker" />

        <div className="flex flex-wrap gap-2 mb-4 text-xs">
          <Link to="/teacher/generate/sba" className="studio-btn-ghost">🏫 Create SBA tasks →</Link>
          <Link to="/teacher/generate/sba-planner" className="studio-btn-ghost">🗂️ Year Planner →</Link>
        </div>

        <div className="space-y-6">
          {/* ── Class + sheet selectors ── */}
          <section className="studio-card p-5 space-y-4">
            <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
              <div>
                <label className="studio-label">Subject</label>
                <select value={subject} onChange={(e) => setSubject(e.target.value)} className="studio-input">
                  {SBA_SUBJECTS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
                </select>
              </div>
              <div>
                <label className="studio-label">Grade</label>
                <select value={grade} onChange={(e) => setGrade(e.target.value)} className="studio-input">
                  {SBA_GRADES.map((g) => <option key={g.value} value={g.value}>{g.label}</option>)}
                </select>
              </div>
              <div>
                <label className="studio-label">School</label>
                <input type="text" value={header.school} maxLength={120}
                  onChange={(e) => setH('school', e.target.value)} placeholder="School name" className="studio-input" />
              </div>
              <div>
                <label className="studio-label">Class</label>
                <input type="text" value={header.className} maxLength={40}
                  onChange={(e) => setH('className', e.target.value)} placeholder="e.g. 5 Blue" className="studio-input" />
              </div>
              <div>
                <label className="studio-label">Year</label>
                <input type="text" value={header.year} maxLength={4}
                  onChange={(e) => setH('year', e.target.value.replace(/[^\d]/g, ''))} className="studio-input" />
              </div>
            </div>
            <p className="text-xs" style={{ color: '#566f76' }}>
              {subjectMeta?.label} · {SBA_GRADES.find((g) => g.value === grade)?.label}: <strong>{columns.length} tasks</strong>,
              maximum <strong>{total} marks</strong> → converted to 10%.
            </p>
          </section>

          {/* ── Pupils & marks ── */}
          <section className="studio-card p-5">
            <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
              <div>
                <h2 className="studio-display" style={{ fontSize: 20, color: '#0e2a32', margin: 0 }}>Pupils and task marks</h2>
                <p className="text-xs mt-0.5" style={{ color: '#566f76' }}>
                  {named.length} pupil{named.length === 1 ? '' : 's'} · rows without a name are ignored
                </p>
              </div>
              <div className="flex gap-2 flex-wrap">
                <button type="button" onClick={() => addPupils(1)} className="studio-btn-ghost text-xs">+ Add pupil</button>
                <button type="button" onClick={() => addPupils(5)} className="studio-btn-ghost text-xs">+ Add 5</button>
                <button type="button" onClick={() => setConfirmClear(true)} className="studio-btn-ghost text-xs text-rose-700">Clear</button>
                <button
                  type="button"
                  onClick={onSaveToLibrary}
                  disabled={!named.length || saving || (generationId && !dirtySinceSave)}
                  className="studio-btn-ghost text-xs disabled:opacity-50"
                >
                  {saving ? 'Saving…' : generationId ? (dirtySinceSave ? '💾 Update in library' : '✓ Saved') : '💾 Save to library'}
                </button>
                <button type="button" onClick={onExportXlsx} disabled={!named.length} className="studio-btn-ghost text-xs disabled:opacity-50">
                  📊 .xlsx (live formula)
                </button>
                <button type="button" onClick={onExportDocx} disabled={!named.length} className="studio-btn-primary text-xs disabled:opacity-50">
                  📄 Download schedule (.docx)
                </button>
              </div>
            </div>
            {generationId && (
              <p className="text-xs mb-2 -mt-2" style={{ color: '#566f76' }}>
                In your library — <Link to={`/teacher/library/${generationId}`} className="font-bold underline">open the saved copy</Link>.
              </p>
            )}

            <div className="overflow-x-auto">
              <table className="text-sm border-collapse min-w-[720px]">
                <thead>
                  <tr className="text-[11px] font-black uppercase tracking-wide" style={{ color: '#566f76' }}>
                    <th className="py-1.5 pr-2 w-8 text-left" rowSpan={2}>SN</th>
                    <th className="py-1.5 pr-2 text-left sticky left-0 bg-white" rowSpan={2}>Pupil's name</th>
                    {groups.map((g, i) => (
                      <th key={i} colSpan={g.span} className="py-1 px-1 text-center border-b theme-border">{g.group}</th>
                    ))}
                    <th className="py-1.5 px-2 text-center" rowSpan={2}>Total<br />/{total}</th>
                    <th className="py-1.5 px-2 text-center text-emerald-700" rowSpan={2}>SBA<br />/10</th>
                    <th className="w-8" rowSpan={2} />
                  </tr>
                  <tr className="text-[10px] font-bold" style={{ color: '#7a8e94' }}>
                    {columns.map((c) => (
                      <th key={c.key} className="py-1 px-1 text-center align-bottom" title={c.label}>
                        <span className="block max-w-[64px] truncate mx-auto">{c.label}</span>
                        <span className="opacity-60">/{c.max}</span>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {pupils.map((p, idx) => {
                    const raw = rowTotal(p)
                    const conv = convertSbaMark(raw, total).rounded
                    const hasMarks = Object.keys(p.marks || {}).length > 0
                    return (
                      <tr key={p.id} className="border-t theme-border align-middle">
                        <td className="py-1.5 pr-2 text-xs theme-text-secondary">{idx + 1}</td>
                        <td className="py-1.5 pr-2 sticky left-0 bg-white">
                          <input type="text" value={p.name} maxLength={60} placeholder="Full name"
                            aria-label={`Pupil ${idx + 1} name`}
                            onChange={(e) => updatePupil(p.id, (row) => ({ ...row, name: e.target.value }))}
                            className="studio-input !py-1.5 text-sm min-w-[150px]" />
                        </td>
                        {columns.map((c) => (
                          <td key={c.key} className="py-1.5 px-0.5 text-center">
                            <input type="number" inputMode="numeric" min={0} max={c.max}
                              value={p.marks?.[c.key] ?? ''}
                              aria-label={`${p.name || `Pupil ${idx + 1}`} ${c.label}`}
                              onChange={(e) => setMark(p.id, c.key, e.target.value, c.max)}
                              className="studio-input !py-1.5 !px-1 text-sm text-center w-12" />
                          </td>
                        ))}
                        <td className="py-1.5 px-2 text-center font-bold theme-text">{p.name.trim() ? raw : ''}</td>
                        <td className="py-1.5 px-2 text-center font-black text-emerald-700">
                          {p.name.trim() && hasMarks ? conv : ''}
                        </td>
                        <td className="py-1.5 text-center">
                          <button type="button" onClick={() => removePupil(p.id)}
                            aria-label={`Remove ${p.name || `pupil ${idx + 1}`}`}
                            className="text-rose-500 hover:text-rose-700 font-black">×</button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </section>

          {/* ── Final cumulative combiner ── */}
          <section className="studio-card p-5">
            <h2 className="studio-display" style={{ fontSize: 18, color: '#0e2a32', margin: 0 }}>
              Final SBA mark (entered in Grade 7)
            </h2>
            <p className="text-xs mt-0.5 mb-3" style={{ color: '#566f76' }}>
              The mark submitted on the ECZ portal is the sum of the three per-grade SBA marks. Enter a pupil's
              Grade 5, 6 and 7 marks (each out of 10) to get the final out of {SBA_MAX_FINAL_MARK}.
            </p>
            <div className="flex flex-wrap items-end gap-3">
              {[['g5', 'Grade 5 /10'], ['g6', 'Grade 6 /10'], ['g7', 'Grade 7 /10']].map(([k, label]) => (
                <div key={k}>
                  <label className="studio-label">{label}</label>
                  <input type="number" min={0} max={10} value={combo[k]}
                    onChange={(e) => setCombo((c) => ({ ...c, [k]: e.target.value === '' ? '' : clampInt(e.target.value, 0, 10) }))}
                    className="studio-input w-24 text-center" />
                </div>
              ))}
              <div className="rounded-xl px-4 py-2 font-black text-emerald-800 bg-emerald-50 border border-emerald-200">
                Final: {finalMark} / {SBA_MAX_FINAL_MARK}
              </div>
            </div>
          </section>
        </div>
      </div>

      <ConfirmDialog
        open={confirmClear}
        title="Clear this sheet?"
        message="Every pupil and mark on this subject + grade sheet is removed. This cannot be undone."
        confirmLabel="Clear"
        variant="danger"
        onConfirm={clearAll}
        onCancel={() => setConfirmClear(false)}
      />
    </div>
  )
}
