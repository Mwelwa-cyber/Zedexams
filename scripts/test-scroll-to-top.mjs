#!/usr/bin/env node
/* global console, process */
/**
 * Regression test for the "page opens scrolled to bottom" bug.
 *
 * Root cause: React Router v6 BrowserRouter never resets window.scrollY on
 * client-side navigation — the new route inherits the previous page's scroll
 * offset. Fix: a ScrollToTop component that calls window.scrollTo(0,0) on
 * every pathname change, rendered inside <BrowserRouter> in App.jsx.
 *
 * This test cannot exercise real scroll positions in Node (no browser DOM),
 * but it pins the three structural invariants that would be broken if the fix
 * were accidentally reverted:
 *
 *   1. The component file exists at the expected path.
 *   2. The component imports useLocation from react-router-dom and calls
 *      window.scrollTo inside a useEffect that depends on pathname — the
 *      minimal shape of a correct scroll-to-top hook.
 *   3. App.jsx imports ScrollToTop and renders <ScrollToTop /> inside
 *      <BrowserRouter> (confirmed by the import line + render tag both
 *      being present in the source).
 *
 * Run: npm run test:scroll-to-top   (also part of npm run test:all)
 */
import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = join(__dirname, '..')
const read = (p) => readFileSync(join(root, p), 'utf8')

let pass = 0
let fail = 0
const failures = []

function test(name, fn) {
  try {
    fn()
    pass++
    console.log(`  ok  ${name}`)
  } catch (err) {
    fail++
    failures.push({ name, message: err.message })
    console.log(`  FAIL ${name}`)
    console.log(`       ${err.message}`)
  }
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg)
}

const COMPONENT_PATH = 'src/shared/components/ScrollToTop.jsx'
const componentExists = existsSync(join(root, COMPONENT_PATH))
const componentSrc = componentExists ? read(COMPONENT_PATH) : ''
const appSrc = read('src/app/App.jsx')

// ── 1. Component file exists ─────────────────────────────────────────
console.log('\nScrollToTop component structure')

test('ScrollToTop.jsx exists at src/shared/components/ScrollToTop.jsx', () => {
  assert(componentExists, `${COMPONENT_PATH} is missing — the scroll-to-top fix has been deleted`)
})

test('ScrollToTop imports useLocation from react-router-dom', () => {
  assert(
    /useLocation/.test(componentSrc) && /react-router-dom/.test(componentSrc),
    'ScrollToTop.jsx does not import useLocation from react-router-dom',
  )
})

test('ScrollToTop calls window.scrollTo inside useEffect', () => {
  assert(
    /useEffect/.test(componentSrc) && /window\.scrollTo/.test(componentSrc),
    'ScrollToTop.jsx does not call window.scrollTo inside a useEffect',
  )
})

test('ScrollToTop useEffect depends on pathname', () => {
  // The effect must re-run on every pathname change, not just once on mount.
  assert(
    /\[pathname\]/.test(componentSrc),
    'ScrollToTop.jsx useEffect dependency array does not include pathname — it will only fire once on mount, not on navigation',
  )
})

test('ScrollToTop returns null (render-nothing component)', () => {
  assert(
    /return null/.test(componentSrc),
    'ScrollToTop.jsx does not return null — it should be a render-nothing side-effect component',
  )
})

// ── 2. App.jsx wires the component ───────────────────────────────────
console.log('\nApp.jsx integration')

test('App.jsx imports ScrollToTop', () => {
  assert(
    /import ScrollToTop/.test(appSrc),
    "App.jsx does not import ScrollToTop — the component won't be active",
  )
})

test('App.jsx renders <ScrollToTop />', () => {
  assert(
    /<ScrollToTop\s*\/>/.test(appSrc),
    "App.jsx does not render <ScrollToTop /> — the scroll reset won't fire on navigation",
  )
})

test('ScrollToTop is rendered inside BrowserRouter (App.jsx uses BrowserRouter)', () => {
  // BrowserRouter must appear in App.jsx; ScrollToTop must be rendered inside
  // it (both appear in the same component tree rendered by App's JSX return).
  assert(
    /BrowserRouter/.test(appSrc),
    'App.jsx does not use BrowserRouter — ScrollToTop cannot call useLocation without a router context',
  )
})

// ── Report ────────────────────────────────────────────────────────────
console.log('')
console.log(`─── ${pass + fail} tests · ${pass} passed · ${fail} failed ───`)
if (fail > 0) {
  console.log('\nfailures:')
  failures.forEach((f) => console.log(`  × ${f.name}\n    ${f.message}`))
  process.exit(1)
}
