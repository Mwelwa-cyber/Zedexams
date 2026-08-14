/**
 * AI generation progress — stage catalogue + pure state logic.
 *
 * Two facts shape this module:
 *
 *   1. Most ZedExams generators (notes, flashcards, rubric, scheme, homework,
 *      quiz/assessment) are single-promise callables — there is NO live
 *      progress to read. For those the tracker walks a *simulated*,
 *      time-weighted timeline so the wait feels intentional.
 *   2. Worksheet (and the Lesson Plan studio) DO emit real SSE phases
 *      (`queued | claude_started | token | claude_done`). Those callers pass an
 *      `activeStageId` so the tracker reflects the truth instead of a guess.
 *
 * The golden rule, encoded in `computeStageStates`: while a run is still in
 * flight we never auto-complete the *final* stage. It stays "active" until the
 * promise/stream actually resolves (`finished: true`), at which point every
 * stage snaps to done. The UI must never claim "done" before the work is.
 *
 * Everything here is framework-free and side-effect-free so it can be unit
 * tested with plain `node` (see scripts/test-ai-generation-stages.mjs).
 */

/**
 * Canonical, ordered catalogue of every stage an AI generation run can pass
 * through. Individual tools pick a subset via STAGE_PRESETS — e.g. notes never
 * build an answer key, lesson plans don't draw diagrams.
 *
 * `estMs` is a rough time weight used only for the simulated timeline; it does
 * not need to be accurate, only proportional, so the active stage advances at a
 * believable pace for a ~20–40s generation.
 */
export const AI_STAGES = {
  reading:    { id: 'reading',    label: 'Reading your request',        icon: '📖', estMs: 1500 },
  curriculum: { id: 'curriculum', label: 'Checking the curriculum',     icon: '📚', estMs: 4000 },
  content:    { id: 'content',    label: 'Generating content',          icon: '✍️', estMs: 14000 },
  diagrams:   { id: 'diagrams',   label: 'Adding diagrams & images',    icon: '🎨', estMs: 6000 },
  answerKey:  { id: 'answerKey',  label: 'Validating the answer key',   icon: '✅', estMs: 4000 },
  preview:    { id: 'preview',    label: 'Preparing your preview',      icon: '📄', estMs: 2500 },
}

/**
 * Per-tool stage lists. Keys are the `preset` prop accepted by the component
 * and the hook. Order matters — it's the order stages are shown and advanced.
 *
 * The `diagrams` stage is only included for tools that actually generate
 * imagery; callers that draw diagrams conditionally (e.g. AssessmentStudio's
 * auto-diagram toggle) should pass an explicit `stages` array instead so the
 * stage appears only when it will really run.
 */
export const STAGE_PRESETS = {
  quiz:        ['reading', 'curriculum', 'content', 'answerKey', 'preview'],
  assessment:  ['reading', 'curriculum', 'content', 'answerKey', 'preview'],
  worksheet:   ['reading', 'curriculum', 'content', 'answerKey', 'preview'],
  homework:    ['reading', 'curriculum', 'content', 'answerKey', 'preview'],
  notes:       ['reading', 'curriculum', 'content', 'preview'],
  lessonPlan:  ['reading', 'curriculum', 'content', 'preview'],
  lesson_plan: ['reading', 'curriculum', 'content', 'preview'],
  flashcards:  ['reading', 'curriculum', 'content', 'preview'],
  rubric:      ['reading', 'curriculum', 'content', 'preview'],
  scheme:      ['reading', 'curriculum', 'content', 'preview'],
}

/**
 * Per-preset label overrides for specific stage IDs. Replaces the generic
 * stage label with one that names what the tool is actually doing, so the
 * tracker text matches the generation in progress.
 *
 * Only stages where a more specific label genuinely adds signal are overridden;
 * generic stages like "Reading your request" are left as-is across all presets.
 */
export const PRESET_LABELS = {
  worksheet:   { content: 'Drafting worksheet questions',   answerKey: 'Checking the marking key' },
  homework:    { content: 'Setting homework tasks' },
  notes:       { content: 'Writing study notes',            preview: 'Formatting your notes' },
  lessonPlan:  { content: 'Writing your lesson plan' },
  lesson_plan: { content: 'Writing your lesson plan' },
  flashcards:  { content: 'Creating flashcard pairs',       preview: 'Arranging your cards' },
  rubric:      { content: 'Writing rubric criteria',        preview: 'Building the rubric table' },
  scheme:      { content: 'Mapping the scheme of work',     preview: 'Formatting the term plan' },
  quiz:        { content: 'Composing quiz questions' },
  assessment:  { content: 'Composing questions' },
}

/**
 * Resolve a list of stage ids (or a preset name) into full stage objects.
 * Unknown ids are dropped rather than throwing — a caller typo degrades to a
 * shorter tracker, never a crash mid-generation.
 *
 * @param {string|string[]} presetOrStages — a STAGE_PRESETS key, or an explicit
 *   array of stage ids.
 * @returns {Array<{id,label,icon,estMs}>}
 */
export function resolveStages(presetOrStages) {
  const key = Array.isArray(presetOrStages) ? null : presetOrStages
  const ids = Array.isArray(presetOrStages)
    ? presetOrStages
    : (STAGE_PRESETS[presetOrStages] || STAGE_PRESETS.notes)
  const overrides = (key && PRESET_LABELS[key]) || {}
  return ids.map((id) => {
    const stage = AI_STAGES[id]
    if (!stage) return null
    return overrides[id] ? { ...stage, label: overrides[id] } : stage
  }).filter(Boolean)
}

/**
 * Map a Worksheet/Lesson-Plan SSE phase to the stage it represents, so callers
 * with real progress can drive the tracker truthfully.
 *
 * Phase schema (src/utils/teacherTools.js): queued | claude_started | token |
 * claude_done. We surface `claude_done` as the answer-key stage when the preset
 * has one, otherwise as the preview stage — the caller decides which preset.
 *
 * @param {string|undefined} phase
 * @param {{ hasAnswerKey?: boolean }} [opts]
 * @returns {string|undefined} a stage id, or undefined to fall back to timing.
 */
export function mapWorksheetPhaseToStage(phase, opts = {}) {
  switch (phase) {
    case 'queued':         return 'curriculum'
    case 'claude_started': return 'content'
    case 'token':          return 'content'
    case 'claude_done':    return opts.hasAnswerKey === false ? 'preview' : 'answerKey'
    default:               return undefined
  }
}

/**
 * Pure stage-state reducer. Given the resolved stages and the current run
 * conditions, return each stage's status plus an overall percent.
 *
 * Status values: 'done' | 'active' | 'pending' | 'error'.
 *
 * Precedence:
 *   • errored      → the active stage shows 'error'; earlier stages stay 'done'.
 *   • finished     → every stage 'done', percent 100.
 *   • activeStageId given (real driver) → that stage is active, earlier done.
 *   • otherwise    → derive the active stage from elapsedMs vs cumulative estMs,
 *                    capped at the LAST stage while still running so we never
 *                    auto-complete the final stage.
 *
 * @param {object} args
 * @param {Array<{id,label,icon,estMs}>} args.stages
 * @param {number} [args.elapsedMs=0]
 * @param {string} [args.activeStageId]
 * @param {boolean} [args.running=true]
 * @param {boolean} [args.finished=false]
 * @param {boolean} [args.errored=false]
 * @returns {{ items: Array, activeIndex: number, percent: number }}
 */
export function computeStageStates({
  stages,
  elapsedMs = 0,
  activeStageId,
  running = true,
  finished = false,
  errored = false,
}) {
  const list = Array.isArray(stages) ? stages : []
  const lastIndex = list.length - 1

  if (list.length === 0) {
    return { items: [], activeIndex: -1, percent: finished ? 100 : 0 }
  }

  // Success: everything completes.
  if (finished && !errored) {
    return {
      items: list.map((s) => ({ ...s, status: 'done' })),
      activeIndex: lastIndex,
      percent: 100,
    }
  }

  // Determine which stage is currently active.
  let activeIndex
  if (activeStageId) {
    const idx = list.findIndex((s) => s.id === activeStageId)
    activeIndex = idx === -1 ? 0 : idx
  } else {
    activeIndex = activeIndexFromElapsed(list, elapsedMs)
    // While the run is still in flight, never let the timer march the active
    // stage past the last one — the final stage must wait for a real resolve.
    if (running && activeIndex >= lastIndex) activeIndex = lastIndex
  }

  const items = list.map((stage, i) => {
    let status
    if (i < activeIndex) status = 'done'
    else if (i === activeIndex) status = errored ? 'error' : 'active'
    else status = 'pending'
    return { ...stage, status }
  })

  // Overall percent: completed stages count fully, the active stage counts as a
  // partial weighted by its progress through its own estMs window. Capped just
  // under 100 while running so the bar visibly "lands" only on finish.
  const percent = errored
    ? clampPercent((activeIndex / list.length) * 100)
    : overallPercent(list, activeIndex, activeStageId ? null : elapsedMs, running)

  return { items, activeIndex, percent }
}

/* ── connection health notices ─────────────────────────────────── */

/**
 * How long a run may go before we tell the teacher their connection looks
 * slow. A normal generation lands in ~20–40s (see the per-stage estMs), so a
 * run still going past this has genuinely stalled on the network rather than
 * on the model. Kept generous so we never cry wolf on a normal-but-large paper.
 */
export const SLOW_CONNECTION_AFTER_MS = 45000

/**
 * The exact, teacher-friendly copy shown inside the progress panel. No jargon,
 * no error codes — just what's happening and what (not) to do about it.
 */
export const CONNECTION_NOTICES = {
  offline: 'You are offline. Your request has been saved and will continue when internet returns.',
  slow: 'Your connection is slow, but we are still working. Please do not close the page.',
}

/**
 * Decide which connection notice (if any) belongs in the panel right now.
 * Pure so it's unit-testable and can be shared with the vanilla-JS lesson-plan
 * port.
 *
 *   • Only speaks while a run is actually in flight and hasn't errored — once
 *     the work fails, the retry UI takes over and a stale "slow…" line would
 *     just confuse.
 *   • Offline outranks slow: it's the more actionable of the two.
 *   • Slow fires purely on elapsed wall-clock, so it works for both the
 *     simulated timeline AND the real-SSE (activeStageId) callers.
 *
 * @param {object} args
 * @param {boolean} [args.online=true]     — navigator.onLine (via useNetworkStatus).
 * @param {number}  [args.elapsedMs=0]     — wall-clock since the run began.
 * @param {boolean} [args.running=true]    — is a generation currently in flight.
 * @param {boolean} [args.errored=false]   — has the run failed.
 * @param {number}  [args.slowAfterMs]     — override the slow threshold.
 * @returns {'offline'|'slow'|null} a CONNECTION_NOTICES key, or null.
 */
export function connectionNoticeFor({
  online = true,
  elapsedMs = 0,
  running = true,
  errored = false,
  slowAfterMs = SLOW_CONNECTION_AFTER_MS,
} = {}) {
  if (!running || errored) return null
  if (!online) return 'offline'
  if (elapsedMs >= slowAfterMs) return 'slow'
  return null
}

/* ── internals ─────────────────────────────────────────────────── */

function activeIndexFromElapsed(list, elapsedMs) {
  let acc = 0
  for (let i = 0; i < list.length; i++) {
    acc += list[i].estMs || 0
    if (elapsedMs < acc) return i
  }
  return list.length - 1
}

function overallPercent(list, activeIndex, elapsedMs, running) {
  const total = list.reduce((sum, s) => sum + (s.estMs || 0), 0) || 1
  // Sum the est of fully-completed stages.
  let completedMs = 0
  for (let i = 0; i < activeIndex; i++) completedMs += list[i].estMs || 0

  let partial = 0
  const activeEst = list[activeIndex]?.estMs || 0
  if (elapsedMs == null) {
    // Real driver (no timer): show the active stage as half-filled.
    partial = activeEst * 0.5
  } else {
    partial = Math.min(activeEst, Math.max(0, elapsedMs - completedMs))
  }

  const raw = ((completedMs + partial) / total) * 100
  // Hold just under 100 until a real finish flips the whole thing to done.
  return running ? clampPercent(raw, 96) : clampPercent(raw)
}

function clampPercent(value, max = 100) {
  if (!Number.isFinite(value)) return 0
  return Math.max(0, Math.min(max, Math.round(value)))
}
