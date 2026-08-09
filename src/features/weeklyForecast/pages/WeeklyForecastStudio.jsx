/**
 * Weekly Focus studio — /teacher/generate/weekly-forecast
 *
 * Plans the school week day-by-day, connected to the rest of the teacher's
 * curriculum data. It sources content in priority order:
 *
 *   1. A saved Scheme of Work for the grade/subject/term (the chosen week
 *      split across the teaching days).
 *   2. The Syllabi Studio + uploaded modules (the merged CBC knowledge base):
 *      picking a topic auto-suggests its sub-topics, specific competences,
 *      learning activities and expected standards.
 *   3. The teacher's saved Class Timetable, which decides exactly which
 *      weekdays the subject is taught (Mon–Fri, not a fixed 3) and how many
 *      periods it gets — the days adjust to the timetable automatically and
 *      can still be added/removed by hand.
 *
 * An AI assistant (Gemini via Firebase AI Logic) proposes Teacher's /
 * Learner's resources per day, which the teacher accepts, edits or removes.
 * Helpful alerts flag off-curriculum topics, missing standards, a subject
 * that isn't on the timetable, over-allocated weeks and module fallbacks.
 *
 * Outputs the official per-day document (WEEK | DAY | TOPIC | SUB-TOPIC |
 * SPECIFIC COMPETENCE | LEARNING ACTIVITY | EXPECTED STANDARD | T/L
 * RESOURCES | REMARKS) on screen and as landscape DOCX, and saves to the
 * library's Weekly Forecasts section. No usage meter (the curriculum wiring
 * is client-side; only the optional resource assistant calls AI).
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useAuth } from '../../../contexts/AuthContext'
import { curriculumSeedFromProfile } from '../../../utils/teacherDefaults'
import { readActiveAssignmentSeed, resolveStudioSeed } from '../../../utils/activeAssignmentSeed'
import StudioAssignmentChangeNotice from '../../../components/teacher/generate/StudioAssignmentChangeNotice'
import {
  TEACHER_SUBJECTS,
  getTermModuleOutline,
} from '../../../utils/teacherTools'
import {
  getTopicsForTeacherSubject, getSubtopicsForTeacherSubject,
  getCompetencies, TEACHER_SUBJECT_TO_CURRICULUM,
} from '../../../config/curriculum'
import { toKbSubjectKey, subjectLabel as subjectLabelForSlug } from '../../../components/teacher/paperTaxonomy'
import { kbGradeToStudioLabel, studioLabelToKbGrade } from '../../../components/teacher/curriculum/curriculumSelectorConstants'
import {
  getCalendarYears, getTermWeeks, getCurrentForecastWeek,
} from '../../../utils/moeCalendar'
import { schemeWeeks, weekNumberOf, normalizeSchemeWeek, buildForecastDays } from '../../../shared/utils/weeklyForecast'
import { buildGeneratorQueryString } from '../../../utils/useFormDefaultsFromUrl'
import StudioNextSteps from '../../../components/teacher/StudioNextSteps'
import { weekTeachingAvailability, excludeHolidayWeekdays, holidaySummary, openMoveTargets } from '../../../utils/weeklyFocusHolidays'
import {
  WEEKDAYS, buildTopicCatalog, subtopicsForTopic, dayFieldsFromTopic,
  subjectScheduleFromTimetable, forecastAlerts,
} from '../../../utils/weeklyFocusPlanner'
import { listAllSyllabusTopics } from '../../../utils/syllabusKbService'
import { suggestForecastResources } from '../../../utils/forecastResourceSuggest'
import { downloadWeeklyForecastDocx } from '../../../engines/export-engine/weeklyForecastToDocx'
import { buildDownloadName } from '../../../utils/downloadFilename'
import {
  listMyGenerations, titleForGeneration, saveWeeklyForecastGeneration, isFreePlanTeacher,
} from '../../../utils/teacherLibraryService'
import { useLibraryAutoSave } from '../../../hooks/useLibraryAutoSave'
import WeeklyForecastView from '../components/WeeklyForecastView'
import { normalizeCurriculum, schemeCurriculum, curriculumLabel } from '../../../shared/utils/schemeFormat'
import StudioPageHeader from '../../../components/teacher/StudioPageHeader'
import StudioCurriculumSelector from '../../../components/teacher/curriculum/StudioCurriculumSelector'
import SeoHelmet from '../../../components/seo/SeoHelmet'
import ConfirmDialog from '../../../components/ui/ConfirmDialog'
import { useToast } from '../../../components/ui/Toast'
import { useDraftManager } from '../../../hooks/draft/useDraftManager'
import { weeklyForecastDescriptor } from '../../../hooks/draft/descriptors/handBuilt'
import { usePlatformSettings } from '../../../contexts/PlatformSettingsContext'
import DraftRecoveryPrompt from '../../../components/draft/DraftRecoveryPrompt'
import DraftStatusIndicator from '../../../components/draft/DraftStatusIndicator'
import ListTextarea from '../../../components/ui/ListTextarea'

// The standardized curriculum selector's payload already carries the
// canonical KB subject slug (`curr.subject`, e.g. 'mathematics'), which is the
// primary key for every catalogue lookup below. These label→slug maps are the
// FALLBACK bridge only, for subjects that arrive as a bare label with no
// selector payload: a restored draft's header, or a scheme's header subject
// (whatever the model emitted — often UPPERCASED, e.g. "MATHEMATICS", which
// the case-insensitive map rescues).
const SUBJECT_SLUG_BY_LABEL = Object.fromEntries(
  TEACHER_SUBJECTS.filter((s) => s.value).map((s) => [s.label, s.value]),
)
const SUBJECT_SLUG_BY_NORM_LABEL = Object.fromEntries(
  TEACHER_SUBJECTS.filter((s) => s.value).map((s) => [s.label.toLowerCase(), s.value]),
)

const subjectSlugFor = (label) =>
  SUBJECT_SLUG_BY_LABEL[label] ||
  SUBJECT_SLUG_BY_NORM_LABEL[String(label || '').trim().toLowerCase()] ||
  ''

// Two slug vocabularies key the two topic catalogues:
//   - The syllabus KB (listAllSyllabusTopics → buildTopicCatalog, and the
//     uploaded-modules callable) keys rows by CANONICAL KB slugs — the
//     studioSubjectToKbSubject output: 'mathematics', 'zambian_language',
//     'numeracy', 'creative_and_technology_studies', … — exactly the shape
//     `curr.subject` carries.
//   - The static curriculum catalogue (TEACHER_SUBJECT_TO_CURRICULUM →
//     getTopicsForTeacherSubject / getCompetencies) is keyed by TEACHER slugs.
// The two agree for every subject except where a teacher subject folds into a
// broader KB subject — currently only Cinyanja (teacher 'cinyanja' → KB
// 'zambian_language'), so bridge just that one back for the static lookups.
const KB_TO_TEACHER_SUBJECT = { zambian_language: 'cinyanja' }

const YEARS = getCalendarYears()
const thisYear = new Date().getFullYear()

// A neutral starting spread for a core subject (non-consecutive days). The
// timetable overrides this the moment one is picked.
const DEFAULT_WEEKDAYS = ['Monday', 'Wednesday', 'Friday']

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

// A day the teacher has actually started filling — never auto-pruned when the
// week changes even if it lands on a (new) holiday.
const dayHasContent = (d) =>
  !!(String(d?.topic || '').trim() ||
    String(d?.subtopic || '').trim() ||
    String(d?.specificCompetence || '').trim() ||
    (Array.isArray(d?.learningActivities) && d.learningActivities.length > 0))

const blankDay = (weekday) => ({
  day: weekday,
  topic: '',
  subtopic: '',
  specificCompetence: '',
  learningActivities: [],
  expectedStandard: '',
  resources: [],
  remarks: '',
})

// Keep only known weekdays, in Mon→Fri order, reusing any existing day's
// content. Used by every day-set change (toggle, timetable, scheme).
function reconcileDays(prevDays, weekdays) {
  const want = WEEKDAYS.filter((d) => weekdays.includes(d))
  return want.map((wd) => prevDays.find((d) => d.day === wd) || blankDay(wd))
}

// Old drafts (and the pre-upgrade studio) numbered days '1','2','3'. Map any
// numeric day onto its weekday so restored drafts render correctly.
function migrateDayWeekdays(days) {
  if (!Array.isArray(days) || !days.length) return [blankDay('Monday')]
  const out = days.map((d, i) => {
    if (WEEKDAYS.includes(d.day)) return d
    const n = Number(String(d.day || '').replace(/[^0-9]/g, ''))
    return { ...d, day: WEEKDAYS[(Number.isFinite(n) && n >= 1 ? n - 1 : i)] || WEEKDAYS[i] || 'Monday' }
  })
  // De-dupe collisions by keeping Mon→Fri order.
  return reconcileDays(out, out.map((d) => d.day))
}


export default function WeeklyForecastStudio() {
  const { currentUser, userProfile, isAdmin } = useAuth()
  const toast = useToast()
  const uid = currentUser?.uid

  // What the teacher signed up with — used to pre-fill the school and name.
  const profileSchool = userProfile?.school || userProfile?.schoolName || ''
  const profileName = userProfile?.displayName || userProfile?.fullName || ''

  const [header, setHeader] = useState(() => ({
    school: profileSchool,
    teacherName: profileName,
    ...currentWeekDefaults(),
  }))
  // Standardized curriculum selection (CBC/Previous → grade → subject). `curr`
  // is the source of truth for grade + subject; the rest of the studio reads
  // the derived `grade` / `subjectLabel` / `subjectSlug` computed below.
  const [curr, setCurr] = useState({})
  // Grade + subject recovered from a restored draft or an imported scheme —
  // the fallback for the derived values below whenever the selector is
  // untouched, so a restore round-trips its original grade/subject instead of
  // stamping blanks into the saved/exported header. Initialized synchronously
  // from localStorage (uid is known at mount behind TeacherRoute) so the
  // mount-once selector can also be seeded from it.
  // Grade + subject recovered from a restored draft — the fallback for the
  // derived values below whenever the selector is untouched. Starts empty; the
  // Universal Draft Manager fills it on recovery (see onRestore).
  const [restoredMeta, setRestoredMeta] = useState({ grade: '', subjectLabel: '' })
  // Seed for the mount-once curriculum selector: the active Teaching Profile
  // assignment (persisted by the dashboard) wins over the teacher's saved
  // curriculum default. Recovering a draft re-seeds it and bumps selectorKey to
  // remount on the saved grade/subject.
  const [selectorSeed, setSelectorSeed] = useState(() =>
    resolveStudioSeed({
      activeSeed: readActiveAssignmentSeed(uid),
      profileSeed: curriculumSeedFromProfile(userProfile),
    }),
  )
  const [selectorKey, setSelectorKey] = useState(0)
  const [days, setDays] = useState(() => {
    // Exclude days closed by a public holiday from the initial teaching spread.
    const iso = getCurrentForecastWeek()?.beginning || ''
    const wd = excludeHolidayWeekdays(DEFAULT_WEEKDAYS, weekTeachingAvailability(iso).holidays)
    return (wd.length ? wd : DEFAULT_WEEKDAYS).map(blankDay)
  })

  // Scheme source picker.
  const [schemes, setSchemes] = useState([])
  const [schemesStatus, setSchemesStatus] = useState('loading')
  const [schemeId, setSchemeId] = useState('')
  // Connected workflow (§14): the Scheme studio's "Create Weekly Focus"
  // hand-off deep-links here with ?schemeId= so the freshly generated scheme
  // arrives pre-selected in the picker — grade, subject and term then flow
  // from the scheme itself. Applied once when the scheme list loads; the
  // teacher's own picks always win afterwards.
  const [searchParams] = useSearchParams()
  const handoffSchemeId = searchParams.get('schemeId') || ''
  const handoffAppliedRef = useRef(false)
  useEffect(() => {
    if (handoffAppliedRef.current || !handoffSchemeId || schemesStatus !== 'ready') return
    handoffAppliedRef.current = true
    if (schemes.some((s) => s.id === handoffSchemeId)) setSchemeId(handoffSchemeId)
  }, [handoffSchemeId, schemes, schemesStatus])
  const [weekPick, setWeekPick] = useState('')
  // Curriculum-module fallback: when there's no saved scheme, the teacher can
  // load the term's uploaded modules and build the forecast from those.
  const [moduleWeeks, setModuleWeeks] = useState([])
  const [moduleStatus, setModuleStatus] = useState('idle') // idle|loading|ready|empty|error

  // Class timetable source picker.
  const [timetables, setTimetables] = useState([])
  const [timetableId, setTimetableId] = useState('')

  // Merged Syllabi Studio + uploaded-module topics (the CBC knowledge base).
  const [kbTopics, setKbTopics] = useState(null) // null = loading
  const [usedModuleFallback, setUsedModuleFallback] = useState(false)

  const [confirmClear, setConfirmClear] = useState(false)
  const [generationId, setGenerationId] = useState(null)
  const [saving, setSaving] = useState(false)
  const [dirtySinceSave, setDirtySinceSave] = useState(false)
  // Skip the mount + draft-restore runs of the dirty-marking effect so a
  // freshly-loaded saved forecast isn't flagged "Update in library".
  const dirtySkipRef = useRef(1)
  const autoTimetableRef = useRef('')

  // ── Grade + subject: the curriculum selector, falling back to restore ──
  // `curr` (the live selector pick) always wins; `restoredMeta` fills in for
  // a restored draft / imported scheme the mount-once selector can't replay.
  // `grade` is the KB code ('G4'); `subjectLabel` is the printed label
  // ('Mathematics'); the slugs key the catalogue lookups — the KB flavour for
  // the syllabus KB + uploaded modules, the teacher flavour for the static
  // curriculum catalogue (see KB_TO_TEACHER_SUBJECT above).
  const grade = curr.grade || restoredMeta.grade
  const subjectLabel = curr.subjectLabel || restoredMeta.subjectLabel
  // Primary source: the selector's canonical KB slug. The label bridges only
  // serve restores, whose stored header carries the label alone —
  // subjectSlugFor for teacher-taxonomy labels ('Mathematics and Science'),
  // toKbSubjectKey for syllabi-derived ones ('English Language', 'ICT', …).
  const subjectSlug = curr.subject || subjectSlugFor(subjectLabel) || toKbSubjectKey(subjectLabel)
  const kbSubjectSlug = toKbSubjectKey(subjectSlug)
  const teacherSubjectSlug = KB_TO_TEACHER_SUBJECT[kbSubjectSlug] || subjectSlug

  // Saved schemes + timetables for the pickers — quietly degrade to manual.
  useEffect(() => {
    if (!uid) return
    let cancelled = false
    listMyGenerations({ uid, tool: 'scheme_of_work' })
      .then((rows) => { if (!cancelled) { setSchemes(rows.filter((r) => r.output)); setSchemesStatus('ready') } })
      .catch(() => { if (!cancelled) setSchemesStatus('error') })
    listMyGenerations({ uid, tool: 'class_timetable' })
      .then((rows) => { if (!cancelled) setTimetables(rows.filter((r) => r.output?.slots)) })
      .catch(() => { /* timetable picker just stays empty */ })
    return () => { cancelled = true }
  }, [uid])

  // Load the merged syllabi + module topics once. Failure → empty catalogue
  // (every field degrades to free text), no error shown.
  useEffect(() => {
    let cancelled = false
    listAllSyllabusTopics()
      .then((rows) => { if (!cancelled) setKbTopics(Array.isArray(rows) ? rows : []) })
      .catch(() => { if (!cancelled) setKbTopics([]) })
    return () => { cancelled = true }
  }, [])

  // Universal Draft Manager: cross-device auto-save + recovery (replaces the old
  // localStorage-only draft). Persists the effective grade + subjectLabel so a
  // recovered draft can re-seed the curriculum selector and the restoredMeta
  // fallback. The library copy (aiGenerations) is saved separately below.
  const { featureFlags } = usePlatformSettings().settings
  const draft = useDraftManager({
    studioId: 'weekly_forecast',
    uid,
    draftId: 'weekly_forecast-current',
    descriptor: weeklyForecastDescriptor,
    state: { header, days, timetableId, generationId, grade, subjectLabel },
    enabled: Boolean(uid && featureFlags?.universalDrafts !== false),
    onRestore: (p) => {
      if (p.header) setHeader((h) => ({ ...h, ...p.header }))
      // Upgrade any pre-weekday (numeric) day shape on restore.
      if (Array.isArray(p.days) && p.days.length) setDays(migrateDayWeekdays(p.days))
      if (p.timetableId !== undefined) setTimetableId(p.timetableId)
      if (p.generationId !== undefined) setGenerationId(p.generationId)
      const meta = { grade: String(p.grade || ''), subjectLabel: String(p.subjectLabel || '') }
      setRestoredMeta(meta)
      if (meta.grade || meta.subjectLabel) {
        setSelectorSeed({
          curriculumMode: 'cbc',
          gradeLabel: kbGradeToStudioLabel(meta.grade),
          subjectKey: meta.subjectLabel,
        })
        setSelectorKey((k) => k + 1)
      }
      dirtySkipRef.current += 1
    },
  })

  useEffect(() => {
    if (dirtySkipRef.current > 0) { dirtySkipRef.current -= 1; return }
    setDirtySinceSave(true)
  }, [header, days])

  const setH = (field, value) => setHeader((h) => ({ ...h, [field]: value }))

  const competenceOptions = useMemo(
    () => getCompetencies(TEACHER_SUBJECT_TO_CURRICULUM[teacherSubjectSlug]),
    [teacherSubjectSlug],
  )
  const termWeeks = useMemo(
    () => getTermWeeks(Number(header.year), header.term),
    [header.year, header.term],
  )
  // The selected week's Monday (ISO) → School-Calendar teaching-day availability,
  // so closed (public-holiday) days can be excluded from the default spread and
  // shown as unavailable. A ref lets the timetable-apply paths read the current
  // availability without re-running on every week change.
  const weekBeginningISO = useMemo(
    () => termWeeks.find((w) => w.weekNumber === Number(header.weekNumber))?.beginning || '',
    [termWeeks, header.weekNumber],
  )
  const availability = useMemo(() => weekTeachingAvailability(weekBeginningISO), [weekBeginningISO])
  const availabilityRef = useRef(availability)
  availabilityRef.current = availability

  // When the teacher changes the week, drop EMPTY days that are now closed by a
  // holiday (so no lesson slot is auto-created on a closed day); days they have
  // already started filling are kept, with the holiday flagged in the toggles.
  useEffect(() => {
    const set = new Set(availabilityRef.current.holidays.map((h) => h.weekday))
    if (!set.size) return
    setDays((prev) => {
      const pruned = prev.filter((d) => !set.has(d.day) || dayHasContent(d))
      return pruned.length && pruned.length !== prev.length ? pruned : prev
    })
  }, [weekBeginningISO])
  const weekNumberChoices = useMemo(
    () => (termWeeks.length ? termWeeks.map((w) => w.weekNumber) : Array.from({ length: 14 }, (_, i) => i + 1)),
    [termWeeks],
  )

  // The curriculum catalogue for the chosen grade + subject — from the merged
  // Syllabi Studio + uploaded modules. Drives every topic/sub-topic dropdown.
  const topicCatalog = useMemo(
    () => buildTopicCatalog(kbTopics || [], grade, kbSubjectSlug),
    [kbTopics, grade, kbSubjectSlug],
  )
  // Topic names from the syllabus KB; fall back to the static curriculum
  // catalogue when the KB has no rows for this grade/subject so the dropdown
  // is never empty for a catalogued combination.
  const topicNames = useMemo(() => (
    topicCatalog.length ? topicCatalog.map((t) => t.topic) : getTopicsForTeacherSubject(teacherSubjectSlug, grade)
  ), [topicCatalog, teacherSubjectSlug, grade])
  const kbLoading = kbTopics == null

  // Sub-topics for a day's topic: prefer the syllabus KB, fall back to the
  // static curriculum catalogue (which carries its own topic→subtopic map).
  const subtopicOptionsFor = (topic) => {
    const fromKb = subtopicsForTopic(topicCatalog, topic)
    if (fromKb.length) return fromKb
    return getSubtopicsForTeacherSubject(teacherSubjectSlug, grade, topic)
  }

  // The timetable's view of this subject: which weekdays + how many periods.
  const selectedTimetable = useMemo(
    () => timetables.find((t) => t.id === timetableId)?.output || null,
    [timetables, timetableId],
  )
  const schedule = useMemo(
    () => subjectScheduleFromTimetable(selectedTimetable, subjectLabel),
    [selectedTimetable, subjectLabel],
  )

  // Apply the timetable's teaching days for this subject — once per
  // timetable+subject combo, so manual day edits afterwards still stick.
  useEffect(() => {
    const key = `${timetableId}|${subjectLabel}`
    if (!timetableId || autoTimetableRef.current === key) return
    if (schedule.days.length) {
      autoTimetableRef.current = key
      setDays((prev) => reconcileDays(prev, excludeHolidayWeekdays(schedule.days, availabilityRef.current.holidays)))
    }
  }, [timetableId, subjectLabel, schedule.days])

  // ── Week dates ──
  function pickCalendarWeek(weekNumber) {
    const wk = termWeeks.find((w) => w.weekNumber === Number(weekNumber))
    setHeader((h) => ({
      ...h,
      weekNumber: Number(weekNumber),
      ...(wk ? { weekBeginning: wk.beginningLabel, weekEnding: wk.endingLabel } : {}),
    }))
  }
  function setTermOrYear(field, value) {
    setHeader((h) => {
      const next = { ...h, [field]: value }
      const weeks = getTermWeeks(Number(next.year), next.term)
      const wk = weeks.find((w) => w.weekNumber === next.weekNumber) || weeks[0]
      if (wk) { next.weekNumber = wk.weekNumber; next.weekBeginning = wk.beginningLabel; next.weekEnding = wk.endingLabel }
      return next
    })
  }

  // ── Scheme of Work + uploaded-module source ──
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
  // term. Used as the third source when there's no saved scheme to start from.
  async function loadModules() {
    // The uploaded-modules KB (cbcKnowledgeBase/{version}/topics) is keyed by
    // the canonical KB subject slug — the same shape `curr.subject` carries.
    const subject = kbSubjectSlug
    if (!subject) { toast.error('Pick a subject first.'); return }
    setModuleStatus('loading')
    const res = await getTermModuleOutline({ grade, subject, term: header.term })
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
    const weekdays = days.map((d) => d.day)
    const content = buildForecastDays(picked.week, Math.max(1, weekdays.length))
    setDays(weekdays.map((wd, i) => ({ ...(content[i] || blankDay(wd)), day: wd })))
    if (selectedScheme) {
      const out = selectedScheme.output || {}
      // The mount-once curriculum selector can't be driven from here, so the
      // scheme's grade + subject land in restoredMeta: they stamp the header,
      // exports and catalogue lookups unless (until) the teacher picks
      // something in the selector, which always wins. inputs.grade is the
      // server-shape KB code ('G4'); the output header's class/grade + subject
      // are whatever the model emitted (labels, often UPPERCASED) — normalise
      // both to the KB code + canonical printed label.
      const schemeGrade = studioLabelToKbGrade(String(
        selectedScheme.inputs?.grade || out.header?.class || out.header?.grade || '',
      ).trim())
      const rawSubject = String(out.header?.subject || selectedScheme.inputs?.subject || '').trim()
      const schemeSubjectSlug = subjectSlugFor(rawSubject) || toKbSubjectKey(rawSubject)
      const schemeSubjectLabel = subjectLabelForSlug(schemeSubjectSlug) || rawSubject
      if (schemeGrade || schemeSubjectLabel) {
        setRestoredMeta((m) => ({
          grade: schemeGrade || m.grade,
          subjectLabel: schemeSubjectLabel || m.subjectLabel,
        }))
      }
      setHeader((h) => ({
        ...h,
        term: Number(out.header?.term || selectedScheme.inputs?.term || h.term) || h.term,
        weekNumber: Number(picked.value) || h.weekNumber,
      }))
      toast.success(`Week ${picked.value} loaded across ${weekdays.length} day${weekdays.length === 1 ? '' : 's'} — adjust each as you need.`)
    } else {
      // Built from a module sub-topic — header grade/subject/term already
      // reflect what the teacher chose, so leave them and just load the days.
      setUsedModuleFallback(true)
      toast.success(`Sub-topic loaded across ${weekdays.length} day${weekdays.length === 1 ? '' : 's'} — adjust each as you need.`)
    }
  }

  // ── Teaching days ──
  function toggleWeekday(day) {
    const have = days.some((d) => d.day === day)
    if (have && days.length <= 1) { toast.info('Keep at least one teaching day.'); return }
    const next = have ? days.filter((d) => d.day !== day).map((d) => d.day) : [...days.map((d) => d.day), day]
    setDays((prev) => reconcileDays(prev, next))
  }
  function applyTimetableDays() {
    if (!schedule.days.length) { toast.error('This subject isn’t on the selected timetable.'); return }
    const openDays = excludeHolidayWeekdays(schedule.days, availabilityRef.current.holidays)
    setDays((prev) => reconcileDays(prev, openDays.length ? openDays : schedule.days))
    toast.success(`Days set from the timetable: ${(openDays.length ? openDays : schedule.days).join(', ')}.`)
  }

  function updateDay(index, field, value) {
    // Editing a day's content re-opens the non-teaching-day review (the teacher
    // may want to reconsider the date now that it holds new content).
    setDays((list) => list.map((d, i) => (i === index ? { ...d, [field]: value, nonTeachingDayConfirmed: false } : d)))
  }

  // ── Non-teaching-day review (filled holiday days) ──
  const [clearConfirmIndex, setClearConfirmIndex] = useState(null)
  // Keep the lesson on this closed day — records an explicit teacher override so
  // the amber review stops showing (until the date/content changes again).
  function confirmNonTeachingDay(index) {
    setDays((list) => list.map((d, i) => (
      i === index
        ? { ...d, nonTeachingDayConfirmed: true, confirmationReason: 'teacher_override', confirmedAt: new Date().toISOString() }
        : d
    )))
  }
  // Move the lesson to a valid open teaching day this week, preserving content.
  function moveDayTo(index, targetWeekday) {
    if (!targetWeekday) return
    setDays((list) => {
      const moved = list.map((d, i) => (
        i === index ? { ...d, day: targetWeekday, nonTeachingDayConfirmed: false, confirmationReason: '', confirmedAt: '' } : d
      ))
      return reconcileDays(moved, moved.map((d) => d.day))
    })
    toast.success(`Lesson moved to ${targetWeekday}.`)
  }
  // Clear this closed day's content (removes the day from the forecast).
  function clearDay(index) {
    setDays((list) => (list.length <= 1 ? list : list.filter((_, i) => i !== index)))
    setClearConfirmIndex(null)
  }

  // Auto-fill a day's curriculum fields from the chosen topic (and optionally
  // a sub-topic). Off-curriculum topics keep the teacher's free text.
  function applyTopicToDay(index, topic, subtopic = '') {
    const fields = dayFieldsFromTopic(topicCatalog, topic, subtopic)
    if (!fields) {
      setDays((list) => list.map((d, i) => (i === index ? { ...d, topic, ...(subtopic ? { subtopic } : {}) } : d)))
      return
    }
    if (fields.source === 'module') setUsedModuleFallback(true)
    setDays((list) => list.map((d, i) => (i === index ? {
      ...d,
      topic: fields.topic,
      subtopic: subtopic || fields.subtopic,
      specificCompetence: fields.specificCompetence || d.specificCompetence,
      learningActivities: fields.learningActivities.length ? fields.learningActivities : d.learningActivities,
      expectedStandard: fields.expectedStandard || d.expectedStandard,
      resources: fields.resources.length ? fields.resources : d.resources,
    } : d)))
  }

  function addResourceToDay(index, resource) {
    setDays((list) => list.map((d, i) => {
      if (i !== index) return d
      if (d.resources.some((r) => r.toLowerCase() === resource.toLowerCase())) return d
      return { ...d, resources: [...d.resources, resource] }
    }))
  }

  const alerts = useMemo(() => forecastAlerts({
    days,
    subjectLabel,
    timetableSelected: Boolean(timetableId),
    scheduleDays: schedule.days,
    periodsPerWeek: schedule.periodsPerWeek,
    topicCatalog,
    usedModuleFallback,
  }), [days, subjectLabel, timetableId, schedule, topicCatalog, usedModuleFallback])

  // CBC (2023) vs OBC (2013/"previous") drives the forecast's column set. A
  // picked scheme's curriculum wins (the forecast is that scheme's week split
  // across the days); otherwise the curriculum selector decides.
  const forecastCurriculum = useMemo(() => (
    selectedScheme?.output ? schemeCurriculum(selectedScheme.output) : normalizeCurriculum(curr.curriculum)
  ), [selectedScheme, curr.curriculum])

  const artifact = useMemo(() => {
    const filled = days.filter((d) => d.topic.trim() || d.learningActivities.length)
    if (!filled.length) return null
    return {
      schemaVersion: 'forecast-table-1.0',
      header: { ...header, grade, subject: subjectLabel, curriculum: forecastCurriculum },
      days: days.map((d) => ({ ...d })),
    }
  }, [days, header, grade, subjectLabel, forecastCurriculum])

  function clearAll() {
    setHeader({
      school: profileSchool,
      teacherName: profileName,
      ...currentWeekDefaults(),
    })
    {
      const iso = getCurrentForecastWeek()?.beginning || ''
      const wd = excludeHolidayWeekdays(DEFAULT_WEEKDAYS, weekTeachingAvailability(iso).holidays)
      setDays((wd.length ? wd : DEFAULT_WEEKDAYS).map(blankDay))
    }
    setSchemeId(''); setWeekPick(''); setTimetableId('')
    setModuleWeeks([]); setModuleStatus('idle')
    setUsedModuleFallback(false)
    // Drop any restore/scheme fallback — a live selector pick (curr) survives.
    setRestoredMeta({ grade: '', subjectLabel: '' })
    autoTimetableRef.current = ''
    setGenerationId(null)
    draft.clear().catch(() => {})
    setConfirmClear(false)
    toast.info('Cleared. Starting a fresh forecast.')
  }

  async function onSaveToLibrary({ silent = false } = {}) {
    if (!artifact || saving) return
    setSaving(true)
    try {
      const id = await saveWeeklyForecastGeneration({ uid, existingId: generationId, artifact })
      setGenerationId(id)
      setDirtySinceSave(false)
      if (!silent) toast.success(generationId ? 'Library copy updated.' : 'Saved to your library.')
    } catch (err) {
      console.error('[WeeklyForecastStudio] save failed', err)
      if (!silent) toast.error(err?.message || 'Could not save to your library. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  // Auto-save to the library so a hand-built forecast is never lost.
  useLibraryAutoSave({
    enabled: !!artifact,
    dirty: dirtySinceSave,
    saving,
    onSave: () => onSaveToLibrary({ silent: true }),
  })

  async function onExportDocx() {
    if (!artifact) return
    const name = buildDownloadName({ docType: 'Weekly Forecast', grade, subject: subjectLabel, term: header.term, week: header.weekNumber })
    try {
      await downloadWeeklyForecastDocx(artifact, name, { attribution: isFreePlanTeacher({ userProfile, isAdmin }) })
      toast.success('Weekly forecast downloaded.')
    } catch (err) {
      console.error('[WeeklyForecastStudio] docx export failed', err)
      toast.error('Could not build the Word file. Please try again.')
    }
  }

  return (
    <div className="studio-page">
      <SeoHelmet title="Weekly focus" noIndex />
      <div className="w-full">
        <StudioPageHeader
          eyebrow="Weekly Focus"
          title="This week's plan, day by day"
          subtitle="Pull the week from your scheme of work, the syllabus or your timetable — then fine-tune each day and print the official forecast."
          emoji="📅"
        />

        <div className="space-y-6">
          <StudioAssignmentChangeNotice
            uid={uid}
            currentSeed={{ grade: curr.grade || selectorSeed?.grade || '', subject: curr.subject || selectorSeed?.subject || '', curriculum: curr.curriculum || selectorSeed?.curriculum || '' }}
            onApply={(seed) => { setSelectorSeed(seed); setSelectorKey((k) => k + 1); setCurr({}) }}
          hasUnsavedChanges={draft.status !== 'idle'}
          saveDraft={draft.flush}
          />
          <DraftRecoveryPrompt {...draft} label="weekly forecast" />
          {/* ── Plan details (select first) ── */}
          <section className="studio-card p-5 space-y-4">
            <div>
              <h2 className="studio-display" style={{ fontSize: 18, margin: 0 }}>1. Choose what you're planning</h2>
              <p className="text-xs mt-0.5" style={{ color: 'var(--zt-text-muted)' }}>
                Pick the curriculum, grade and subject — the topic and competence lists become specific to them. The week's dates fill from the MoE calendar.
              </p>
            </div>
            <StudioCurriculumSelector key={selectorKey} value={selectorSeed} onChange={setCurr} showTopicSubtopic={false} />
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
          </section>

          {/* ── Sources: scheme + timetable ── */}
          <section className="studio-card p-5 space-y-4">
            <div>
              <h2 className="studio-display" style={{ fontSize: 18, margin: 0 }}>2. Pull from your curriculum</h2>
              <p className="text-xs mt-0.5" style={{ color: 'var(--zt-text-muted)' }}>
                Start from a saved scheme of work, set the teaching days from your class timetable, or just pick topics per day from the syllabus below.
              </p>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {/* Scheme of work + uploaded modules */}
              <div className="rounded-xl border theme-border bg-white p-3 space-y-2">
                <p className="text-xs font-black uppercase tracking-wide" style={{ color: 'var(--zt-text)' }}>📋 Scheme of work or modules</p>
                <div>
                  <label className="studio-label">Saved scheme</label>
                  <select value={schemeId} onChange={(e) => { setSchemeId(e.target.value); setWeekPick('') }} className="studio-input" disabled={schemesStatus !== 'ready' || !schemes.length}>
                    <option value="">{schemesStatus === 'loading' ? 'Loading your schemes…' : schemesStatus === 'error' ? 'Could not load schemes' : schemes.length ? 'Choose a scheme…' : 'No saved schemes yet'}</option>
                    {schemes.map((s) => (
                      <option key={s.id} value={s.id}>{titleForGeneration(s)}</option>
                    ))}
                  </select>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={loadModules}
                    disabled={moduleStatus === 'loading'}
                    className="studio-btn-ghost text-xs disabled:opacity-50"
                  >
                    {moduleStatus === 'loading' ? 'Loading modules…' : '📚 Load from curriculum modules'}
                  </button>
                  <span className="text-xs" style={{ color: 'var(--zt-text-muted)' }}>
                    {moduleStatus === 'ready' && !selectedScheme && `${moduleWeeks.length} module sub-topic${moduleWeeks.length === 1 ? '' : 's'} — pick one in “Week”.`}
                    {moduleStatus === 'empty' && 'No modules for this grade, subject and term yet.'}
                    {moduleStatus === 'error' && 'Could not load modules.'}
                    {moduleStatus === 'idle' && 'No saved scheme? Use uploaded modules.'}
                  </span>
                </div>
                <div className="flex gap-2 items-end">
                  <div className="flex-1">
                    <label className="studio-label">Week</label>
                    <select value={weekPick} onChange={(e) => setWeekPick(e.target.value)} className="studio-input" disabled={!weekOptions.length}>
                      <option value="">{weekOptions.length ? 'Choose a week…' : '—'}</option>
                      {weekOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </select>
                  </div>
                  <button type="button" onClick={buildFromScheme} disabled={!weekPick} className="studio-btn-primary disabled:opacity-50 whitespace-nowrap">
                    ▶ Build the week
                  </button>
                </div>
              </div>

              {/* Class timetable */}
              <div className="rounded-xl border theme-border bg-white p-3 space-y-2">
                <p className="text-xs font-black uppercase tracking-wide" style={{ color: 'var(--zt-text)' }}>🗓️ Class timetable</p>
                <div>
                  <label className="studio-label">Saved timetable</label>
                  <select value={timetableId} onChange={(e) => setTimetableId(e.target.value)} className="studio-input" disabled={!timetables.length}>
                    <option value="">{timetables.length ? 'Choose a timetable…' : 'No saved timetables yet'}</option>
                    {timetables.map((t) => (
                      <option key={t.id} value={t.id}>{titleForGeneration(t)}</option>
                    ))}
                  </select>
                </div>
                {timetableId ? (
                  schedule.days.length ? (
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-xs" style={{ color: 'var(--zt-text-muted)' }}>
                        {subjectLabel} is taught on <strong>{schedule.days.join(', ')}</strong> ({schedule.periodsPerWeek} period{schedule.periodsPerWeek === 1 ? '' : 's'}/week).
                      </p>
                      <button type="button" onClick={applyTimetableDays} className="studio-btn-ghost text-xs whitespace-nowrap">Apply days</button>
                    </div>
                  ) : (
                    <p className="text-xs text-amber-700">{subjectLabel} isn’t on this timetable — choose the days manually below.</p>
                  )
                ) : (
                  <p className="text-xs" style={{ color: 'var(--zt-text-muted)' }}>
                    Pick a timetable and the teaching days set themselves to the days this subject appears.
                  </p>
                )}
              </div>
            </div>

            {/* Teaching-day toggles — the full school week, not a fixed three. */}
            <div>
              <label className="studio-label">Teaching days this week</label>
              <div className="flex flex-wrap gap-2">
                {WEEKDAYS.map((day) => {
                  const on = days.some((d) => d.day === day)
                  const holiday = availability.holidays.find((h) => h.weekday === day)
                  return (
                    <button key={day} type="button" onClick={() => toggleWeekday(day)}
                      aria-pressed={on}
                      title={holiday ? `${day} — ${holiday.holiday} (public holiday). Add it only if your school teaches this day.` : undefined}
                      className={`rounded-full px-3 py-1.5 text-xs font-black border transition-all ${
                        on ? 'theme-accent-fill theme-on-accent border-transparent'
                        : holiday ? 'bg-amber-50 text-amber-700 border-amber-300'
                        : 'bg-white theme-text-muted theme-border hover:theme-text'
                      }`}>
                      {day}{holiday ? ' ·' : ''}{holiday && <span className="ml-0.5 opacity-80" aria-hidden="true">🎉</span>}
                    </button>
                  )
                })}
              </div>
              {availability.holidays.length > 0 && (
                <p className="text-xs mt-1.5" style={{ color: '#b45309' }} role="status">
                  {holidaySummary(availability.holidays)} this week — {availability.count} teaching day{availability.count === 1 ? '' : 's'} available. Holiday days are left out of the plan unless you add them.
                </p>
              )}
              <p className="text-xs mt-1" style={{ color: 'var(--zt-text-muted)' }}>
                Add or remove days to match how often this subject is taught — some subjects run all five days, others only two or three.
              </p>
            </div>
          </section>

          {/* ── Alerts ── */}
          {alerts.length > 0 && (
            <section className="studio-card p-4 space-y-2">
              <h2 className="text-xs font-black uppercase tracking-wide" style={{ color: 'var(--zt-text)' }}>⚠ Checks</h2>
              <ul className="space-y-1.5">
                {alerts.map((a, i) => (
                  <li key={i} className={`text-xs rounded-lg px-3 py-2 ${ALERT_STYLE[a.level] || ALERT_STYLE.info}`}>
                    {a.message}
                  </li>
                ))}
              </ul>
            </section>
          )}

          {/* ── Day editors ── */}
          <section className="studio-card p-5">
            <div className="mb-4">
              <h2 className="studio-display" style={{ fontSize: 20, margin: 0 }}>3. The week, day by day</h2>
              <p className="text-xs mt-0.5" style={{ color: 'var(--zt-text-muted)' }}>
                Pick a topic and the sub-topic, competence, activities and expected standard fill in from the syllabus. One line per activity / resource.
              </p>
            </div>
            <div className="grid grid-cols-1 xl:grid-cols-2 2xl:grid-cols-3 gap-4">
              {days.map((d, i) => {
                const holiday = availability.holidays.find((h) => h.weekday === d.day)
                const needsReview = !!holiday && dayHasContent(d) && !d.nonTeachingDayConfirmed
                const moveTargets = needsReview ? openMoveTargets(days, availability.teachingDays) : []
                return (
                <div key={d.day} className="rounded-xl border theme-border bg-white p-3 space-y-2">
                  <p className="text-xs font-black uppercase tracking-wide" style={{ color: 'var(--zt-text)' }}>
                    {d.day}
                    {holiday && d.nonTeachingDayConfirmed && (
                      <span className="ml-2 text-[10px] font-bold text-amber-700" title={`${holiday.holiday} — you confirmed teaching on this day`}>· holiday (confirmed)</span>
                    )}
                  </p>

                  {needsReview && (
                    <div className="rounded-lg border border-amber-300 bg-amber-50 p-2.5 text-amber-800" role="status">
                      <p className="flex items-center gap-1.5 text-xs font-black">
                        <span aria-hidden="true">⚠</span> This is not a normal teaching day
                      </p>
                      <p className="mt-0.5 text-[11.5px] leading-snug">
                        {d.day} is marked as {holiday.holiday} (a public holiday), but this day already contains teaching content. Review it before saving.
                      </p>
                      {clearConfirmIndex === i ? (
                        <div className="mt-2 flex flex-wrap items-center gap-2">
                          <span className="text-[11.5px] font-bold">Clear this teaching day?</span>
                          <button type="button" onClick={() => clearDay(i)} className="rounded-md border border-amber-400 bg-white px-2 py-1 text-[11px] font-bold text-amber-800 hover:bg-amber-100">Clear day</button>
                          <button type="button" onClick={() => setClearConfirmIndex(null)} className="rounded-md px-2 py-1 text-[11px] font-bold text-amber-800 hover:bg-amber-100">Keep content</button>
                        </div>
                      ) : (
                        <div className="mt-2 flex flex-wrap items-center gap-2">
                          <button type="button" onClick={() => confirmNonTeachingDay(i)} className="rounded-md border border-amber-400 bg-white px-2 py-1 text-[11px] font-bold hover:bg-amber-100">Keep on this date</button>
                          {moveTargets.length > 0 && (
                            <label className="flex items-center gap-1 text-[11px] font-bold">
                              Move to
                              <select
                                aria-label={`Move ${d.day}'s lesson to another teaching day`}
                                defaultValue=""
                                onChange={(e) => { moveDayTo(i, e.target.value); e.target.value = '' }}
                                className="rounded-md border border-amber-400 bg-white px-1.5 py-1 text-[11px] font-bold"
                              >
                                <option value="" disabled>day…</option>
                                {moveTargets.map((wd) => <option key={wd} value={wd}>{wd}</option>)}
                              </select>
                            </label>
                          )}
                          <button type="button" onClick={() => setClearConfirmIndex(i)} className="rounded-md px-2 py-1 text-[11px] font-bold text-amber-800 hover:bg-amber-100">Clear this day</button>
                        </div>
                      )}
                    </div>
                  )}

                  <div>
                    <label className="studio-label">Topic</label>
                    {topicNames.length > 0 && (
                      <PickSelect
                        options={topicNames}
                        value={topicNames.includes(d.topic) ? d.topic : ''}
                        placeholder={kbLoading ? 'Loading syllabus topics…' : '＋ Pick a curriculum topic…'}
                        onPick={(v) => applyTopicToDay(i, v)}
                      />
                    )}
                    <input type="text" value={d.topic} maxLength={120} onChange={(e) => updateDay(i, 'topic', e.target.value)} placeholder={topicNames.length ? '…or type your own' : 'Type the topic'} className="studio-input !py-1.5 text-sm" />
                  </div>
                  <div>
                    <label className="studio-label">Sub-topic / to be done</label>
                    {(() => {
                      const subOpts = subtopicOptionsFor(d.topic)
                      return subOpts.length > 0 && (
                        <PickSelect
                          options={subOpts}
                          value={subOpts.includes(d.subtopic) ? d.subtopic : ''}
                          placeholder="＋ Pick a sub-topic…"
                          onPick={(v) => applyTopicToDay(i, d.topic, v)}
                        />
                      )
                    })()}
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
                    <ListTextarea rows={4} value={d.learningActivities} onChange={(list) => updateDay(i, 'learningActivities', list)} className="studio-input !py-1.5 text-sm resize-none" />
                  </div>
                  <div>
                    <label className="studio-label">Expected standard</label>
                    <textarea rows={2} value={d.expectedStandard} maxLength={300} onChange={(e) => updateDay(i, 'expectedStandard', e.target.value)} className="studio-input !py-1.5 text-sm resize-none" />
                  </div>
                  <div>
                    <label className="studio-label">T/L resources (one per line)</label>
                    <ListTextarea rows={3} value={d.resources} onChange={(list) => updateDay(i, 'resources', list)} className="studio-input !py-1.5 text-sm resize-none" />
                    <ResourceAssistant
                      grade={grade}
                      subject={subjectLabel}
                      topic={d.topic}
                      subtopic={d.subtopic}
                      competence={d.specificCompetence}
                      existing={d.resources}
                      onAdd={(r) => addResourceToDay(i, r)}
                    />
                  </div>
                  <div>
                    <label className="studio-label">Remarks (optional)</label>
                    <input type="text" value={d.remarks} maxLength={200} onChange={(e) => updateDay(i, 'remarks', e.target.value)} className="studio-input !py-1.5 text-sm" />
                  </div>
                </div>
                )
              })}
            </div>
          </section>

          {/* ── Document preview ── */}
          <section className="studio-card p-5">
            <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
              <div>
                <h2 className="studio-display" style={{ fontSize: 20, margin: 0 }}>
                  Your weekly forecast
                  <span
                    className="ml-2 align-middle text-[10px] font-black uppercase tracking-wide px-2 py-0.5 rounded-full"
                    style={{ background: forecastCurriculum === 'obc' ? '#ede9fe' : '#dcfce7', color: forecastCurriculum === 'obc' ? '#6b21a8' : '#166534' }}
                  >
                    {curriculumLabel(forecastCurriculum)}
                  </span>
                </h2>
                <p className="text-xs mt-0.5" style={{ color: 'var(--zt-text-muted)' }}>
                  Exactly what prints — the remarks column travels with it for the classroom
                  {forecastCurriculum === 'obc' ? ' (Outcome-Based: no learning-activity or expected-standard columns).' : '.'}
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
            {generationId && (() => {
              // Connected workflow (§14): the saved week's grade/subject/term
              // + topics flow into the follow-up studios via their existing
              // URL seeding. Lesson Plan Studio takes only the assignment
              // seed today (its topics must come from curriculum rows), so
              // that action opens it plainly.
              const weekTopics = days.map((d) => String(d.topic || '').trim()).filter(Boolean)
              const ctx = {
                grade,
                subject: subjectSlug,
                term: header.term,
                topic: weekTopics.join('; ').slice(0, 240),
              }
              return (
                <StudioNextSteps
                  context="weekly-focus"
                  actions={[
                    { key: 'lesson', label: 'Create this week’s lessons', to: '/teacher/lesson-plans/new' },
                    { key: 'worksheet', label: 'Create weekly worksheet', to: `/teacher/generate/worksheet${buildGeneratorQueryString(ctx)}` },
                    { key: 'short-test', label: 'Create a short test', to: `/teacher/assessment-papers/new${buildGeneratorQueryString(ctx)}` },
                    { key: 'record', label: 'Update Record of Work', to: '/teacher/generate/record-of-work' },
                  ]}
                />
              )
            })()}
            {artifact ? (
              <WeeklyForecastView forecast={artifact} />
            ) : (
              <div className="rounded-xl border border-dashed theme-border bg-white/60 py-14 text-center text-sm" style={{ color: 'var(--zt-text-muted)' }}>
                Build a week from your scheme above, or pick a day's topic — the forecast appears here as you go.
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

const ALERT_STYLE = {
  error: 'bg-rose-50 text-rose-800 border border-rose-200',
  warn: 'bg-amber-50 text-amber-800 border border-amber-200',
  info: 'bg-sky-50 text-sky-800 border border-sky-200',
}

/**
 * The AI suggestion assistant for a day's Teacher's / Learner's resources.
 * Fetches on demand; the teacher accepts (adds to the resources list), or
 * dismisses each chip. Stays silent until asked, and degrades to nothing on
 * any AI failure.
 */
function ResourceAssistant({ grade, subject, topic, subtopic, competence, existing = [], onAdd }) {
  const [status, setStatus] = useState('idle') // idle | loading | done | error
  const [teacher, setTeacher] = useState([])
  const [learner, setLearner] = useState([])

  const lower = useMemo(() => new Set(existing.map((r) => r.toLowerCase())), [existing])

  async function fetchSuggestions() {
    if (!topic) return
    setStatus('loading')
    try {
      const { teacherResources, learnerResources } = await suggestForecastResources({ grade, subject, topic, subtopic, competence })
      setTeacher(teacherResources)
      setLearner(learnerResources)
      setStatus(teacherResources.length || learnerResources.length ? 'done' : 'error')
    } catch {
      setStatus('error')
    }
  }

  function accept(list, setList, item) {
    onAdd(item)
    setList(list.filter((x) => x !== item))
  }

  if (!topic) {
    return <p className="text-[11px] mt-1" style={{ color: 'var(--zt-text-muted)' }}>Pick a topic to get AI resource ideas.</p>
  }

  return (
    <div className="mt-1.5">
      <button
        type="button"
        onClick={fetchSuggestions}
        disabled={status === 'loading'}
        className="text-[11px] font-bold rounded-full px-2.5 py-1 border theme-border bg-white hover:theme-text disabled:opacity-50"
        style={{ color: 'var(--zt-text)' }}
      >
        {status === 'loading' ? '✨ Thinking…' : status === 'done' ? '✨ Suggest more' : '✨ Suggest resources'}
      </button>
      {status === 'error' && (
        <p className="text-[11px] mt-1" style={{ color: '#b45309' }}>No suggestions right now — type your own resources above.</p>
      )}
      {(teacher.length > 0 || learner.length > 0) && (
        <div className="mt-2 space-y-2">
          <SuggestionGroup label="For the teacher" items={teacher} lower={lower} onAccept={(item) => accept(teacher, setTeacher, item)} onDismiss={(item) => setTeacher(teacher.filter((x) => x !== item))} />
          <SuggestionGroup label="For learners" items={learner} lower={lower} onAccept={(item) => accept(learner, setLearner, item)} onDismiss={(item) => setLearner(learner.filter((x) => x !== item))} />
        </div>
      )}
    </div>
  )
}

function SuggestionGroup({ label, items, lower, onAccept, onDismiss }) {
  if (!items.length) return null
  return (
    <div>
      <p className="text-[10px] font-black uppercase tracking-wide" style={{ color: 'var(--zt-text-muted)' }}>{label}</p>
      <div className="flex flex-wrap gap-1.5 mt-1">
        {items.map((item) => {
          const added = lower.has(item.toLowerCase())
          return (
            <span key={item} className="inline-flex items-center gap-1 rounded-full bg-emerald-50 border border-emerald-200 pl-2 pr-1 py-0.5 text-[11px] text-emerald-900">
              {item}
              {added ? (
                <span title="Already added" className="px-1">✓</span>
              ) : (
                <button type="button" onClick={() => onAccept(item)} title="Add to resources" className="px-1 font-black text-emerald-700 hover:text-emerald-900">＋</button>
              )}
              <button type="button" onClick={() => onDismiss(item)} title="Dismiss" className="px-1 text-emerald-400 hover:text-rose-600">×</button>
            </span>
          )
        })}
      </div>
    </div>
  )
}

/**
 * A quick-fill dropdown that sits above a free-text field. With no `value` it
 * snaps back to the placeholder after each pick (additive fields like
 * competence); with a `value` it stays a controlled select reflecting the
 * current choice (topic / sub-topic). Renders nothing with no options.
 */
function PickSelect({ options, onPick, placeholder, value }) {
  if (!Array.isArray(options) || options.length === 0) return null
  const controlled = value !== undefined
  return (
    <select
      value={controlled ? value : ''}
      onChange={(e) => { if (e.target.value || controlled) onPick(e.target.value) }}
      className="studio-input !py-1.5 text-sm mb-1"
    >
      <option value="">{placeholder}</option>
      {options.map((o) => <option key={o} value={o}>{o}</option>)}
    </select>
  )
}

