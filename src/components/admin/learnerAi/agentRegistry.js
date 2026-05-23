/**
 * Single source of truth for the learner-AI agents on the admin
 * Live Monitor. The agent `id` MUST match the strings the
 * server-side runners write to aiLiveAgentStates document ids and
 * the `agentName` field on aiAgentLogs / aiAgentTasks — DO NOT
 * rename these without coordinating a runner-side migration.
 *
 * `displayOverride` is the human-facing label. It's the ONLY value
 * the Live Monitor renders to admins; the raw `id` should never
 * surface in the UI.
 *
 * `kind` drives the grid grouping + card colour. `displayKind` is
 * an optional one-liner that surfaces under the card title to make
 * the agent's role obvious to a new admin.
 *
 * Order matters — drives the grid layout on the monitor so admins
 * always see the agents in the same place.
 *
 * Disambiguation:
 *   - `standards` is the standards-data LOADER (fetches
 *     assessmentStandards docs into chainContext for the exam_quiz
 *     generator). It's an internal worker, not a verification
 *     agent. Labelled "Standards Reference Loader Worker".
 *   - `standardsCheck` is the VERIFIER that validates generated
 *     content against Zambian curriculum + exam standards across
 *     14 axes. This is the agent the user-facing copy refers to
 *     as the "Zambian Curriculum & Exam Standards Agent".
 *   - `AI Supervisor Agent` is the orchestration planner (decides
 *     which runners run in what order).
 *   - `supervisorReview` is the final-gatekeeper sub-step (reviews
 *     the upstream verdicts + writes supervisorDecision). Labelled
 *     "Supervisor Review Worker" so admins don't mistake the two
 *     for duplicates.
 */

export const AGENTS = Object.freeze([
  // Orchestration + verification (top row visually)
  {
    id: 'AI Supervisor Agent',
    stateDocId: 'AI Supervisor Agent',
    kind: 'orchestrator',
    displayOverride: 'AI Supervisor Agent',
    displayKind: 'Plans the step graph for each task',
  },
  {
    id: 'Curriculum Reader Agent',
    stateDocId: 'Curriculum Reader Agent',
    kind: 'safety_gate',
    displayOverride: 'Curriculum Reader Agent',
    displayKind: 'Loads approved CBC entries; refuses on no match',
  },
  {
    id: 'standards',
    stateDocId: 'standards',
    kind: 'reference_data',
    displayOverride: 'Standards Reference Loader Worker',
    displayKind: 'Fetches exam-paper standards for the exam quiz generator (internal sub-step)',
  },
  {
    id: 'standardsCheck',
    stateDocId: 'standardsCheck',
    kind: 'verifier',
    displayOverride: 'Zambian Curriculum & Exam Standards Agent',
    displayKind: 'Verifies generated content against Zambian curriculum + exam standards',
  },
  {
    id: 'Quality Check Agent',
    stateDocId: 'Quality Check Agent',
    kind: 'verifier',
    displayOverride: 'Quality Check Agent',
    displayKind: 'Per-question + per-artifact quality + safety checks',
  },
  {
    id: 'supervisorReview',
    stateDocId: 'supervisorReview',
    kind: 'gatekeeper',
    displayOverride: 'Supervisor Review Worker',
    displayKind: 'Final-gatekeeper sub-step: reviews upstream verdicts + writes supervisorDecision',
  },

  // Generators (middle row visually)
  {
    id: 'practiceQuiz',
    stateDocId: 'practiceQuiz',
    kind: 'generator',
    displayOverride: 'Practice Quiz Generator Agent',
    displayKind: 'Generates practice quizzes (MCQ / short-answer / matching / true-false)',
  },
  {
    id: 'examQuiz',
    stateDocId: 'examQuiz',
    kind: 'generator',
    displayOverride: 'Exam Quiz Generator Agent',
    displayKind: 'Generates formal exam papers (Section A / B / C)',
  },
  {
    id: 'notes',
    stateDocId: 'notes',
    kind: 'generator',
    displayOverride: 'Notes Generator Agent',
    displayKind: 'Generates study notes (vocabulary, examples, summary, remember-this)',
  },
  {
    id: 'studyTips',
    stateDocId: 'studyTips',
    kind: 'generator',
    displayOverride: 'Study Tips Agent',
    displayKind: 'Generates per-learner study tips grounded in real weakness data',
  },

  // Analytics + scheduled
  {
    id: 'weakness',
    stateDocId: 'weakness',
    kind: 'analytics',
    displayOverride: 'Weakness Detection Agent',
    displayKind: 'Analyses the learner’s own attempts; queues a Study Tips task on signals',
  },
  {
    id: 'feedback',
    stateDocId: 'feedback',
    kind: 'generator',
    displayOverride: 'Learner Feedback Agent',
    displayKind: 'Generates honest-but-encouraging feedback tied to one quiz attempt',
  },
  {
    id: 'curriculumWatcher',
    stateDocId: 'curriculumWatcher',
    kind: 'scheduled',
    displayOverride: 'Curriculum Update Checker Agent',
    displayKind: 'Scans whitelisted MoE / CDC / ECZ sources weekly or monthly; never auto-applies',
  },
])

// O(1) lookup by raw id / stateDocId / displayOverride. Used by the
// log + timeline + drawer rendering paths.
const _byKey = (() => {
  const m = new Map()
  for (const a of AGENTS) {
    m.set(a.id, a)
    if (a.stateDocId && a.stateDocId !== a.id) m.set(a.stateDocId, a)
    if (a.displayOverride && a.displayOverride !== a.id) m.set(a.displayOverride, a)
  }
  return m
})()

export function findAgent(agentIdOrName) {
  if (!agentIdOrName) return null
  return _byKey.get(agentIdOrName) || null
}

/**
 * Used by the agent-status-card grid (LiveAgentStatusCards.jsx) where
 * both the agent entry + the live-state doc are in hand.
 *
 * Priority (changed from prior versions — was liveState.agentName first):
 *   1. agent.displayOverride  — our authoritative human-facing name
 *   2. liveState.agentName    — fallback for legacy state docs whose
 *                               id we don't know but whose agentName
 *                               might already be friendly
 *   3. agent.id               — last-ditch fallback
 *
 * Rationale: runners stamp `agentName: AGENT_ID` (the raw camelCase
 * id) onto aiLiveAgentStates. Putting liveState.agentName first
 * leaked those raw ids into the UI. The override is the truth.
 */
export function displayNameFor(agent, liveState) {
  if (!agent) {
    // No registry match — show liveState.agentName if it looks
    // human-readable; otherwise pretty-print the raw token.
    if (liveState && typeof liveState.agentName === 'string') {
      return prettyFallback(liveState.agentName)
    }
    return 'Unknown agent'
  }
  if (agent.displayOverride) return agent.displayOverride
  if (liveState && typeof liveState.agentName === 'string' && liveState.agentName.length) {
    return liveState.agentName
  }
  return agent.id
}

/**
 * One-liner role description shown under the card title. Falls
 * back to '' so callers can skip rendering when empty.
 */
export function displayKindFor(agent) {
  return (agent && agent.displayKind) || ''
}

/**
 * Used by the components that only have the raw agent-name string
 * from a log / step / task doc (`aiAgentLogs[].agentName`,
 * `aiTaskSteps[].agentName`, `aiAgentTasks.agentName`). Looks up
 * the registry; falls back to a prettified version of the raw
 * token (e.g. 'practiceQuiz' → 'Practice Quiz') so even unknown
 * agents don't surface as raw camelCase.
 */
export function prettyAgentName(rawAgentName) {
  if (!rawAgentName) return ''
  const agent = findAgent(rawAgentName)
  if (agent && agent.displayOverride) return agent.displayOverride
  if (agent && agent.id) return agent.id
  return prettyFallback(rawAgentName)
}

// camelCase / snake_case → Title Case fallback for unknown tokens.
function prettyFallback(raw) {
  return String(raw)
    .replace(/[_-]+/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .map(w => w.length ? w[0].toUpperCase() + w.slice(1) : w)
    .join(' ')
}

// Per-status palette. Pinned to the v2 TASK_STATUSES + a few
// runner-side state strings (idle / failed / completed).
export const STATUS_COLORS = Object.freeze({
  idle:                  'bg-slate-100 text-slate-600 border-slate-200',
  queued:                'bg-slate-200 text-slate-700 border-slate-300',
  running:               'bg-blue-100 text-blue-800 border-blue-200',
  thinking:              'bg-blue-100 text-blue-800 border-blue-200',
  generating:            'bg-violet-100 text-violet-800 border-violet-200',
  checking:              'bg-amber-100 text-amber-800 border-amber-200',
  waiting:               'bg-slate-100 text-slate-600 border-slate-200',
  completed:             'bg-emerald-100 text-emerald-800 border-emerald-200',
  passed_quality_check:  'bg-emerald-100 text-emerald-800 border-emerald-200',
  failed_quality_check:  'bg-rose-100 text-rose-800 border-rose-200',
  needs_review:          'bg-orange-100 text-orange-800 border-orange-200',
  approved:              'bg-emerald-100 text-emerald-800 border-emerald-200',
  published:             'bg-emerald-100 text-emerald-800 border-emerald-200',
  rejected:              'bg-rose-100 text-rose-800 border-rose-200',
  regenerating:          'bg-amber-100 text-amber-800 border-amber-200',
  error:                 'bg-rose-100 text-rose-800 border-rose-200',
  failed:                'bg-rose-100 text-rose-800 border-rose-200',
})

export function classForStatus(status) {
  return STATUS_COLORS[status] || 'bg-slate-100 text-slate-600 border-slate-200'
}
