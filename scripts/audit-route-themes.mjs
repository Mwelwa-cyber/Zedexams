#!/usr/bin/env node
/* global console, process */
/**
 * Step 5 — every route in the router, resolved to the themed container it
 * renders inside.
 *
 * WHY THIS AND NOT "VISIT ALL 201 ROUTES"
 * Most routes are role-gated behind real Firebase auth, so a browser walk
 * needs a stubbed session per role and still only proves the routes the stub
 * can reach. What actually determines whether a route is correct in the dark
 * is which themed CONTAINER its tree carries — `.studio-theme`, `.studio-v2`,
 * `.notes-studio`, `.moe-calendar`, `.force-light-theme`, `.vstudio`,
 * `.ss-root`, `.qe-page`, or none of those, meaning the global reading
 * tokens. Each of those containers is measured in all four theme combinations
 * by `npm run audit:dark`.
 *
 * So this resolves route → component → container, and the verdict on each row
 * is the measured verdict for its container. A route whose container has no
 * measurement is reported as UNKNOWN rather than assumed fine — that is the
 * whole value of the exercise, and the number to drive to zero.
 */
import { readFileSync, existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

const ROOT = process.cwd()
const app = readFileSync(join(ROOT, 'src/app/App.jsx'), 'utf8')

/* ── route sources ────────────────────────────────────────────────────────
 * Routes are declared in more than one place. App.jsx has most of them as
 * <Route> elements; the teacher area declares its own as DATA in
 * teacherRoutes.jsx, which App.jsx maps into elements (#2033).
 *
 * That second source is why this list is asserted rather than assumed. When
 * the teacher routes moved out of App.jsx, this audit went from 201 routes to
 * 132 and still exited 0 — it did not report the 69 it had stopped seeing,
 * because a route it cannot see is not a route it flags. Silently auditing
 * two thirds of the router is worse than not auditing it, so a shrinking
 * count is now a failure. */
const TEACHER_ROUTES_FILE = join(ROOT, 'src/app/routes/teacherRoutes.jsx')
const teacherSrc = existsSync(TEACHER_ROUTES_FILE) ? readFileSync(TEACHER_ROUTES_FILE, 'utf8') : ''

const routes = []
for (const m of app.matchAll(/<Route\s+path="([^"]+)"/g)) {
  const start = m.index
  const chunk = app.slice(start, start + 600)
  const el = chunk.match(/element=\{([\s\S]*?)\}\s*\/?>/)
  routes.push({ path: m[1], element: el ? el[1].replace(/\s+/g, ' ').trim() : '', src: 'App.jsx' })
}
// teacherRoutes.jsx declares routes through three helpers — page(), bare()
// and redirect() — and the path may sit on the next line, so the newline is
// matched rather than assumed away. All three are read: missing `redirect`
// alone would have lost 13 routes without a word.
for (const m of teacherSrc.matchAll(/\b(?:page|bare|redirect)\(\s*\n?\s*'([^']+)'\s*,\s*([\s\S]{0,300}?)(?:,\s*\n?\s*'|\)\s*,\s*\n)/g)) {
  routes.push({ path: m[1], element: m[2].replace(/\s+/g, ' ').trim(), src: 'teacherRoutes.jsx' })
}

/* ── component name → file ────────────────────────────────────────────── */
const lazyMap = new Map()
// teacherRoutes.jsx's specifiers are relative to ITS directory, so they are
// rebased onto src/ before being stored — otherwise every teacher page
// resolves to nothing and reports as unmeasured.
const REBASE = { 'App.jsx': 'app/', 'teacherRoutes.jsx': 'app/routes/' }
for (const [src, text] of [['App.jsx', app], ['teacherRoutes.jsx', teacherSrc]]) {
  const rebase = (spec) => spec.startsWith('./')
    ? './' + REBASE[src] + spec.slice(2)
    : spec.startsWith('../') ? './' + join(REBASE[src], spec).replace(/^\.\//, '') : spec
  for (const m of text.matchAll(/const\s+(\w+)\s*=\s*lazy\(\s*\(\)\s*=>\s*import\(\s*['"]([^'"]+)['"]/g)) {
    if (!lazyMap.has(m[1])) lazyMap.set(m[1], rebase(m[2]))
  }
  for (const m of text.matchAll(/^import\s+(\w+)\s+from\s+['"](\.[^'"]+)['"]/gm)) {
    if (!lazyMap.has(m[1])) lazyMap.set(m[1], rebase(m[2]))
  }
}

function resolveFile(spec) {
  const base = resolve(ROOT, 'src', spec.replace(/^\.\//, ''))
  for (const ext of ['.jsx', '.js', '/index.jsx', '/index.js']) {
    if (existsSync(base + ext)) return base + ext
  }
  return existsSync(base) ? base : null
}

/* ── file (and what it renders) → themed container ────────────────────── */
// Ordered: the first match wins, most specific first.
const CONTAINERS = [
  [/\bstudio-v2\b/, 'Assessment Paper Studio (.studio-v2)'],
  [/\blps-game\b|lessonStudio\.css/, 'Lesson Plan Studio (.lps-*)'],
  [/\bss-root\b/, 'Syllabi Studio (.ss-root)'],
  [/\bqe-page\b|editor\/editor\.css/, 'Quiz editor (.qe-page)'],
  [/\bmoe-calendar\b/, 'MoE calendar (.moe-calendar)'],
  [/\bnotes-studio\b/, 'Notes / lessons (.notes-studio)'],
  [/\bvstudio\b/, 'Visual Studio (.vstudio)'],
  [/\bforce-light-theme\b/, 'Games / quizzes (.force-light-theme)'],
  [/\btdv2\b/, 'Dashboard V2 (.tdv2)'],
  [/\bmarketing-page\b/, 'Marketing (pinned light)'],
  [/\bstudio-theme\b/, 'Teacher studio shell (.studio-theme)'],
]

// The verdict for each container, from `npm run audit:dark`. Kept as data so
// the two stay legibly in step; the audit is the thing that establishes them.
const VERDICT = {
  'Assessment Paper Studio (.studio-v2)': 'ok',
  'Lesson Plan Studio (.lps-*)': 'ok',
  'Syllabi Studio (.ss-root)': 'ok',
  'Quiz editor (.qe-page)': 'light-by-design',
  'MoE calendar (.moe-calendar)': 'ok',
  'Notes / lessons (.notes-studio)': 'ok',
  'Visual Studio (.vstudio)': 'ok',
  'Games / quizzes (.force-light-theme)': 'ok',
  'Dashboard V2 (.tdv2)': 'ok',
  'Marketing (pinned light)': 'light-by-design',
  'Teacher studio shell (.studio-theme)': 'ok',
  'Reading tokens (theme-*)': 'ok',
}

const cache = new Map()
function containerFor(file, depth = 0) {
  if (!file || depth > 2) return null
  if (cache.has(file)) return cache.get(file)
  cache.set(file, null) // cycle guard
  let src
  try { src = readFileSync(file, 'utf8') } catch { return null }

  for (const [re, name] of CONTAINERS) {
    if (re.test(src)) { cache.set(file, name); return name }
  }
  // Follow local imports one or two levels — a page often delegates its shell
  // to a layout or a single child component.
  for (const m of src.matchAll(/from\s+['"](\.[^'"]+)['"]/g)) {
    const child = resolveFile(join(dirname(file).replace(resolve(ROOT, 'src'), '.'), m[1]))
      || resolveFile(m[1])
    const found = containerFor(child, depth + 1)
    if (found) { cache.set(file, found); return found }
  }
  cache.set(file, null)
  return null
}

// Components defined INSIDE App.jsx that render a <Navigate> are redirects.
// Detected by what they return rather than by a name convention, so a redirect
// called something else is still classified correctly — and a component that
// stops being a redirect stops being excused.
// Scanned in BOTH sources: the legacy assessment/lesson-plan redirects moved
// to teacherRoutes.jsx with the rest of the teacher area, and looking for them
// only in App.jsx left six routes reported as unmeasured surfaces when they
// render no surface at all.
const localRedirects = new Set(['Navigate'])
for (const text of [app, teacherSrc]) {
  for (const m of text.matchAll(/function\s+(\w+)\s*\([^)]*\)\s*\{/g)) {
    const body = text.slice(m.index, text.indexOf('\n}', m.index))
    if (/<Navigate\b/.test(body) && !/<(?!Navigate)[A-Z]\w+/.test(body)) localRedirects.add(m[1])
  }
}

const rows = []
const REDIRECTS = localRedirects
for (const r of routes) {
  // Most routes wrap the page in one or more guards —
  // `<ProtectedRoute><TeacherRoute><SchoolCalendar /></TeacherRoute></…>` —
  // so the FIRST tag is the guard and tells us nothing about theming. Take the
  // innermost tag that actually resolves to a page component.
  const tags = [...r.element.matchAll(/<(\w+)/g)].map((m) => m[1])
  const name = [...tags].reverse().find((t) => lazyMap.has(t)) || tags[tags.length - 1] || ''
  if (REDIRECTS.has(name)) {
    rows.push({ ...r, name, file: null, container: 'Redirect (renders no page)', verdict: 'n/a' })
    continue
  }
  const spec = lazyMap.get(name)
  let file = spec ? resolveFile(spec) : null
  let container = file ? containerFor(file) : null

  // A component defined in App.jsx that renders OTHER page components is a
  // dispatcher, not a page — `/` picks between Marketing, the loader and a
  // redirect depending on auth state. Resolve it through what it can render:
  // it is covered when every branch is.
  if (!file && !REDIRECTS.has(name)) {
    const text = [app, teacherSrc].find((t) => new RegExp(`function\\s+${name}\\s*\\(`).test(t)) || app
    const def = text.match(new RegExp(`function\\s+${name}\\s*\\([^)]*\\)\\s*\\{`))
    if (def) {
      const body = text.slice(def.index, text.indexOf('\n}', def.index))
      const targets = [...new Set([...body.matchAll(/<([A-Z]\w+)/g)].map((m) => m[1]))]
        .filter((t) => lazyMap.has(t))
      const cs = targets.map((t) => {
        const f = resolveFile(lazyMap.get(t))
        return f ? (containerFor(f) || 'Reading tokens (theme-*)') : null
      })
      if (cs.length && cs.every(Boolean)) {
        container = `Dispatcher → ${[...new Set(cs)].join(' / ')}`
        file = 'src/app/App.jsx'
      }
    }
  }
  const resolved = container || (file ? 'Reading tokens (theme-*)' : null)
  rows.push({ ...r, name, file, container: resolved, verdict: resolved ? (VERDICT[resolved] || 'ok') : 'UNKNOWN' })
}

const byContainer = {}
for (const r of rows) {
  const k = r.container || 'UNRESOLVED'
  ;(byContainer[k] ||= []).push(r)
}

/* ── Did we read everything each source declares? ─────────────────────────
 * A hand-set minimum goes stale the moment routes are legitimately
 * consolidated, and then the honest move looks like lowering the number. So
 * each source is checked against ITSELF: count the declarations in the file,
 * count what the parser got, and require them to match. That catches a
 * regex that silently stops matching one shape — which is how `redirect()`
 * was missed on the first attempt here, losing 13 routes without a word —
 * and it needs no maintenance when routes are added or removed.
 *
 * The floor stays as a second, cruder net for a whole SOURCE disappearing:
 * a file this script does not know about cannot be self-checked. */
const declared = {
  'App.jsx': (app.match(/<Route\s+path="/g) || []).length,
  // Every page()/bare()/redirect() CALL, minus the one that is the redirect
  // helper's own definition rather than a route.
  'teacherRoutes.jsx': (teacherSrc.match(/^\s*(?:page|bare|redirect)\(/gm) || []).length
    - (/const redirect = \([^)]*\) =>\s*\n?\s*bare\(/.test(teacherSrc) ? 1 : 0),
}
const MIN_ROUTES = 150
console.log(`# Step 5 — route theming\n`)
const bySrc = rows.reduce((a, r) => ((a[r.src] = (a[r.src] || 0) + 1), a), {})
console.log(`${rows.length} routes: ${Object.entries(bySrc).map(([k, v]) => `${v} in ${k}`).join(', ')}.\n`)
console.log('| Themed container | Routes | Verdict |')
console.log('|---|---|---|')
for (const [k, v] of Object.entries(byContainer).sort((a, b) => b[1].length - a[1].length)) {
  const verdict = k === 'UNRESOLVED' ? '**UNKNOWN — not measured**'
    : k.startsWith('Dispatcher') ? 'covered via every branch it can render'
    : k === 'Redirect (renders no page)' ? 'n/a — redirects to another route'
    : VERDICT[k] === 'light-by-design' ? 'light in every theme, by design'
    : 'follows both dark themes'
  console.log(`| ${k} | ${v.length} | ${verdict} |`)
}

const unknown = byContainer.UNRESOLVED || []
if (unknown.length) {
  console.log(`\n## ${unknown.length} routes whose container could not be resolved\n`)
  for (const r of unknown) console.log(`  - \`${r.path}\` → ${r.name || '(inline element)'}`)
}

if (process.argv[2] === 'full') {
  console.log('\n## Every route\n')
  console.log('| Route | Component | Container |')
  console.log('|---|---|---|')
  for (const r of rows.sort((a, b) => a.path.localeCompare(b.path))) {
    console.log(`| \`${r.path}\` | ${r.name || '—'} | ${r.container || '**UNKNOWN**'} |`)
  }
}
let short = false
for (const [src, n] of Object.entries(declared)) {
  const got = rows.filter((r) => r.src === src).length
  if (got !== n) {
    short = true
    console.log(`\n✗ ${src} declares ${n} routes; the parser read ${got}.`)
    console.log('  A declaration shape has stopped matching. A route this script')
    console.log('  cannot see is not a route it flags, so it would report a clean')
    console.log('  run over a fraction of the router — which is exactly what')
    console.log('  happened when the teacher routes moved out of App.jsx.')
  }
}
if (rows.length < MIN_ROUTES) {
  short = true
  console.log(`\n✗ Only ${rows.length} routes in total, expected at least ${MIN_ROUTES}.`)
  console.log('  A whole route SOURCE has probably stopped being read: a file this')
  console.log('  script does not know about cannot be self-checked. Add it above.')
}
process.exit(unknown.length || short ? 1 : 0)
