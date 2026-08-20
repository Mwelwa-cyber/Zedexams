#!/usr/bin/env node
/* global console, process, document, window, getComputedStyle */
/**
 * Layout regression test for the learner Games hub (/games).
 *
 * The rules it guards are the ones the 2026-08-19 pass was written for,
 * and every one of them is a MEASUREMENT — a claim about boxes that no
 * jsdom test can make, because jsdom has no layout engine:
 *
 *   1. Nothing renders under the fixed chrome. Scrolled to the bottom, no
 *      element of the page intersects the tab bar's rect. This is the live
 *      bug: the nav was translucent and the page
 *      reserved 24px under a 76px bar, so "Your games", the Leaderboard
 *      link and the first game card rendered THROUGH it.
 *   2. No horizontal overflow: documentElement.scrollWidth === clientWidth.
 *   3. Every game row is exactly the same height. Two wrapping chips made
 *      Meaning Match ~40px taller than Punctuation Pro, and a list whose
 *      rows are different heights cannot be scanned.
 *   4. Every one-line string is one line — hero titles, hero subs, game
 *      names, game meta — even when the content is absurd. The harness
 *      renders a deliberately over-long game name and asserts it
 *      truncated rather than reflowed its card.
 *   5. The tab bar is opaque. A translucent bar is what made (1) look like
 *      a rendering artefact rather than a bug.
 *
 * Run at 390×844 and 1440×900, in light and Night mode: four states, the
 * same four the acceptance asks for. Screenshots land in
 * `node_modules/.cache/games-hub/` and are NOT compared to a baseline —
 * this is an assertion harness, not the §4.6 visual gate. (The visual
 * gate's baselines are recorded by CI and keyed to a renderer identity;
 * a screenshot recorded here could never match one.)
 *
 * WHY A FIXTURE AND NOT THE REAL ROUTE: /games is served by the SPA behind
 * Firebase auth, and the learner hub needs a signed-in profile with a
 * grade to render its own content. There is no unguarded twin of it. So
 * this mounts the REAL components under the REAL stylesheets with the
 * Firebase-touching modules substituted — see scripts/gamesHub/. The
 * layout rules live entirely in CSS and the DOM is the component's own
 * output, so what is measured is what ships.
 *
 * Needs a real Chromium, so — like test-mobile-smoke.mjs and
 * test-learner-explore-row.mjs — it is NOT a `test:*` script (CI sets
 * PUPPETEER_SKIP_DOWNLOAD=true outside the smoke job). Locally:
 *     npm run smoke:games-hub
 * (set PUPPETEER_EXECUTABLE_PATH to reuse a system/Playwright Chromium.)
 */
import { build } from 'esbuild'
import puppeteer from 'puppeteer'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { STUBS } from './gamesHub/stubs.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..')
const OUT = join(ROOT, 'node_modules/.cache/games-hub')

const NUNITO_HREF =
  'https://fonts.googleapis.com/css2?family=Nunito:wght@400;600;700;800;900&display=block'

/**
 * Nunito, INLINED — fetched here in node and embedded as data URIs, never
 * linked from the page.
 *
 * Same rule the §4.6 screen stage holds: a `.woff2` left as a URL is a
 * request, and a request that fails leaves the page laid out in a fallback
 * face. That is not a hypothetical here — headless Chromium in this
 * container has no route to fonts.gstatic.com even where node does, so a
 * linked stylesheet hangs the page load rather than degrading it.
 *
 * A failure is REPORTED and the run continues: the box rules (chrome
 * collision, overflow, row heights) are font-independent, and the text
 * rules are then measuring a face the product does not ship, which the
 * summary says out loud rather than counting as a pass.
 */
async function inlineNunito() {
  try {
    const res = await fetch(NUNITO_HREF, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/126 Safari/537.36' },
      signal: AbortSignal.timeout(20_000),
    })
    if (!res.ok) return { css: '', ok: false, why: `google fonts returned ${res.status}` }
    let css = await res.text()
    const urls = [...new Set([...css.matchAll(/url\((https:\/\/[^)]+)\)/g)].map((m) => m[1]))]
    for (const url of urls) {
      const font = await fetch(url, { signal: AbortSignal.timeout(20_000) })
      if (!font.ok) return { css: '', ok: false, why: `font file ${url} returned ${font.status}` }
      const b64 = Buffer.from(await font.arrayBuffer()).toString('base64')
      css = css.split(url).join(`data:font/woff2;base64,${b64}`)
    }
    return { css, ok: true, why: null }
  } catch (err) {
    return { css: '', ok: false, why: String(err?.message || err) }
  }
}

/* ── The fixture ──────────────────────────────────────────────────────
 * Deliberately hostile where the rules are about overflow: one game name
 * long enough to reflow any card that lets it, and a topic to match. A
 * fixture made of comfortable strings cannot fail a truncation rule. */
const LONG_NAME = 'Punctuation Pro: Commas, Colons, Semicolons and the Oxford Comma Marathon'
const FIXTURE = {
  profile: { role: 'learner', grade: 7 },
  challenge: { id: 'g-daily', title: 'Meaning Match', type: 'memory_match', grade: 7 },
  streak: { streak: 1, longestStreak: 4, signedIn: true },
  badges: { 'first-game': { earnedAt: 1 } },
  history: [{ gameId: 'g-words', score: 120 }],
  games: [
    { id: 'g-path',  title: 'Number Target', type: 'number_target', grade: 7, subject: 'mathematics', cbc_topic: 'Numbers', points: 15 },
    // NOTE there is deliberately no `word_builder` pack for grade 7 here.
    // That mechanic renders as the "Coming soon for Grade 7" row, which is
    // a row the list has to keep at the same height as every other one —
    // it is a different component (`UnavailableRow`) reaching for the same
    // 68px, which is exactly the kind of thing that drifts unmeasured.
    { id: 'g-mean',  title: 'Meaning Match', type: 'memory_match', grade: 7, subject: 'english', cbc_topic: 'Word meanings', points: 15 },
    // A SECOND pack of a mechanic the grade already has. Before 2026-08-19
    // the catalogue took one pack per mechanic and this row did not exist;
    // now it does, and it changes what the row is NAMED — two rows both
    // reading "Meaning Match" would identify neither, so each falls back
    // to its own doc title. Which makes a row name a free-text value from
    // the document for the first time, and therefore an overflow surface.
    { id: 'g-mean2', title: 'African Capitals', type: 'memory_match', grade: 7, subject: 'social', cbc_topic: 'Africa', points: 15 },
    // The topic overflow probe. This mechanic has ONE pack, so its name
    // still comes from CATALOGUE_MECHANICS and the long string goes where
    // the component reads free text from the doc: the topic.
    { id: 'g-punc',  title: LONG_NAME, type: 'punctuation', grade: 7, subject: 'english', cbc_topic: LONG_NAME, points: 15 },
    // The NAME overflow probe, and the reason it is a `timed_quiz`: a type
    // with no mechanic name always renders its own title, so this is the
    // hostile string in the one slot that used to be safe by construction.
    // It also proves the type lists at all — 27 of the 47 bundled games are
    // timed_quiz and browsing could not reach one of them.
    { id: 'g-quiz',  title: LONG_NAME, type: 'timed_quiz', grade: 7, subject: 'science', cbc_topic: 'Living things', points: 15 },
    // A pack of a mechanic the learner's grade DOES have, at the wrong
    // grade. It must not appear at all — nothing here should render it,
    // and the row-count assertion below would notice an extra row.
    { id: 'g-wrong-grade', title: 'Someone else\'s Number Path', type: 'number_target', grade: 4, subject: 'mathematics', cbc_topic: 'Numbers', points: 15 },
  ],
}

/**
 * The rows the fixture must produce, in order. Named here rather than
 * inline so the settle-wait below and the assertion cannot disagree about
 * what "finished loading" means.
 *
 * Four mechanics lead in the mockup's order — `memory_match` owning two of
 * the rows, each named for its own pack and sorted by title — then every
 * other playable type, then the Map Quest teaser.
 */
const EXPECTED_ROWS = [
  'Number Path',      // g-path
  'Word Builder',     // no grade-7 pack: the "Coming soon" placeholder
  'African Capitals', // g-mean2 ─┬ one mechanic, two packs, sorted by title
  'Meaning Match',    // g-mean  ─┘ and named for the pack, not the mechanic
  'Punctuation Pro',  // g-punc: one pack, so still named for the mechanic
  LONG_NAME,          // g-quiz: no mechanic name, so its own title
  'Map Quest',        // the teaser: no engine at all
]

const VIEWPORTS = [
  { id: 'phone',   width: 390,  height: 844 },
  { id: 'desktop', width: 1440, height: 900 },
]
const THEMES = [
  { id: 'light', bodyClass: '',                htmlTheme: null },
  { id: 'night', bodyClass: 'theme-midnight',  htmlTheme: 'night' },
]

/** Substitute the Firebase-touching modules at resolve time. */
const stubPlugin = {
  name: 'games-hub-stubs',
  setup(b) {
    const keys = Object.keys(STUBS)
    b.onResolve({ filter: /.*/ }, (args) => {
      if (!args.importer) return null
      const full = resolve(dirname(args.importer), args.path)
      const rel = full.slice(ROOT.length + 1).replace(/\\/g, '/').replace(/\.(jsx?|mjs)$/, '')
      const hit = keys.find((k) => k === rel)
      return hit ? { path: hit, namespace: 'games-hub-stub' } : null
    })
    b.onLoad({ filter: /.*/, namespace: 'games-hub-stub' }, (args) => ({
      contents: STUBS[args.path],
      loader: 'js',
      resolveDir: ROOT,
    }))
  },
}

async function buildBundle() {
  rmSync(OUT, { recursive: true, force: true })
  mkdirSync(OUT, { recursive: true })
  const outfile = join(OUT, 'entry.js')
  await build({
    entryPoints: [join(__dirname, 'gamesHub/gamesHubEntry.jsx')],
    bundle: true, jsx: 'automatic', format: 'iife', outfile,
    define: { 'process.env.NODE_ENV': '"production"' },
    loader: { '.webp': 'dataurl', '.png': 'dataurl', '.svg': 'dataurl' },
    plugins: [stubPlugin],
    logLevel: 'silent',
  })
  const js = readFileSync(outfile, 'utf8')
  const css = readFileSync(outfile.replace(/\.js$/, '.css'), 'utf8')
  // A bundle that emitted no learner stylesheet would paint an unstyled
  // page, and an unstyled page has no fixed chrome to collide with — every
  // assertion below would pass while measuring nothing.
  if (!css.includes('.lhx-nav') || !css.includes('.lhx-game')) {
    throw new Error('the bundled CSS is missing the learner chrome — the harness would measure an unstyled page')
  }
  return { js, css }
}

function page({ js, css, fontCss, theme }) {
  return `<!doctype html><html lang="en"${theme.htmlTheme ? ` data-theme="${theme.htmlTheme}"` : ''}>
<head><meta charset="utf-8"><title>games hub — ${theme.id}</title>
<!-- A base URL so the app's root-relative <img src="/images/…"> resolves to
     something. setContent leaves the document at about:blank, where a
     root-relative path resolves to nothing and the image never even
     requests — which reads as "the asset is missing" in a screenshot. The
     host is fictional; every request to it is answered from public/ by the
     interceptor, and anything else is aborted. -->
<base href="http://games-hub.harness.invalid/">
<style>${fontCss}</style>
<style>${css}</style>
<style>html,body{margin:0}</style>
</head>
<body${theme.bodyClass ? ` class="${theme.bodyClass}"` : ''}>
<div id="root"></div>
<script>window.__gamesHubFixture=${JSON.stringify(FIXTURE)}</script>
<script>${js}</script>
</body></html>`
}

/* ── The assertions, run IN the page ─────────────────────────────────── */

function measure() {
  const rect = (el) => {
    const r = el.getBoundingClientRect()
    return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, width: r.width, height: r.height }
  }
  const overlaps = (a, b) =>
    a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top

  const nav = document.querySelector('.lhx-nav')
  const navBox = nav ? rect(nav) : null

  /**
   * Every element of the PAGE that actually PAINTS something.
   *
   * "Paints" rather than "exists", and the distinction is the whole
   * assertion. A layout container — the page column, a <section> — spans
   * the full height of its contents by definition, so its rect reaches
   * behind any fixed chrome no matter how much bottom padding the page
   * reserves. Failing on those would make the rule unsatisfiable and the
   * only way to green would be to weaken it.
   *
   * What a learner can actually see covered is ink: a text node, or a box
   * with a background or a border of its own. So that is what is checked.
   */
  const paints = (el, cs) => {
    if (cs.backgroundImage !== 'none') return true
    const bg = cs.backgroundColor || ''
    const rgba = bg.match(/^rgba?\(([^)]+)\)$/)
    if (rgba) {
      const parts = rgba[1].split(',').map((n) => parseFloat(n))
      if (parts.length < 4 || parts[3] > 0.02) return true
    }
    if (parseFloat(cs.borderTopWidth) || parseFloat(cs.borderBottomWidth)) return true
    // A direct (not inherited) text node with real content.
    return [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim().length > 0)
  }

  const pageEls = [...document.querySelectorAll('.lhx-page *')].filter((el) => {
    if (el.closest('.lhx-nav')) return false
    const cs = getComputedStyle(el)
    if (cs.visibility === 'hidden' || cs.display === 'none' || Number(cs.opacity) === 0) return false
    const r = el.getBoundingClientRect()
    if (r.width <= 0 || r.height <= 0) return false
    return paints(el, cs)
  })

  const describe = (el) => `${el.tagName.toLowerCase()}.${[...el.classList].join('.')}: "${(el.textContent || '').trim().slice(0, 40)}"`

  const under = { nav: [] }
  for (const el of pageEls) {
    const r = rect(el)
    if (navBox && overlaps(r, navBox)) under.nav.push(describe(el))
  }

  const oneLiners = [
    ...document.querySelectorAll('.lhx-gh-hero-title, .lhx-gh-hero-sub, .lhx-game-main b, .lhx-game-main span, .lhx-gh-title'),
  ].map((el) => ({
    what: describe(el),
    // A one-line box is at most one line-height tall. Compared against the
    // element's own computed line-height + 1px of rounding, so this holds
    // whatever face the page ended up in.
    height: el.getBoundingClientRect().height,
    lineHeight: parseFloat(getComputedStyle(el).lineHeight) || 0,
    whiteSpace: getComputedStyle(el).whiteSpace,
    textOverflow: getComputedStyle(el).textOverflow,
    truncated: el.scrollWidth > el.clientWidth + 1,
  }))

  const navStyle = nav ? getComputedStyle(nav) : null

  return {
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
    scrollY: window.scrollY,
    maxScroll: document.documentElement.scrollHeight - window.innerHeight,
    navBox,
    navBackground: navStyle?.backgroundColor || null,
    navBackdrop: navStyle?.backdropFilter || navStyle?.webkitBackdropFilter || 'none',
    navBorderTop: navStyle?.borderTopWidth || '0px',
    gameHeights: [...document.querySelectorAll('.lhx-game')].map((el) => el.offsetHeight),
    gameCount: document.querySelectorAll('.lhx-game').length,
    rowNames: [...document.querySelectorAll('.lhx-game b')].map((el) => el.textContent.trim()),
    unopenableRows: [...document.querySelectorAll('.lhx-game')].filter((el) => el.tagName !== 'A').length,
    heroGrades: [...document.querySelectorAll('.lhx-gh-hero-grade')].map((el) => el.textContent.trim()),
    barHeight: document.querySelector('.lhx-gh-bar')?.offsetHeight ?? null,
    progressBars: document.querySelectorAll('.lhx-game .lhx-gc-bar, .lhx-game progress, .lhx-game-bar').length,
    dailyGradeAsked: window.__gamesHubDailyGradeAsked,
    shelfScrollbar: (() => {
      const shelf = document.querySelector('.lhx-badge-shelf')
      if (!shelf) return null
      return { hidden: shelf.offsetHeight - shelf.clientHeight === 0, snap: getComputedStyle(shelf).scrollSnapType }
    })(),
    under,
    oneLiners,
    error: window.__gamesHubError || null,
  }
}

/* ── Driver ──────────────────────────────────────────────────────────── */

const failures = []
const notes = []
function check(ok, message) { if (!ok) failures.push(message) }

const { js, css } = await buildBundle()
const nunito = await inlineNunito()

const browser = await puppeteer.launch({
  headless: true,
  executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--font-render-hinting=none'],
})

let nunitoLoaded = null

try {
  for (const theme of THEMES) {
    const html = page({ js, css, theme })
    writeFileSync(join(OUT, `games-hub-${theme.id}.html`), html)
    for (const vp of VIEWPORTS) {
      const p = await browser.newPage()
      // Serve `/images/...` off disk. The mascot art is an <img src="/images/…">
      // — a real request the app answers from `public/`. Left unhandled it
      // renders as an empty box, which changes nothing measured here but
      // makes every screenshot a picture of a page with a hole in it.
      // Anything else that escapes to the network is ABORTED rather than
      // allowed: a harness that quietly depends on a request is one that
      // fails differently on a machine with no route to it.
      await p.setRequestInterception(true)
      p.on('request', (req) => {
        const url = req.url()
        if (url.startsWith('data:') || url === 'about:blank') return req.continue()
        const local = url.match(/^https?:\/\/[^/]+(\/images\/.+?)(?:\?.*)?$/)
        if (local) {
          try {
            const body = readFileSync(join(ROOT, 'public', local[1]))
            const ext = local[1].split('.').pop().toLowerCase()
            const type = { webp: 'image/webp', png: 'image/png', jpg: 'image/jpeg', svg: 'image/svg+xml' }[ext]
            return req.respond({ status: 200, contentType: type || 'application/octet-stream', body })
          } catch { /* fall through to the abort below */ }
        }
        return req.abort()
      })
      await p.setViewport({ width: vp.width, height: vp.height, deviceScaleFactor: 2 })
      // No network is involved — the fonts are inlined and the bundle is
      // inline — so `load` is the whole story and cannot hang on a
      // request this container has no route for.
      await p.setContent(html, { waitUntil: 'load', timeout: 30_000 })
      await p.waitForFunction('window.__gamesHubReady === true', { timeout: 20_000 })
      // …and then for the page to actually BE the page under test.
      //
      // The readiness flag says React committed; it does not say the hub's
      // data arrived, and the first commit is the loading skeleton. That
      // skeleton has no game rows and only one hero — so every rule below
      // would have measured an empty list and called it uniform. Waiting on
      // the rendered content instead of on a sleep is both faster and the
      // only version that cannot silently measure the wrong screen.
      await p.waitForFunction(
        (n) => document.querySelectorAll('.lhx-game').length >= n
          && document.querySelectorAll('.lhx-gh-hero-grade').length === 2
          && !document.querySelector('.lhx-skel'),
        { timeout: 20_000 },
        EXPECTED_ROWS.length,
      ).catch(() => {
        throw new Error(
          `${vp.id} ${theme.id}: the hub never finished loading — `
          + 'rows/heroes/skeletons never reached the settled state',
        )
      })
      await p.evaluate(() => document.fonts.ready)

      if (nunitoLoaded === null) {
        nunitoLoaded = await p.evaluate(() => document.fonts.check('700 16px Nunito'))
      }

      const where = `${vp.id} ${theme.id}`

      // The state the live bug is visible in: the very bottom of the list,
      // with both pieces of chrome SHOWN.
      //
      // Forcing them shown is the point rather than a convenience. Both
      // auto-hide on scroll-down, so measuring what a scroll-to-bottom
      // leaves on screen would measure a page with no chrome on it and
      // pass trivially. And scrolling back up to reveal them moves the
      // content down, which puts the last card under the pill at every
      // possible bottom padding — fixed chrome always covers SOMETHING
      // mid-scroll; that is what fixed means. The rule being asserted is
      // the reachable one: at the end of the list, with the chrome out,
      // nothing is behind it.
      await p.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight))
      await new Promise((r) => setTimeout(r, 120))
      await p.evaluate(() => {
        for (const [sel, cls] of [['.lhx-nav', 'lhx-nav-hidden']]) {
          const el = document.querySelector(sel)
          if (!el) continue
          el.classList.remove(cls)
          el.style.transition = 'none'
        }
        // Re-pin to the true bottom: revealing the chrome changes nothing
        // about layout, but a stray scroll event during the reveal would.
        window.scrollTo(0, document.documentElement.scrollHeight)
      })
      await new Promise((r) => setTimeout(r, 120))
      // Is the page still THERE? Asked explicitly, because the way this
      // harness breaks is not the way it looks like it breaks. Both stub
      // gaps found on 2026-08-19 were modules added to the hub's graph
      // long after this file was written, and the lazy one (the deletion
      // banner) resolved a tick AFTER a correct first render: the settle
      // wait passed on a good page, the chunk then threw inside a
      // <Suspense> with no boundary above it, React unmounted everything,
      // and the harness reported eleven separate layout failures per
      // viewport — "the tab bar is not opaque", "rows are not all the same
      // height — []" — about a page that no longer existed. One check that
      // names the real cause is worth more than forty that describe its
      // shadow, so this runs FIRST and short-circuits the rest.
      const alive = await p.evaluate(() => ({
        thrown: window.__gamesHubError || null,
        rootChildren: document.getElementById('root')?.childElementCount ?? 0,
      }))
      if (alive.thrown || alive.rootChildren === 0) {
        check(false, `${where}: the page unmounted before it could be measured${
          alive.thrown ? ` — ${alive.thrown}` : ' (root is empty; look for an unstubbed module reaching Firebase)'}`)
        await p.close()
        continue
      }

      const bottom = await p.evaluate(measure)

      check(!bottom.error, `${where}: the page threw — ${bottom.error}`)

      // 1. Nothing under the fixed chrome.
      check(
        bottom.under.nav.length === 0,
        `${where}: ${bottom.under.nav.length} element(s) render under the tab bar:\n      ${bottom.under.nav.slice(0, 6).join('\n      ')}`,
      )

      // 2. No horizontal overflow.
      check(
        bottom.scrollWidth === bottom.clientWidth,
        `${where}: horizontal overflow — scrollWidth ${bottom.scrollWidth} vs clientWidth ${bottom.clientWidth}`,
      )

      // 3. Every game row the same height.
      const heights = new Set(bottom.gameHeights)
      // `===` rather than `>=`, in both directions: a cross-grade pack
      // leaking back in would ADD a row, and the pre-2026-08-19 one-pack-
      // per-mechanic rule would DROP two (g-mean2 and the timed_quiz).
      check(
        bottom.gameCount === EXPECTED_ROWS.length,
        `${where}: expected exactly ${EXPECTED_ROWS.length} catalogue rows, found ${bottom.gameCount}`,
      )
      check(
        bottom.rowNames.join(' | ') === EXPECTED_ROWS.join(' | '),
        `${where}: the catalogue is not the expected rows in order\n      want: ${EXPECTED_ROWS.join(' | ')}\n      got:  ${bottom.rowNames.join(' | ')}`,
      )
      check(
        bottom.unopenableRows === 2,
        `${where}: expected two rows that do not open (Word Builder has no grade-7 pack, Map Quest has no engine), found ${bottom.unopenableRows}`,
      )
      check(
        heights.size === 1,
        `${where}: game rows are not all the same height — ${JSON.stringify(bottom.gameHeights)}`,
      )

      // 4. One-line strings stay on one line, and the hostile one truncates.
      for (const el of bottom.oneLiners) {
        check(
          el.whiteSpace === 'nowrap',
          `${where}: "${el.what}" is not nowrap (${el.whiteSpace}) — it can reflow its card`,
        )
        check(
          el.textOverflow === 'ellipsis',
          `${where}: "${el.what}" has no ellipsis — it would clip mid-letter`,
        )
        if (el.lineHeight > 0) {
          check(
            el.height <= el.lineHeight + 1,
            `${where}: "${el.what}" is ${el.height}px tall against a ${el.lineHeight}px line — it wrapped`,
          )
        }
      }
      if (vp.id === 'phone') {
        const anyTruncated = bottom.oneLiners.some((el) => el.truncated)
        check(anyTruncated, `${where}: the deliberately over-long game name did not truncate — the harness is not exercising the rule it claims to`)
      }

      // 5. The tab bar is opaque.
      check(
        /^rgb\(\d+, \d+, \d+\)$/.test(bottom.navBackground || ''),
        `${where}: the tab bar is not opaque — background ${bottom.navBackground}`,
      )
      check(
        bottom.navBackdrop === 'none',
        `${where}: the tab bar still carries a backdrop filter (${bottom.navBackdrop}) — content behind it is meant to be impossible, not blurred`,
      )

      // 6. The pass's other promises, measured while we are here.
      check(bottom.progressBars === 0, `${where}: ${bottom.progressBars} per-game progress bar(s) survive`)
      check(
        bottom.heroGrades.length === 2 && new Set(bottom.heroGrades).size === 1,
        `${where}: the two hero grade pills disagree or are missing — ${JSON.stringify(bottom.heroGrades)}`,
      )
      check(
        bottom.heroGrades[0] === `Grade ${FIXTURE.profile.grade}`,
        `${where}: the hero pill reads ${bottom.heroGrades[0]}, not the learner's Grade ${FIXTURE.profile.grade}`,
      )
      check(
        bottom.dailyGradeAsked === FIXTURE.profile.grade,
        `${where}: the daily quiz was asked for grade ${bottom.dailyGradeAsked}, not the learner's ${FIXTURE.profile.grade}`,
      )
      check(bottom.barHeight === 52, `${where}: the top bar is ${bottom.barHeight}px, not 52`)
      check(
        bottom.shelfScrollbar?.hidden === true,
        `${where}: the achievements shelf still reserves a native scrollbar`,
      )
      check(
        (bottom.shelfScrollbar?.snap || '').includes('mandatory'),
        `${where}: the achievements shelf has no scroll-snap (${bottom.shelfScrollbar?.snap})`,
      )

      // Screenshots: top of the hub and the scrolled state, both states
      // the acceptance asks to see.
      await p.evaluate(() => window.scrollTo(0, 0))
      await new Promise((r) => setTimeout(r, 350))
      await p.screenshot({ path: join(OUT, `${vp.id}-${theme.id}-top.png`) })
      await p.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight))
      await new Promise((r) => setTimeout(r, 120))
      await p.evaluate(() => {
        for (const [sel, cls] of [['.lhx-nav', 'lhx-nav-hidden']]) {
          document.querySelector(sel)?.classList.remove(cls)
        }
        window.scrollTo(0, document.documentElement.scrollHeight)
      })
      await new Promise((r) => setTimeout(r, 400))
      await p.screenshot({ path: join(OUT, `${vp.id}-${theme.id}-bottom.png`) })

      notes.push(
        `  ${where.padEnd(15)} rows ${JSON.stringify([...heights])}px · nav ${bottom.navBackground} · no overflow (${bottom.scrollWidth}px)`,
      )
      await p.close()
    }
  }
} finally {
  await browser.close()
}

console.log('\n/games layout harness')
console.log(notes.join('\n'))
console.log(
  nunitoLoaded
    ? '  Nunito inlined and loaded — text measurements are against the shipped face.'
    : `  ⚠ Nunito UNAVAILABLE (${nunito.why || 'not applied'}) — the one-line checks ran against a\n` +
      '    fallback face. Box rules (chrome collision, overflow, row heights) are\n' +
      '    font-independent and still hold; the text ones measured the wrong metrics.',
)
console.log(`  screenshots → ${OUT}`)

if (failures.length) {
  console.error(`\n✗ ${failures.length} failure(s):\n  • ${failures.join('\n  • ')}\n`)
  process.exit(1)
}
console.log('\n✓ games hub layout — nothing under the chrome, no overflow, uniform rows, no wrapping\n')
