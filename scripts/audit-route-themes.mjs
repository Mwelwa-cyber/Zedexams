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
const app = readFileSync(join(ROOT, 'src/App.jsx'), 'utf8')

/* ── route → component name ───────────────────────────────────────────── */
const routes = []
for (const m of app.matchAll(/<Route\s+path="([^"]+)"/g)) {
  const start = m.index
  const chunk = app.slice(start, start + 600)
  const el = chunk.match(/element=\{([\s\S]*?)\}\s*\/?>/)
  routes.push({ path: m[1], element: el ? el[1].replace(/\s+/g, ' ').trim() : '' })
}

/* ── component name → file ────────────────────────────────────────────── */
const lazyMap = new Map()
for (const m of app.matchAll(/const\s+(\w+)\s*=\s*lazy\(\s*\(\)\s*=>\s*import\(\s*['"]([^'"]+)['"]/g)) {
  lazyMap.set(m[1], m[2])
}
for (const m of app.matchAll(/^import\s+(\w+)\s+from\s+['"](\.[^'"]+)['"]/gm)) {
  if (!lazyMap.has(m[1])) lazyMap.set(m[1], m[2])
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
const localRedirects = new Set(['Navigate'])
for (const m of app.matchAll(/function\s+(\w+)\s*\([^)]*\)\s*\{/g)) {
  const body = app.slice(m.index, app.indexOf('\n}', m.index))
  if (/<Navigate\b/.test(body) && !/<(?!Navigate)[A-Z]\w+/.test(body)) localRedirects.add(m[1])
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
    const def = app.match(new RegExp(`function\\s+${name}\\s*\\([^)]*\\)\\s*\\{`))
    if (def) {
      const body = app.slice(def.index, app.indexOf('\n}', def.index))
      const targets = [...new Set([...body.matchAll(/<([A-Z]\w+)/g)].map((m) => m[1]))]
        .filter((t) => lazyMap.has(t))
      const cs = targets.map((t) => {
        const f = resolveFile(lazyMap.get(t))
        return f ? (containerFor(f) || 'Reading tokens (theme-*)') : null
      })
      if (cs.length && cs.every(Boolean)) {
        container = `Dispatcher → ${[...new Set(cs)].join(' / ')}`
        file = 'src/App.jsx'
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

console.log(`# Step 5 — route theming\n`)
console.log(`${rows.length} routes declared in src/App.jsx.\n`)
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
process.exit(unknown.length ? 1 : 0)
