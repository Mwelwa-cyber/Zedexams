/**
 * Pure tests for the admin command-palette search.
 *
 * Fixtures rather than the real registry: the registry imports icon
 * components, and this suite is a plain-node script. The real registry's
 * DESTINATIONS are covered by `npm run test:admin-links`; what is checked
 * here is the ranking behaviour, which is registry-independent.
 */
import assert from 'node:assert/strict'
import {
  RANK,
  moveHighlight,
  rankCommand,
  searchAdminCommands,
  tokenize,
} from './adminNavSearch.js'

const COMMANDS = [
  { id: '/admin', section: 'Overview', label: 'Dashboard', to: '/admin', keywords: 'home overview' },
  { id: '/admin/content', section: 'Content', label: 'Manage content', to: '/admin/content', keywords: 'library publish' },
  { id: '/admin/quizzes/new', section: 'Content', label: 'Create quiz', to: '/admin/quizzes/new', keywords: 'new test author' },
  { id: '/admin/payments', section: 'Billing', label: 'Payments', to: '/admin/payments', keywords: 'billing money refund lenco' },
  { id: '/admin/ai-costs', section: 'Reports', label: 'AI costs', to: '/admin/ai-costs', keywords: 'spend budget tokens' },
  { id: '/admin/activity', section: 'Operations', label: 'Activity log', to: '/admin/activity', keywords: 'audit history' },
  { id: 'cmd:logout', section: 'Switch', label: 'Sign out', command: 'logout', keywords: 'logout exit' },
]

const labels = (results) => results.map((r) => r.label)

// ── tokenize ────────────────────────────────────────────────────────
assert.deepEqual(tokenize(''), [])
assert.deepEqual(tokenize('   '), [])
assert.deepEqual(tokenize('  AI   Costs '), ['ai', 'costs'])
assert.deepEqual(tokenize(null), [])

// ── the regression this module exists for ───────────────────────────
// Both orders find the page. The old substring search matched only the
// contiguous "ai costs" and returned nothing for the reverse.
assert.deepEqual(labels(searchAdminCommands(COMMANDS, 'ai costs')), ['AI costs'])
assert.deepEqual(labels(searchAdminCommands(COMMANDS, 'costs ai')), ['AI costs'])

// A word that is on the item but not in its label — the whole point of
// `keywords`. Every one of these returned "No matches" before.
assert.deepEqual(labels(searchAdminCommands(COMMANDS, 'billing')), ['Payments'])
assert.deepEqual(labels(searchAdminCommands(COMMANDS, 'refund')), ['Payments'])
assert.deepEqual(labels(searchAdminCommands(COMMANDS, 'audit')), ['Activity log'])

// Shell actions are reachable from the palette at all.
assert.deepEqual(labels(searchAdminCommands(COMMANDS, 'logout')), ['Sign out'])

// ── ranking ─────────────────────────────────────────────────────────
// "quiz" appears in a label and nowhere else; "content" is an exact label.
assert.equal(searchAdminCommands(COMMANDS, 'quiz')[0].label, 'Create quiz')
assert.equal(searchAdminCommands(COMMANDS, 'payments')[0].label, 'Payments')

// A prefix of a label outranks an item that merely mentions the token.
// "pay" is a label prefix on Payments; nothing else matches at all.
assert.deepEqual(labels(searchAdminCommands(COMMANDS, 'pay')), ['Payments'])

// Exact label beats prefix beats word beats substring beats keyword-only.
assert.equal(rankCommand(COMMANDS[3], ['payments']), RANK.EXACT_LABEL)
assert.equal(rankCommand(COMMANDS[3], ['pay']), RANK.LABEL_PREFIX)
assert.equal(rankCommand(COMMANDS[2], ['quiz']), RANK.LABEL_WORD)
assert.equal(rankCommand(COMMANDS[3], ['billing']), RANK.OTHER)
assert.equal(rankCommand(COMMANDS[3], ['nonsense']), null)

// Multi-token initials across label words: "cr qu" → "Create quiz".
assert.equal(rankCommand(COMMANDS[2], ['cr', 'qu']), RANK.LABEL_WORD)

// Ties keep registry order, so typing does not reshuffle what is already
// on screen. Both Content items match "content"; Manage content is an
// exact label so it leads, and the ordering is deterministic.
const contentHits = searchAdminCommands(COMMANDS, 'content')
assert.equal(contentHits[0].label, 'Manage content')

// ── AND semantics ───────────────────────────────────────────────────
// A second token narrows. "content" matches two items via section; adding
// "create" leaves one.
assert.ok(searchAdminCommands(COMMANDS, 'content').length >= 2)
assert.deepEqual(labels(searchAdminCommands(COMMANDS, 'content create')), ['Create quiz'])

// ── path matching ───────────────────────────────────────────────────
// An admin who knows the URL can type it, hyphens and all.
assert.deepEqual(labels(searchAdminCommands(COMMANDS, '/admin/ai-costs')), ['AI costs'])
assert.deepEqual(labels(searchAdminCommands(COMMANDS, 'ai-costs')), ['AI costs'])

// ── empty query + limits ────────────────────────────────────────────
assert.deepEqual(searchAdminCommands(COMMANDS, ''), COMMANDS.slice(0, 7))
assert.equal(searchAdminCommands(COMMANDS, '', { emptyLimit: 3 }).length, 3)
assert.equal(searchAdminCommands(COMMANDS, 'a', { limit: 2 }).length, 2)
assert.deepEqual(searchAdminCommands(COMMANDS, 'zzzznope'), [])

// Defensive: a caller that has not loaded commands yet must not throw.
assert.deepEqual(searchAdminCommands(undefined, 'pay'), [])
assert.deepEqual(searchAdminCommands(null, ''), [])

// ── highlight wrapping ──────────────────────────────────────────────
assert.equal(moveHighlight(0, 1, 5), 1)
assert.equal(moveHighlight(4, 1, 5), 0, 'wraps forward off the end')
assert.equal(moveHighlight(0, -1, 5), 4, 'ArrowUp from the top reaches the last item')
assert.equal(moveHighlight(0, 1, 0), 0, 'empty result list never yields a stray index')
assert.equal(moveHighlight(undefined, 1, 3), 1)

console.log('admin-nav-search: all assertions passed')
