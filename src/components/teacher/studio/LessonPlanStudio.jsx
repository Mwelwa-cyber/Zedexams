import { useState, useCallback, useRef, useEffect, useMemo } from 'react'
import './lessonStudio.css'
import { getFunctions, httpsCallable } from 'firebase/functions'
import { doc, setDoc, serverTimestamp } from 'firebase/firestore'
import { useNavigate, useParams } from 'react-router-dom'
import {
  BookOpen,
  ChartNoAxesColumnIncreasing,
  FileCheck,
  FileText,
  House,
  Layers,
  Sparkles,
} from 'lucide-react'
import app, { db } from '../../../firebase/config'
import { useAuth } from '../../../contexts/AuthContext'
import { CurriculumContext } from './CurriculumContext'
import { useStudioState } from './hooks/useStudioState'
import { useLessonSeries } from './hooks/useLessonSeries'
import { StudioShell } from './StudioShell'
import StudioHeader from '../StudioHeader.jsx'
import { LessonPlanWizard } from './wizard/LessonPlanWizard.jsx'
import { StudioCanvas } from './StudioCanvas'
import { renderPlanHtml } from './utils/renderPlanHtml'
import { normalizePlanShape } from './utils/planShape'
import { cleanSubjectName } from './utils/subjectName'
import { STUDIO_SYSTEM_PROMPT_CBC, STUDIO_SYSTEM_PROMPT_PREVIOUS } from './utils/studioSystemPrompt'
import { schoolResourcePromptLines, DEFAULT_SCHOOL_RESOURCES } from '../../../config/schoolResources'
import { lessonStudioSeed, aiPrefsPromptLines } from '../../../utils/teacherDefaults'
import { getSchoolProfile } from '../../../utils/schoolProfileService'
import { useAILessonCount } from './hooks/useAILessonCount'
import { useTeacherPlanContext } from './hooks/useTeacherPlanContext'
import { useActiveAssignmentContext } from './hooks/useActiveAssignmentContext'
import { buildPlannedTeachingMeta } from '../../../utils/plannedTeachingMeta'
import { isNonTeachingDay, isWeekend, publicHolidayOn } from '../../../utils/calendarResolver'
import { useCoverageAnalysis } from './hooks/useCoverageAnalysis'
import { buildAlignmentInstructions } from './utils/teacherPlanContext'
import { buildGeneratorQueryString } from '../../../utils/useFormDefaultsFromUrl'
import {
  WRITING_STYLE_DIRECTIVES,
  resolveLessonFormat,
  toStoredPreferences,
} from '../../../utils/lessonPlanFormat'
import { runLengthGate } from '../../../utils/lessonPlanCondense'
import { blockNotationDirective } from '../../../utils/lessonPlanBlocks'
import { normalizeTeacherPreferences } from '../../../utils/teacherSettingsCore'
import { downloadLessonPlanDocx } from '../../../utils/lessonPlanToDocx'
import { saveLessonPlanGeneration, getGeneration } from '../../../utils/teacherLibraryService'
import { LIBRARY_TYPES } from '../../../config/library'
import { generateDiagram } from '../../../utils/generateDiagram'
import { buildLessonDiagramPrompt } from '../../../utils/lessonDiagramPrompt'
import { useGenerationGate } from '../../../hooks/useGenerationGate'
import { paywall } from '../../../utils/paywall'
import { beginCriticalWork } from '../../../utils/criticalWork'
import { useLessonMemory } from './hooks/useLessonMemory'
import {
  saveLessonPlanMemory,
  setLessonTeachingStatus,
  attachGenerationToMemory,
  touchLessonProgress,
} from '../../../utils/lessonMemoryService'
import {
  buildSubtopicKey,
  buildGradeSubjectKey,
  curriculumTypeLabel,
  lessonsForSubtopic,
  resolveExpectedCount,
  generateButtonState,
  findLessonByNumber,
  subtopicProgress,
  lessonPlanDocId,
  extractCode,
  stripCode,
} from './utils/lessonMemory'
import { DuplicateLessonModal } from './modals/DuplicateLessonModal'
import { useDraftManager } from '../../../hooks/draft/useDraftManager'
import { lessonPlanInputDescriptor } from '../../../hooks/draft/descriptors'
import { useAiOperationLock } from '../../../hooks/useAiOperationLock'
import { stableFingerprint } from '../../../hooks/aiOperationLockCore'
import { applyLessonPlanRestore } from '../../../hooks/draft/restoreLessonPlan'
import { usePlatformSettings } from '../../../contexts/PlatformSettingsContext'
import DraftRecoveryPrompt from '../../draft/DraftRecoveryPrompt'
import DraftStatusIndicator from '../../draft/DraftStatusIndicator'

const functions = getFunctions(app, 'us-central1')
const generateCallable = httpsCallable(functions, 'studioGenerateLessonPlan', { timeout: 120_000 })

// Teaching Kit tools surfaced once a plan exists. `id` drives openKitTool().
// Lucide components, not emoji — the teacher surfaces draw every icon at the
// row's own size and colour rather than the platform's.
const KIT_TOOLS = [
  { id: 'worksheet',  label: 'Worksheet',  Icon: FileText },
  { id: 'homework',   label: 'Homework',   Icon: House },
  { id: 'notes',      label: 'Notes',      Icon: BookOpen },
  { id: 'flashcards', label: 'Flashcards', Icon: Layers },
  { id: 'test',       label: 'Test Paper', Icon: FileCheck },
]

// Map a studioGenerateLessonPlan quota rejection to the matching upgrade
// paywall. The server's usage meter (functions/teacherTools/usageMeter.js)
// throws an HttpsError("failed-precondition", …) carrying a structured
// `details.reason` ('monthly-limit' | 'daily-cap' | 'max-only') when a teacher
// is out of lesson-plan quota. Without this, the studio just printed the raw
// error string and offered no way to upgrade — so a capped teacher saw "it
// just brings tables / an error" with no payment path. Returns true when it
// recognised a quota error and opened the paywall (caller then skips the
// generic error panel); false for any non-quota failure.
function showQuotaPaywallForError(err) {
  const code = err && err.code ? String(err.code) : ''
  const reason = err && err.details && err.details.reason ? String(err.details.reason) : ''
  if (code !== 'functions/failed-precondition' && !reason) return false
  switch (reason) {
    case 'max-only':
      paywall.show('max-feature', { feature: 'Lesson plans', tool: 'lesson_plan' })
      return true
    case 'daily-cap':
      paywall.show('daily-cap', { feature: 'lesson plans', tool: 'lesson_plan' })
      return true
    case 'monthly-limit':
      paywall.show('monthly-limit', { feature: 'lesson plans', tool: 'lesson_plan' })
      return true
    default:
      return false
  }
}

// Pick the stage an auto/manual illustration should sit under. Prefers the
// lesson-development stage (where worked examples live), falling back to the
// second stage, then the first, then the canonical development-stage label.
// The returned name is matched loosely by renderPlanHtml's stageMatches().
function pickIllustrationStage(planJson, curriculumMode) {
  const stages = Array.isArray(planJson?.stages) ? planJson.stages : []
  const dev = stages.find((s) => /develop/i.test(String(s?.name || '')))
  if (dev?.name) return dev.name
  if (stages.length > 1 && stages[1]?.name) return stages[1].name
  if (stages.length > 0 && stages[0]?.name) return stages[0].name
  return curriculumMode === 'previous' ? 'DEVELOPMENT' : 'LESSON DEVELOPMENT'
}

// Fingerprint of the INPUT slices a generation was started from. Compared
// before the post-save draft.clear(): if the teacher went "Back to form" and
// kept editing while the request was in flight, the current inputs no longer
// match and the newer draft must survive. From lessonSeries only the
// teacher-typed keys are picked — seriesId is minted by the generate handler
// itself mid-run and any future machine-stamped key must not spuriously
// block the clear either.
function draftInputFingerprint(s) {
  const series = s.lessonSeries || {}
  return JSON.stringify({
    curriculumMode: s.curriculumMode,
    lessonDetails: s.lessonDetails,
    topic: s.topicData?.topic ?? '',
    subtopic: s.topicData?.subtopic ?? '',
    selectedOutcomes: s.selectedOutcomes,
    learningEnvironments: s.learningEnvironments,
    lessonSeries: {
      planningMode: series.planningMode ?? 'single',
      totalLessons: series.totalLessons ?? 1,
      lessonNumber: series.lessonNumber ?? 1,
      lessonFocus: series.lessonFocus ?? '',
    },
    lessonBreakdown: s.lessonBreakdown,
    formatOptions: s.formatOptions,
  })
}

// ── Validation ────────────────────────────────────────────────────────────────

/**
 * Returns true when all required fields are filled and the Generate button
 * should be enabled.
 *
 * @param {object} studioState - Return value of useStudioState()
 * @returns {boolean}
 */
function computeIsValid(studioState) {
  const {
    curriculumMode,
    lessonDetails,
    topicData,
    selectedOutcomes,
    learningEnvironments,
    lessonBreakdown,
    lessonSeries,
  } = studioState

  if (!curriculumMode) return false

  const { grade, subject } = lessonDetails
  const { topic, subtopic, subtopicRow } = topicData
  if (!grade || !subject || !topic || !subtopic) return false

  if (curriculumMode === 'cbc') {
    if (!subtopicRow?.specificCompetence) return false
    if (!learningEnvironments || learningEnvironments.length === 0) return false
    const planningMode = lessonSeries?.planningMode ?? 'single'
    if (planningMode === 'series' && (!lessonBreakdown || lessonBreakdown.length === 0)) return false
  }

  if (curriculumMode === 'previous') {
    if (!selectedOutcomes || selectedOutcomes.length === 0) return false
  }

  return true
}

// ── Root component ────────────────────────────────────────────────────────────

/**
 * LessonPlanStudio — root orchestrator for the redesigned studio.
 *
 * Wires together:
 *   - useStudioState() for all form state
 *   - CurriculumContext.Provider
 *   - handleGenerate() — calls studioGenerateLessonPlan Cloud Function
 *   - StudioShell with LessonPlanWizard (five-step flow) + StudioCanvas
 */
/**
 * The generation-prompt lines that carry §3.1's word budgets and §2.2's writing
 * style, plus §4.7's block notation.
 *
 * Kept beside the studio rather than inside the system prompt because the
 * budgets change per plan — the system prompt is prompt-cached and must stay
 * byte-stable across generations for that cache to hit.
 *
 * @param {object} fmt  a resolved lesson format
 * @returns {string[]}
 */
export function lessonFormatPromptLines(fmt) {
  const b = fmt.wordBudgets
  const lines = [
    `- Writing style: ${WRITING_STYLE_DIRECTIVES[fmt.writingStyle]}`,
  ]

  if (fmt.pageTarget != null) {
    lines.push(
      '',
      `- PAGE BUDGET: this plan must print on ${fmt.pageTarget} A4 ${fmt.pageTarget === 1 ? 'side' : 'sides'}. Write in point form as a Zambian teacher writes in a plan book: sentence fragments, imperative voice, no repetition of the stage name or the lesson context, no full sentences. Keep every cell within its word budget.`,
      '',
      '- WORD BUDGETS (hard limits, per cell):',
      `  · Lesson goal: ≤ ${b.lessonGoal} words`,
      `  · Prior knowledge / Pre-requisite: ≤ ${b.priorKnowledge} words`,
      b.rationale > 0 ? `  · Rationale: ≤ ${b.rationale} words` : '  · Rationale: omit it',
      `  · Teacher's Activities per stage: ≤ ${b.teacher} words, at most ${b.maxFragments.teacher} fragments`,
      `  · Learners' Activities per stage: ≤ ${b.pupils} words, at most ${b.maxFragments.pupils} fragments`,
      `  · Assessment / Learning Point per stage: ≤ ${b.assessment} words, at most ${b.maxFragments.assessment} fragment${b.maxFragments.assessment === 1 ? '' : 's'}`,
      b.remedialWork > 0
        ? `  · Remedial work and Extension: ≤ ${b.remedialWork} words each`
        : '  · Remedial work and Extension: omit them',
      b.expectedAnswers
        ? `  · Expected answers in brackets: keep them, ≤ ${b.expectedAnswerWords} words`
        : '  · Expected answers in brackets: omit them',
      '',
      '- Write each cell as separate lines, one action per line. Do not number them and do not add a dash — the template adds the dash.',
    )
  }

  // §2.4 — a section the teacher switched off must not be generated at all.
  // Asking for it and then hiding it spends tokens and, worse, lets the model
  // put content there that then never reaches the teacher.
  const omitted = Object.entries(fmt.sections)
    .filter(([, on]) => !on)
    .map(([key]) => key)
  if (omitted.length) {
    lines.push('', `- OMIT these sections entirely (the teacher switched them off): ${omitted.join(', ')}. Return "" for them.`)
  }

  lines.push('', blockNotationDirective())
  return lines
}

export default function LessonPlanStudio() {
  const studioState = useStudioState()
  const { currentUser, userProfile, updateProfileFields } = useAuth()
  const navigate = useNavigate()

  // Keep a ref to the latest studioState so handleGenerate can read current
  // values without studioState appearing in its dependency array (a new
  // object every render would defeat the useCallback memoisation).
  const studioStateRef = useRef(studioState)
  useEffect(() => {
    studioStateRef.current = studioState
  })

  // Same ref pattern for the live profile: handleGenerate is memoised on
  // [uid] only, so reading userProfile from its closure would freeze the
  // teacher's AI preferences at first render.
  const userProfileRef = useRef(userProfile)
  useEffect(() => {
    userProfileRef.current = userProfile
  })

  // Auto-fill Teacher Name + School from the signed-in teacher's profile (the
  // details they gave at signup) the first time the profile loads, so they
  // don't retype them on every plan. Teacher Settings preferences (medium /
  // detail / reflection / school resource level — see utils/teacherDefaults)
  // seed the same way. Only fills fields still at their defaults — never
  // clobbers something the teacher has already set — and every input stays
  // fully editable.
  const prefilledIdentityRef = useRef(false)
  // Unmount-only guard for the async seed below. A `cancelled` flag in the
  // effect closure would also fire when the profile snapshot ticks again
  // (userProfile is a fresh object every onSnapshot), silently dropping the
  // pending seed — the ref only flips on real unmount.
  const unmountedRef = useRef(false)
  useEffect(() => {
    // Reset on setup so React.StrictMode's dev-only mount→cleanup→remount
    // cycle doesn't leave the flag stuck true (which silently discarded the
    // async seed below in `npm run dev`). A real unmount still trips it.
    unmountedRef.current = false
    return () => { unmountedRef.current = true }
  }, [])
  const { setLessonDetails, setFormatOptions } = studioState
  useEffect(() => {
    if (prefilledIdentityRef.current || !userProfile) return
    prefilledIdentityRef.current = true
    // The resource level lives on schoolProfiles/{uid}; the fetch is
    // best-effort (returns null offline) and everything else applies without it.
    // eslint-disable-next-line promise/catch-or-return -- catch precedes then by design: the seed applies even when the profile fetch fails
    getSchoolProfile(currentUser?.uid)
      .catch(() => null)
      .then((schoolProfile) => {
        if (unmountedRef.current) return
        const seed = lessonStudioSeed(userProfile, schoolProfile)
        setLessonDetails((prev) => ({
          ...prev,
          teacherName: prev.teacherName || userProfile.displayName || '',
          school: prev.school || userProfile.school || '',
          medium: prev.medium === 'English' && seed.medium ? seed.medium : prev.medium,
          resources:
            prev.resources === DEFAULT_SCHOOL_RESOURCES && seed.resources
              ? seed.resources
              : prev.resources,
        }))
        // §2.6 — preload the teacher's last-used paper format. A teacher who
        // wants 1-page point-form plans sets it once. Applied as ONE update so
        // the page-budget cascade (which re-applies that budget's margins,
        // density and section defaults) cannot overwrite the rest of it.
        const saved = normalizeTeacherPreferences(userProfile?.teacherPreferences).lessonPlanFormat
        setFormatOptions((prev) => ({
          ...prev,
          ...saved,
          sections: { ...prev.sections, ...(saved.sections || {}) },
        }))
        if (seed.includeLessonEvaluation === false) {
          setFormatOptions((prev) => ({
            ...prev,
            sections: { ...prev.sections, lessonEvaluation: false },
          }))
        }
      })
  }, [userProfile, currentUser, setLessonDetails, setFormatOptions])

  /**
   * §2.6 — remember the teacher's paper format for the next plan.
   *
   * Stores the RAW choices under `teacherPreferences.lessonPlanFormat`, never a
   * resolved format: a stored resolved format would pin this month's typography
   * table into the profile and never pick up a preset change. The write merges
   * into the whole preferences map because `updateProfileFields` replaces a map
   * wholesale — writing a partial one would erase the teacher's AI and
   * curriculum preferences.
   *
   * Fire-and-forget. A failed preference write must never cost a teacher the
   * plan they just generated.
   */
  const persistFormatPreference = useCallback((format) => {
    if (typeof updateProfileFields !== 'function') return
    try {
      const latest = normalizeTeacherPreferences(userProfileRef.current?.teacherPreferences)
      const next = { ...latest, lessonPlanFormat: toStoredPreferences(format) }
      if (JSON.stringify(next.lessonPlanFormat) === JSON.stringify(latest.lessonPlanFormat)) return
      Promise.resolve(updateProfileFields({ teacherPreferences: next })).catch(() => {})
    } catch {
      // Preferences are a convenience; never let one break a generation.
    }
  }, [updateProfileFields])

  // Same ref pattern as userProfileRef: handleGenerate is memoised on [uid], so
  // reading this from its closure would freeze it at first render.
  const persistFormatPreferenceRef = useRef(persistFormatPreference)
  useEffect(() => {
    persistFormatPreferenceRef.current = persistFormatPreference
  })

  // Learning Environment is a CBC-only concept. When the teacher switches to
  // the Previous (Outcomes-Based) curriculum, clear any environments selected
  // while in CBC mode so they are never folded into the generation prompt or a
  // stale value blocks validation. The section is also hidden in that mode.
  const { setLearningEnvironments } = studioState
  const previousLearningEnvironments = studioState.learningEnvironments
  useEffect(() => {
    if (studioState.curriculumMode === 'previous' && previousLearningEnvironments.length > 0) {
      setLearningEnvironments([])
    }
  }, [studioState.curriculumMode, previousLearningEnvironments, setLearningEnvironments])

  // Ephemeral generation state — not persisted to Firestore, lives only
  // for the current session. generationStatus / generatedPlan already live
  // in useStudioState so they can gate the Generate button; generationError
  // is purely UI state for the error panel.
  const [generationError, setGenerationError] = useState(null)
  const [kit, setKit] = useState(null)
  const [lastPlanJson, setLastPlanJson] = useState(null)
  const [lastMeta, setLastMeta] = useState(null)
  // Set when Fit to page exhausted every layout lever and the plan still
  // spills. Surfaced to the teacher rather than acted on: the only remaining
  // lever changes the words, and a plan silently rewritten to fit is not the
  // plan the teacher reviewed.
  const [fitNotice, setFitNotice] = useState(null)
  // Render meta built from the form the instant Generate is clicked — passed to
  // the canvas so the live "writing itself" preview can type the document header
  // (school, teacher, class, subject, topic, date, duration) in from the very
  // first frame, before the model has replied.
  const [liveMeta, setLiveMeta] = useState(null)

  // Canvas view mode: 'preview' (formatted document) | 'edit' (manual + AI
  // section editor). Session-only, resets to preview on each new generation.
  const [viewMode, setViewMode] = useState('preview')

  // Which surface fills the page: the five-step creation wizard ('form') or
  // the document canvas ('canvas'). The canvas is never rendered while the
  // teacher is entering information — it takes over when a generation starts
  // and hands back via the shell's "Back to form" control (the generated plan
  // is kept, so the teacher can hop between the two freely).
  const [studioView, setStudioView] = useState('form')

  // "My lessons" (the saved-lessons + coverage overlay) is opened from the
  // header's utility row and rendered by the wizard, which owns the coverage
  // and lesson-memory props it needs. The state lives here so the page has ONE
  // navigation cluster — the trigger used to float beside the step heading and
  // compete with the stepper.
  const [progressOpen, setProgressOpen] = useState(false)

  // Save-to-library state. `savedSignature` is a content fingerprint of the
  // last plan saved, so the button knows when the (possibly edited) plan has
  // unsaved changes vs. is already in the library.
  const [saveStatus, setSaveStatus] = useState('idle') // 'idle' | 'saving' | 'saved' | 'error'
  const [saveError, setSaveError] = useState(null)
  const [savedSignature, setSavedSignature] = useState(null)
  // The aiGenerations doc id of the last-saved plan — used as `lessonPlanId` so
  // the Teaching Kit can ground companion tools on this exact plan.
  const [savedPlanId, setSavedPlanId] = useState(null)
  // Teaching Kit busy flag (Notes needs the plan saved first, which is async).
  const [kitBusy, setKitBusy] = useState(false)
  // "This week's lesson" auto-fill banner dismissal (session-only).
  const [planContextDismissed, setPlanContextDismissed] = useState(false)
  // True once a Teaching-Profile assignment or weekly-forecast suggestion has
  // ACTUALLY written values into the form. The wizard's "Set up for you" card
  // renders only then — and its chips are derived from the LIVE studioState,
  // never from the raw suggestion, so the card can never describe a different
  // lesson than the form holds.
  const [appliedContext, setAppliedContext] = useState(false)
  // Week number for the card's Week chip — set only when the weekly-forecast
  // suggestion itself was applied (an assignment seed carries no week).
  const [appliedWeekNumber, setAppliedWeekNumber] = useState(null)

  // Duplicate-lesson guard (requirement #6). Holds { lessonNumber,
  // nextLessonNumber } when the teacher is about to (re)create a lesson that
  // already exists in memory; null when the dialog is closed.
  const [dupModal, setDupModal] = useState(null)

  // Illustration (AI diagram) state. `diagrams` accumulates the generated
  // figures attached to the current plan; illustrationStatus drives the
  // canvas indicator ('idle' | 'generating' | 'error').
  const [diagrams, setDiagrams] = useState([])
  const [illustrationStatus, setIllustrationStatus] = useState('idle')
  const [illustrationError, setIllustrationError] = useState(null)

  // AI lesson-count recommendation (used by LessonProgressionForm). Calls the
  // aiLessonCount Cloud Function (Claude Haiku); grade/subject sharpen the
  // pacing and `enabled` defers the call until the teacher is actually in
  // Lesson Series mode — the only surface that renders the suggestion.
  const subtopicRow = studioState.topicData.subtopicRow
  const aiState = useAILessonCount(
    studioState.topicData.topic,
    studioState.topicData.subtopic,
    subtopicRow?.learningActivities ?? [],
    subtopicRow?.expectedStandard ?? '',
    studioState.curriculumMode,
    {
      grade: studioState.lessonDetails.grade,
      subject: studioState.lessonDetails.subject,
      enabled: studioState.lessonSeries?.planningMode === 'series',
    },
  )

  // Series progress — live Firestore subscription via useLessonSeries.
  const uid = currentUser?.uid ?? null
  // Per-run token: stops a resolved callable from hijacking the UI if Stop was
  // clicked before the response landed.
  const runRef = useRef(0)

  // Idempotency lock: one intentional Generate → one provider call + one saved
  // plan + one usage charge, even across a double-click / rapid tap / refresh /
  // a second tab. studioLessonPlan.js's server-side reservation enforces this
  // (and now REFUSES a keyless call), so the primary generate AND the
  // length-gate repair both carry a key. This is the free tier's entry point,
  // where a double-charge hurts most.
  const { run: runGenerateLocked } = useAiOperationLock('lesson-plan-studio:generate')

  // ── Active Teaching Profile assignment auto-fill ────────────────────────────
  // Prefill a NEW plan from the teacher's ACTIVE assignment (grade / subject /
  // curriculum / a valid planned teaching date). Runs before the weekly-forecast
  // fill so the profile is the primary source; both are fill-blanks-only, so
  // neither clobbers a typed value or a restored draft. `assignmentContext`
  // (assignment + calendar context) is also read at save time to stamp the
  // planned-teaching metadata.
  const assignmentContext = useActiveAssignmentContext()
  // Mirror the studioStateRef pattern so handleGenerate (deps: [uid]) reads the
  // freshest assignment/calendar context at save time without a stale closure.
  const assignmentContextRef = useRef(assignmentContext)
  assignmentContextRef.current = assignmentContext
  const appliedAssignmentRef = useRef(false)
  useEffect(() => {
    const s = studioStateRef.current
    const seed = assignmentContext.seed
    if (!seed || appliedAssignmentRef.current) return
    if (restoredDraftRef.current) return // a restored draft always wins
    appliedAssignmentRef.current = true
    // Did this seed ACTUALLY write anything? The "Set up for you" card only
    // renders when a suggestion really filled fields in.
    const d = s.lessonDetails
    const wrote = Boolean(
      (!s.curriculumMode && seed.curriculumMode) ||
      (!d.grade && seed.grade) ||
      (!d.subject && seed.subject) ||
      (!d.date && seed.date),
    )
    if (!s.curriculumMode) s.setCurriculumMode(seed.curriculumMode)
    s.setLessonDetails((prev) => {
      const next = { ...prev }
      if (!next.grade && seed.grade) next.grade = seed.grade
      if (!next.subject && seed.subject) next.subject = seed.subject
      if (!next.date && seed.date) next.date = seed.date
      return next
    })
    if (wrote) setAppliedContext(true)
  }, [assignmentContext.seed])

  // ── "This week's lesson" auto-fill ──────────────────────────────────────────
  // Read the teacher's latest Weekly Forecast and, once, prefill the studio's
  // EMPTY fields with this week's grade / subject / topic / subtopic / date.
  // Mirrors the prefilledIdentityRef pattern: fill only blanks, never clobber
  // anything the teacher has typed, and no-op cleanly when there's no forecast.
  const { suggestion: planContext } = useTeacherPlanContext(uid)
  const appliedPlanContextRef = useRef(false)
  // Mirrored into a ref so restoreDraft (stable identity, no deps) can compare
  // the restored fields against the suggestion without a stale closure.
  const planContextRef = useRef(null)
  planContextRef.current = planContext
  useEffect(() => {
    if (!planContext || appliedPlanContextRef.current) return
    const s = studioStateRef.current
    // Evaluated exactly once — the ref is set BEFORE any early return, so a
    // later state change can never re-run the fill against a form the teacher
    // has since edited (the old 'previous' early return left the ref unset).
    appliedPlanContextRef.current = true
    // Forecasts are CBC; don't touch a teacher who has chosen Previous.
    if (s.curriculumMode === 'previous') return
    // Blanks-only merge: record whether the suggestion ACTUALLY writes
    // anything, so the "Set up for you" card only appears when it did (the
    // Teaching-Profile seed may have won every field already).
    const d = s.lessonDetails
    const wrote = Boolean(
      !s.curriculumMode ||
      (!d.grade && planContext.grade) ||
      (!d.subject && planContext.subject) ||
      (!d.date && planContext.date) ||
      (planContext.topic && !s.topicData.topic),
    )
    if (!s.curriculumMode) s.setCurriculumMode('cbc')
    s.setLessonDetails((prev) => ({
      ...prev,
      grade: prev.grade || planContext.grade || prev.grade,
      subject: prev.subject || planContext.subject || prev.subject,
      date: prev.date || planContext.date || prev.date,
    }))
    if (planContext.topic && !s.topicData.topic) {
      // setTopicField('topic') resets subtopic; set topic first, then subtopic.
      s.setTopicField('topic', planContext.topic)
      if (planContext.subtopic) s.setTopicField('subtopic', planContext.subtopic)
    }
    if (wrote) {
      setAppliedContext(true)
      if (planContext.weekNumber) setAppliedWeekNumber(planContext.weekNumber)
    }
  }, [planContext])

  // ── Universal Draft Manager restore ─────────────────────────────────────────
  // Runs when the teacher clicks "Continue editing" in <DraftRecoveryPrompt>.
  // The setter ORDER defeats the cascade-reset effects that would otherwise wipe
  // a naive restore (see the reset effects in LessonDetailsForm/useStudioState):
  //   1. curriculumMode first, so a restored grade is valid for the mode's list.
  //   2. lessonDetails whole (raw key preserved so subjects-resolve doesn't clear
  //      it).
  //   3. topicData whole via the raw setter — bypasses setTopicField's cascade so
  //      topic + subtopic + subtopicRow land atomically and outcomes aren't wiped.
  //   4. selectedOutcomes after topicData.
  //   5. learningEnvironments only for CBC (Previous force-clears them).
  //   6/7. lessonSeries / lessonBreakdown / formatOptions whole.
  // A one-shot ref prevents a re-fire from clobbering post-restore edits, and we
  // mark the plan-context auto-fill applied so it can't overwrite the recovery.
  const restoredDraftRef = useRef(false)
  const restoreDraft = useCallback((payload) => {
    if (restoredDraftRef.current || !payload) return
    restoredDraftRef.current = true
    applyLessonPlanRestore(studioStateRef.current, payload)
    // The recovered draft wins over "This week's lesson" auto-fill.
    appliedPlanContextRef.current = true
    // The "Set up for you" card only survives a restore when the restored
    // fields still MATCH the suggestion it advertises — otherwise it would
    // describe a different lesson than the form now holds.
    const pc = planContextRef.current
    const restored = payload?.lessonDetails ?? {}
    const matches = Boolean(
      pc && restored.grade && restored.grade === pc.grade &&
      restored.subject && restored.subject === pc.subject,
    )
    setAppliedContext(matches)
    setAppliedWeekNumber(matches && pc.weekNumber ? pc.weekNumber : null)
  }, [])

  // ── Persistent lesson memory ────────────────────────────────────────────────
  // Live subscription to every lesson plan the teacher has saved. This is the
  // single source of truth for BOTH the per-subtopic Saved Lessons panel and
  // the Curriculum Coverage panel below — reselecting a subtopic instantly
  // reflects what already exists, surviving reloads and sign-outs.
  const memory = useLessonMemory(uid)

  // ── Curriculum coverage / pacing ────────────────────────────────────────────
  // For the selected grade+subject, how much of the syllabus has the teacher
  // already planned, and what's left? Computed from the SAME lesson memory the
  // Saved Lessons panel uses (matched by subtopic key), so the two never
  // disagree — a freshly generated lesson bumps coverage immediately.
  const coverageState = useCoverageAnalysis(
    uid,
    studioState.lessonDetails.grade,
    studioState.lessonDetails.subject,
    studioState.curriculumMode,
    memory.plans,
    studioState.topicData.topic,
  )

  const seriesId = studioState.lessonSeries?.seriesId ?? null
  const { completedCount, completedLessons, seriesLoading, seriesError } = useLessonSeries(uid, seriesId)
  const seriesState = { completedCount, completedLessons, seriesLoading, seriesError }

  // Per-subtopic derived memory (used by the Saved Lessons panel + adaptive
  // Generate button). All the maths lives in pure helpers (utils/lessonMemory).
  const curriculumType = curriculumTypeLabel(studioState.curriculumMode)
  const memGrade = studioState.lessonDetails.grade
  const memSubject = studioState.lessonDetails.subject
  const memTopic = studioState.topicData.topic
  const memSubtopic = studioState.topicData.subtopic
  const subtopicKey = memGrade && memSubject && memTopic && memSubtopic
    ? buildSubtopicKey({ curriculumType, grade: memGrade, subject: memSubject, topic: memTopic, subtopic: memSubtopic })
    : null
  const subtopicLessons = useMemo(
    () => (subtopicKey ? lessonsForSubtopic(memory.plans, subtopicKey) : []),
    [memory.plans, subtopicKey],
  )
  const expectedCount = resolveExpectedCount({
    breakdownLength: studioState.lessonSeries?.planningMode === 'series'
      ? (studioState.lessonBreakdown?.length || 0)
      : 0,
    aiRecommended: aiState?.recommendation?.count,
    created: subtopicLessons.length,
  })
  const genButton = generateButtonState({ lessons: subtopicLessons, expected: expectedCount })
  const nextRecommendedSubtopic = coverageState?.coverage?.nextSuggestion?.subtopic || null

  // Persist a grade+subject progress rollup (lessonProgress/{id}) whenever the
  // teacher opens a subtopic, so "continue where you left off" survives a
  // reload. Fail-soft inside the service. Throttled by the dependency list.
  useEffect(() => {
    if (!uid || !memGrade || !memSubject) return
    const gsKey = buildGradeSubjectKey({ curriculumType, grade: memGrade, subject: memSubject })
    const completedLessonsCount = memory.plans.filter(
      (p) => p.gradeSubjectKey === gsKey && (p.teachingStatus === 'taught' || p.status === 'taught'),
    ).length
    touchLessonProgress({
      uid,
      schoolId: studioState.lessonDetails.school || '',
      curriculumType,
      grade: memGrade,
      subject: memSubject,
      totals: coverageState?.coverage
        ? {
            totalSubtopics: coverageState.coverage.totalSubtopics,
            plannedSubtopics: coverageState.coverage.coveredCount,
            completedLessons: completedLessonsCount,
          }
        : { completedLessons: completedLessonsCount },
      lastOpenedTopic: memTopic || null,
      lastOpenedSubtopic: memSubtopic || null,
      nextRecommendedSubtopic,
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uid, curriculumType, memGrade, memSubject, memTopic, memSubtopic, coverageState?.coverage?.coveredCount, nextRecommendedSubtopic])

  // Quota pre-flight (payment gate). Every other studio routes through this so a
  // capped teacher sees the upgrade paywall instead of watching a generation
  // start and fail on the server limit. Kept in a ref so handleGenerate can read
  // the latest gate without `ensureCanGenerate` (whose identity changes as the
  // usage meter loads) entering its dependency array.
  const { ensureCanGenerate } = useGenerationGate(uid)
  const gateRef = useRef(ensureCanGenerate)
  useEffect(() => {
    gateRef.current = ensureCanGenerate
  })

  const isValid = computeIsValid(studioState)

  // ── Universal Draft Manager: auto-save the lesson-plan INPUTS ───────────────
  // Only the input slices (never generatedPlan/generationStatus) so a refresh /
  // crash / offline drop never loses a half-built plan.
  const draftState = useMemo(() => ({
    curriculumMode:       studioState.curriculumMode,
    lessonDetails:        studioState.lessonDetails,
    topicData:            studioState.topicData,
    selectedOutcomes:     studioState.selectedOutcomes,
    learningEnvironments: studioState.learningEnvironments,
    lessonSeries:         studioState.lessonSeries,
    lessonBreakdown:      studioState.lessonBreakdown,
    formatOptions:        studioState.formatOptions,
    wizardStep:           studioState.wizardStep,
  }), [
    studioState.curriculumMode,
    studioState.lessonDetails,
    studioState.topicData,
    studioState.selectedOutcomes,
    studioState.learningEnvironments,
    studioState.lessonSeries,
    studioState.lessonBreakdown,
    studioState.formatOptions,
    studioState.wizardStep,
  ])
  const { featureFlags } = usePlatformSettings().settings
  const draft = useDraftManager({
    studioId: 'lesson_plan',
    uid,
    draftId: 'lesson_plan-current',
    descriptor: lessonPlanInputDescriptor,
    state: draftState,
    enabled: Boolean(uid && featureFlags?.universalDrafts !== false),
    onRestore: restoreDraft,
    // Wizard autosave: settle writes 0.9s after the teacher stops typing so a
    // mid-step exit loses at most a moment of input (was the 2.5s default).
    debounceMs: 900,
  })
  // Ref-mirror so handleGenerate can clear the draft without `draft` (a new
  // object each render) entering its dependency array — same pattern as
  // studioStateRef / gateRef above.
  const draftRef = useRef(draft)
  draftRef.current = draft

  // ── Edit mode: /teacher/lesson-plans/:lessonPlanId/edit ────────────────────
  // Reopens a SAVED plan in the full studio: the aiGenerations doc's plan JSON,
  // meta and pre-rendered HTML hydrate the canvas exactly as they were saved,
  // the Save state starts at "saved" (no duplicate on open), and the editor tab
  // is preselected. The form inputs are untouched — the draft manager and
  // auto-fill effects own those — so editing a plan never clobbers a half-built
  // new one. One-shot per id; fail-soft to an error panel line via
  // generationError so a deleted/foreign id never blanks the studio.
  const { lessonPlanId } = useParams()
  const editLoadedRef = useRef(null)
  useEffect(() => {
    if (!lessonPlanId || editLoadedRef.current === lessonPlanId) return
    editLoadedRef.current = lessonPlanId
    let cancelled = false
    getGeneration(lessonPlanId).then((gen) => {
      if (cancelled) return
      const planData = gen && (gen.data || gen.output)
      if (!gen || gen.tool !== 'lesson_plan' || !planData || typeof planData !== 'object') {
        setGenerationError('We could not open that saved lesson plan. It may have been deleted — pick it from your library instead.')
        studioStateRef.current.setGenerationStatus('error')
        setStudioView('canvas')
        return
      }
      const planJson = normalizePlanShape(planData)
      const meta = gen.meta || {}
      const genDiagrams = Array.isArray(planJson?.diagrams) ? planJson.diagrams : []
      // The library classification remembers which syllabus family the plan
      // was authored against (OBC ↔ the Previous curriculum).
      const mode = gen.library?.syllabus === 'OBC' ? 'previous' : 'cbc'
      const s = studioStateRef.current
      if (!s.curriculumMode) s.setCurriculumMode(mode)
      setLastPlanJson(planJson)
      setLastMeta(meta)
      setLiveMeta(meta)
      setDiagrams(genDiagrams)
      setSavedPlanId(gen.id)
      setSavedSignature(JSON.stringify({ plan: planJson, diagrams: genDiagrams }))
      setSaveStatus('saved')
      s.setGeneratedPlan(gen.html || renderPlanHtml(planJson, meta, mode))
      s.setGenerationStatus('done')
      setViewMode('edit')
      // The wizard is for building a plan; a reopened plan lands straight on
      // the document canvas (Back to form remains available).
      setStudioView('canvas')
    }).catch(() => {
      if (cancelled) return
      setGenerationError('We could not open that saved lesson plan. Check your connection and try again from your library.')
      studioStateRef.current.setGenerationStatus('error')
      setStudioView('canvas')
    })
    return () => { cancelled = true }
  }, [lessonPlanId])

  // ── Generate handler ──────────────────────────────────────────────────────

  const handleGenerate = useCallback(async (lessonIndex = 0, opts = {}) => {
    const current = studioStateRef.current
    // The sticky Generate button wires onClick directly, so the first arg can
    // arrive as a DOM event rather than a numeric index — coerce defensively.
    const idx = typeof lessonIndex === 'number' ? lessonIndex : 0
    // Explicit lesson-number override (from the memory panel's "Create Lesson N"
    // / adaptive Generate button / duplicate dialog). Takes precedence over the
    // series-breakdown / single-lesson number below.
    const lessonNumberOverride = Number(opts.lessonNumber) || null

    // Pre-flight quota gate: if the teacher is already out of lesson-plan quota
    // (monthly or daily, with no purchased top-up credit), open the matching
    // upgrade paywall immediately and do NOT flip into the "Generating…" state.
    // The server meter enforces the same cap as a backstop. Admins / an
    // unloaded meter fall through (ensureCanGenerate returns true).
    if (!gateRef.current('lesson_plan')) return

    const run = ++runRef.current
    // Hand the page over to the canvas so the teacher watches the plan being
    // written; "Back to form" returns to the wizard at any time.
    setStudioView('canvas')
    // What the teacher's inputs looked like when THIS run started — guards the
    // post-save draft.clear() against wiping edits made during the run.
    const inputsAtStart = draftInputFingerprint(current)
    current.setGenerationStatus('loading')
    setGenerationError(null)
    setViewMode('preview')
    setSaveStatus('idle')
    setSaveError(null)
    setSavedSignature(null)
    setSavedPlanId(null)

    const {
      lessonDetails,
      topicData,
      selectedOutcomes,
      learningEnvironments,
      formatOptions,
      lessonSeries,
      lessonBreakdown,
      curriculumMode,
    } = current

    const planningMode = lessonSeries?.planningMode ?? 'single'

    // Assign a seriesId on the first generation in series mode.
    // We capture the effective ID in a local variable so Firestore writes
    // in this same call use the new ID even before the state update settles.
    let effectiveSeriesId = lessonSeries?.seriesId ?? null
    if (planningMode === 'series' && !effectiveSeriesId) {
      effectiveSeriesId = `series-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
      current.setLessonSeriesField('seriesId', effectiveSeriesId)
    }
    const lessonItem =
      planningMode === 'series' && Array.isArray(lessonBreakdown) && lessonBreakdown.length > 0
        ? lessonBreakdown[idx] ?? null
        : null

    const lessonNumber = lessonNumberOverride ?? lessonItem?.lessonNumber ?? lessonDetails.lessonNumber ?? 1
    const totalLessons = planningMode === 'series' ? (lessonBreakdown?.length ?? 1) : 1

    // Build the user prompt from React state.
    const openingLine = curriculumMode === 'previous'
      ? 'Generate a Zambian lesson plan (Previous Curriculum / Outcomes-Based) for the following lesson:'
      : 'Generate a Zambian CBC lesson plan for the following lesson:'

    // The clean subject name for everything the teacher reads (plan, prompt,
    // header, filename); lessonDetails.subject keeps the raw syllabi key used
    // for the data lookups already resolved into topicData/subtopicRow.
    const subjectName = cleanSubjectName(lessonDetails.subject)

    const userPromptLines = [
      openingLine,
      '',
      `- Grade / Class: ${lessonDetails.grade}`,
      `- Subject: ${subjectName}`,
      `- Topic: ${topicData.topic}`,
      topicData.subtopic ? `- Sub-topic: ${topicData.subtopic}` : '',
      totalLessons > 1
        ? `- This is Lesson ${lessonNumber} of ${totalLessons} for this sub-topic.`
        : '',
      learningEnvironments?.length
        ? `- Learning environment: ${learningEnvironments.join(', ')}`
        : '',
      // What the school actually has — constrains every activity/material so a
      // rural teacher never gets a plan needing equipment they don't have.
      ...schoolResourcePromptLines(lessonDetails.resources || DEFAULT_SCHOOL_RESOURCES),
      `- Lesson duration: ${lessonDetails.duration || 40} minutes`,
      `- Medium of instruction: ${lessonDetails.medium || 'English'}`,
    ]

    if (curriculumMode === 'cbc' && topicData.subtopicRow) {
      const row = topicData.subtopicRow
      userPromptLines.push('')
      userPromptLines.push('<cbc_context>')
      if (row.specificCompetence)
        userPromptLines.push(`Specific Competence: ${row.specificCompetence}`)
      if (row.learningActivities?.length)
        userPromptLines.push(`Learning Activities (from syllabus): ${row.learningActivities.join(' | ')}`)
      if (row.expectedStandard)
        userPromptLines.push(`Expected Standard: ${row.expectedStandard}`)
      userPromptLines.push('</cbc_context>')
      userPromptLines.push('')
      userPromptLines.push('Ground the entire plan in this context. The specificCompetence drives every stage.')
    }

    if (curriculumMode === 'previous' && selectedOutcomes?.length) {
      userPromptLines.push('')
      userPromptLines.push('<previous_context>')
      userPromptLines.push('Specific Outcome(s) for this lesson:')
      selectedOutcomes.forEach((o, i) => userPromptLines.push(`${i + 1}. ${o}`))
      userPromptLines.push('</previous_context>')
      userPromptLines.push('')
      userPromptLines.push('Ground the lesson in achieving these specific outcomes. The lesson structure follows: Introduction → Development → Conclusion → Homework.')
    }

    if (planningMode === 'series' && lessonItem?.coveredContent?.length) {
      userPromptLines.push(`Previously covered in this series (DO NOT repeat): ${lessonItem.coveredContent.join(' | ')}`)
    }
    // Lesson focus: the series breakdown item's focus, OR the single-lesson
    // "Lesson Focus" input. The latter was previously never read — typing a
    // focus in single mode did nothing.
    const lessonFocus = lessonItem?.focus || (lessonSeries?.lessonFocus || '').trim()
    if (lessonFocus) {
      userPromptLines.push(`Focus for THIS lesson: ${lessonFocus}`)
    }

    // Format preferences (§3.1). The word budgets are the whole point: the old
    // Detail Level knob changed TONE, so "Simplified" produced the same 80-120
    // word cells as "Detailed" and the plan still ran to four pages. Explicit
    // per-cell limits are what makes the page budget a request the model can
    // actually satisfy — and §3.2's length gate is what makes it a promise.
    const lessonFormat = resolveLessonFormat(formatOptions)
    userPromptLines.push('', ...lessonFormatPromptLines(lessonFormat))

    // Teacher Settings → My AI: English variant + include/exclude switches
    // (pure derivation, order-stable — see utils/teacherDefaults).
    userPromptLines.push(...aiPrefsPromptLines(userProfileRef.current))

    // "Write in Local Language" toggle — only meaningful when the medium of
    // instruction is a Zambian local language (the form disables it otherwise).
    // Previously this toggle was never read, so it did nothing.
    if (formatOptions.advanced?.localLanguage && lessonDetails.medium && lessonDetails.medium !== 'English') {
      userPromptLines.push(
        '',
        `- IMPORTANT: Write the lesson plan content (rationale, activities, explanations, examples and questions) in ${lessonDetails.medium}, the local language of instruction — NOT in English. Keep the structural field labels and stage names in English so the document structure stays standard.`,
      )
    }

    userPromptLines.push('', 'Return ONLY the JSON object. No markdown fences. No commentary.')

    const userPrompt = userPromptLines.filter(Boolean).join('\n')

    const systemPrompt = curriculumMode === 'previous'
      ? STUDIO_SYSTEM_PROMPT_PREVIOUS
      : STUDIO_SYSTEM_PROMPT_CBC

    // Build the render meta from the form NOW (every field is already known) so
    // the live canvas can start typing the document header the instant we flip
    // into the loading state — before the model replies. The same object is
    // reused to render the finished plan, so the header the teacher watches fill
    // in is byte-for-byte the header of the final document.
    // Planned-teaching metadata from the active assignment + School Calendar,
    // stamped onto NEW plans. Nested under `meta` (an allowlisted map in the
    // aiGenerations rules), so it needs no rules change. Reused by
    // persistPlanToLibrary via lastMeta, so a manual re-save keeps it.
    const ac = assignmentContextRef.current
    const plannedMeta = buildPlannedTeachingMeta({
      assignment: ac.assignment,
      context: ac.context,
      plannedDate: lessonDetails.date,
    })
    const meta = {
      format: formatOptions.format || 'modern',
      // The resolved paper format travels WITH the plan, so the preview, the
      // print window, the PDF and the Word export all draw the document the
      // teacher chose — and reopening a saved plan reproduces it rather than
      // re-deriving it from whatever the defaults happen to be that month.
      lessonFormat,
      // §2.3 — which environment categories actually print. Without this the
      // renderer can only guess from which descriptions are non-empty, and a
      // generator that wrote "Not applicable" for all three looks like a
      // teacher who selected all three.
      learningEnvironments: [...(learningEnvironments || [])],
      showEnrolment: formatOptions.advanced?.includeEnrolment ?? false,
      showAttendance: formatOptions.advanced?.includeAttendance ?? false,
      compactMeta: formatOptions.advanced?.compactMetadata ?? false,
      teacherName: lessonDetails.teacherName || '',
      school: lessonDetails.school || '',
      date: lessonDetails.date || '',
      time: lessonDetails.time || '',
      grade: lessonDetails.grade || '',
      subject: subjectName || '',
      topic: topicData.topic || '',
      subtopic: topicData.subtopic || '',
      duration: lessonDetails.duration || 40,
      medium: lessonDetails.medium || 'English',
      lessonNumber,
      totalLessons,
      ...(plannedMeta ? { planned: plannedMeta } : {}),
    }
    setLiveMeta(meta)

    // Mark the generation as critical work so a service-worker update that
    // lands mid-stream (registerType 'autoUpdate') defers its reload instead of
    // wiping the in-progress plan, and a stray unload is guarded. Released in
    // the finally below — exactly once — whichever way the handler exits.
    const releaseCriticalWork = beginCriticalWork()
    try {
      // Lesson coordinates so the server can ground the plan on the CBC
      // knowledge base (resolveCbcContext: stored curriculum modules, topic
      // KB, prior-coverage dedup) AND on the teacher's OWN saved Scheme of
      // Work / Weekly Forecast (resolveTeacherPlanContext). framework tells
      // the KB which syllabus family the studio is planning against.
      const genContext = {
        grade: lessonDetails.grade || '',
        subject: subjectName || '',
        term: lessonDetails.term || '',
        week: lessonDetails.week || '',
        topic: topicData.topic || '',
        subtopic: topicData.subtopic || '',
        lessonNumber,
        totalLessons,
        framework: curriculumMode === 'previous' ? '2013' : '2023',
      }
      // The primary generate goes through the idempotency lock. A concurrent
      // duplicate is refused here (reason 'locked'); a genuine failure is
      // re-thrown so the existing catch below keeps mapping quota rejections.
      const lockResult = await runGenerateLocked({
        fingerprint: stableFingerprint({ systemPrompt, userPrompt, context: genContext }),
        action: (idempotencyKey) => generateCallable({
          systemPrompt, userPrompt, context: genContext, idempotencyKey,
        }),
      })
      if (lockResult.reason === 'locked') return
      if (!lockResult.ok) throw (lockResult.error || new Error('Generation failed'))
      const result = lockResult.data

      // Bail if Stop was clicked while this generation was in-flight.
      // The finally block still runs and releases the critical-work lock.
      if (run !== runRef.current) return

      // The server already has this exact request in flight (a retried call or
      // another tab) — leave the canvas as-is; the owning call completes it.
      if (result?.data?.status === 'processing') return

      const raw = String(result.data?.text || '')
        .trim()
        .replace(/^```json\s*/i, '')
        .replace(/^```\s*/, '')
        .replace(/\s*```$/, '')
        .trim()

      // Normalise the stage field-name families up front (teacher/pupils ↔
      // teacherActivities/learnerActivities) so the preview, the Word export and
      // the editor all read consistent data — see utils/planShape.js.
      const rawPlanJson = normalizePlanShape(JSON.parse(raw))

      // §3.2 — the post-generation length gate. Word budgets in a prompt are a
      // request; measuring the result and repairing the cells that overshot is
      // what turns the page budget into a promise. It is ONE targeted call on
      // the offending cells, not a regeneration — the parts that came back
      // right are not re-rolled. Any failure leaves the plan exactly as
      // generated (see runLengthGate), so this can cost a page but never a plan.
      const gate = await runLengthGate(rawPlanJson, lessonFormat, async (condensePrompt) => {
        // A distinct sub-operation (condense specific cells), so it carries its
        // own idempotency key — the server now refuses a keyless call. Minted
        // fresh per repair; it is auto-triggered and best-effort, not a
        // double-click surface.
        const repair = await generateCallable({
          systemPrompt: 'You condense Zambian teachers\' lesson-plan cells. You reply with JSON only.',
          userPrompt: condensePrompt,
          idempotencyKey: crypto.randomUUID(),
        })
        return String(repair.data?.text || '')
      })
      if (run !== runRef.current) return
      if (gate.error) console.warn('[zedexams] lesson-plan length gate failed', gate.error)
      const planJson = gate.repaired ? normalizePlanShape(gate.plan) : rawPlanJson

      // `meta` was built from the form before the call (and already drove the
      // live header animation); reuse it verbatim for the finished document.
      const html = renderPlanHtml(planJson, meta, curriculumMode)
      current.setGeneratedPlan(html)
      current.setGenerationStatus('done')
      setLastPlanJson(planJson)
      setLastMeta(meta)
      setDiagrams([])
      setIllustrationError(null)
      setIllustrationStatus('idle')

      // Auto-save the freshly generated plan straight to the teacher's library
      // so it appears under Library → Lesson Plans without a manual click (and
      // so the Template Bank trigger, which only fires on saved `lesson_plan`
      // docs, can pick it up). We save the LOCAL planJson/meta here rather than
      // calling persistPlanToLibrary() — that closure reads `lastPlanJson` from
      // state, which the setLastPlanJson above hasn't committed yet. The canvas
      // then shows a "Saved · View" indicator (saveStatus + onViewLibrary), so
      // the teacher knows it's in the library and can open it. Fail-soft: a save
      // miss flips the Save button back on for a manual retry but never hides
      // the plan that's already on screen. (A background auto-illustration, if
      // any, lands after this and re-enables Save so the teacher can re-save the
      // illustrated copy.)
      // §2.6 — remember the paper format for next time. Fire-and-forget: a
      // teacher whose preference write fails still has their plan, and the
      // next generation simply starts from the defaults again.
      persistFormatPreferenceRef.current(lessonFormat)

      if (uid) {
        setSaveStatus('saving')
        try {
          const savedId = await saveLessonPlanGeneration({
            uid,
            planJson,
            html,
            meta,
            studioFormat: meta.format || 'modern',
            inputs: {
              grade: lessonDetails.grade || null,
              subject: lessonDetails.subject || null,
              topic: topicData.topic || null,
              subtopic: topicData.subtopic || null,
              // Stamp the term so the dashboard attributes the plan to the right
              // term (genTerm reads inputs.term); read back via meta.planned too.
              ...(plannedMeta?.termNumber != null ? { term: String(plannedMeta.termNumber) } : {}),
            },
            classification: {
              libraryType: LIBRARY_TYPES.LESSON_PLANS,
              // The teacher's chosen curriculum decides the library folder —
              // without it every plan defaults to CBC, so an OBC plan lands in
              // the wrong (CBC) folder.
              syllabusHint: curriculumMode === 'previous' ? 'OBC' : 'CBC',
              grade: lessonDetails.grade,
              subject: lessonDetails.subject,
            },
          })
          setSavedPlanId(savedId)
          setSavedSignature(JSON.stringify({ plan: planJson, diagrams: [] }))
          setSaveStatus('saved')
          // Plan is now persisted to the library — drop the input draft so it
          // doesn't resurface as a stale recovery prompt. (Only on the success
          // branch: a save failure keeps the draft for a retry.) Skipped when
          // the inputs changed while this run was in flight — the teacher went
          // "Back to form" and kept editing, and that newer draft must survive.
          if (draftInputFingerprint(studioStateRef.current) === inputsAtStart) {
            draftRef.current.clear().catch(() => {})
          }
        } catch (saveErr) {
          console.warn('[zedexams] lesson-plan auto-save failed', saveErr)
          setSaveError(
            saveErr instanceof Error ?
              `Plan generated, but auto-saving to your library failed: ${saveErr.message}` :
              'Plan generated, but auto-saving to your library failed. Use “Save to library” to retry.',
          )
          setSaveStatus('error')
        }
      }

      // Auto-illustration: when the teacher chose "Automatic" (or the advanced
      // Auto-add toggle), generate one relevant illustration in the BACKGROUND
      // and inject it once ready — the plan is already on screen, so the image
      // never blocks reading. 'none' / 'manual' skip this. Fail-soft: any
      // diagram error surfaces in the canvas indicator but leaves the plan.
      const autoIllustrate =
        formatOptions.illustrations === 'automatic' ||
        formatOptions.advanced?.autoIllustrations === true
      const diagramPrompt = autoIllustrate
        ? buildLessonDiagramPrompt({
            topic: topicData.topic,
            subtopic: topicData.subtopic,
            subject: lessonDetails.subject,
            grade: lessonDetails.grade,
          })
        : ''
      if (diagramPrompt) {
        setIllustrationStatus('generating')
        generateDiagram({ prompt: diagramPrompt, provider: 'recraft' })
          .then(({ url }) => {
            const next = [
              {
                stage: pickIllustrationStage(planJson, curriculumMode),
                url,
                caption: topicData.subtopic || topicData.topic || '',
              },
            ]
            setDiagrams(next)
            studioStateRef.current.setGeneratedPlan(
              renderPlanHtml({ ...planJson, diagrams: next }, meta, curriculumMode),
            )
            setIllustrationStatus('idle')
          })
          .catch((err) => {
            setIllustrationError(err instanceof Error ? err.message : String(err))
            setIllustrationStatus('error')
          })
      }
      setKit({
        grade: lessonDetails.grade,
        subject: lessonDetails.subject,
        topic: topicData.topic,
        subtopic: topicData.subtopic,
        lessonNumber,
        totalLessons,
      })

      // ── Persistent lesson memory ────────────────────────────────────────
      // Record this lesson against its curriculum coordinates so the studio
      // remembers it after the teacher leaves and returns. Keyed by
      // curriculum+grade+subject+topic+subtopic+lessonNumber (deterministic doc
      // id), so re-generating the same lesson updates one record instead of
      // piling up duplicates. Fail-soft: the plan is already rendered + 'done',
      // so a memory-write miss must never throw out of this handler.
      saveLessonPlanMemory({
        uid,
        schoolId: lessonDetails.school || '',
        curriculumType: curriculumTypeLabel(curriculumMode),
        grade: lessonDetails.grade || '',
        // Raw subject key (not the cleaned display name) so the memory key
        // matches the one the sidebar panel builds from studioState.
        subject: lessonDetails.subject || '',
        topic: topicData.topic || '',
        subtopic: topicData.subtopic || '',
        topicName: stripCode(topicData.topic || ''),
        topicCode: extractCode(topicData.topic || ''),
        subtopicName: stripCode(topicData.subtopic || ''),
        subtopicCode: extractCode(topicData.subtopic || ''),
        competence: curriculumMode === 'previous'
          ? (selectedOutcomes || []).join(' | ')
          : (topicData.subtopicRow?.specificCompetence || ''),
        lessonNumber,
        title: planJson?.lessonTitle || planJson?.title || topicData.subtopic || topicData.topic || '',
        focus: lessonFocus || '',
        status: 'draft',
        teachingStatus: 'planned',
      }).catch(() => {})

      // Persist series progress to Firestore when in series mode.
      // Schema: lessonSeries/{uid}/{seriesId}/{lessonNumber}
      // Fail-soft: the plan is already rendered and marked 'done' above, so a
      // progress-tracking write failure (e.g. transient PERMISSION_DENIED)
      // must never throw out of this handler and flip the canvas to the error
      // state — that would hide a plan the teacher can already see and use.
      if (planningMode === 'series' && uid && effectiveSeriesId) {
        try {
          const lessonRef = doc(db, 'lessonSeries', uid, effectiveSeriesId, String(lessonNumber))
          await setDoc(lessonRef, {
            lessonNumber,
            status: 'completed',
            generatedAt: serverTimestamp(),
          })
        } catch (persistErr) {
          // Non-fatal: keep the rendered plan; just log the progress-write miss.
          console.warn('[zedexams] lesson-series progress write failed', persistErr)
        }
      }
    } catch (err) {
      // A server-side quota block (the meter throws 'failed-precondition' with a
      // structured reason) becomes the upgrade paywall, not a raw error string —
      // this covers the race where the client meter was stale and let the call
      // through. Any other failure shows the normal error panel.
      if (showQuotaPaywallForError(err)) {
        current.setGenerationStatus('idle')
        return
      }
      const msg = err instanceof Error ? err.message : String(err)
      setGenerationError(msg)
      current.setGenerationStatus('error')
    } finally {
      releaseCriticalWork()
    }
  }, [uid, runGenerateLocked]) // uid for Firestore writes; runGenerateLocked is a stable useCallback

  // Navigate to the next non-completed lesson in the series.
  const handleContinue = useCallback(() => {
    const { lessonBreakdown: breakdown } = studioStateRef.current
    const completedSet = new Set(completedLessons.map((l) => String(l)))
    const nextIndex = breakdown.findIndex(
      (item) => !completedSet.has(String(item.lessonNumber)),
    )
    if (nextIndex >= 0) {
      handleGenerate(nextIndex)
    }
  }, [completedLessons, handleGenerate])

  // Manually add an illustration: the teacher types a description in the
  // canvas, we generate it and inject it under the lesson-development stage.
  // Each new illustration accumulates onto the current plan and re-renders.
  const handleAddIllustration = useCallback(async (description) => {
    const text = String(description || '').trim()
    if (!text || !lastPlanJson) return
    const mode = studioStateRef.current.curriculumMode
    setIllustrationError(null)
    setIllustrationStatus('generating')
    try {
      const { url } = await generateDiagram({ prompt: text, provider: 'recraft' })
      const next = [
        ...diagrams,
        { stage: pickIllustrationStage(lastPlanJson, mode), url, caption: text },
      ]
      setDiagrams(next)
      studioStateRef.current.setGeneratedPlan(
        renderPlanHtml({ ...lastPlanJson, diagrams: next }, lastMeta ?? {}, mode),
      )
      setIllustrationStatus('idle')
    } catch (err) {
      setIllustrationError(err instanceof Error ? err.message : String(err))
      setIllustrationStatus('error')
    }
  }, [lastPlanJson, lastMeta, diagrams])

  // Manual / AI edits from the LessonPlanEditor. Update the source-of-truth
  // plan JSON and re-render the preview HTML so Print and the on-screen preview
  // always reflect the latest edits. The Word/PDF exporters read lastPlanJson
  // directly, so they pick up edits automatically. renderPlanHtml is a pure
  // string build, cheap enough to run per edit (the preview DOM is not mounted
  // while editing).
  const handlePlanChange = useCallback((nextJson) => {
    if (!nextJson) return
    setLastPlanJson(nextJson)
    const mode = studioStateRef.current.curriculumMode
    const withDiagrams = diagrams.length ? { ...nextJson, diagrams } : nextJson
    studioStateRef.current.setGeneratedPlan(
      renderPlanHtml(withDiagrams, lastMeta ?? {}, mode),
    )
  }, [diagrams, lastMeta])

  // Content fingerprint of the current plan (including illustrations) — drives
  // the Save button's "unsaved changes vs. already saved" state.
  const planSignature = lastPlanJson
    ? JSON.stringify({ plan: lastPlanJson, diagrams })
    : null

  // Save the current (possibly edited) plan as a snapshot in the teacher
  // library. Each save creates a fresh library entry — see
  // saveLessonPlanGeneration for why there is no in-place update path.
  // Core persist: write the current (possibly edited) plan to the library and
  // return its aiGenerations doc id. Shared by the Save button and the Teaching
  // Kit's "ensure saved" step. Does no UI-state bookkeeping beyond stamping the
  // saved id + signature so callers can layer their own status on top.
  const persistPlanToLibrary = useCallback(async () => {
    const ownerUid = currentUser?.uid
    if (!ownerUid || !lastPlanJson) return null
    const s = studioStateRef.current
    const mode = s.curriculumMode
    const planJson = diagrams.length ? { ...lastPlanJson, diagrams } : lastPlanJson
    const html = renderPlanHtml(planJson, lastMeta ?? {}, mode)
    const id = await saveLessonPlanGeneration({
      uid: ownerUid,
      planJson,
      html,
      meta: lastMeta ?? {},
      studioFormat: lastMeta?.format || 'modern',
      inputs: {
        grade: s.lessonDetails.grade || null,
        subject: s.lessonDetails.subject || null,
        topic: s.topicData.topic || null,
        subtopic: s.topicData.subtopic || null,
        // Preserve the term stamped at generation time (carried on lastMeta).
        ...(lastMeta?.planned?.termNumber != null ? { term: String(lastMeta.planned.termNumber) } : {}),
      },
      classification: {
        libraryType: LIBRARY_TYPES.LESSON_PLANS,
        // Persist the curriculum so the library files this under CBC vs OBC
        // correctly (see the auto-save path above).
        syllabusHint: mode === 'previous' ? 'OBC' : 'CBC',
        grade: s.lessonDetails.grade,
        subject: s.lessonDetails.subject,
      },
    })
    setSavedPlanId(id)
    setSavedSignature(JSON.stringify({ plan: lastPlanJson, diagrams }))

    // Link this saved library copy to the lesson's persistent memory record so
    // the Saved Lessons panel's "Edit" button can reopen the exact plan, and
    // mark the lesson slot completed. Fail-soft — never blocks the save.
    try {
      const ct = curriculumTypeLabel(s.curriculumMode)
      const stKey = buildSubtopicKey({
        curriculumType: ct,
        grade: s.lessonDetails.grade || '',
        subject: s.lessonDetails.subject || '',
        topic: s.topicData.topic || '',
        subtopic: s.topicData.subtopic || '',
      })
      const ln = Number(lastMeta?.lessonNumber) || 1
      const memId = lessonPlanDocId({ uid: ownerUid, subtopicKey: stKey, lessonNumber: ln })
      attachGenerationToMemory(memId, id)
    } catch {
      /* fail-soft: the library save already succeeded */
    }
    // Reflect the persisted state in the canvas Save control — whether the save
    // came from the Save button or the Teaching Kit's silent "ensure saved".
    setSaveStatus('saved')
    return id
  }, [currentUser, lastPlanJson, lastMeta, diagrams])

  const handleSaveToLibrary = useCallback(async () => {
    if (!currentUser?.uid || !lastPlanJson) return
    setSaveStatus('saving')
    setSaveError(null)
    try {
      await persistPlanToLibrary()
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : String(err))
      setSaveStatus('error')
    }
  }, [currentUser, lastPlanJson, persistPlanToLibrary])

  // Ensure the current plan is in the library and return its id. Reuses the
  // already-saved id when the plan hasn't changed since the last save, so the
  // Teaching Kit doesn't create a duplicate on every click.
  const ensurePlanSaved = useCallback(async () => {
    if (savedPlanId && planSignature && planSignature === savedSignature) return savedPlanId
    return persistPlanToLibrary()
  }, [savedPlanId, planSignature, savedSignature, persistPlanToLibrary])

  // ── Teaching Kit ───────────────────────────────────────────────────────────
  // Turn the finished plan into aligned companion materials in one click. Notes
  // grounds on the saved plan via `lessonPlanId` (true full-plan grounding, see
  // functions/teacherTools/generateNotes.js); worksheet / homework / test paper
  // receive the plan's CBC anchors through the generators' existing
  // `instructions` field so their output stays on the same lesson + competency.
  const openKitTool = useCallback(async (tool) => {
    if (!kit) return
    const alignInstructions = buildAlignmentInstructions(lastPlanJson)
    const withAlign = alignInstructions ? { ...kit, instructions: alignInstructions } : kit
    if (tool === 'notes') {
      setKitBusy(true)
      try {
        const id = await ensurePlanSaved()
        navigate('/teacher/generate/notes' + buildGeneratorQueryString(id ? { ...kit, lessonPlanId: id } : kit))
      } catch {
        // Saving failed (offline / quota) — still open Notes prefilled by topic.
        navigate('/teacher/generate/notes' + buildGeneratorQueryString(kit))
      } finally {
        setKitBusy(false)
      }
      return
    }
    const path = tool === 'homework'
      ? '/teacher/generate/homework'
      : tool === 'flashcards'
        ? '/teacher/generate/flashcards'
        : tool === 'test'
          ? '/teacher/assessment-papers/new'
          : '/teacher/generate/worksheet'
    navigate(path + buildGeneratorQueryString(withAlign))
  }, [kit, lastPlanJson, ensurePlanSaved, navigate])

  const handleExportWord = useCallback(async () => {
    if (!lastPlanJson) return
    const m = lastMeta ?? {}
    const mode = studioStateRef.current.curriculumMode
    const subject = m.subject ?? 'lesson'
    const grade   = m.grade   ?? ''
    const filename = `lesson-plan-${grade}-${subject}.docx`.replace(/\s+/g, '-').toLowerCase()

    // The generated plan JSON has no `header` object — its identity/coordinate
    // fields live in `meta`. The Word builder reads `plan.header.*`, so without
    // this mapping the .docx came out with no teacher / date / class / subject /
    // topic (the "Word export not working" report). Build the header the docx
    // expects from the studio meta, keeping any header the plan already carries.
    const header = {
      ...(lastPlanJson.header || {}),
      school: m.school || '',
      teacherName: m.teacherName || '',
      date: m.date || '',
      time: m.time || '',
      class: m.grade || '',
      durationMinutes: Number(m.duration) || undefined,
      subject: m.subject || '',
      topic: m.topic || '',
      subtopic: m.subtopic || '',
    }

    // Carry the on-screen illustration into the Word file. The preview attaches
    // figures as plan.diagrams[]; the docx embeds the single plan.lessonDiagram.
    const firstDiagram = diagrams.length ? diagrams[0] : null
    const lessonDiagram = lastPlanJson.lessonDiagram
      || (firstDiagram?.url ? { url: firstDiagram.url, prompt: firstDiagram.caption || '' } : undefined)

    const exportJson = {
      ...lastPlanJson,
      header,
      ...(diagrams.length ? { diagrams } : {}),
      ...(lessonDiagram ? { lessonDiagram } : {}),
    }
    await downloadLessonPlanDocx(exportJson, filename, { ...m, curriculumMode: mode })
  }, [lastPlanJson, lastMeta, diagrams])

  /**
   * Fit to page changed the paper format (§2.5). Apply it to BOTH the form
   * (so the next generation keeps it) and the meta the current plan renders
   * with, then re-render the plan and remember the choice.
   */
  const handleLessonFormatChange = useCallback((format) => {
    const fmt = resolveLessonFormat(format)
    studioStateRef.current.setFormatOptions((prev) => ({
      ...prev,
      pageBudget: fmt.pageBudget,
      writingStyle: fmt.writingStyle,
      density: fmt.density,
      marginMm: fmt.marginMm,
      environmentDisplay: fmt.environmentDisplay,
      headerStyle: fmt.headerStyle,
      ministryLine: fmt.ministryLine,
      sections: { ...fmt.sections },
    }))
    setLastMeta((prev) => {
      const next = { ...(prev ?? {}), lessonFormat: fmt }
      if (lastPlanJson) {
        studioStateRef.current.setGeneratedPlan(
          renderPlanHtml(
            diagrams.length ? { ...lastPlanJson, diagrams } : lastPlanJson,
            next,
            studioStateRef.current.curriculumMode,
          ),
        )
      }
      return next
    })
    persistFormatPreferenceRef.current(fmt)
  }, [lastPlanJson, diagrams])

  /**
   * The Fit-to-page ladder ran out of layout levers. The only one left changes
   * the WORDS, so it is offered rather than applied — a plan silently rewritten
   * to fit is not the plan the teacher reviewed.
   */
  const handleCondenseToFit = useCallback((result) => {
    setFitNotice({
      pages: result.pages,
      target: resolveLessonFormat(result.format).pageTarget,
    })
  }, [])

  // Navigate to the teacher's saved lesson library.
  const handleViewCompleted = useCallback(() => {
    navigate('/teacher/library')
  }, [navigate])

  // ── Persistent-memory actions (Saved Lessons panel + adaptive Generate) ─────

  // Open an existing saved lesson to continue editing. If it was saved to the
  // library (has a generationId), reopen it in the studio's edit mode (client-
  // side routed, inside the dashboard shell); otherwise it was generated but
  // never saved — regenerate that lesson number.
  const handleOpenLesson = useCallback((lesson) => {
    if (lesson?.generationId) {
      navigate(`/teacher/lesson-plans/${lesson.generationId}/edit`)
      return
    }
    handleGenerate(0, { lessonNumber: Number(lesson?.lessonNumber) || 1 })
  }, [navigate, handleGenerate])

  // "Create Lesson N" from the Saved Lessons panel. Guards against duplicating
  // an existing lesson number (requirement #6).
  const handleCreateLesson = useCallback((lessonNumber) => {
    const existing = findLessonByNumber(subtopicLessons, lessonNumber)
    if (existing) {
      const prog = subtopicProgress(subtopicLessons, expectedCount)
      setDupModal({ lessonNumber, nextLessonNumber: prog.nextToCreate })
      return
    }
    handleGenerate(0, { lessonNumber })
  }, [subtopicLessons, expectedCount, handleGenerate])

  // Persist a teaching-status change (Not started / Planned / Taught / Needs
  // revision). The live subscription re-renders the panel; no local state.
  const handleSetTeachingStatus = useCallback((lessonId, status) => {
    setLessonTeachingStatus(lessonId, status)
  }, [])

  // The sticky Generate button. Its label adapts via genButton; this routes the
  // click to the matching action (generate / create-next / continue / review)
  // and guards against duplicates. Series planning keeps its dedicated flow.
  const handlePrimaryGenerate = useCallback(() => {
    const planningMode = studioStateRef.current.lessonSeries?.planningMode ?? 'single'
    if (planningMode === 'series' || !subtopicKey) {
      handleGenerate(0)
      return
    }
    if (genButton.action === 'review') {
      handleViewCompleted()
      return
    }
    if (genButton.action === 'continue') {
      const target = findLessonByNumber(subtopicLessons, genButton.nextLessonNumber)
      if (target) {
        handleOpenLesson(target)
        return
      }
    }
    const targetNum = genButton.nextLessonNumber || 1
    const existing = findLessonByNumber(subtopicLessons, targetNum)
    if (existing) {
      const prog = subtopicProgress(subtopicLessons, expectedCount)
      setDupModal({ lessonNumber: targetNum, nextLessonNumber: prog.nextToCreate })
      return
    }
    handleGenerate(0, { lessonNumber: targetNum })
  }, [subtopicKey, genButton, subtopicLessons, expectedCount, handleGenerate, handleViewCompleted, handleOpenLesson])

  // Duplicate-dialog resolutions (requirement #6).
  const handleDupContinue = useCallback(() => {
    const num = dupModal?.lessonNumber
    setDupModal(null)
    const lesson = findLessonByNumber(subtopicLessons, num)
    if (lesson) handleOpenLesson(lesson)
  }, [dupModal, subtopicLessons, handleOpenLesson])

  const handleDupDuplicate = useCallback(() => {
    const num = dupModal?.lessonNumber
    setDupModal(null)
    if (num) handleGenerate(0, { lessonNumber: num })
  }, [dupModal, handleGenerate])

  const handleDupCreateNext = useCallback(() => {
    const next = dupModal?.nextLessonNumber
    setDupModal(null)
    if (next) handleGenerate(0, { lessonNumber: next })
  }, [dupModal, handleGenerate])

  // ── Teaching Profile context surfacing (read-only) ──────────────────────────
  // Non-blocking notices so an unsupported assignment or an unresolved/invalid
  // teaching date is never a silent empty field. (The old "Teaching: …" label
  // is folded into the wizard's "Set up for you" card, whose chips derive from
  // the live form state.)
  const mappingNotice =
    assignmentContext.mappingNotice && (!studioState.lessonDetails.grade || !studioState.lessonDetails.subject)
      ? assignmentContext.mappingNotice
      : ''
  const activeLessonDate = studioState.lessonDetails.date
  let dateWarning = ''
  if (activeLessonDate && isNonTeachingDay(activeLessonDate)) {
    const hol = publicHolidayOn(activeLessonDate)
    const why = isWeekend(activeLessonDate)
      ? 'Weekends are currently treated as non-teaching days.'
      : hol ? `${hol.name} is a public holiday.`
      : 'It falls outside the current term.'
    dateWarning = `This date is not a normal teaching day. ${why} Choose another date or confirm that your school teaches on this day.`
  }
  const dateHint = (!activeLessonDate && assignmentContext.seed && !assignmentContext.seed.date)
    ? (assignmentContext.calendarUnavailable
        ? 'We could not suggest a teaching date from the School Calendar. Choose a valid date to continue.'
        : 'Select the date you plan to teach this lesson.')
    : ''

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <CurriculumContext.Provider
      value={{
        curriculumMode: studioState.curriculumMode,
        setCurriculumMode: studioState.setCurriculumMode,
      }}
    >
      <div className="w-full max-w-3xl mx-auto px-4 pt-3">
        <DraftRecoveryPrompt {...draft} label="lesson plan" />
      </div>
      <StudioShell
        view={studioView}
        onBackToForm={() => setStudioView('form')}
        header={
          <StudioHeader
            eyebrow="Planning"
            title="Lesson Plan Studio"
            description="Create smart lesson plans in minutes — one step at a time, preview live."
            icon={Sparkles}
            backTo="/teacher/lesson-plans"
            backLabel="Back to Lesson Plans"
            status={
              <DraftStatusIndicator status={draft.status} savedAt={draft.savedAt} online={draft.online} />
            }
            // The wizard's secondary navigation joins the back link in the one
            // utility row rather than floating beside the step heading. Only in
            // the form view — the canvas has its own "Back to form" bar and
            // neither target exists there.
            actions={studioView === 'form' ? (
              <>
                {(studioState.generatedPlan || studioState.generationStatus !== 'idle') && (
                  <button
                    type="button"
                    onClick={() => setStudioView('canvas')}
                    className="lps-btn-ghost min-h-[36px] px-3 py-1.5 text-[12px]"
                  >
                    {studioState.generationStatus === 'loading'
                      ? 'View generation progress'
                      : 'View generated plan'}
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setProgressOpen(true)}
                  className="lps-btn-ghost min-h-[36px] px-3 py-1.5 text-[12px]"
                >
                  <ChartNoAxesColumnIncreasing size={15} aria-hidden="true" />
                  My lessons
                </button>
              </>
            ) : null}
          />
        }
        sidebar={
          <LessonPlanWizard
            studioState={studioState}
            aiState={aiState}
            seriesState={seriesState}
            onGenerate={handlePrimaryGenerate}
            onContinue={handleContinue}
            onViewCompleted={handleViewCompleted}
            isValid={isValid}
            generateLabel={genButton.label}
            appliedContext={appliedContext && !planContextDismissed}
            appliedWeekNumber={appliedWeekNumber}
            onDismissPlanContext={() => setPlanContextDismissed(true)}
            mappingNotice={mappingNotice}
            dateHint={dateHint}
            dateWarning={dateWarning}
            coverageState={coverageState}
            onSaveExit={async () => {
              // Flush the pending input draft (don't wait out the debounce —
              // unmount would cancel it) BEFORE navigating, so "Save & exit"
              // never discards an edit made in the last second. Fail-soft:
              // a flush error still exits; the on-device copy is best-effort.
              try {
                await draftRef.current.flush?.()
              } catch (err) {
                // Exit anyway — the debounced on-device copy is the recovery
                // path — but leave a trace so failing flushes are visible.
                console.warn('[zedexams] draft flush failed on exit', err)
              }
              navigate('/teacher/lesson-plans')
            }}
            // Also true while a generation is in flight or failed, so the
            // canvas (progress view / Stop / the error panel) stays reachable
            // after "Back to form" — not only once a plan exists.
            hasPlan={Boolean(studioState.generatedPlan) || studioState.generationStatus !== 'idle'}
            onViewPlan={() => setStudioView('canvas')}
            // "My lessons" is controlled from the header's utility row.
            progressOpen={progressOpen}
            onCloseProgress={() => setProgressOpen(false)}
            lessonMemory={{
              subtopicName: stripCode(memSubtopic || ''),
              subtopicCode: extractCode(memSubtopic || ''),
              lessons: subtopicLessons,
              expectedCount,
              loading: memory.loading,
              nextRecommendedSubtopic,
              onSetTeachingStatus: handleSetTeachingStatus,
              onCreateLesson: handleCreateLesson,
              onOpenLesson: handleOpenLesson,
            }}
          />
        }
        canvas={
          <div className="flex min-h-0 flex-1 flex-col">
          {/* Fit to page ran out of layout levers (§2.5). The remaining one
              rewrites the plan's words, so it is offered, never applied. */}
          {fitNotice && (
            <div
              role="status"
              data-testid="fit-notice"
              className="flex items-start gap-3 border-b border-amber-200 bg-amber-50 px-4 py-2.5 text-[12.5px] text-amber-900"
            >
              <span className="flex-1">
                Tightened as far as the printer allows — the plan still runs to{' '}
                <strong>{fitNotice.pages}</strong>{' '}
                {fitNotice.pages === 1 ? 'page' : 'pages'} against a{' '}
                {fitNotice.target}-page budget. Shorten a few cells in Edit mode, switch some
                sections off, or raise the page budget.
              </span>
              <button
                type="button"
                onClick={() => setFitNotice(null)}
                className="flex-shrink-0 font-bold underline hover:no-underline"
              >
                Dismiss
              </button>
            </div>
          )}
          <StudioCanvas
            generatedPlan={studioState.generatedPlan}
            generationStatus={studioState.generationStatus}
            generationError={generationError}
            onStop={() => { runRef.current += 1; studioState.setGenerationStatus('idle'); setStudioView('form') }}
            onExportWord={handleExportWord}
            illustrationMode={studioState.formatOptions.illustrations}
            illustrationStatus={illustrationStatus}
            illustrationError={illustrationError}
            onAddIllustration={handleAddIllustration}
            viewMode={viewMode}
            onViewModeChange={setViewMode}
            planJson={lastPlanJson}
            liveMeta={lastMeta || liveMeta}
            curriculumMode={studioState.curriculumMode}
            lessonContext={{
              grade: studioState.lessonDetails.grade || '',
              subject: studioState.lessonDetails.subject || '',
              topic: studioState.topicData.topic || '',
              subtopic: studioState.topicData.subtopic || '',
            }}
            onPlanChange={handlePlanChange}
            // The paper format the plan on screen was rendered with. Read from
            // the SAVED meta first: reopening a plan must reproduce the sheet it
            // was generated as, not re-derive it from today's form state.
            lessonFormat={lastMeta?.lessonFormat ?? studioState.formatOptions}
            onLessonFormatChange={handleLessonFormatChange}
            onCondenseToFit={handleCondenseToFit}
            onSaveToLibrary={handleSaveToLibrary}
            saveStatus={saveStatus}
            saveError={saveError}
            canSave={!!lastPlanJson && saveStatus !== 'saving' && planSignature !== savedSignature}
            onViewLibrary={handleViewCompleted}
          />
          </div>
        }
      />
      {kit && studioView === 'canvas' && (
        <div className="lps-game fixed inset-x-0 bottom-[calc(72px+env(safe-area-inset-bottom,0px))] z-50 border-t-2 border-[#0F1B2D] bg-white/95 px-3 py-2.5 shadow-[0_-6px_24px_-12px_rgba(15,27,45,0.35)] backdrop-blur sm:px-5 lg:bottom-0">
          <div className="mx-auto flex max-w-5xl items-center gap-3">
            <div className="hidden shrink-0 sm:block">
              <p className="flex items-center gap-1.5 text-[12px] font-extrabold text-[#0F1B2D]">
                <Sparkles size={14} aria-hidden="true" /> Teaching Kit
              </p>
              <p className="text-[11px] font-semibold text-[#4A5A6E]">Aligned to this lesson</p>
            </div>
            <div className="flex flex-1 gap-2 overflow-x-auto">
              {KIT_TOOLS.map(({ id, label, Icon }) => {
                const busy = id === 'notes' && kitBusy
                return (
                  <button
                    key={id}
                    type="button"
                    onClick={() => openKitTool(id)}
                    disabled={busy}
                    className="lps-btn-ghost shrink-0 px-3 py-2 text-[12px]"
                  >
                    <Icon size={15} aria-hidden="true" />
                    {busy ? 'Saving…' : label}
                  </button>
                )
              })}
            </div>
          </div>
        </div>
      )}

      <DuplicateLessonModal
        open={!!dupModal}
        lessonNumber={dupModal?.lessonNumber}
        nextLessonNumber={dupModal?.nextLessonNumber}
        subtopicName={stripCode(memSubtopic || '')}
        onContinue={handleDupContinue}
        onDuplicate={handleDupDuplicate}
        onCreateNext={handleDupCreateNext}
        onCancel={() => setDupModal(null)}
      />
    </CurriculumContext.Provider>
  )
}
