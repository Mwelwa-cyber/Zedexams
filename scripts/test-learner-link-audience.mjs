#!/usr/bin/env node
/**
 * No surface outside the learner portal may LINK to a page the learner
 * portal alone will open.
 *
 * ## Why this exists, and why the narrower guard was not enough
 *
 * `src/utils/navigation.js` states the rule: `LearnerOnlyRoute`'s refusal
 * card ("Teacher accounts stay in the teacher portal") is the right answer
 * when somebody types or bookmarks a learner URL, and the WRONG answer when
 * the app itself pointed them at it.
 *
 * #2575 enforced that for the two NAV REGISTRIES — the learner tab bar and
 * `Navbar`'s role-branched menu — and shipped `test:navbar-audience` to keep
 * them honest. It was reported still happening the same day, because the bug
 * does not only live in navigation registries. It lives in ORDINARY PAGE
 * CONTENT, on the public routes that mount learner chrome:
 *
 *   - `PastPapersHub` drew a full-width "2026 Exam Timetable" gradient card
 *     linking to `/timetable`, on the public `/papers` hub a teacher browses;
 *   - `GamesShell`'s header showed a signed-in teacher a button with their own
 *     first name on it, linking to `/dashboard`.
 *
 * Both are one tap from the same refusal card, and neither is a nav registry,
 * so the narrower guard reported green over both. Hence this one: it reads
 * EVERY file in `src/`, resolves each link destination through App.jsx's
 * redirects, and requires every learner-only destination outside the learner
 * portal to be either fixed or listed below with a reason.
 *
 * ## Shape
 *
 * An allowlist ratchet, like `test:learner-chrome`. A new link to a
 * learner-only path fails the build until somebody decides what it is:
 * genuinely fine (the file only renders behind the guard), or the bug again.
 * The list only shrinks.
 *
 * ## What it cannot see
 *
 * Destinations built at runtime — `to={somePath}`, a template literal with an
 * expression — are not classified. They are COUNTED AND PRINTED rather than
 * passed over silently, because a guard that quietly covers less than it
 * claims reads exactly like one that found nothing wrong. Keep a route a
 * plain string literal where you can.
 *
 * Run: npm run test:learner-link-audience
 */
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { isLearnerOnlyPath } from '../src/utils/navigation.js'
import { readSource } from './lib/declaredRoutes.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const app = readSource('src/app/App.jsx')

/* ── One-hop redirects, because that is how /lessons hid ──────────────── */

const redirects = new Map(
  [...app.matchAll(/<Route\s+path="([^"]+)"\s+element=\{<Navigate\s+to="([^"]+)"/g)].map((m) => [m[1], m[2]]),
)
assert.ok(redirects.size >= 10, `Parsed only ${redirects.size} <Navigate> routes — parser drifted?`)
const landsOn = (path) => redirects.get(path) ?? path

/* ── Where a learner-only link is expected ─────────────────────────────
 *
 * Two legitimate cases, and they are checked differently.
 *
 * 1. LEARNER_ONLY_AREAS — directories whose files render only from a
 *    <LearnerOnlyRoute> page. Their reader is a learner by construction, so
 *    a link to `/progress` there is just navigation.
 *
 *    LIMIT, stated rather than hidden: this is a DIRECTORY judgement, not a
 *    module-graph one. A component that moves out of one of these areas onto
 *    a public page takes its exemption with it and this guard will not see
 *    it. `test:import-boundaries` is the thing that resolves the real graph;
 *    if that ever grows a "who mounts this" answer, derive this from it.
 *
 * 2. GATED — files OUTSIDE those areas where the link is real but guarded on
 *    the account. Text alone cannot tell a gated link from an ungated one —
 *    `PastPapersHub` still contains the literal `to="/timetable"` after being
 *    fixed, because what changed is whether the card renders. So each entry
 *    here must name the predicate, and the file must actually contain it: rip
 *    the gate out and the build fails rather than quietly passing.
 */
const LEARNER_ONLY_AREAS = [
  ['src/features/learnerHome/', 'the learner shell, Home and its sections'],
  ['src/features/learnerProgress/', '/progress and /study-plan'],
  ['src/features/learnerSettings/', 'learner settings, mounted from the learner shell'],
  ['src/features/learnerOnboarding/', 'the setup wizard behind LearnerSetupGate'],
  ['src/features/learnerDashboard/', 'the learner profile and the timetable PDF viewer'],
  ['src/features/dailyQuiz/pages/', '/daily and its leaderboard'],
  ['src/features/dailyExams/pages/', '/exam-results, kept so past attempts stay readable'],
  ['src/features/quiz/pages/', 'the learner quiz runtime'],
  ['src/features/notifications/pages/', 'the learner notification centre'],
  ['src/features/notes/pages/Learner', 'the learner notes list and reader'],
  ['src/features/notes/pages/ReaderPreview', '/notes/reader-preview'],
  ['src/features/lessons/', '/lessons/:lessonId and the players it mounts'],
  ['src/features/examTimetable/pages/', '/timetable itself'],
]

const GATED = new Map([
  ['src/app/App.jsx', { needs: null, why: 'the route table itself — <Route>/<Navigate> declarations, not navigation' }],
  ['src/app/guards/LearnerSetupGate.jsx', { needs: null, why: 'runs INSIDE LearnerOnlyRoute; /setup is the wizard it redirects to' }],
  ['src/shared/components/ComingSoon.jsx', { needs: null, why: 'rendered only by LessonLibrary and QuizList, both LearnerOnlyRoute pages' }],
  ['src/components/layout/Navbar.jsx', { needs: 'canOpenLearnerRoutes', why: 'the /search link is gated (!isAdmin && !isTeacher); the menu and tab bar are covered by test:navbar-audience' }],
  ['src/features/marketing/components/GuardianPricingNotice.jsx', { needs: null, why: 'Plans renders it only `if (isMinorLearner)` — a learner, for whom /dashboard is correct' }],
  ['src/features/subscription/pages/AskGrownUpPage.jsx', { needs: null, why: 'the under-18 guardian-unlock flow; nothing routes a teacher here, and typing the URL is the case the refusal card is FOR' }],
  ['src/features/papers/pages/PastPapersHub.jsx', { needs: 'canOpenLearnerRoutes', why: 'public hub: the exam-timetable card renders only for an account that can open /timetable' }],
])

// `GamesShell` is deliberately NOT here. Its header home button was the second
// half of this bug, and the fix made its destination `to={homePath}` — built at
// runtime, so this guard cannot classify it either way and an entry would be
// stale the moment it was written. `GamesShell.spec.jsx` renders it per role
// and reads the href instead, which is the only thing that can see a computed
// destination.
const inLearnerArea = (rel) => LEARNER_ONLY_AREAS.some(([prefix]) => rel.startsWith(prefix))

/* ── Walk src/ ─────────────────────────────────────────────────────────── */

function* sourceFiles(dir) {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules') continue
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) { yield* sourceFiles(full); continue }
    if (!/\.jsx?$/.test(entry)) continue
    if (/\.(spec|test)\.jsx?$/.test(entry)) continue
    yield full
  }
}

// `to="/x"`, `to={'/x'}`, `href="/x"`, `navigate('/x')`, `navigate("/x")`.
const LINK = /(?:\bto=|\bhref=|\bnavigate\()\s*[{(]?\s*['"](\/[A-Za-z0-9\-_/]*)['"]/g
// A destination the parser cannot resolve to a literal.
const DYNAMIC = /(?:\bto=\{(?!\s*['"])|\bnavigate\(\s*`)/g

const offences = []
let scanned = 0
let dynamic = 0
const gatedHits = new Set()
const areaHits = new Set()

for (const full of sourceFiles(join(root, 'src'))) {
  const rel = relative(root, full)
  const src = readFileSync(full, 'utf8')
  scanned += 1
  src.split('\n').forEach((line, i) => {
    dynamic += [...line.matchAll(DYNAMIC)].length
    for (const m of line.matchAll(LINK)) {
      const destination = landsOn(m[1])
      if (!isLearnerOnlyPath(destination)) continue
      if (inLearnerArea(rel)) { areaHits.add(rel); continue }
      if (GATED.has(rel)) { gatedHits.add(rel); continue }
      offences.push({ rel, line: i + 1, raw: m[1], destination })
    }
  })
}

assert.ok(scanned > 500, `Scanned only ${scanned} source files — walker drifted?`)

/* ── 1. Nothing unlisted links into the learner portal ────────────────── */

assert.deepEqual(
  offences.map((o) => `${o.rel}:${o.line} → ${o.raw}${o.destination !== o.raw ? ` (redirects to ${o.destination})` : ''}`),
  [],
  'These link to a page LearnerOnlyRoute refuses. If the surface is reachable by a teacher, a '
  + 'guardian or a signed-out visitor, that link is one tap from "Teacher accounts stay in the '
  + 'teacher portal" — retarget it with getRoleLandingPath, or drop it for accounts that cannot '
  + 'open it (see PastPapersHub\'s TimetableRow and GamesShell for one of each). Only if the file '
  + 'genuinely renders behind the guard does it belong in ALLOWED, with the reason written out.',
)

/* ── 2. Every gated entry still carries its gate ──────────────────────── */

// The half a text-level guard would otherwise get wrong: the literal stays in
// the file after the fix, so only the PREDICATE's presence distinguishes a
// gated link from the bug.
for (const [file, { needs, why }] of GATED) {
  if (!needs) continue
  assert.match(
    readFileSync(join(root, file), 'utf8'),
    new RegExp(needs),
    `${file} is allowed to link into the learner portal because ${why}, but no longer mentions `
    + `${needs}. Either the gate was removed — in which case this is the refusal-card bug again — `
    + 'or the gate moved and this entry needs rewriting to name what replaced it.',
  )
}

/* ── 3. Both lists only shrink ────────────────────────────────────────── */

const staleGated = [...GATED.keys()].filter((f) => !gatedHits.has(f)).sort()
assert.deepEqual(
  staleGated,
  [],
  `GATED lists ${staleGated.join(', ')}, which no longer links to a learner-only path at all. `
  + 'Remove the entry — a list that keeps finished work stops meaning anything, which is how a '
  + 'ratchet quietly stops being one.',
)

const staleAreas = LEARNER_ONLY_AREAS
  .filter(([prefix]) => ![...areaHits].some((f) => f.startsWith(prefix)))
  .map(([prefix]) => prefix)
assert.deepEqual(
  staleAreas,
  [],
  `LEARNER_ONLY_AREAS lists ${staleAreas.join(', ')}, where nothing links into the learner portal `
  + 'any more. A prefix that exempts nothing is a hole waiting for something to fall into it.',
)

/* ── 4. The guard can fail ────────────────────────────────────────────── */

// The two real regressions, in the shapes they actually had.
assert.ok(isLearnerOnlyPath(landsOn('/timetable')), 'Mutation check: the PastPapersHub card destination must classify')
assert.ok(isLearnerOnlyPath(landsOn('/dashboard')), 'Mutation check: the GamesShell button destination must classify')
// …and through a redirect, which is how /lessons escaped the first sweep.
assert.equal(landsOn('/lessons'), '/notes')
assert.ok(isLearnerOnlyPath(landsOn('/lessons')), 'Mutation check: a redirect hop must still classify')

console.log(
  `✓ learner-link audience — ${scanned} source files scanned, 0 unlisted links into the learner `
  + `portal; ${areaHits.size} file(s) inside learner-only areas, ${gatedHits.size} gated (each with a `
  + `reason, and each gate re-checked); ${dynamic} runtime-built destination(s) not classified`,
)
