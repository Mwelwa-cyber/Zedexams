/**
 * SBA Year Planner — /teacher/generate/sba-planner
 *
 * The third SBA surface (alongside the Studio that creates tasks and the Mark
 * Tracker that records marks): a coverage matrix. For the chosen subject +
 * grade it lays out the official ECZ task set, grouped by term/skill, and lets
 * the teacher advance each task through Planned → Administered → Marked. Shows
 * per-group and overall progress against the mandated counts so nothing is
 * under- or over-assessed. Pure client-side; autosaves per teacher + sheet.
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useAuth } from '../../../contexts/AuthContext'
import { SBA_GRADES, SBA_SUBJECTS, getSbaSubject } from '../../../config/sba'
import {
  SBA_TASK_STATUSES,
  buildSbaPlan,
  nextSbaStatus,
  normalizeSbaStatus,
} from '../../../utils/sbaPlanner'
import { downloadSbaPlannerDocx } from '../../../engines/export-engine/sbaPlannerToDocx'
import { buildDownloadName } from '../../../utils/downloadFilename'
import { isFreePlanTeacher, saveSbaPlanGeneration } from '../../../utils/teacherLibraryService'
import { useLibraryAutoSave } from '../../../hooks/useLibraryAutoSave'
import StudioPageHeader from '../../../components/teacher/StudioPageHeader'
import SeoHelmet from '../../../components/seo/SeoHelmet'
import SbaWorkflowNote from '../components/SbaWorkflowNote'
import { useToast } from '../../../components/ui/Toast'
import { useDraftManager } from '../../../hooks/draft/useDraftManager'
import { sbaPlannerDescriptor } from '../../../hooks/draft/descriptors/handBuilt'
import { usePlatformSettings } from '../../../contexts/PlatformSettingsContext'
import DraftStatusIndicator from '../../../components/draft/DraftStatusIndicator'

const TONE_CLASSES = {
  slate: 'bg-slate-100 text-slate-600 border-slate-300',
  amber: 'bg-amber-100 text-amber-800 border-amber-300',
  sky:   'bg-sky-100 text-sky-800 border-sky-300',
  green: 'bg-emerald-100 text-emerald-800 border-emerald-300',
}
const STATUS_BY_VALUE = Object.fromEntries(SBA_TASK_STATUSES.map((s) => [s.value, s]))

export default function SbaYearPlanner() {
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
  const [statuses, setStatuses] = useState({})

  // Library persistence — one saved doc per subject + grade plan.
  const [generationId, setGenerationId] = useState(null)
  const [saving, setSaving] = useState(false)
  const [dirtySinceSave, setDirtySinceSave] = useState(false)

  const subjectMeta = getSbaSubject(subject)
  const plan = useMemo(() => buildSbaPlan(subject, grade, statuses), [subject, grade, statuses])

  // Universal Draft Manager: one cross-device draft per (subject, grade) combo.
  // The composite draftId re-keys on switch; that combo's saved plan is
  // auto-accepted below to keep today's silent per-combo load. The library copy
  // (aiGenerations) is saved separately by useLibraryAutoSave.
  const { featureFlags } = usePlatformSettings().settings
  const draft = useDraftManager({
    studioId: 'sba_planner',
    uid,
    draftId: `sba_planner-${subject}-${grade}`,
    descriptor: sbaPlannerDescriptor,
    state: { header, statuses, generationId },
    enabled: Boolean(uid && featureFlags?.universalDrafts !== false),
    onRestore: (p) => {
      // Direct setters (no markDirty), so a restored plan reads "✓ Saved".
      setStatuses(p.statuses && typeof p.statuses === 'object' ? p.statuses : {})
      if (p.header) setHeader((h) => ({ ...h, ...p.header }))
      setGenerationId(p.generationId ?? null)
    },
  })

  // Silent per-combo load (no prompt), matching today's behaviour — cross-device.
  const acceptRecoveryRef = useRef(draft.acceptRecovery)
  acceptRecoveryRef.current = draft.acceptRecovery
  const recoveryAvailable = draft.recovery.available
  useEffect(() => {
    if (recoveryAvailable) acceptRecoveryRef.current()
  }, [recoveryAvailable])

  // Switching to a combo with NO saved draft clears the previous combo's
  // statuses (the manager does nothing for an empty combo). Skips the first
  // mount; header is kept (matches the old behaviour).
  const comboKeyRef = useRef(`${subject}:${grade}`)
  useEffect(() => {
    const key = `${subject}:${grade}`
    if (comboKeyRef.current === key) return
    comboKeyRef.current = key
    setStatuses({})
    setGenerationId(null)
    setDirtySinceSave(false)
  }, [subject, grade])

  // Mark the saved library copy stale on a genuine *user* edit. (Driven from
  // the mutators below rather than a [header, statuses] effect: that effect
  // also fired on mount and on every draft-restore / profile back-fill, so a
  // freshly-loaded plan always read "Update in library" instead of "Saved".)
  const markDirty = () => setDirtySinceSave(true)

  // Back-fill the school once the profile resolves (it's often null on first
  // render). Fills only an empty field and writes setHeader directly, so it
  // never marks the plan dirty.
  useEffect(() => {
    if (!userProfile) return
    setHeader((h) => {
      const school = h.school || userProfile.school || userProfile.schoolName || ''
      return school === h.school ? h : { ...h, school }
    })
  }, [userProfile])

  // The saved artifact: header (with raw subject/grade + labels) + statuses.
  // The library detail view rebuilds the plan from these.
  const artifact = useMemo(() => ({
    schemaVersion: 'sba-plan-1.0',
    header: {
      ...header,
      subject,
      grade,
      subjectLabel: subjectMeta?.label || subject,
      gradeLabel: SBA_GRADES.find((g) => g.value === grade)?.label || grade,
    },
    statuses,
  }), [header, subject, grade, subjectMeta, statuses])

  const setH = (field, value) => { markDirty(); setHeader((h) => ({ ...h, [field]: value })) }

  function advance(colKey) {
    markDirty()
    setStatuses((s) => ({ ...s, [colKey]: nextSbaStatus(s[colKey]) }))
  }
  function setStatus(colKey, value) {
    markDirty()
    setStatuses((s) => ({ ...s, [colKey]: value }))
  }
  function markAll(value) {
    if (!plan) return
    markDirty()
    const next = {}
    for (const g of plan.groups) for (const c of g.columns) next[c.key] = value
    setStatuses(next)
  }

  async function onSaveToLibrary({ silent = false } = {}) {
    if (!plan || saving) return
    setSaving(true)
    try {
      const id = await saveSbaPlanGeneration({ uid, existingId: generationId, artifact })
      setGenerationId(id)
      setDirtySinceSave(false)
      if (!silent) toast.success(generationId ? 'Library copy updated.' : 'Saved to your library.')
    } catch (err) {
      console.error('[SbaYearPlanner] save failed', err)
      if (!silent) toast.error(err?.message || 'Could not save to your library. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  // Auto-save to the library so a hand-built SBA plan is never lost.
  useLibraryAutoSave({
    enabled: Object.keys(statuses).length > 0,
    dirty: dirtySinceSave,
    saving,
    onSave: () => onSaveToLibrary({ silent: true }),
  })

  async function onExport() {
    if (!plan) return
    const name = buildDownloadName({ docType: 'SBA Year Plan', grade, subject, topic: header.className || header.year })
    try {
      await downloadSbaPlannerDocx(
        { ...plan, statuses },
        {
          ...header,
          subjectLabel: subjectMeta?.label || subject,
          gradeLabel: SBA_GRADES.find((g) => g.value === grade)?.label || grade,
        },
        name,
        { attribution: isFreePlanTeacher({ userProfile, isAdmin }) },
      )
      toast.success('SBA year plan downloaded.')
    } catch (err) {
      console.error('[SbaYearPlanner] docx export failed', err)
      toast.error('Could not build the Word file. Please try again.')
    }
  }

  const summary = plan?.summary

  return (
    <div className="studio-page">
      <SeoHelmet title="SBA Year Planner" noIndex />
      <div className="w-full">
        <StudioPageHeader
          eyebrow="SBA Year Planner"
          title="Every ECZ task, tracked to done"
          subtitle="See the exact tasks SBA requires this year, and move each through Planned → Administered → Marked. Nothing missed, nothing over-assessed."
          emoji="🗂️"
        />

        <SbaWorkflowNote current="planner" />

        <div className="flex flex-wrap gap-2 mb-4 text-xs">
          <Link to="/teacher/generate/sba" className="studio-btn-ghost">🏫 Create SBA tasks →</Link>
          <Link to="/teacher/generate/sba-tracker" className="studio-btn-ghost">🧮 Open the Mark Tracker →</Link>
        </div>

        <div className="space-y-6">
          {/* ── Selectors ── */}
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
          </section>

          {/* ── Overall progress ── */}
          {plan && (
            <section className="studio-card p-5">
              <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
                <div>
                  <h2 className="studio-display" style={{ fontSize: 20, margin: 0 }}>
                    {subjectMeta?.label} · {SBA_GRADES.find((g) => g.value === grade)?.label}
                  </h2>
                  <p className="text-xs mt-0.5" style={{ color: 'var(--zt-text-muted)' }}>
                    {plan.total} marks max → 10% · {summary.total} required tasks
                  </p>
                </div>
                <div className="flex gap-2 flex-wrap items-center">
                  <DraftStatusIndicator status={draft.status} savedAt={draft.savedAt} online={draft.online} />
                  <button type="button" onClick={() => markAll('not_started')} className="studio-btn-ghost text-xs">Reset all</button>
                  <button type="button" onClick={() => markAll('marked')} className="studio-btn-ghost text-xs">Mark all done</button>
                  <button
                    type="button"
                    onClick={onSaveToLibrary}
                    disabled={saving || (generationId && !dirtySinceSave)}
                    className="studio-btn-ghost text-xs disabled:opacity-50"
                  >
                    {saving ? 'Saving…' : generationId ? (dirtySinceSave ? '💾 Update in library' : '✓ Saved') : '💾 Save to library'}
                  </button>
                  <button type="button" onClick={onExport} className="studio-btn-primary text-xs">📄 Download plan (.docx)</button>
                </div>
              </div>
              {generationId && (
                <p className="text-xs mb-3" style={{ color: 'var(--zt-text-muted)' }}>
                  In your library — <Link to={`/teacher/library/${generationId}`} className="font-bold underline">open the saved copy</Link>.
                </p>
              )}

              <div className="flex items-center gap-3">
                <div className="flex-1 h-3 rounded-full bg-slate-200 overflow-hidden">
                  <div className="h-full bg-emerald-500 transition-all" style={{ width: `${summary.percentComplete}%` }} />
                </div>
                <span className="text-sm font-black text-emerald-700 whitespace-nowrap">
                  {summary.done}/{summary.total} · {summary.percentComplete}%
                </span>
              </div>

              {/* Legend */}
              <div className="flex flex-wrap gap-2 mt-3">
                {SBA_TASK_STATUSES.map((s) => (
                  <span key={s.value} className={`text-[11px] font-bold px-2 py-0.5 rounded-full border ${TONE_CLASSES[s.tone]}`}>
                    {s.label}
                  </span>
                ))}
                <span className="text-[11px] theme-text-secondary self-center">— tap a task to advance its status</span>
              </div>
            </section>
          )}

          {/* ── Groups ── */}
          {plan && plan.groups.map((g) => (
            <section key={g.group} className="studio-card p-5">
              <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
                <h3 className="text-base font-black theme-text">{g.group}</h3>
                <span className="text-xs font-bold" style={{ color: 'var(--zt-text-muted)' }}>
                  {g.summary.done}/{g.summary.total} marked · {g.maxMarks} marks
                </span>
              </div>
              <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-2">
                {g.columns.map((c) => {
                  const st = normalizeSbaStatus(statuses[c.key])
                  const meta = STATUS_BY_VALUE[st]
                  return (
                    <div key={c.key} className={`flex items-center justify-between gap-2 rounded-xl border p-2.5 ${TONE_CLASSES[meta.tone]}`}>
                      <button type="button" onClick={() => advance(c.key)} className="flex-1 text-left">
                        <span className="text-sm font-bold block leading-tight">{c.label}</span>
                        <span className="text-[11px] opacity-80">/{c.max} · {meta.label}</span>
                      </button>
                      <select
                        value={st}
                        onChange={(e) => setStatus(c.key, e.target.value)}
                        aria-label={`${c.label} status`}
                        className="text-[11px] font-bold rounded-lg border border-white/60 bg-white/70 px-1.5 py-1"
                      >
                        {SBA_TASK_STATUSES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
                      </select>
                    </div>
                  )
                })}
              </div>
            </section>
          ))}
        </div>
      </div>
    </div>
  )
}
