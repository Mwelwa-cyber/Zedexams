/**
 * Plain-node tests for the Teacher App Launcher pure logic.
 * Run: npm run test:launcher-core
 */
import assert from 'node:assert/strict'
import {
  applyChip,
  badgeIsPending,
  columnsForWidth,
  favouriteStudios,
  filterStudiosByPermission,
  lastOpenedLabel,
  pushRecent,
  recentLimitForWidth,
  recentStudios,
  resolveBadge,
  resolvePopoverPlacement,
  sanitizeIds,
  searchStudios,
  studioIdForPath,
  toggleFavourite,
} from './teacherLauncherCore.js'

let passed = 0
function test(name, fn) {
  fn()
  passed += 1
  console.log(`  ✓ ${name}`)
}

/*
 * Icon-free fixtures that mirror the real registry shape. The registry
 * itself imports lucide-react (not resolvable under plain node), so its
 * integrity is asserted in TeacherAppLauncher.spec.jsx (jsdom) instead.
 */
const TEACHER_STUDIOS = [
  { id: 'schemes', title: 'Schemes of Work', description: 'Map term pacing and outcomes.', route: '/teacher/generate/scheme-of-work', category: 'planning', countKey: 'scheme_of_work', badge: null, permission: 'teacher', keywords: ['scheme', 'sow'] },
  { id: 'weekly-focus', title: 'Weekly Focus', description: 'Plan the week day by day.', route: '/teacher/generate/weekly-forecast', category: 'planning', countKey: 'weekly_forecast', badge: null, permission: 'teacher', keywords: ['weekly'] },
  { id: 'lesson-plans', title: 'Lesson Plans', description: 'Prepare CBC lessons with stages.', route: '/teacher/lesson-plans/new', category: 'planning', countKey: 'lesson_plan', badge: null, permission: 'teacher', keywords: ['lesson'] },
  { id: 'notes', title: 'Notes Studio', description: 'Write clear CBC notes.', route: '/teacher/generate/notes', category: 'materials', countKey: 'notes', badge: null, permission: 'teacher', keywords: ['notes'] },
  { id: 'worksheets', title: 'Worksheets', description: 'Create classroom practice tasks.', route: '/teacher/generate/worksheet', category: 'materials', countKey: 'worksheet', badge: null, permission: 'teacher', keywords: ['worksheet'] },
  { id: 'assessment-papers', title: 'Assessment Paper Studio', description: 'Build tests, mocks and examinations.', route: '/teacher/assessment-papers/new', category: 'assessment', countKey: 'assessment', badge: 'new', permission: 'teacher', keywords: ['test', 'exam', 'mock'] },
  { id: 'rubrics', title: 'Rubrics', description: 'Create criteria-based rubrics.', route: '/teacher/generate/rubric', category: 'assessment', countKey: 'rubric', badge: null, permission: 'teacher', keywords: ['rubric'] },
  { id: 'curriculum', title: 'Curriculum', description: 'Explore the CBC curriculum.', route: '/teacher/curriculum', category: 'setup', countKey: null, badge: null, permission: 'teacher', keywords: ['curriculum'] },
  { id: 'class-register', title: 'Class Register', description: 'Mark daily attendance.', route: '/teacher/attendance', category: 'setup', countKey: null, badge: null, permission: 'teacher', keywords: ['attendance'] },
]
const STUDIO_BY_ID = TEACHER_STUDIOS.reduce((a, s) => { a[s.id] = s; return a }, {})

// ── Permissions ─────────────────────────────────────────────────────────
test('permission filter drops teacher tools for non-teachers', () => {
  assert.equal(filterStudiosByPermission(TEACHER_STUDIOS, { isTeacher: true }).length, TEACHER_STUDIOS.length)
  assert.equal(filterStudiosByPermission(TEACHER_STUDIOS, { isTeacher: false }).length, 0)
})

// ── Search ──────────────────────────────────────────────────────────────
test('search matches title, keyword and description; empty returns all', () => {
  assert.equal(searchStudios(TEACHER_STUDIOS, '').length, TEACHER_STUDIOS.length)
  const lesson = searchStudios(TEACHER_STUDIOS, 'lesson')
  assert.equal(lesson[0].id, 'lesson-plans')
  // keyword-only hit ("mock" is a keyword of assessment-papers)
  const mock = searchStudios(TEACHER_STUDIOS, 'mock')
  assert.ok(mock.some((s) => s.id === 'assessment-papers'))
  // case + whitespace tolerant
  assert.ok(searchStudios(TEACHER_STUDIOS, '  ATTENDANCE ').some((s) => s.id === 'class-register'))
})

test('exact title outranks partial', () => {
  const res = searchStudios(TEACHER_STUDIOS, 'rubrics')
  assert.equal(res[0].id, 'rubrics')
})

// ── Badges ──────────────────────────────────────────────────────────────
test('resolveBadge prioritises live saved count over static new', () => {
  const s = STUDIO_BY_ID['assessment-papers'] // has badge:'new' + countKey
  assert.deepEqual(resolveBadge(s, { assessment: 3 }), { type: 'saved', label: '3 saved', count: 3 })
  assert.deepEqual(resolveBadge(s, { assessment: 0 }), { type: 'new', label: 'New' })
  assert.deepEqual(resolveBadge(s, null), { type: 'new', label: 'New' })
})

test('resolveBadge returns null when nothing to show', () => {
  assert.equal(resolveBadge(STUDIO_BY_ID['schemes'], { scheme_of_work: 0 }), null)
  assert.equal(resolveBadge(STUDIO_BY_ID['curriculum'], {}), null)
})

test('badgeIsPending only while a count-bearing studio has null counts', () => {
  assert.equal(badgeIsPending(STUDIO_BY_ID['schemes'], null), true)
  assert.equal(badgeIsPending(STUDIO_BY_ID['schemes'], {}), false)
  assert.equal(badgeIsPending(STUDIO_BY_ID['curriculum'], null), false)
})

test('a live warning outranks saved count and New', () => {
  const s = STUDIO_BY_ID['assessment-papers']
  const warned = resolveBadge(s, { assessment: 3 }, { warnings: new Set(['assessment-papers']) })
  assert.deepEqual(warned, { type: 'warning', label: 'Needs attention' })
  // arrays work too; other studios unaffected
  assert.equal(resolveBadge(STUDIO_BY_ID['schemes'], {}, { warnings: ['assessment-papers'] }), null)
})

// ── Route → studio matching ─────────────────────────────────────────────
test('studioIdForPath maps studio routes, subpages and aliases', () => {
  const studios = [
    ...TEACHER_STUDIOS,
    { id: 'sba', title: 'SBA', description: 'School based assessment.', route: '/teacher/sba', routeAliases: ['/teacher/generate/sba', '/teacher/generate/sba-tracker'], category: 'assessment', countKey: null, badge: null, permission: 'teacher', keywords: [] },
  ]
  // exact route + '/new' stripped
  assert.equal(studioIdForPath('/teacher/lesson-plans/new', studios), 'lesson-plans')
  // subpages of the same studio
  assert.equal(studioIdForPath('/teacher/lesson-plans/abc123/edit', studios), 'lesson-plans')
  assert.equal(studioIdForPath('/teacher/assessment-papers/xyz/edit', studios), 'assessment-papers')
  // query strings and trailing slashes ignored
  assert.equal(studioIdForPath('/teacher/generate/worksheet/?from=nav', studios), 'worksheets')
  // aliases count as the studio
  assert.equal(studioIdForPath('/teacher/generate/sba', studios), 'sba')
  assert.equal(studioIdForPath('/teacher/generate/sba-tracker', studios), 'sba')
  // boundary: '/teacher/generate/sba' must NOT swallow unlisted siblings
  assert.equal(studioIdForPath('/teacher/generate/sba-planner', studios), null)
  // non-studio pages record nothing
  assert.equal(studioIdForPath('/teacher/library', studios), null)
  assert.equal(studioIdForPath('/teacher', studios), null)
})

// ── Favourites ──────────────────────────────────────────────────────────
test('toggleFavourite adds to front and removes', () => {
  let favs = []
  favs = toggleFavourite(favs, 'schemes')
  assert.deepEqual(favs, ['schemes'])
  favs = toggleFavourite(favs, 'notes')
  assert.deepEqual(favs, ['notes', 'schemes'])
  favs = toggleFavourite(favs, 'schemes')
  assert.deepEqual(favs, ['notes'])
})

test('favouriteStudios drops unknown ids, keeps order', () => {
  const list = favouriteStudios(['notes', 'ghost', 'schemes'], STUDIO_BY_ID)
  assert.deepEqual(list.map((s) => s.id), ['notes', 'schemes'])
})

test('sanitizeIds de-dupes and drops unknowns', () => {
  assert.deepEqual(sanitizeIds(['notes', 'notes', 'x'], STUDIO_BY_ID), ['notes'])
})

// ── Recents ─────────────────────────────────────────────────────────────
test('pushRecent moves to front, de-dupes and caps', () => {
  let r = []
  r = pushRecent(r, 'a')
  r = pushRecent(r, 'b')
  r = pushRecent(r, 'a')
  assert.deepEqual(r, ['a', 'b'])
  r = pushRecent(['1', '2', '3'], '4', 3)
  assert.deepEqual(r, ['4', '1', '2'])
})

test('recentStudios respects limit and order', () => {
  const list = recentStudios(['worksheets', 'schemes', 'notes'], STUDIO_BY_ID, 2)
  assert.deepEqual(list.map((s) => s.id), ['worksheets', 'schemes'])
})

// ── Chip filtering ──────────────────────────────────────────────────────
test('applyChip: all / favourites / recent', () => {
  const opts = { favourites: ['notes'], recents: ['schemes', 'notes'], byId: STUDIO_BY_ID }
  assert.equal(applyChip(TEACHER_STUDIOS, { chip: 'all', ...opts }).length, TEACHER_STUDIOS.length)
  assert.deepEqual(
    applyChip(TEACHER_STUDIOS, { chip: 'favourites', ...opts }).map((s) => s.id),
    ['notes'],
  )
  assert.deepEqual(
    applyChip(TEACHER_STUDIOS, { chip: 'recent', ...opts }).map((s) => s.id),
    ['schemes', 'notes'],
  )
})

test('applyChip recent stays empty when no history (UI shows empty state)', () => {
  const res = applyChip(TEACHER_STUDIOS, { chip: 'recent', recents: [], byId: STUDIO_BY_ID })
  assert.equal(res.length, 0)
})

// ── Responsive ──────────────────────────────────────────────────────────
test('columnsForWidth follows the breakpoint ladder', () => {
  assert.equal(columnsForWidth(320), 4)
  assert.equal(columnsForWidth(479), 4)
  assert.equal(columnsForWidth(480), 4)
  assert.equal(columnsForWidth(639), 4)
  assert.equal(columnsForWidth(768), 5)
  assert.equal(columnsForWidth(1024), 6)
  assert.equal(columnsForWidth(1440), 7)
})

test('recentLimitForWidth always fills exactly one grid row', () => {
  assert.equal(recentLimitForWidth(360), 4)
  assert.equal(recentLimitForWidth(800), 5)
  assert.equal(recentLimitForWidth(1100), 6)
  assert.equal(recentLimitForWidth(1440), 7)
})

// ── Popover placement ────────────────────────────────────────────────────
const VP = { width: 1000, height: 800 }
const SIZE = { width: 280, height: 200 }

test('popover opens to the right with room', () => {
  const anchor = { top: 100, left: 100, right: 180, bottom: 180, width: 80, height: 80 }
  const p = resolvePopoverPlacement(anchor, VP, SIZE)
  assert.equal(p.side, 'right')
  assert.ok(p.left >= 180)
  assert.ok(p.left + SIZE.width <= VP.width)
})

test('popover flips left near the right edge', () => {
  const anchor = { top: 100, left: 900, right: 980, bottom: 180, width: 80, height: 80 }
  const p = resolvePopoverPlacement(anchor, VP, SIZE)
  assert.equal(p.side, 'left')
  assert.ok(p.left >= 8)
})

test('popover stays inside the viewport vertically', () => {
  const anchor = { top: 760, left: 100, right: 180, bottom: 790, width: 80, height: 30 }
  const p = resolvePopoverPlacement(anchor, VP, SIZE)
  assert.ok(p.top + SIZE.height <= VP.height - 8)
  assert.ok(p.top >= 8)
})

// ── Labels ──────────────────────────────────────────────────────────────
test('lastOpenedLabel formats relative time', () => {
  const now = Date.UTC(2026, 6, 23)
  assert.equal(lastOpenedLabel(now, now), 'today')
  assert.equal(lastOpenedLabel(now - 24 * 3600 * 1000, now), 'yesterday')
  assert.equal(lastOpenedLabel(now - 3 * 24 * 3600 * 1000, now), '3 days ago')
  assert.equal(lastOpenedLabel(0, now), null)
})

console.log(`\nteacherLauncherCore: ${passed} tests passed`)
