/**
 * Single source of truth for the 11 learner-AI agents on the admin
 * Live Monitor. The agent id values MUST match the strings the
 * server-side runners write to aiLiveAgentStates document ids and
 * the `agentName` field on aiAgentLogs / aiAgentTasks.
 *
 * The "display name" picks up either the friendly aiLiveAgentStates
 * agentName field when set (most runners pin a long display name —
 * e.g. "AI Supervisor Agent"), or the short id below as a fallback.
 *
 * Order matters — drives the grid layout on the monitor so admins
 * always see the agents in the same place.
 */

export const AGENTS = Object.freeze([
  // Orchestration + verification (top row visually)
  {id: 'AI Supervisor Agent',           short: 'Supervisor',     stateDocId: 'AI Supervisor Agent',           kind: 'orchestrator'},
  {id: 'Curriculum Reader Agent',       short: 'Curriculum Reader', stateDocId: 'Curriculum Reader Agent',    kind: 'safety_gate'},
  {id: 'standards',                     short: 'Standards (ref)',   stateDocId: 'standards',                   kind: 'reference_data'},
  {id: 'standardsCheck',                short: 'Standards Check',   stateDocId: 'standardsCheck',              kind: 'verifier',
    displayOverride: 'Zambian Curriculum & Exam Standards Agent'},
  {id: 'Quality Check Agent',           short: 'Quality Check',     stateDocId: 'Quality Check Agent',         kind: 'verifier'},
  {id: 'supervisorReview',              short: 'Supervisor Review', stateDocId: 'supervisorReview',            kind: 'gatekeeper',
    displayOverride: 'AI Supervisor Agent (review)'},

  // Generators (middle row visually)
  {id: 'practiceQuiz',                  short: 'Practice Quiz',     stateDocId: 'practiceQuiz',                kind: 'generator'},
  {id: 'examQuiz',                      short: 'Exam Quiz',         stateDocId: 'examQuiz',                    kind: 'generator'},
  {id: 'notes',                         short: 'Notes',             stateDocId: 'notes',                       kind: 'generator'},
  {id: 'studyTips',                     short: 'Study Tips',        stateDocId: 'studyTips',                   kind: 'generator'},

  // Analytics + scheduled
  {id: 'weakness',                      short: 'Weakness Detection', stateDocId: 'weakness',                   kind: 'analytics'},
  {id: 'feedback',                      short: 'Learner Feedback',   stateDocId: 'feedback',                    kind: 'generator'},
  {id: 'curriculumWatcher',             short: 'Curriculum Update',  stateDocId: 'curriculumWatcher',          kind: 'scheduled',
    displayOverride: 'Curriculum Update Checker Agent'},
])

export function findAgent(agentIdOrName) {
  if (!agentIdOrName) return null
  return AGENTS.find(a =>
    a.id === agentIdOrName ||
    a.stateDocId === agentIdOrName ||
    a.displayOverride === agentIdOrName) || null
}

export function displayNameFor(agent, liveState) {
  if (!agent) return 'Unknown'
  if (liveState && typeof liveState.agentName === 'string' && liveState.agentName.length) {
    return liveState.agentName
  }
  return agent.displayOverride || agent.id
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
