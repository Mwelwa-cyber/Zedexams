/**
 * src/utils/companyOrg.js
 *
 * Presentational metadata for the ZedExams "AI Company" — the org chart
 * the /admin/company HQ dashboard renders. This is a faithful snapshot of
 * the agents that actually run in functions/agents/* (see ORG.md), grouped
 * by the same `department` values their agentJobs / cron jobs are tagged
 * with: content | qaEng | revenue | support | growth.
 *
 * Pure data — no Firestore, no side effects. Live status (paused / active)
 * is layered on at render time from the agentControl collection.
 */

export const DEPARTMENTS = [
  {
    id: 'content',
    name: 'Content',
    blurb: 'Drafts, CBC-aligns, reviews and publishes the material learners and teachers pay for.',
    accent: 'emerald',
  },
  {
    id: 'qaEng',
    name: 'QA & Engineering',
    blurb: 'Keeps quality, site health and the codebase honest before anything reaches a learner.',
    accent: 'blue',
  },
  {
    id: 'revenue',
    name: 'Revenue',
    blurb: 'Reconciles mobile-money payments so every kwacha earned is actually captured.',
    accent: 'amber',
  },
  {
    id: 'support',
    name: 'Support',
    blurb: 'Triages learner & teacher messages and drafts replies for a human to send.',
    accent: 'violet',
  },
  {
    id: 'growth',
    name: 'Growth',
    blurb: 'Wins back quiet learners and briefs the owner on what to build next.',
    accent: 'rose',
  },
]

// runsVia: how the agent is triggered.
//   queue   — agentJobs Firestore pipeline (Aria→Cala→Reva→Pubo)
//   cron    — scheduled Cloud Function
//   sync    — synchronous callable (instant feedback)
//   managed — Anthropic Managed Agent session, on demand
//   ci      — GitHub Action (runs outside the agentJobs queue)
// spend: rough AI-cost weight for the org view — none | low | med | high.
export const AGENTS = [
  // ── Content ──────────────────────────────────────────────────────────
  { id: 'aria', name: 'Aria', title: 'Content Author', dept: 'content',
    model: 'Sonnet 4.5', runsVia: 'queue', cadence: 'On brief', spend: 'high',
    mission: 'Drafts CBC-aligned lesson plans, worksheets, rubrics, notes and more from a brief.' },
  { id: 'cala', name: 'Cala', title: 'CBC Alignment Officer', dept: 'content',
    model: 'Deterministic', runsVia: 'queue', cadence: 'On draft + weekly audit', spend: 'none',
    mission: 'Validates every draft against the verified Zambian CBC knowledge base; flags drift, attaches citations.' },
  { id: 'reva', name: 'Reva', title: 'Content Reviewer', dept: 'content',
    model: 'Sonnet 4.5', runsVia: 'queue', cadence: 'On aligned draft', spend: 'med',
    mission: 'Reviews pedagogy, tone and age-fit; suggests edits but never auto-applies them.' },
  { id: 'pubo', name: 'Pubo', title: 'Publisher', dept: 'content',
    model: 'Deterministic', runsVia: 'queue', cadence: 'On approval', spend: 'none',
    mission: 'The only agent that can publish — writes approved artifacts into aiGenerations.' },
  { id: 'compass', name: 'Compass', title: 'Product Analyst', dept: 'content',
    model: 'Deterministic', runsVia: 'cron', cadence: 'Weekly · Mon 06:00', spend: 'none',
    mission: 'Ranks a "what to build next" backlog from where demand is high but mastery is weak.' },
  { id: 'gate', name: 'Gate', title: 'Auto-Publish Gate', dept: 'content',
    model: 'Deterministic', runsVia: 'cron', cadence: 'Every 30 min (opt-in)', spend: 'none',
    mission: 'Auto-approves only the cleanest content (Cala aligned, no gaps, Reva approve). Off by default.' },

  // ── QA & Engineering ─────────────────────────────────────────────────
  { id: 'vex', name: 'Vex', title: 'Quiz Verifier', dept: 'qaEng',
    model: 'Haiku 4.5', runsVia: 'sync', cadence: 'On Verify & publish', spend: 'low',
    mission: 'Grammarly-style instant pre-publish quality score on quizzes; blocks on critical errors.' },
  { id: 'quill', name: 'Quill', title: 'QA Smoke Runner', dept: 'qaEng',
    model: 'Deterministic', runsVia: 'cron', cadence: 'Nightly · 02:00', spend: 'none',
    mission: 'Nightly snapshot of job health, stuck jobs, recent failures and KB freshness.' },
  { id: 'vigil', name: 'Vigil', title: 'Site Monitor', dept: 'qaEng',
    model: 'Haiku 4.5', runsVia: 'cron', cadence: 'Hourly', spend: 'low',
    mission: 'Sweeps pages, Firebase, images and quizzes; on failure suggests a fix and escalates to Mendi.' },
  { id: 'rex', name: 'Rex', title: 'Code Reviewer', dept: 'qaEng',
    model: 'Sonnet 4.5', runsVia: 'managed', cadence: 'On demand', spend: 'none',
    mission: 'Reviews PR diffs for conventions, schema/rule changes, secrets and cost regressions.' },
  { id: 'ledger', name: 'Ledger', title: 'Release Notes', dept: 'qaEng',
    model: 'Sonnet 4.5', runsVia: 'ci', cadence: 'Daily · 22:00', spend: 'low',
    mission: 'Summarises the PRs that landed on main into a daily CHANGELOG entry.' },
  { id: 'mendi', name: 'Mendi', title: 'Bug Fixer', dept: 'qaEng',
    model: 'Sonnet 4.5', runsVia: 'ci', cadence: 'On bug issue', spend: 'med',
    mission: 'Turns a reported breakage into a permanent fix plus a regression test, as a draft PR.' },
  { id: 'marshal', name: 'Marshal', title: 'Operations Supervisor', dept: 'qaEng',
    model: 'Deterministic', runsVia: 'cron', cadence: 'Hourly', spend: 'none',
    mission: 'Checks every scheduled agent actually ran on time; flags stuck jobs, tripped breakers and failures into one health verdict.' },

  // ── Revenue ──────────────────────────────────────────────────────────
  { id: 'till', name: 'Till', title: 'Revenue Reconciler', dept: 'revenue',
    model: 'Deterministic', runsVia: 'cron', cadence: 'Hourly', spend: 'none',
    mission: 'Re-checks stale mobile-money payments with Lenco and activates the ones that actually succeeded.',
    fundsRevenue: true },

  // ── Support ──────────────────────────────────────────────────────────
  { id: 'echo', name: 'Echo', title: 'Support Triage', dept: 'support',
    model: 'Haiku 4.5', runsVia: 'cron', cadence: 'Every 2 hrs', spend: 'low',
    mission: 'Classifies and prioritises feedback + contact messages and drafts a reply (never sends).' },

  // ── Growth ───────────────────────────────────────────────────────────
  { id: 'anchor', name: 'Anchor', title: 'Retention Agent', dept: 'growth',
    model: 'Deterministic', runsVia: 'cron', cadence: 'Weekly · Mon 07:00', spend: 'none',
    mission: 'Finds once-engaged learners who went quiet and drafts a re-engagement nudge.' },
  { id: 'dawn', name: 'Dawn', title: 'Morning Briefing', dept: 'growth',
    model: 'Managed Agent', runsVia: 'managed', cadence: 'On demand', spend: 'high',
    mission: 'Reads the repo + researches the market, then writes a ranked Top-3 briefing for the owner.' },
]

export const SPEND_LABEL = {
  none: { label: 'No AI cost', tone: 'slate' },
  low: { label: 'Low spend', tone: 'emerald' },
  med: { label: 'Medium spend', tone: 'amber' },
  high: { label: 'High spend', tone: 'rose' },
}

export const RUNS_VIA_LABEL = {
  queue: 'Pipeline',
  cron: 'Scheduled',
  sync: 'Instant',
  managed: 'On demand',
  ci: 'CI',
}

export function agentsByDept(deptId) {
  return AGENTS.filter((a) => a.dept === deptId)
}

export function getAgent(id) {
  return AGENTS.find((a) => a.id === id) || null
}

// ── Preview seed: a believable recent-activity feed ───────────────────────
// Used only when the dashboard is in Preview mode (no live agentJobs yet),
// so the HQ looks alive on first open. Never persisted.
export function seedAgentActivity(now = new Date()) {
  const mins = (m) => new Date(now.getTime() - m * 60_000)
  return [
    { id: 's1', agentId: 'aria', status: 'done', label: 'Drafted Grade 6 Maths worksheet · Fractions', at: mins(4) },
    { id: 's2', agentId: 'vex', status: 'done', label: 'Verified quiz · "Grade 7 Science · Energy" → 92/100', at: mins(11) },
    { id: 's3', agentId: 'till', status: 'done', label: 'Reconciled 3 mobile-money payments · K237 captured', at: mins(38) },
    { id: 's4', agentId: 'echo', status: 'done', label: 'Triaged 5 messages · 2 drafted replies awaiting send', at: mins(52) },
    { id: 's5', agentId: 'reva', status: 'awaiting_approval', label: 'Reviewed lesson plan · verdict: approve', at: mins(64) },
    { id: 's6', agentId: 'vigil', status: 'done', label: 'Hourly health sweep · all 4 surfaces green', at: mins(73) },
    { id: 's7', agentId: 'compass', status: 'done', label: 'Backlog refreshed · top gap: Grade 9 English comprehension', at: mins(140) },
    { id: 's8', agentId: 'anchor', status: 'done', label: 'Flagged 18 at-risk learners · nudge drafted', at: mins(190) },
  ]
}
