#!/usr/bin/env node
/* global console, process, document, localStorage */
/**
 * Route contrast gate — the key routes measured for WCAG AA in the two DARK
 * themes (learner Midnight, teacher Night), failing on any text below AA.
 *
 * Two passes, because the two halves of the app gate differently:
 *
 *  1. LIVE public routes — /, /login, /papers, /pricing, /teachers — walked
 *     in a real headless Chromium against the built bundle, with the saved
 *     Midnight theme seeded into localStorage before any script runs (the
 *     exact path a returning dark-theme visitor takes, boot.js pre-paint
 *     guard included). Every visible text node is graded against its
 *     COMPOSITED background (scripts/lib/contrastMeasure.mjs — the same
 *     measurement `npm run audit:dark` uses).
 *
 *  2. FIXTURE teacher/settings routes — /teacher, /teacher/lesson-plans/new,
 *     /teacher/generate/{scheme-of-work,weekly-forecast,record-of-work},
 *     /teacher/library, /teacher/assessment-papers, /teacher/classes,
 *     /teacher/attendance, /teacher/curriculum, /teacher/calendar,
 *     /settings, /settings/appearance. These are role-gated behind real
 *     Firebase auth, so a browser walk cannot reach them (see
 *     scripts/audit-route-themes.mjs for the whole argument). Each route
 *     instead renders its risk surfaces — the exact class/token vocabulary
 *     its page paints, lifted from the components — against the REAL built
 *     stylesheets under `data-theme="night"` (teacher routes; body kept on a
 *     light reading theme, the worst case) or `body.theme-midnight`
 *     (learner settings), and the same measurement grades every pair.
 *
 * Needs a dist/ build and a real Chromium, so it is NOT a `test:*` script —
 * it runs in the "Build + mobile smoke" CI job. Locally:
 *     npm run smoke:build && npm run contrast:routes
 */
import { preview } from 'vite'
import puppeteer from 'puppeteer'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { MEASURE } from './lib/contrastMeasure.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..')
const DIST = join(ROOT, 'dist')
const NAV_TIMEOUT_MS = 30_000
const MIN_ROOT_TEXT = 40

/* ── Pass 1: live public routes under the saved Midnight theme ─────────── */

const LIVE_ROUTES = ['/', '/login', '/papers', '/pricing', '/teachers']

/* ── Pass 2: gated routes as risk-surface fixtures ─────────────────────── */
// Markup is the real class/inline-token vocabulary of each page — when a
// component's colours change, its fixture here measures the change against
// the built CSS. `mode` picks which dark hook the route answers to:
// 'night' = teacher workspace theme (html[data-theme], body stays light —
// the worst case), 'midnight' = learner reading theme on <body>.

const STUDIO = (inner) => `<div class="studio-theme"><div class="studio-page" data-s>${inner}</div></div>`

const CURRICULUM_PICKER = `
  <div class="lps-curriculum-banner border-b px-4 pb-3.5 pt-3.5" data-s>
    <span class="lps-eyebrow">Curriculum</span>
    <div class="lps-lift lps-curriculum-card is-selected rounded-2xl px-3.5 py-3" data-s>
      <span class="lps-curriculum-card__tile">📘</span>
      <span class="lps-curriculum-card__title text-[12.5px] font-bold">Competency-Based Curriculum (CBC)</span>
      <span class="lps-curriculum-card__badge text-[9px] font-extrabold uppercase">Recommended</span>
      <span class="lps-curriculum-card__desc text-[11px]">Learner-centred • Competency-based</span>
    </div>
    <div class="lps-lift lps-curriculum-card rounded-2xl px-3.5 py-3" data-s>
      <span class="lps-curriculum-card__title text-[12.5px] font-bold">Previous Curriculum</span>
      <span class="lps-curriculum-card__desc text-[11px]">Traditional syllabus • Outcome-based</span>
    </div>
  </div>`

const SCHEME_SUMMARY = `
  <div class="rounded-2xl border p-4" style="background:var(--zt-card);border-color:var(--zt-line)" data-s>
    <h3 class="studio-display" style="font-size:16px">Before you generate</h3>
    <span class="zx-chip--green text-[11px] font-black uppercase px-2.5 py-1 rounded-full">CBC Scheme</span>
    <div class="border-b" style="border-color:var(--zt-line)">
      <span class="text-xs font-bold uppercase" style="color:var(--zt-text-muted)">Curriculum</span>
      <span class="text-sm font-bold" style="color:var(--zt-text)">CBC — Competency-Based</span>
      <span class="text-sm font-bold" style="color:var(--warning-fg)">—</span>
    </div>
    <span class="text-[11px] font-bold px-2 py-0.5 rounded-md" style="background:var(--success-bg);color:var(--success-fg)">Syllabus Studio</span>
    <div class="rounded-xl border px-3 py-2 text-sm" style="background:var(--warning-bg);border-color:var(--warning);color:var(--warning-fg)">Set the time allocation</div>
    <div class="rounded-xl border px-3 py-2 text-sm" style="background:var(--info-bg);border-color:var(--info);color:var(--info-fg)">Weeks come from the calendar</div>
  </div>`

const DRAFT_BANNER = `
  <div class="rounded-xl border px-3 py-2.5 text-sm" style="background:var(--zt-banner-bg);border-color:var(--zt-banner-border);color:var(--zt-banner-text)" data-s>
    <span class="font-semibold">We found an unfinished scheme of work</span> — from 2 hours ago.
    <button class="rounded-lg px-3 py-1.5 font-semibold" style="background:var(--zt-accent);color:var(--zt-on-accent)">Continue editing</button>
    <button class="rounded-lg px-3 py-1.5 font-medium">Discard</button>
  </div>`

const LESSON_STUDIO = `
  <div class="lps-game" data-s>
    <div class="lps-soft-shadow bg-white rounded-2xl p-4" data-s>
      <span class="lps-eyebrow">Teacher Studio</span>
      <label class="text-[13px] font-semibold text-[#3d3529]">Topic</label>
      <span class="text-[12px] text-[#7a6d5d]">Field label tier</span>
      <span class="text-[11px] font-normal text-[#a39d8e]">(optional)</span>
      <details class="rounded-xl border border-dashed border-[#e0d7c8] bg-white/50 px-3 py-2">
        <summary class="text-[12px] font-semibold text-[#7a6d5d]">Teacher &amp; school details — prefilled from last time</summary>
      </details>
      <button class="lps-btn-ghost px-3 py-2">Save &amp; exit</button>
      <button class="lps-btn-primary px-3 py-2">Generate</button>
    </div>
  </div>`

const TOP_BAR = `
  <div style="background:color-mix(in srgb, var(--zt-surface) 92%, transparent)" data-s>
    <button class="rounded-xl font-bold" style="background:var(--zt-accent);color:var(--zt-on-accent);padding:8px 14px;font-size:13.5px">Create</button>
    <span class="rounded-full text-[10px] font-black" style="background:var(--zt-accent);color:var(--zt-on-accent);padding:2px 5px">3</span>
  </div>
  <div class="tdv2-menu" data-s style="position:static">
    <div class="tdv2-menu-item">Settings</div>
  </div>`

// The real card paints a gradient the measurer refuses to grade, so the ink
// pairs are ALSO laid on each gradient stop as a flat fill — the strongest
// (`--folder-to`) is the worst case for the light ink.
const LIBRARY_FOLDER = `
  <div class="zx-folder-card" style="--folder-tint-from:#fffdf4;--folder-tint-to:#fdeec0;--folder-tint-border:#efdfa9;--folder-tint-tab:#f9ecc2">
    <span style="background:var(--folder-to);border:1px solid var(--folder-border);display:block;padding:16px" data-s>
      <span style="font-weight:800;font-size:16px;color:var(--folder-ink)">Assessment Papers</span>
      <span style="font-size:12px;color:var(--folder-ink-soft);font-weight:600">12 documents</span>
      <span style="font-size:11.5px;color:var(--folder-ink-faint);font-weight:700">Open</span>
    </span>
    <span style="background:var(--folder-from);display:block;padding:8px" data-s>
      <span style="font-size:12px;color:var(--folder-ink-soft);font-weight:600">Lesson Plans</span>
    </span>
    <span style="background:var(--folder-tab);display:block;padding:8px" data-s>
      <span style="font-size:12px;color:var(--folder-ink);font-weight:600">Tab</span>
    </span>
  </div>`

const ASSESSMENT_LIST = `
  <span class="zx-chip zx-chip--neutral">Mid-Term Test · T2</span>
  <span class="zx-chip zx-chip--neutral">15 questions</span>
  <button class="rounded-full border-2 px-3 py-1.5 text-xs font-bold" style="border-color:var(--warning);background:var(--zt-card);color:var(--warning-fg)">⚠ Needs review · 0</button>
  <button class="rounded-full border-2 px-3 py-1.5 text-xs font-bold" style="border-color:var(--warning);background:var(--warning-bg);color:var(--warning-fg)">⚠ Needs review · 2</button>`

const ATTENDANCE_GRID = `
  <table><tr class="theme-card">
    <td class="px-2 py-1 text-xs font-black" style="color:var(--att-present-fg, #15803d)">0</td>
    <td class="px-2 py-1 text-xs font-black" style="color:var(--att-absent-fg, #b91c1c)">0</td>
    <td class="px-2 py-1 text-xs font-black" style="color:var(--att-sick-fg, #1d4ed8)">0</td>
    <td class="px-2 py-1 text-xs font-black" style="color:var(--att-late-fg, #b45309)">0</td>
    <td class="px-2 py-1 text-xs font-black" style="color:var(--att-excused-fg, #7e22ce)">0</td>
    <td class="px-2 py-1 text-xs font-black theme-text-muted">0</td>
  </tr></table>`

const CURRICULUM_PAGE = `
  <div class="theme-card border theme-border rounded-3xl p-5" data-s>
    <div class="text-[11px] font-black uppercase" style="color:var(--success-fg)">Learning Areas</div>
    <span class="flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-black" style="background:#d4a017;color:#1C1705">1</span>
    <span class="font-black" style="color:var(--success-fg)">Equity.</span>
    <span class="theme-text-muted text-sm">Fair access for every learner.</span>
  </div>`

const CALENDAR = `
  <div class="moe-calendar" style="background:var(--moe-page-bg)" data-s>
    <div style="background:var(--moe-surface)" data-s>
      <div style="font-size:10px;font-weight:700;color:var(--moe-term-ink-1);text-transform:uppercase">Term 1</div>
      <div style="font-size:10px;font-weight:700;color:var(--moe-term-ink-2);text-transform:uppercase">Term 2</div>
      <div style="font-size:10px;font-weight:700;color:var(--moe-term-ink-3);text-transform:uppercase">Term 3</div>
      <div style="font-size:15px;font-weight:700;color:var(--moe-fg)">First Term</div>
    </div>
  </div>`

const LEARNER_SETTINGS = `
  <div class="min-h-screen theme-bg px-4 py-6" data-s>
    <div class="theme-card border theme-border rounded-2xl p-4" data-s>
      <p class="theme-text font-black">Appearance</p>
      <p class="theme-text-muted text-sm">Colours your dashboard and studios.</p>
      <span class="theme-accent-text text-sm font-bold">Manage</span>
    </div>
  </div>`

const FIXTURES = [
  { route: '/teacher', mode: 'night', html: STUDIO(TOP_BAR) },
  { route: '/teacher/lesson-plans/new', mode: 'night', html: STUDIO(LESSON_STUDIO) },
  { route: '/teacher/generate/scheme-of-work', mode: 'night', html: STUDIO(CURRICULUM_PICKER + SCHEME_SUMMARY + DRAFT_BANNER) },
  { route: '/teacher/generate/weekly-forecast', mode: 'night', html: STUDIO(CURRICULUM_PICKER) },
  { route: '/teacher/generate/record-of-work', mode: 'night', html: STUDIO(DRAFT_BANNER) },
  { route: '/teacher/library', mode: 'night', html: STUDIO(LIBRARY_FOLDER) },
  { route: '/teacher/assessment-papers', mode: 'night', html: STUDIO(ASSESSMENT_LIST) },
  { route: '/teacher/classes', mode: 'night', html: STUDIO('<div class="theme-card border theme-border rounded-2xl p-4" data-s><p class="theme-text font-black">Grade 5 Silver</p><p class="theme-text-muted text-sm">32 learners</p></div>') },
  { route: '/teacher/attendance', mode: 'night', html: STUDIO(ATTENDANCE_GRID) },
  { route: '/teacher/curriculum', mode: 'night', html: STUDIO(CURRICULUM_PAGE) },
  { route: '/teacher/calendar', mode: 'night', html: STUDIO(CALENDAR) },
  { route: '/settings', mode: 'midnight', html: LEARNER_SETTINGS },
  { route: '/settings/appearance', mode: 'midnight', html: LEARNER_SETTINGS },
]

/* ── plumbing ──────────────────────────────────────────────────────────── */

function builtCss() {
  const dir = join(DIST, 'assets')
  return readdirSync(dir)
    .filter((f) => f.endsWith('.css'))
    .map((f) => readFileSync(join(dir, f), 'utf8'))
    .join('\n')
}

function report(route, theme, result, failures) {
  const bad = result.pairs.filter((p) => p.ratio < p.min)
  for (const p of bad) {
    failures.push(`${route} [${theme}]: ${p.ratio}:1 (need ${p.min}) ${p.sel} — "${p.text}" ${p.fg} on ${p.bg}`)
  }
  console.log(`  ${bad.length ? '✗' : '✓'} ${route} [${theme}] — ${result.pairs.length} pairs${bad.length ? `, ${bad.length} below AA` : ''}${result.skipped.length ? ` (${result.skipped.length} on gradients, unmeasured)` : ''}`)
}

async function main() {
  if (!existsSync(join(DIST, 'index.html'))) {
    console.error('[route-contrast] dist/index.html not found — run `npm run build` or `npm run smoke:build` first.')
    process.exit(1)
  }

  const browser = await puppeteer.launch({
    headless: true,
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  })
  const failures = []

  /* Pass 1 — live public routes, saved Midnight. */
  const server = await preview({
    root: ROOT,
    preview: { port: 0, strictPort: false, host: '127.0.0.1' },
  })
  const base = server.resolvedUrls.local[0].replace(/\/$/, '')
  console.log(`[route-contrast] live pass (Midnight) at ${base}`)
  try {
    for (const route of LIVE_ROUTES) {
      const page = await browser.newPage()
      await page.setViewport({ width: 1280, height: 900 })
      // The saved-theme path: the key exists BEFORE boot.js runs, exactly as
      // for a returning Midnight reader.
      await page.evaluateOnNewDocument(() => {
        try { localStorage.setItem('examprep:theme', 'midnight') } catch { /* unavailable */ }
      })
      try {
        await page.goto(`${base}${route}`, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT_MS })
        await page.waitForFunction(
          (min) => {
            const root = document.getElementById('root')
            return !!root && (root.innerText || '').trim().length >= min
          },
          { timeout: NAV_TIMEOUT_MS },
          MIN_ROOT_TEXT,
        )
        await new Promise((r) => setTimeout(r, 400))
        // The saved theme must actually be showing — this is the regression
        // where navigation reset the body class to the default palette.
        const bodyTheme = await page.evaluate(() => document.body.className)
        if (!/theme-midnight/.test(bodyTheme)) {
          failures.push(`${route} [midnight]: body lost the saved theme (classes: "${bodyTheme}")`)
        }
        const result = await page.evaluate(MEASURE)
        report(route, 'midnight', result, failures)
      } catch (err) {
        failures.push(`${route} [midnight]: ${err?.message || err}`)
      } finally {
        await page.close()
      }
    }
  } finally {
    await server.close()
  }

  /* Pass 2 — gated routes as fixtures against the built CSS, Night. */
  console.log('[route-contrast] fixture pass (Night / Midnight)')
  const css = builtCss()
  for (const { route, mode, html } of FIXTURES) {
    const page = await browser.newPage()
    await page.setViewport({ width: 1100, height: 800 })
    const dark = mode === 'midnight'
    await page.setContent(
      `<!doctype html><html${mode === 'night' ? ` data-theme="night"` : ''}${dark ? ' class="dark"' : ''}>` +
      `<head><style>${css}</style></head>` +
      `<body class="${dark ? 'theme-midnight' : 'theme-oatmeal'}">${html}</body></html>`,
      { waitUntil: 'domcontentloaded' },
    )
    await new Promise((r) => setTimeout(r, 100))
    const result = await page.evaluate(MEASURE)
    report(route, mode, result, failures)
    await page.close()
  }

  /* Pass 3 — the High-contrast toggle must STRENGTHEN the dark themes.
   * It used to push near-black borders/muted ink onto the dark surfaces, so
   * switching it on measurably reduced contrast. Render the same muted-text
   * sample with and without body[data-a11y-contrast="high"] under Night and
   * assert the ratio does not go down. */
  {
    const css = builtCss()
    const sample = STUDIO(
      '<div class="theme-card border theme-border rounded-xl p-4" data-s>'
      + '<p class="theme-text-muted text-sm" id="hc-probe">Secondary copy</p></div>',
    )
    const ratios = {}
    for (const on of [false, true]) {
      const page = await browser.newPage()
      await page.setContent(
        `<!doctype html><html data-theme="night"><head><style>${css}</style></head>`
        + `<body class="theme-oatmeal"${on ? ' data-a11y-contrast="high"' : ''}>${sample}</body></html>`,
        { waitUntil: 'domcontentloaded' },
      )
      const r = await page.evaluate(MEASURE)
      const probe = r.pairs.find((p) => p.text === 'Secondary copy')
      ratios[on ? 'on' : 'off'] = probe ? probe.ratio : null
      await page.close()
    }
    if (!ratios.on || !ratios.off) {
      failures.push(`high-contrast check: probe not measured (off=${ratios.off}, on=${ratios.on})`)
    } else if (ratios.on < ratios.off) {
      failures.push(`high-contrast check: enabling the toggle REDUCED Night contrast (${ratios.off}:1 → ${ratios.on}:1)`)
    } else {
      console.log(`[route-contrast] high-contrast toggle strengthens Night: ${ratios.off}:1 → ${ratios.on}:1`)
    }
  }

  await browser.close()

  if (failures.length) {
    console.error(`\n[route-contrast] ${failures.length} failures:\n`)
    for (const f of failures) console.error(`  ✗ ${f}`)
    process.exit(1)
  }
  console.log('\n[route-contrast] all routes clear WCAG AA in the dark themes.')
}

main().catch((err) => {
  console.error('[route-contrast] fatal:', err)
  process.exit(1)
})
