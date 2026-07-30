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
import { join } from 'node:path'
import { ROOT, readSource, TEACHER_ROUTES_PATH } from './lib/declaredRoutes.mjs'

// The /teacher/* routes are declared in the teacher route table, not inline
// in App.jsx — see components/teacher/teacherRoutes.jsx.
const routes = readSource(TEACHER_ROUTES_PATH)

let passed = 0
function ok(cond, msg) {
  assert.ok(cond, msg)
  passed++
}

/** The route-table declaration for a given path, or null. */
function routeLine(path) {
  const re = new RegExp(`^.*'${path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}'.*$`, 'm')
  const m = routes.match(re)
  return m ? m[0] : null
}

// ── Canonical routes render the studio inside the dashboard shell ────────────
// `page(...)` is the table's shell-wrapped constructor (TeacherRoute →
// TeacherLayout); teacherRoutes.spec.jsx proves that by rendering it.

const newRoute = routeLine('/teacher/lesson-plans/new')
ok(newRoute, 'the route table declares /teacher/lesson-plans/new')
ok(
  newRoute.includes('page(') && newRoute.includes('<LessonPlanStudio'),
  '/teacher/lesson-plans/new renders LessonPlanStudio inside the shell',
)

const editRoute = routeLine('/teacher/lesson-plans/:lessonPlanId/edit')
ok(editRoute, 'the route table declares /teacher/lesson-plans/:lessonPlanId/edit')
ok(
  editRoute.includes('page(') && editRoute.includes('<LessonPlanStudio'),
  'the edit route renders LessonPlanStudio inside the shell',
)

const listRoute = routeLine('/teacher/lesson-plans')
ok(listRoute, 'the route table declares /teacher/lesson-plans (the Back-to-Lesson-Plans landing)')
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
  /function LegacyLessonPlanStudioRedirect\(\) \{[\s\S]*?useLocation\(\)[\s\S]*?lesson-plans\/new\$\{search\}/.test(routes),
  'the legacy redirect preserves the query string (Teaching-Kit prefills, deep links)',
)

// ── No surface still links to the legacy path ────────────────────────────────

function walk(dir, hits) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    const st = statSync(p)
    if (st.isDirectory()) walk(p, hits)
    else if (/\.(jsx?|mjs)$/.test(name) && !p.endsWith('teacherRoutes.jsx')) {
      const text = readFileSync(p, 'utf8')
      if (text.includes('/teacher/generate/lesson-plan')) hits.push(p)
    }
  }
  return hits
}
// teacherRoutes.jsx is excluded above: it DECLARES the legacy redirect, so
// mentioning the path there is the fix, not the bug being looked for.
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
