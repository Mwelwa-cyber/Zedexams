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
import { Link, useSearchParams } from 'react-router-dom'
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
import { downloadSbaTrackerDocx } from '../../../engines/export-engine/sbaTrackerToDocx'
import { downloadSbaTrackerXlsx } from '../../../engines/export-engine/sbaTrackerToXlsx'
import { buildDownloadName } from '../../../utils/downloadFilename'
import { isFreePlanTeacher, saveSbaMarkSheetGeneration } from '../../../utils/teacherLibraryService'
import { useLibraryAutoSave } from '../../../hooks/useLibraryAutoSave'
import StudioPageHeader from '../../../shared/components/StudioPageHeader'
import SeoHelmet from '../../../components/seo/SeoHelmet'
import ConfirmDialog from '../../../components/ui/ConfirmDialog'
import SbaWorkflowNote from '../components/SbaWorkflowNote'
import { useToast } from '../../../components/ui/Toast'
import { useDraftManager } from '../../../hooks/draft/useDraftManager'
import { sbaTrackerDescriptor } from '../../../hooks/draft/descriptors/handBuilt'
import { usePlatformSettings } from '../../../contexts/PlatformSettingsContext'
import DraftStatusIndicator from '../../../components/draft/DraftStatusIndicator'

let rowSeq = 0
const newPupil = () => ({ id: `p${Date.now()}-${rowSeq += 1}`, name: '', marks: {} })
const blankPupils = (n) => Array.from({ length: n }, () => newPupil())

export default function SbaMarkTracker() {
  const { currentUser, userProfile, isAdmin } = useAuth()
  const toast = useToast()
  const uid = currentUser?.uid

  // Deep-link support: the Recovery Centre resumes a per-combo draft with
  // ?subject=&grade=. Seed from the URL when the values are valid, else default.
  const [searchParams] = useSearchParams()
  const [subject, setSubject] = useState(() => {
    const s = searchParams.get('subject')
    return s && SBA_SUBJECTS.some((x) => x.value === s) ? s : 'mathematics'
  })
  const [grade, setGrade] = useState(() => {
    const g = searchParams.get('grade')
    return g && SBA_GRADES.some((x) => x.value === g) ? g : 'G5'
  })
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

  // Universal Draft Manager: one cross-device draft per (subject, grade) combo.
  // The composite draftId re-keys the manager on switch, which re-offers that
  // combo's saved sheet; auto-accepted below to preserve today's silent per-combo
  // load. The library copy (aiGenerations) is saved separately by useLibraryAutoSave.
  const { featureFlags } = usePlatformSettings().settings
  const draft = useDraftManager({
    studioId: 'sba_tracker',
    uid,
    draftId: `sba_tracker-${subject}-${grade}`,
    descriptor: sbaTrackerDescriptor,
    state: { header, pupils, generationId },
    enabled: Boolean(uid && featureFlags?.universalDrafts !== false),
    onRestore: (p) => {
      // Direct setters (no markDirty), so a restored sheet reads "✓ Saved".
      if (p.header) setHeader((h) => ({ ...h, ...p.header }))
      setPupils(Array.isArray(p.pupils) && p.pupils.length ? p.pupils : blankPupils(5))
      setGenerationId(p.generationId ?? null)
    },
  })

  // Silent per-combo load: auto-accept the recovered sheet (no prompt) — matches
  // today's "switch subject/grade → that sheet loads" behaviour, now cross-device.
  // Depends only on the primitive availability flag; accept is called through a
  // ref so the effect never re-fires on the changing draft object.
  const acceptRecoveryRef = useRef(draft.acceptRecovery)
  acceptRecoveryRef.current = draft.acceptRecovery
  const recoveryAvailable = draft.recovery.available
  useEffect(() => {
    if (recoveryAvailable) acceptRecoveryRef.current()
  }, [recoveryAvailable])

  // Switching to a combo with NO saved draft must clear the previous combo's
  // rows (the manager does nothing when a combo is empty). Skips the first mount
  // (comboKeyRef seeded with the initial combo). Header is intentionally kept
  // (matches the old behaviour); auto-accept overlays a saved sheet a tick later.
  const comboKeyRef = useRef(`${subject}:${grade}`)
  useEffect(() => {
    const key = `${subject}:${grade}`
    if (comboKeyRef.current === key) return
    comboKeyRef.current = key
    setPupils(blankPupils(5))
    setGenerationId(null)
    setDirtySinceSave(false)
  }, [subject, grade])

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
    draft.clear().catch(() => {})
    setConfirmClear(false)
    toast.info('Cleared this sheet.')
  }

  async function onSaveToLibrary({ silent = false } = {}) {
    if (!named.length || saving) return
    setSaving(true)
    try {
      const id = await saveSbaMarkSheetGeneration({ uid, existingId: generationId, artifact })
      setGenerationId(id)
      setDirtySinceSave(false)
      if (!silent) toast.success(generationId ? 'Library copy updated.' : 'Saved to your library.')
    } catch (err) {
      console.error('[SbaMarkTracker] save failed', err)
      if (!silent) toast.error(err?.message || 'Could not save to your library. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  // Auto-save to the library so a hand-built SBA mark sheet is never lost.
  useLibraryAutoSave({
    enabled: named.length > 0,
    dirty: dirtySinceSave,
    saving,
    onSave: () => onSaveToLibrary({ silent: true }),
  })

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
    <div className="studio-page">
      <SeoHelmet title="SBA Mark Tracker" noIndex />
      <div className="w-full">
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
            <p className="text-xs" style={{ color: 'var(--zt-text-muted)' }}>
              {subjectMeta?.label} · {SBA_GRADES.find((g) => g.value === grade)?.label}: <strong>{columns.length} tasks</strong>,
              maximum <strong>{total} marks</strong> → converted to 10%.
            </p>
          </section>

          {/* ── Pupils & marks ── */}
          <section className="studio-card p-5">
            <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
              <div>
                <h2 className="studio-display" style={{ fontSize: 20, margin: 0 }}>Pupils and task marks</h2>
                <p className="text-xs mt-0.5" style={{ color: 'var(--zt-text-muted)' }}>
                  {named.length} pupil{named.length === 1 ? '' : 's'} · rows without a name are ignored
                </p>
              </div>
              <div className="flex gap-2 flex-wrap items-center">
                <DraftStatusIndicator status={draft.status} savedAt={draft.savedAt} online={draft.online} />
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
              <p className="text-xs mb-2 -mt-2" style={{ color: 'var(--zt-text-muted)' }}>
                In your library — <Link to={`/teacher/library/${generationId}`} className="font-bold underline">open the saved copy</Link>.
              </p>
            )}

            <div className="overflow-x-auto">
              <table className="text-sm border-collapse min-w-[720px]">
                <thead>
                  <tr className="text-[11px] font-black uppercase tracking-wide" style={{ color: 'var(--zt-text-muted)' }}>
                    <th className="py-1.5 pr-2 w-8 text-left" rowSpan={2}>SN</th>
                    <th className="py-1.5 pr-2 text-left sticky left-0 bg-white" rowSpan={2}>Pupil's name</th>
                    {groups.map((g, i) => (
                      <th key={i} colSpan={g.span} className="py-1 px-1 text-center border-b theme-border">{g.group}</th>
                    ))}
                    <th className="py-1.5 px-2 text-center" rowSpan={2}>Total<br />/{total}</th>
                    <th className="py-1.5 px-2 text-center text-emerald-700" rowSpan={2}>SBA<br />/10</th>
                    <th className="w-8" rowSpan={2} />
                  </tr>
                  <tr className="text-[10px] font-bold" style={{ color: 'var(--zt-text-muted)' }}>
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
            <h2 className="studio-display" style={{ fontSize: 18, margin: 0 }}>
              Final SBA mark (entered in Grade 7)
            </h2>
            <p className="text-xs mt-0.5 mb-3" style={{ color: 'var(--zt-text-muted)' }}>
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
