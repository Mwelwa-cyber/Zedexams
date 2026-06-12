/**
 * Weekly Forecast studio — /teacher/generate/weekly-forecast
 *
 * Pure client-side tool (no AI call, no usage meter). A weekly forecast
 * is the scheme of work's week split across the teaching days, so the
 * studio builds one FROM a saved scheme: pick a scheme from the library,
 * pick the week, and each day starts with that week's content — then
 * every day is editable on its own. Teachers without a saved scheme can
 * start blank.
 *
 * Outputs the official per-day document (WEEK | DAY | TOPIC | SUB-TOPIC |
 * SPECIFIC COMPETENCE | LEARNING ACTIVITY | EXPECTED STANDARD | T/L
 * RESOURCES | REMARKS) on screen and as landscape DOCX, and saves to the
 * library's Weekly Forecasts section.
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../../../contexts/AuthContext'
import { TEACHER_GRADES, TEACHER_SUBJECTS } from '../../../utils/teacherTools'
import { schemeWeeks, weekNumberOf, normalizeSchemeWeek, buildForecastDays } from '../../../utils/weeklyForecast'
import { downloadWeeklyForecastDocx } from '../../../utils/weeklyForecastToDocx'
import {
  listMyGenerations, titleForGeneration, saveWeeklyForecastGeneration, isFreePlanTeacher,
} from '../../../utils/teacherLibraryService'
import { clampInt } from '../../../utils/inputs.js'
import WeeklyForecastView from '../views/WeeklyForecastView'
import StudioPageHeader from '../StudioPageHeader'
import SeoHelmet from '../../seo/SeoHelmet'
import ConfirmDialog from '../../ui/ConfirmDialog'
import { useToast } from '../../ui/Toast'

const DRAFT_PREFIX = 'examprep:weeklyforecast:draft:'
const DRAFT_TTL = 30 * 24 * 60 * 60 * 1000
const draftKey = (uid) => `${DRAFT_PREFIX}${uid || 'anon'}`

const SUBJECT_LABEL = Object.fromEntries(
  TEACHER_SUBJECTS.filter((s) => s.value).map((s) => [s.value, s.label]),
)

const blankDay = (n) => ({
  day: String(n),
  topic: '',
  subtopic: '',
  specificCompetence: '',
  learningActivities: [],
  expectedStandard: '',
  resources: [],
  remarks: '',
})

function loadDraft(uid) {
  try {
    const raw = localStorage.getItem(draftKey(uid))
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (!parsed?.savedAt || Date.now() - parsed.savedAt > DRAFT_TTL) return null
    return parsed
  } catch { return null }
}

const linesToList = (text) => String(text || '').split('\n').map((l) => l.trim()).filter(Boolean)
const listToLines = (list) => (Array.isArray(list) ? list.join('\n') : '')

export default function WeeklyForecastStudio() {
  const { currentUser, userProfile, isAdmin } = useAuth()
  const toast = useToast()
  const uid = currentUser?.uid

  const [header, setHeader] = useState(() => ({
    school: userProfile?.schoolName || '',
    teacherName: userProfile?.displayName || '',
    grade: 'G4',
    subject: '',
    term: 1,
    year: String(new Date().getFullYear()),
    weekNumber: 1,
    weekBeginning: '',
    weekEnding: '',
  }))
  const [days, setDays] = useState(() => [blankDay(1), blankDay(2), blankDay(3)])
  const [dayCount, setDayCount] = useState(3)

  // Scheme source picker.
  const [schemes, setSchemes] = useState([])
  const [schemesStatus, setSchemesStatus] = useState('loading')
  const [schemeId, setSchemeId] = useState('')
  const [weekPick, setWeekPick] = useState('')

  const [confirmClear, setConfirmClear] = useState(false)
  const [generationId, setGenerationId] = useState(null)
  const [saving, setSaving] = useState(false)
  const [dirtySinceSave, setDirtySinceSave] = useState(false)
  const loadedRef = useRef(false)

  // Saved schemes for the picker — quietly degrades to manual entry.
  useEffect(() => {
    if (!uid) return
    let cancelled = false
    listMyGenerations({ uid, tool: 'scheme_of_work' })
      .then((rows) => { if (!cancelled) { setSchemes(rows.filter((r) => r.output)); setSchemesStatus('ready') } })
      .catch(() => { if (!cancelled) setSchemesStatus('error') })
    return () => { cancelled = true }
  }, [uid])

  // Restore the draft once per mount.
  useEffect(() => {
    if (loadedRef.current || !uid) return
    loadedRef.current = true
    const draft = loadDraft(uid)
    if (!draft) return
    if (draft.header) setHeader((h) => ({ ...h, ...draft.header }))
    if (Array.isArray(draft.days) && draft.days.length) { setDays(draft.days); setDayCount(draft.days.length) }
    if (draft.generationId) setGenerationId(draft.generationId)
  }, [uid])

  // Debounced autosave.
  useEffect(() => {
    if (!uid) return undefined
    const t = setTimeout(() => {
      try {
        localStorage.setItem(draftKey(uid), JSON.stringify({ savedAt: Date.now(), header, days, generationId }))
      } catch { /* storage full/blocked — the editor still works */ }
    }, 800)
    return () => clearTimeout(t)
  }, [uid, header, days, generationId])

  useEffect(() => { setDirtySinceSave(true) }, [header, days])

  const setH = (field, value) => setHeader((h) => ({ ...h, [field]: value }))

  const selectedScheme = useMemo(() => schemes.find((s) => s.id === schemeId) || null, [schemes, schemeId])
  const weekOptions = useMemo(() => {
    if (!selectedScheme) return []
    return schemeWeeks(selectedScheme.output).map((w) => {
      const n = weekNumberOf(w)
      const norm = normalizeSchemeWeek(w)
      return { value: String(n), label: `Week ${n} — ${norm.topic || 'untitled'}`, week: w }
    })
  }, [selectedScheme])

  function buildFromScheme() {
    const picked = weekOptions.find((o) => o.value === weekPick)
    if (!picked) { toast.error('Pick a scheme and a week first.'); return }
    const built = buildForecastDays(picked.week, dayCount)
    setDays(built)
    const out = selectedScheme.output || {}
    setHeader((h) => ({
      ...h,
      grade: selectedScheme.inputs?.grade || h.grade,
      subject: out.header?.subject || SUBJECT_LABEL[selectedScheme.inputs?.subject] || h.subject,
      term: Number(out.header?.term || selectedScheme.inputs?.term || h.term) || h.term,
      weekNumber: Number(picked.value) || h.weekNumber,
    }))
    toast.success(`Week ${picked.value} loaded — now adjust each day as you need.`)
  }

  function setDayCountAndResize(n) {
    const count = clampInt(n, 1, 5)
    setDayCount(count)
    setDays((list) => {
      if (count <= list.length) return list.slice(0, count)
      const extra = Array.from({ length: count - list.length }, (_, i) => blankDay(list.length + i + 1))
      return [...list, ...extra]
    })
  }

  function updateDay(index, field, value) {
    setDays((list) => list.map((d, i) => (i === index ? { ...d, [field]: value } : d)))
  }

  const artifact = useMemo(() => {
    const filled = days.filter((d) => d.topic.trim() || d.learningActivities.length)
    if (!filled.length) return null
    return {
      schemaVersion: 'forecast-table-1.0',
      header,
      days: days.map((d, i) => ({ ...d, day: String(i + 1) })),
    }
  }, [days, header])

  function clearAll() {
    setHeader({
      school: userProfile?.schoolName || '',
      teacherName: userProfile?.displayName || '',
      grade: 'G4', subject: '', term: 1,
      year: String(new Date().getFullYear()),
      weekNumber: 1, weekBeginning: '', weekEnding: '',
    })
    setDays([blankDay(1), blankDay(2), blankDay(3)])
    setDayCount(3)
    setSchemeId(''); setWeekPick('')
    setGenerationId(null)
    try { localStorage.removeItem(draftKey(uid)) } catch { /* ignore */ }
    setConfirmClear(false)
    toast.info('Cleared. Starting a fresh forecast.')
  }

  async function onSaveToLibrary() {
    if (!artifact || saving) return
    setSaving(true)
    try {
      const id = await saveWeeklyForecastGeneration({ uid, existingId: generationId, artifact })
      setGenerationId(id)
      setDirtySinceSave(false)
      toast.success(generationId ? 'Library copy updated.' : 'Saved to your library.')
    } catch (err) {
      console.error('[WeeklyForecastStudio] save failed', err)
      toast.error(err?.message || 'Could not save to your library. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  async function onExportDocx() {
    if (!artifact) return
    const name = `${header.grade}_term${header.term}_week${header.weekNumber}_weekly-forecast.docx`
    try {
      await downloadWeeklyForecastDocx(artifact, name, { attribution: isFreePlanTeacher({ userProfile, isAdmin }) })
      toast.success('Weekly forecast downloaded.')
    } catch (err) {
      console.error('[WeeklyForecastStudio] docx export failed', err)
      toast.error('Could not build the Word file. Please try again.')
    }
  }

  return (
    <div className="min-h-screen p-4 sm:p-6 lg:p-8" style={{ background: '#f5efe1' }}>
      <SeoHelmet title="Weekly forecast" noIndex />
      <div className="max-w-7xl mx-auto">
        <StudioPageHeader
          eyebrow="Weekly Forecast"
          title="This week's plan, day by day"
          subtitle="Pull a week straight out of your scheme of work, adjust each day, and print the official forecast with its remarks column."
          emoji="📅"
        />

        <div className="space-y-6">
          {/* ── Build from a scheme ── */}
          <section className="studio-card p-5 space-y-3">
            <div>
              <h2 className="studio-display" style={{ fontSize: 20, color: '#0e2a32', margin: 0 }}>Start from your scheme of work</h2>
              <p className="text-xs mt-0.5" style={{ color: '#566f76' }}>
                {schemesStatus === 'ready' && schemes.length === 0
                  ? 'No saved schemes yet — generate one first, or fill the days in manually below.'
                  : 'The forecast copies the chosen week into every teaching day; you then fine-tune per day.'}
              </p>
            </div>
            <div className="grid grid-cols-1 lg:grid-cols-[2fr_2fr_1fr_auto] gap-3 items-end">
              <div>
                <label className="studio-label">Saved scheme</label>
                <select value={schemeId} onChange={(e) => { setSchemeId(e.target.value); setWeekPick('') }} className="studio-input" disabled={schemesStatus !== 'ready' || !schemes.length}>
                  <option value="">{schemesStatus === 'loading' ? 'Loading your schemes…' : schemesStatus === 'error' ? 'Could not load schemes' : schemes.length ? 'Choose a scheme…' : 'No saved schemes'}</option>
                  {schemes.map((s) => (
                    <option key={s.id} value={s.id}>{titleForGeneration(s)}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="studio-label">Week</label>
                <select value={weekPick} onChange={(e) => setWeekPick(e.target.value)} className="studio-input" disabled={!weekOptions.length}>
                  <option value="">{weekOptions.length ? 'Choose a week…' : '—'}</option>
                  {weekOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </div>
              <div>
                <label className="studio-label">Teaching days</label>
                <select value={String(dayCount)} onChange={(e) => setDayCountAndResize(e.target.value)} className="studio-input">
                  {[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n}</option>)}
                </select>
              </div>
              <button type="button" onClick={buildFromScheme} disabled={!weekPick} className="studio-btn-primary disabled:opacity-50">
                ▶ Build the week
              </button>
            </div>
          </section>

          {/* ── Forecast details ── */}
          <section className="studio-card p-5 space-y-4">
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
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
                <input type="text" value={header.subject} maxLength={60} onChange={(e) => setH('subject', e.target.value)} placeholder="e.g. Integrated Science" className="studio-input" />
              </div>
              <div>
                <label className="studio-label">Term</label>
                <select value={String(header.term)} onChange={(e) => setH('term', Number(e.target.value))} className="studio-input">
                  {[1, 2, 3].map((t) => <option key={t} value={t}>Term {t}</option>)}
                </select>
              </div>
              <div>
                <label className="studio-label">Week number</label>
                <input type="number" min={1} max={14} value={header.weekNumber} onChange={(e) => setH('weekNumber', clampInt(e.target.value, 1, 14))} className="studio-input" />
              </div>
              <div>
                <label className="studio-label">Week beginning</label>
                <input type="text" value={header.weekBeginning} maxLength={20} onChange={(e) => setH('weekBeginning', e.target.value)} placeholder="e.g. 12 Jan 2026" className="studio-input" />
              </div>
              <div>
                <label className="studio-label">Week ending</label>
                <input type="text" value={header.weekEnding} maxLength={20} onChange={(e) => setH('weekEnding', e.target.value)} placeholder="e.g. 16 Jan 2026" className="studio-input" />
              </div>
            </div>
          </section>

          {/* ── Day editors ── */}
          <section className="studio-card p-5">
            <div className="mb-4">
              <h2 className="studio-display" style={{ fontSize: 20, color: '#0e2a32', margin: 0 }}>The week, day by day</h2>
              <p className="text-xs mt-0.5" style={{ color: '#566f76' }}>
                One line per activity / resource. Remarks stay blank for after the lesson — or note anything ahead of time.
              </p>
            </div>
            <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
              {days.map((d, i) => (
                <div key={i} className="rounded-xl border theme-border bg-white p-3 space-y-2">
                  <p className="text-xs font-black uppercase tracking-wide" style={{ color: '#0e2a32' }}>Day {i + 1}</p>
                  <div>
                    <label className="studio-label">Topic</label>
                    <input type="text" value={d.topic} maxLength={120} onChange={(e) => updateDay(i, 'topic', e.target.value)} className="studio-input !py-1.5 text-sm" />
                  </div>
                  <div>
                    <label className="studio-label">Sub-topic / to be done</label>
                    <input type="text" value={d.subtopic} maxLength={160} onChange={(e) => updateDay(i, 'subtopic', e.target.value)} className="studio-input !py-1.5 text-sm" />
                  </div>
                  <div>
                    <label className="studio-label">Specific competence</label>
                    <textarea rows={2} value={d.specificCompetence} maxLength={400} onChange={(e) => updateDay(i, 'specificCompetence', e.target.value)} className="studio-input !py-1.5 text-sm resize-none" />
                  </div>
                  <div>
                    <label className="studio-label">Learning activities (one per line)</label>
                    <textarea rows={4} value={listToLines(d.learningActivities)} onChange={(e) => updateDay(i, 'learningActivities', linesToList(e.target.value))} className="studio-input !py-1.5 text-sm resize-none" />
                  </div>
                  <div>
                    <label className="studio-label">Expected standard</label>
                    <textarea rows={2} value={d.expectedStandard} maxLength={300} onChange={(e) => updateDay(i, 'expectedStandard', e.target.value)} className="studio-input !py-1.5 text-sm resize-none" />
                  </div>
                  <div>
                    <label className="studio-label">T/L resources (one per line)</label>
                    <textarea rows={3} value={listToLines(d.resources)} onChange={(e) => updateDay(i, 'resources', linesToList(e.target.value))} className="studio-input !py-1.5 text-sm resize-none" />
                  </div>
                  <div>
                    <label className="studio-label">Remarks (optional)</label>
                    <input type="text" value={d.remarks} maxLength={200} onChange={(e) => updateDay(i, 'remarks', e.target.value)} className="studio-input !py-1.5 text-sm" />
                  </div>
                </div>
              ))}
            </div>
          </section>

          {/* ── Document preview ── */}
          <section className="studio-card p-5">
            <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
              <div>
                <h2 className="studio-display" style={{ fontSize: 20, color: '#0e2a32', margin: 0 }}>Your weekly forecast</h2>
                <p className="text-xs mt-0.5" style={{ color: '#566f76' }}>
                  Exactly what prints — the remarks column travels with it for the classroom.
                </p>
              </div>
              <div className="flex gap-2 flex-wrap items-center">
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
              <p className="text-xs mb-3 -mt-2" style={{ color: '#566f76' }}>
                In your library — <Link to={`/teacher/library/${generationId}`} className="font-bold underline">open the saved copy</Link>.
              </p>
            )}
            {artifact ? (
              <WeeklyForecastView forecast={artifact} />
            ) : (
              <div className="rounded-xl border border-dashed theme-border bg-white/60 py-14 text-center text-sm" style={{ color: '#566f76' }}>
                Build a week from your scheme above, or type a day's topic — the forecast appears here as you go.
              </div>
            )}
          </section>
        </div>
      </div>

      <ConfirmDialog
        open={confirmClear}
        title="Clear the whole forecast?"
        message="Every day's content is removed and the saved draft is deleted (a copy already saved to your library stays there). This cannot be undone."
        confirmLabel="Clear everything"
        variant="danger"
        onConfirm={clearAll}
        onCancel={() => setConfirmClear(false)}
      />
    </div>
  )
}
