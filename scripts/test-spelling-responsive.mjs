#!/usr/bin/env node
/* global console, process, document, window, getComputedStyle */
/**
 * The spelling screens, measured in a real browser at seven widths.
 *
 * §27 is a set of claims about LAYOUT — no horizontal overflow, no clipped
 * button, no hidden letter tile, touch targets a child can hit — and none of
 * them can be checked in jsdom, which has no layout engine and reports every
 * box as zero. So this renders the REAL components (react-dom/server, the real
 * `spelling.css` and `learnerTheme.css`) into headless Chromium and measures.
 *
 * WHY SERVER-RENDERED MARKUP RATHER THAN THE LIVE APP. The live route needs a
 * Firestore game document, an authenticated learner and a word pack, none of
 * which exist in CI — and a smoke test that has to fake all three is testing
 * the fakes. Rendering the components directly gives the genuine DOM and the
 * genuine stylesheet, which together are what the layout claims are ABOUT.
 * What it deliberately does NOT cover is anything that only appears after an
 * interaction; those are the Vitest specs' job.
 *
 * NOT a `test:*` script, for the same reason as the mobile smoke: it needs a
 * real Chromium the plain-node suite has not got. Run it with:
 *     node scripts/test-spelling-responsive.mjs
 */
import { renderToStaticMarkup } from 'react-dom/server'
import { createElement as h } from 'react'
import puppeteer from 'puppeteer'
import * as esbuild from 'esbuild'
import { readFileSync, writeFileSync, mkdtempSync, rmSync, mkdirSync, readdirSync, existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..')

/** Every width a Zambian learner actually meets, smallest first. */
const WIDTHS = [
  { label: '320px — smallest phone in real use', width: 320, height: 640 },
  { label: '360px — the common Android', width: 360, height: 740 },
  { label: '390px — iPhone class', width: 390, height: 844 },
  { label: '430px — large Android', width: 430, height: 932 },
  { label: '768px — tablet portrait', width: 768, height: 1024 },
  { label: '1024px — tablet landscape', width: 1024, height: 768 },
  { label: '1280px — laptop / desktop', width: 1280, height: 800 },
]

/** A few px of slop absorbs sub-pixel rounding and overlay scrollbars. */
const MAX_OVERFLOW_PX = 2

/**
 * The floor for anything a child taps. 44px is the platform guidance and the
 * letter tiles sit above it because they are the primary interaction.
 */
const MIN_TOUCH_PX = 44

let passed = 0
const failures = []
function check(cond, msg) {
  if (cond) { passed += 1; return }
  failures.push(msg)
}

/* ── the screens, rendered from the real components ─────────────────── */

/**
 * Node cannot import `.jsx`, so the components are bundled first — with
 * esbuild, which the repo already carries as a Vite dependency. `react` and
 * `react-dom` stay external so this file and the bundle share one React;
 * two copies would make `renderToStaticMarkup` throw on the first hook.
 *
 * The CSS import inside each component is stubbed: the stylesheets are read
 * from disk further down and injected into the page whole, which is the
 * version the browser actually applies.
 */
// INSIDE the repo, not in /tmp: node resolves `react` by walking up from the
// importing file, and a bundle in the system temp directory has no
// node_modules above it to find.
mkdirSync(join(ROOT, 'node_modules', '.cache'), { recursive: true })
const workDir = mkdtempSync(join(ROOT, 'node_modules', '.cache', 'spelling-responsive-'))
const entry = join(workDir, 'entry.jsx')
const bundle = join(workDir, 'bundle.mjs')
writeFileSync(entry, `
export { default as SpellingStageMap, StageIntroSheet } from ${JSON.stringify(join(ROOT, 'src/features/games/components/SpellingStageMap.jsx'))}
export { default as BreakItUpCoach } from ${JSON.stringify(join(ROOT, 'src/features/games/components/BreakItUpCoach.jsx'))}
export { default as SpellingResults } from ${JSON.stringify(join(ROOT, 'src/features/games/components/SpellingResults.jsx'))}
export { default as TrickyWordsPanel } from ${JSON.stringify(join(ROOT, 'src/features/games/components/TrickyWordsPanel.jsx'))}
export { buildStageMap } from ${JSON.stringify(join(ROOT, 'src/features/games/lib/spellingMapCore.js'))}
export { coachFor } from ${JSON.stringify(join(ROOT, 'src/features/games/lib/spellingCoachCore.js'))}
export { recordMiss } from ${JSON.stringify(join(ROOT, 'src/features/games/lib/spellingStagesCore.js'))}
`)
await esbuild.build({
  entryPoints: [entry],
  outfile: bundle,
  bundle: true,
  format: 'esm',
  platform: 'node',
  jsx: 'automatic',
  loader: { '.js': 'jsx', '.jsx': 'jsx', '.css': 'empty' },
  external: ['react', 'react-dom', 'react/jsx-runtime'],
  logLevel: 'silent',
})

const {
  SpellingStageMap, StageIntroSheet, BreakItUpCoach, SpellingResults,
  TrickyWordsPanel, buildStageMap, coachFor, recordMiss,
} = await import(`file://${bundle}`)

const BANDS = [
  { id: 'sound-out', title: 'Sound it out', blurb: 'Words that behave. Say each sound and write what you hear.' },
  { id: 'double', title: 'Double trouble', blurb: 'Words that trip people up with double letters.' },
  { id: 'silent', title: 'Silent letters', blurb: 'A letter that is written but never said.' },
]
const COUNTS = { 'sound-out': 40, double: 32, silent: 24 }

let pool = {}
for (let i = 0; i < 12; i += 1) pool = recordMiss(pool, `TRICKYWORD${i}`, { stage: 3 })

const MAP = buildStageMap({ bands: BANDS, counts: COUNTS, stars: { 1: 3, 2: 2, 3: 1 }, pool })

/**
 * The longest realistic word in the bank, so the slot row is tested at its
 * worst case rather than on "LION". A fourteen-letter word at 320px is the
 * exact case that pushes a page sideways.
 */
const LONG_WORD = 'RESPONSIBILITY'

const COACH = coachFor({
  answer: 'SEPARATE',
  chunks: ['SEP', 'A', 'RATE'],
  trap: 1,
  strategy: 'syllables',
  why: 'Say it in three — <b>sep · a · rate</b>. Most people write "seperate" because they say it fast.',
  hook: 'There is <u>a rat</u> in sepa<u>rat</u>e',
  hookNote: 'The middle is an <b>a</b>, not an e.',
  related: ['DESPERATE', 'CELEBRATE', 'DECORATE'],
})

/**
 * The round is rendered as static markup rather than mounted, because the
 * component starts a speech timer and reads `window`. The markup below is
 * copied from its render output for the WORST case: a long word, a full slot
 * row, decoy tiles and an open wrong-answer panel.
 *
 * BEING A COPY, IT HAS TO BE KEPT IN STEP. A control added to the real header
 * and not to this one is a control this file never measures — which is how a
 * new button ships under the touch floor. The `assert` in the patch that adds
 * the mute button is the reminder; if you change that header, change this.
 */
function roundMarkup(word) {
  const letters = [...word, 'K', 'M', 'Z']
  return `
  <div class="lhx-sp-round">
    <header class="lhx-sp-round-head">
      <button type="button" class="lhx-sp-back">‹</button>
      <div class="lhx-sp-dots">${'<span class="lhx-sp-dot is-done"></span>'.repeat(8)}</div>
      <button type="button" class="lhx-sp-mute"><span>🔊</span></button>
      <span class="lhx-sp-streak">🔥 4</span>
    </header>
    <p class="lhx-sp-stagelab">Stage 24 · Double trouble</p>
    <section class="lhx-sp-hero">
      <p class="lhx-sp-kicker">Word 5 of 8 · one you missed</p>
      <button type="button" class="lhx-sp-hear">🔊 Hear it again</button>
      <p class="lhx-sp-sentence">Taking care of the goats is her <b class="lhx-sp-gap">· · ·</b> every morning before school.</p>
    </section>
    <div class="lhx-sp-slots">${[...word].map((l) => `<span class="lhx-sp-slot is-filled">${l}</span>`).join('')}</div>
    <div class="lhx-sp-tiles">${letters.map((l) => `<button type="button" class="lhx-sp-tile">${l}</button>`).join('')}</div>
    <div class="lhx-sp-controls">
      <button type="button" class="lhx-sp-ghost">⌫ Undo</button>
      <button type="button" class="lhx-sp-ghost">↺ Clear</button>
    </div>
    <button type="button" class="lhx-sp-check">Check</button>
    <div class="lhx-sp-feedback">
      <div class="lhx-sp-fb is-no">
        <p class="lhx-sp-fb-title">Not quite — look again</p>
        <p class="lhx-sp-fb-you">You built <b>RESPONSABILITY</b></p>
        <p class="lhx-sp-fb-word">${[...word].map((l, i) => (i === 6 ? `<span class="lhx-sp-fb-mark">${l}</span>` : l)).join('')}</p>
        <p class="lhx-sp-fb-where">It goes wrong at letter 7 — you put <b>A</b>, it is <b>I</b>.</p>
        <div class="lhx-sp-fb-actions">
          <button type="button" class="lhx-sp-fix">✂️ Let's fix this</button>
          <button type="button" class="lhx-sp-ghost">Skip — I've got it</button>
        </div>
        <p class="lhx-sp-fb-note">This one comes back later with no help.</p>
      </div>
    </div>
  </div>`
}

const SCREENS = [
  { id: 'map', name: 'Stage map', html: renderToStaticMarkup(h(SpellingStageMap, { map: MAP, grade: 7, onPickStage() {}, onPickTricky() {}, onExit() {} })) },
  {
    id: 'intro',
    name: 'Stage intro sheet',
    html: renderToStaticMarkup(h(StageIntroSheet, {
      stage: 24,
      chapter: MAP.chapters[1],
      words: Array.from({ length: 8 }, (_, i) => ({ word: `WORD${i}` })),
      fromPool: ['necessary', 'separate', 'embarrass'],
      onStart() {}, onClose() {},
    })),
  },
  { id: 'round', name: 'Round (long word, wrong answer open)', html: roundMarkup(LONG_WORD) },
  { id: 'coach', name: 'Break It Up coach', html: renderToStaticMarkup(h(BreakItUpCoach, { coach: COACH, attempt: 'SEPERATE', onDone() {}, onSkip() {} })) },
  {
    id: 'results',
    name: 'Stage results',
    html: renderToStaticMarkup(h(SpellingResults, {
      stage: 24,
      summary: {
        stars: 2, firstTryCorrect: 6, words: 8, accuracy: 75,
        mastered: ['necessary', 'beginning'],
        addedTricky: ['embarrass', 'occurred'],
        returning: [{ word: 'embarrass', dueAt: 26 }, { word: 'occurred', dueAt: 26 }],
      },
      bestStreak: 5, previousStars: 1, hasNextStage: true,
      onNext() {}, onReplay() {}, onMap() {},
    })),
  },
  { id: 'tricky', name: 'Tricky words', html: renderToStaticMarkup(h(TrickyWordsPanel, { pool, onTakeOn() {}, onBack() {} })) },
]

/* ── the page ───────────────────────────────────────────────────────── */

const css = [
  join(ROOT, 'src/shared/styles/learnerTheme.css'),
  join(ROOT, 'src/features/games/gamesProto.css'),
  join(ROOT, 'src/features/games/components/spelling.css'),
].map((file) => readFileSync(file, 'utf8')).join('\n')

function pageFor(screen) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>*{box-sizing:border-box}html,body{margin:0;padding:0}${css}</style>
</head><body><div class="lhx"><div class="lhx-page">${screen.html}</div></div></body></html>`
}

/* ── measure ────────────────────────────────────────────────────────── */

/**
 * The browser. `PUPPETEER_EXECUTABLE_PATH` wins; otherwise the first of the
 * known pre-installed Chromiums that actually exists, and only then
 * puppeteer's own download. Resolved rather than hard-coded because the
 * versioned directory name changes with every browser bump.
 */
function findChromium() {
  if (process.env.PUPPETEER_EXECUTABLE_PATH) return process.env.PUPPETEER_EXECUTABLE_PATH
  const base = process.env.PLAYWRIGHT_BROWSERS_PATH || '/opt/pw-browsers'
  let dirs = []
  try {
    dirs = readdirSync(base)
      .filter((name) => name.startsWith('chromium'))
      // Newest build first, so a bumped browser is picked up without an edit.
      .sort()
      .reverse()
  } catch { return null }
  for (const dir of dirs) {
    for (const binary of ['chrome-linux/chrome', 'chrome-linux/headless_shell']) {
      const candidate = join(base, dir, binary)
      if (existsSync(candidate)) return candidate
    }
  }
  return null
}

const executablePath = findChromium()
const browser = await puppeteer.launch({
  ...(executablePath ? { executablePath } : {}),
  headless: 'new',
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
})

try {
  for (const screen of SCREENS) {
    const page = await browser.newPage()
    await page.setContent(pageFor(screen), { waitUntil: 'load' })

    for (const size of WIDTHS) {
      await page.setViewport({ width: size.width, height: size.height, deviceScaleFactor: 2 })
      const report = await page.evaluate((minTouch) => {
        const doc = document.documentElement
        const overflow = Math.max(0, doc.scrollWidth - doc.clientWidth)

        // Anything past the right edge — a clipped button, a tile row pushed
        // off screen, a word that will not wrap.
        const past = []
        for (const el of document.querySelectorAll('button, .lhx-sp-slot, .lhx-sp-tile, .lhx-sp-chunk, .lhx-sp-option, .lhx-sp-list-row, p, h1, h2')) {
          const box = el.getBoundingClientRect()
          if (box.width === 0 && box.height === 0) continue
          if (box.right > doc.clientWidth + 1 || box.left < -1) {
            past.push(`${el.className || el.tagName} right=${Math.round(box.right)}`)
          }
        }

        // Every interactive control, measured. A control a child cannot hit
        // is as broken as one that is not there.
        const small = []
        for (const el of document.querySelectorAll('button, a[href], select, input, textarea')) {
          const box = el.getBoundingClientRect()
          if (box.width === 0 && box.height === 0) continue          // not rendered
          if (getComputedStyle(el).visibility === 'hidden') continue  // a used tile
          if (Math.min(box.width, box.height) < minTouch - 0.5) {
            small.push(`${el.className || el.tagName} ${Math.round(box.width)}×${Math.round(box.height)}`)
          }
        }

        // A tile the learner cannot see or reach.
        const hidden = []
        for (const el of document.querySelectorAll('.lhx-sp-tile, .lhx-sp-slot')) {
          const box = el.getBoundingClientRect()
          const styles = getComputedStyle(el)
          if (styles.display === 'none' || Number(styles.opacity) === 0) {
            hidden.push(el.className)
          }
          if (box.width === 0 || box.height === 0) hidden.push(`${el.className} collapsed`)
        }

        return { overflow, past: past.slice(0, 5), small: small.slice(0, 5), hidden: hidden.slice(0, 5) }
      }, MIN_TOUCH_PX)

      const where = `${screen.name} @ ${size.label}`
      check(report.overflow <= MAX_OVERFLOW_PX,
        `${where}: no horizontal overflow (was ${report.overflow}px)`)
      check(report.past.length === 0,
        `${where}: nothing is clipped past the edge (${report.past.join('; ')})`)
      check(report.small.length === 0,
        `${where}: every control is at least ${MIN_TOUCH_PX}px (${report.small.join('; ')})`)
      check(report.hidden.length === 0,
        `${where}: no letter tile or slot is hidden or collapsed (${report.hidden.join('; ')})`)
    }
    await page.close()
  }
} finally {
  await browser.close()
  rmSync(workDir, { recursive: true, force: true })
}

if (failures.length) {
  console.error(`\nspelling responsive: ${failures.length} FAILED\n`)
  for (const failure of failures) console.error('  ✗ ' + failure)
  process.exit(1)
}
console.log(`spelling responsive: ${passed} checks passed`)
console.log(`  ${SCREENS.length} screens × ${WIDTHS.length} widths — 320px to 1280px`)
