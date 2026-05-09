/**
 * Static roster of ZedExams AI agents.
 *
 * The single source of truth for the /admin/agents UI. Server-side
 * dispatcher logic lives in functions/agents/ and reads this same shape
 * indirectly via the agentId field on agentJobs documents.
 *
 * Adding an agent? Update ORG.md too, then drop a .claude/agents/<id>.md
 * definition. See docs/AGENTS.md.
 */

export const DEPARTMENTS = {
  content: { id: 'content',  label: 'Content',         emoji: 'AC' },
  qaEng:   { id: 'qaEng',    label: 'QA / Engineering', emoji: 'QE' },
}

export const AGENTS = [
  {
    id: 'aria',
    name: 'Aria',
    role: 'Content Author',
    department: 'content',
    mission: 'Drafts CBC-aligned lesson plans, worksheets, schemes, rubrics, flashcards, and notes from a brief.',
    inputs: 'tool, grade, subject, topic, term, brief',
    outputs: 'agentJobs.output.draft (matches teacherTools schema)',
    wraps: 'functions/teacherTools/generate*.js runners',
    runtime: ['subagent', 'cloud-function'],
    invocation: 'Use the content-author subagent in Claude Code, or POST to agentJobs from a teacher brief form.',
  },
  {
    id: 'cala',
    name: 'Cala',
    role: 'CBC Alignment Officer',
    department: 'content',
    mission: 'Verifies a draft against the verified Zambian CBC knowledge base; flags drift, attaches citations.',
    inputs: 'Aria draft + grade, topic',
    outputs: '{ aligned, citations, gaps, drift }',
    wraps: 'functions/teacherTools/cbcKnowledge.js (resolveCbcContext)',
    runtime: ['subagent', 'cloud-function', 'github-action'],
    invocation: 'Use the cbc-alignment subagent after Aria produces a draft.',
  },
  {
    id: 'reva',
    name: 'Reva',
    role: 'Content Reviewer',
    department: 'content',
    mission: 'Pedagogy + tone + age-appropriateness review. Suggests edits, never auto-applies.',
    inputs: 'Aligned draft from Cala',
    outputs: '{ verdict, severity, edits, summary }',
    wraps: 'functions/aiService.js (callAnthropic)',
    runtime: ['subagent', 'cloud-function'],
    invocation: 'Use the content-reviewer subagent after Cala passes a draft.',
  },
  {
    id: 'pubo',
    name: 'Pubo',
    role: 'Publisher',
    department: 'content',
    mission: 'Only agent allowed to publish. On admin approval, writes the final artifact to aiGenerations.',
    inputs: 'Approved agentJobs doc',
    outputs: 'New aiGenerations doc + publishedRefs',
    wraps: 'aiGenerations admin-SDK write path',
    runtime: ['subagent', 'cloud-function'],
    invocation: 'Auto-runs when an admin clicks Approve in /admin/agents.',
  },
  {
    id: 'quill',
    name: 'Quill',
    role: 'QA Smoke Runner',
    department: 'qaEng',
    mission: 'Refreshes auth + authoring QA reports nightly; surfaces regressions as queued jobs.',
    inputs: 'cron schedule',
    outputs: '.auth-qa-report.json, .authoring-qa-report.json + summary job',
    wraps: 'scripts/check-file-integrity.mjs, scripts/test-question-schema.mjs, .playwright-cli/',
    runtime: ['subagent', 'cloud-function'],
    invocation: 'Cron: nightly 02:00 Africa/Lusaka. Manually: invoke the qa-smoke subagent.',
  },
  {
    id: 'rex',
    name: 'Rex',
    role: 'Code Reviewer',
    department: 'qaEng',
    mission: 'Reviews PR diffs for repo conventions, schema/rule changes, secrets, and Anthropic cost regressions.',
    inputs: 'PR diff (from gh pr diff)',
    outputs: 'PR review comment',
    wraps: 'Anthropic API via GitHub Action',
    runtime: ['subagent', 'github-action'],
    invocation: 'Auto on pull_request: opened, synchronize. Manually: invoke the code-reviewer subagent.',
  },
  {
    id: 'ledger',
    name: 'Ledger',
    role: 'Release Notes',
    department: 'qaEng',
    mission: 'On push to main, summarises merged PRs into a CHANGELOG PR.',
    inputs: 'git log since last changelog entry',
    outputs: 'Draft CHANGELOG PR',
    wraps: '@octokit/rest (already in functions/package.json)',
    runtime: ['subagent', 'github-action'],
    invocation: 'Auto on push to main. Manually: invoke the release-notes subagent.',
  },
  {
    id: 'vex',
    name: 'Vex',
    role: 'Quiz Verifier',
    department: 'qaEng',
    mission: 'Synchronous pre-publish quality check on quizzes — answer accuracy, grade fit, clarity, grammar, options, and CBC alignment. Blocks publishing on critical errors, warns on minor issues.',
    inputs: 'quizId, questions[], meta { grade, subject, topic, subtopic, difficulty }',
    outputs: '{ verdict, overallScore, scores, summary, blockers[], warnings[] }',
    wraps: 'functions/agents/runners/vex.js (Anthropic Haiku, synchronous callable)',
    runtime: ['subagent', 'cloud-function'],
    invocation: 'Auto when an admin clicks Verify & publish in the quiz editor. Not queued — direct callable, no agentJobs writes.',
  },
]

export const AGENTS_BY_ID = Object.fromEntries(AGENTS.map(a => [a.id, a]))

export const JOB_STATUSES = [
  'queued',
  'running',
  'awaiting_approval',
  'approved',
  'rejected',
  'done',
  'failed',
]

export function agentsForDepartment(deptId) {
  return AGENTS.filter(a => a.department === deptId)
}
