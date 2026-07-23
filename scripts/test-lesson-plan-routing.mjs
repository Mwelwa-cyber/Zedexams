/**
 * Guards the Lesson Plan Studio's dashboard-shell routing (the 2026-07
 * redesign): the studio renders INSIDE TeacherLayout at the canonical
 * /teacher/lesson-plans routes, the legacy standalone path redirects with its
 * query string intact, and no surface links to the legacy path any more.
 *
 * Text-level checks in the spirit of test-dashboard-v2-links.mjs — they pin
 * the routing architecture, not runtime behaviour (that's covered by the
 * studio Vitest specs).
 *
 * Run: node scripts/test-lesson-plan-routing.mjs   (npm run test:lesson-plan-routing)
 */
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const app = readFileSync(join(ROOT, 'src/App.jsx'), 'utf8')

let passed = 0
function ok(cond, msg) {
  assert.ok(cond, msg)
  passed++
}

/** The <Route> line for a given path attribute, or null. */
function routeLine(path) {
  const re = new RegExp(`<Route path="${path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"[^\\n]*`)
  const m = app.match(re)
  return m ? m[0] : null
}

// ── Canonical routes render the studio inside the dashboard shell ────────────

const newRoute = routeLine('/teacher/lesson-plans/new')
ok(newRoute, 'App.jsx declares /teacher/lesson-plans/new')
ok(
  newRoute.includes('<TeacherRoute>') && newRoute.includes('<LessonPlanStudio'),
  '/teacher/lesson-plans/new renders LessonPlanStudio inside TeacherRoute (TeacherLayout shell)',
)

const editRoute = routeLine('/teacher/lesson-plans/:lessonPlanId/edit')
ok(editRoute, 'App.jsx declares /teacher/lesson-plans/:lessonPlanId/edit')
ok(
  editRoute.includes('<TeacherRoute>') && editRoute.includes('<LessonPlanStudio'),
  'the edit route renders LessonPlanStudio inside TeacherRoute (TeacherLayout shell)',
)

const listRoute = routeLine('/teacher/lesson-plans')
ok(listRoute, 'App.jsx declares /teacher/lesson-plans (the Back-to-Lesson-Plans landing)')
ok(
  listRoute.includes('type=lesson_plans'),
  '/teacher/lesson-plans lands on the library filtered to lesson plans',
)

// ── Legacy path redirects (query preserved), never the bare studio ───────────

const legacyRoute = routeLine('/teacher/generate/lesson-plan')
ok(legacyRoute, 'the legacy /teacher/generate/lesson-plan route still exists (bookmarks)')
ok(
  legacyRoute.includes('LegacyLessonPlanStudioRedirect'),
  'the legacy path is a redirect, not a standalone LessonPlanStudio page',
)
ok(
  /function LegacyLessonPlanStudioRedirect\(\) \{[\s\S]*?useLocation\(\)[\s\S]*?lesson-plans\/new\$\{search\}/.test(app),
  'the legacy redirect preserves the query string (Teaching-Kit prefills, deep links)',
)

// ── No surface still links to the legacy path ────────────────────────────────

function walk(dir, hits) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    const st = statSync(p)
    if (st.isDirectory()) walk(p, hits)
    else if (/\.(jsx?|mjs)$/.test(name) && !p.endsWith(`src${join('/', 'App.jsx')}`)) {
      const text = readFileSync(p, 'utf8')
      if (text.includes('/teacher/generate/lesson-plan')) hits.push(p)
    }
  }
  return hits
}
const legacyLinkers = walk(join(ROOT, 'src'), []).filter((p) => !p.endsWith('App.jsx'))
ok(
  legacyLinkers.length === 0,
  `no src file links to the legacy lesson-plan path any more (found: ${legacyLinkers.join(', ') || 'none'})`,
)

// ── Sidebar config points at the canonical route with wide active state ──────

const config = readFileSync(
  join(ROOT, 'src/components/teacher/dashboardV2/dashboardV2Config.js'),
  'utf8',
)
ok(
  config.includes("to: '/teacher/lesson-plans/new', activePrefix: '/teacher/lesson-plans'"),
  'dashboardV2Config lesson-plan nav items target the canonical route with activePrefix',
)
ok(
  !config.includes('/teacher/generate/lesson-plan'),
  'dashboardV2Config has no legacy lesson-plan links left',
)

// ── The studio shell must not bring standalone full-page chrome ──────────────

const shell = readFileSync(
  join(ROOT, 'src/components/teacher/studio/StudioShell.jsx'),
  'utf8',
)
ok(
  !/\bh-screen\b/.test(shell),
  'StudioShell never locks the full viewport (it renders inside TeacherLayout)',
)

console.log(`lesson-plan routing: ${passed} checks passed`)
