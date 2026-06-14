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
import {
  TEACHER_GRADES, TEACHER_SUBJECTS,
  getSubjectsForGrade, isSubjectValidForGrade, defaultSubjectForGrade,
  getTermModuleOutline,
} from '../../../utils/teacherTools'
import {
  getTopicsForTeacherSubject, getSubtopicsForTeacherSubject,
  getCompetencies, TEACHER_SUBJECT_TO_CURRICULUM,
} from '../../../config/curriculum'
import {
  getCalendarYears, getTermWeeks, getCurrentForecastWeek,
} from '../../../utils/moeCalendar'
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

// teacher-tools subject slug → display label, and the inverse. The forecast
// header stores the *label* (it prints on the document), but topic/competence
// catalogue lookups are keyed by the slug, so we bridge between the two.
const SUBJECT_LABEL = Object.fromEntries(
  TEACHER_SUBJECTS.filter((s) => s.value).map((s) => [s.value, s.label]),
)
const SUBJECT_SLUG_BY_LABEL = Object.fromEntries(
  TEACHER_SUBJECTS.filter((s) => s.value).map((s) => [s.label, s.value]),
)

const subjectLabelFor = (slug) => SUBJECT_LABEL[slug] || ''
const subjectSlugFor = (label) => SUBJECT_SLUG_BY_LABEL[label] || ''
const defaultSubjectLabel = (grade) => subjectLabelFor(defaultSubjectForGrade(grade))

const YEARS = getCalendarYears()
const thisYear = new Date().getFullYear()

// The current calendar week (live term week, or week 1 of the next term in
// the holidays) — used to pre-fill the header so the common case is one click.
function currentWeekDefaults() {
  const wk = getCurrentForecastWeek()
  return {
    year: String(wk?.year ?? thisYear),
    term: wk?.termNumber ?? 1,
    weekNumber: wk?.weekNumber ?? 1,
    weekBeginning: wk?.beginningLabel ?? '',
    weekEnding: wk?.endingLabel ?? '',
  }
}

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

  // What the teacher signed up with — used to pre-fill the school and name.
  const profileSchool = userProfile?.schoolName || userProfile?.school || ''
  const profileName = userProfile?.displayName || userProfile?.fullName || ''

  const [header, setHeader] = useState(() => ({
    school: profileSchool,
    teacherName: profileName,
    grade: 'G4',
    subject: defaultSubjectLabel('G4'),
    ...currentWeekDefaults(),
  }))
  const [days, setDays] = useState(() => [blankDay(1), blankDay(2), blankDay(3)])
  const [dayCount, setDayCount] = useState(3)

  // Scheme source picker.
  const [schemes, setSchemes] = useState([])
  const [schemesStatus, setSchemesStatus] = useState('loading')
  const [schemeId, setSchemeId] = useState('')
  const [weekPick, setWeekPick] = useState('')
  // Curriculum-module fallback: when there's no saved scheme, the teacher can
  // load the term's uploaded modules and build the forecast from those.
  const [moduleWeeks, setModuleWeeks] = useState([])
  const [moduleStatus, setModuleStatus] = useState('idle') // idle|loading|ready|empty|error

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

  // ── Smart, grade-aware option lists ──
  const subjectOptions = useMemo(() => {
    // getSubjectsForGrade returns the teacher-tools shape (group headers +
    // {value:slug}); the forecast stores labels, so re-key options to labels.
    const opts = getSubjectsForGrade(header.grade).map((o) =>
      o.group !== undefined ? o : { value: o.label, label: o.label })
    // Keep a scheme-supplied or custom subject selectable even if it isn't in
    // the grade's catalogue, so building from a scheme never blanks it.
    if (header.subject && !opts.some((o) => o.value === header.subject)) {
      return [{ value: header.subject, label: header.subject }, ...opts]
    }
    return opts
  }, [header.grade, header.subject])

  const subjectSlug = subjectSlugFor(header.subject)
  const topicOptions = useMemo(
    () => getTopicsForTeacherSubject(subjectSlug, header.grade),
    [subjectSlug, header.grade],
  )
  const competenceOptions = useMemo(
    () => getCompetencies(TEACHER_SUBJECT_TO_CURRICULUM[subjectSlug]),
    [subjectSlug],
  )
  const termWeeks = useMemo(
    () => getTermWeeks(Number(header.year), header.term),
    [header.year, header.term],
  )
  const weekNumberChoices = useMemo(
    () => (termWeeks.length ? termWeeks.map((w) => w.weekNumber) : Array.from({ length: 14 }, (_, i) => i + 1)),
    [termWeeks],
  )

  // When the grade changes, drop a now-invalid subject back to a sensible
  // default. A subject we can't map to a slug (custom / scheme-supplied) is
  // left untouched so we don't clobber it.
  useEffect(() => {
    const slug = subjectSlugFor(header.subject)
    if (slug && !isSubjectValidForGrade(slug, header.grade)) {
      setHeader((h) => ({ ...h, subject: defaultSubjectLabel(h.grade) }))
    }
  }, [header.grade, header.subject])

  // Pick a calendar week → fill the week number plus its begin/end dates.
  function pickCalendarWeek(weekNumber) {
    const wk = termWeeks.find((w) => w.weekNumber === Number(weekNumber))
    setHeader((h) => ({
      ...h,
      weekNumber: Number(weekNumber),
      ...(wk ? { weekBeginning: wk.beginningLabel, weekEnding: wk.endingLabel } : {}),
    }))
  }

  // Changing term or year re-anchors the week's begin/end dates to that term's
  // calendar (keeping the same week number where it still exists).
  function setTermOrYear(field, value) {
    setHeader((h) => {
      const next = { ...h, [field]: value }
      const weeks = getTermWeeks(Number(next.year), next.term)
      const wk = weeks.find((w) => w.weekNumber === next.weekNumber) || weeks[0]
      if (wk) { next.weekNumber = wk.weekNumber; next.weekBeginning = wk.beginningLabel; next.weekEnding = wk.endingLabel }
      return next
    })
  }

  const selectedScheme = useMemo(() => schemes.find((s) => s.id === schemeId) || null, [schemes, schemeId])
  // Week options come from the selected scheme, or — when none is selected —
  // from the loaded curriculum modules (each module sub-topic is one option).
  const weekOptions = useMemo(() => {
    const source = selectedScheme ? schemeWeeks(selectedScheme.output) : moduleWeeks
    return source.map((w) => {
      const n = weekNumberOf(w)
      const norm = normalizeSchemeWeek(w)
      const label = selectedScheme
        ? `Week ${n} — ${norm.topic || 'untitled'}`
        : `${norm.topic || 'Topic'} — ${norm.subtopic || 'sub-topic'}`
      return { value: String(n), label, week: w }
    })
  }, [selectedScheme, moduleWeeks])

  // Load the term's uploaded curriculum modules for the current grade/subject/
  // term. Used when the teacher has no saved scheme to start from.
  async function loadModules() {
    const subject = subjectSlugFor(header.subject)
    if (!subject) { toast.error('Pick a subject first.'); return }
    setModuleStatus('loading')
    const res = await getTermModuleOutline({ grade: header.grade, subject, term: header.term })
    if (!res.ok) { setModuleStatus('error'); toast.error(res.error || 'Could not load modules.'); return }
    const weeks = Array.isArray(res.data?.weeks) ? res.data.weeks : []
    setSchemeId(''); setWeekPick('')
    setModuleWeeks(weeks)
    setModuleStatus(weeks.length ? 'ready' : 'empty')
    if (!weeks.length) {
      toast.info('No curriculum modules uploaded for this grade, subject and term yet.')
    } else {
      toast.success(`${weeks.length} sub-topic${weeks.length === 1 ? '' : 's'} loaded from curriculum modules.`)
    }
  }

  function buildFromScheme() {
    const picked = weekOptions.find((o) => o.value === weekPick)
    if (!picked) { toast.error(selectedScheme ? 'Pick a scheme and a week first.' : 'Load modules and pick a sub-topic first.'); return }
    const built = buildForecastDays(picked.week, dayCount)
    setDays(built)
    if (selectedScheme) {
      const out = selectedScheme.output || {}
      setHeader((h) => ({
        ...h,
        grade: selectedScheme.inputs?.grade || h.grade,
        subject: out.header?.subject || SUBJECT_LABEL[selectedScheme.inputs?.subject] || h.subject,
        term: Number(out.header?.term || selectedScheme.inputs?.term || h.term) || h.term,
        weekNumber: Number(picked.value) || h.weekNumber,
      }))
      toast.success(`Week ${picked.value} loaded — now adjust each day as you need.`)
    } else {
      // Built from a module sub-topic — header grade/subject/term already
      // reflect what the teacher chose, so leave them and just load the days.
      toast.success('Sub-topic loaded — now adjust each day as you need.')
    }
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
      school: profileSchool,
      teacherName: profileName,
      grade: 'G4',
      subject: defaultSubjectLabel('G4'),
      ...currentWeekDefaults(),
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
                  ? 'No saved schemes yet — generate one first, load the curriculum modules for this term, or fill the days in manually below.'
                  : 'The forecast copies the chosen week into every teaching day; you then fine-tune per day.'}
              </p>
              <div className="flex flex-wrap items-center gap-2 mt-2">
                <button
                  type="button"
                  onClick={loadModules}
                  disabled={moduleStatus === 'loading'}
                  className="studio-btn-ghost text-xs disabled:opacity-50"
                >
                  {moduleStatus === 'loading' ? 'Loading modules…' : '📚 Load from curriculum modules'}
                </button>
                <span className="text-xs" style={{ color: '#566f76' }}>
                  {moduleStatus === 'ready' && !selectedScheme && `Showing ${moduleWeeks.length} module sub-topic${moduleWeeks.length === 1 ? '' : 's'} for ${header.subject}, Term ${header.term} — pick one in “Week”.`}
                  {moduleStatus === 'empty' && 'No modules uploaded for this grade, subject and term yet.'}
                  {moduleStatus === 'error' && 'Could not load curriculum modules.'}
                  {moduleStatus === 'idle' && 'No saved scheme? Use the uploaded curriculum modules instead.'}
                </span>
              </div>
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
                <GroupedSelect
                  value={header.subject}
                  options={subjectOptions}
                  onChange={(v) => setH('subject', v)}
                />
              </div>
              <div>
                <label className="studio-label">Year</label>
                <select value={header.year} onChange={(e) => setTermOrYear('year', e.target.value)} className="studio-input">
                  {YEARS.map((y) => <option key={y} value={String(y)}>{y}</option>)}
                  {!YEARS.includes(Number(header.year)) && <option value={header.year}>{header.year}</option>}
                </select>
              </div>
              <div>
                <label className="studio-label">Term</label>
                <select value={String(header.term)} onChange={(e) => setTermOrYear('term', Number(e.target.value))} className="studio-input">
                  {[1, 2, 3].map((t) => <option key={t} value={t}>Term {t}</option>)}
                </select>
              </div>
              <div>
                <label className="studio-label">Week number</label>
                <select value={String(header.weekNumber)} onChange={(e) => pickCalendarWeek(e.target.value)} className="studio-input">
                  {weekNumberChoices.map((n) => <option key={n} value={n}>Week {n}</option>)}
                  {!weekNumberChoices.includes(Number(header.weekNumber)) && (
                    <option value={header.weekNumber}>Week {header.weekNumber}</option>
                  )}
                </select>
              </div>
              <div>
                <label className="studio-label">School calendar</label>
                <select
                  value={termWeeks.some((w) => w.weekNumber === Number(header.weekNumber)) ? String(header.weekNumber) : ''}
                  onChange={(e) => { if (e.target.value) pickCalendarWeek(e.target.value) }}
                  className="studio-input"
                  disabled={!termWeeks.length}
                  title="Fill the dates from the MoE school calendar"
                >
                  <option value="">{termWeeks.length ? '📅 Pick week dates…' : '—'}</option>
                  {termWeeks.map((w) => (
                    <option key={w.weekNumber} value={w.weekNumber}>
                      Wk {w.weekNumber}: {w.beginningLabel} – {w.endingLabel}
                    </option>
                  ))}
                </select>
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
            <p className="text-xs" style={{ color: '#566f76' }}>
              Subjects follow the grade you pick. Dates default to this week on the MoE calendar — switch the week
              number or pick from the calendar to change them, or just type your own.
            </p>
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
                    <PickSelect
                      options={topicOptions}
                      placeholder="＋ Pick a curriculum topic…"
                      onPick={(v) => updateDay(i, 'topic', v)}
                    />
                    <input type="text" value={d.topic} maxLength={120} onChange={(e) => updateDay(i, 'topic', e.target.value)} placeholder="…or type your own" className="studio-input !py-1.5 text-sm" />
                  </div>
                  <div>
                    <label className="studio-label">Sub-topic / to be done</label>
                    <PickSelect
                      options={getSubtopicsForTeacherSubject(subjectSlug, header.grade, d.topic)}
                      placeholder="＋ Pick a sub-topic…"
                      onPick={(v) => updateDay(i, 'subtopic', v)}
                    />
                    <input type="text" value={d.subtopic} maxLength={160} onChange={(e) => updateDay(i, 'subtopic', e.target.value)} placeholder="…or type your own" className="studio-input !py-1.5 text-sm" />
                  </div>
                  <div>
                    <label className="studio-label">Specific competence</label>
                    <PickSelect
                      options={competenceOptions}
                      placeholder="＋ Pick a competence…"
                      onPick={(v) => updateDay(i, 'specificCompetence', v)}
                    />
                    <textarea rows={2} value={d.specificCompetence} maxLength={400} onChange={(e) => updateDay(i, 'specificCompetence', e.target.value)} placeholder="…or write your own" className="studio-input !py-1.5 text-sm resize-none" />
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

/**
 * A quick-fill dropdown that sits above a free-text field: choosing an option
 * drops it into the field (via onPick), then the select snaps back to its
 * placeholder so the text field stays the single source of truth. Renders
 * nothing when there are no options to offer.
 */
function PickSelect({ options, onPick, placeholder }) {
  if (!Array.isArray(options) || options.length === 0) return null
  return (
    <select
      value=""
      onChange={(e) => { if (e.target.value) onPick(e.target.value) }}
      className="studio-input !py-1.5 text-sm mb-1"
    >
      <option value="">{placeholder}</option>
      {options.map((o) => <option key={o} value={o}>{o}</option>)}
    </select>
  )
}

/**
 * A <select> that understands the teacher-tools option shape — entries with a
 * `group` key render as <optgroup> labels, the rest as options. Used for the
 * grade-filtered subject list.
 */
function GroupedSelect({ value, options, onChange }) {
  const groups = []
  let cur = null
  for (const o of options) {
    if (o.group !== undefined) { if (cur) groups.push(cur); cur = { label: o.group, items: [] } }
    else { if (!cur) cur = { label: null, items: [] }; cur.items.push(o) }
  }
  if (cur) groups.push(cur)
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} className="studio-input">
      {groups.map((g, i) => (
        g.label
          ? <optgroup key={i} label={g.label}>{g.items.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</optgroup>
          : g.items.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)
      ))}
    </select>
  )
}
