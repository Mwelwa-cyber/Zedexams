/**
 * Static prerendering of the public, indexable routes (SEO follow-up).
 *
 * ZedExams is a pure client-rendered SPA. Googlebot *can* render JS, but on
 * a young, low-authority domain the two-pass render queue is slow and
 * unreliable — which showed up in Search Console first as "Discovered –
 * currently not indexed" and then as "Duplicate without user-selected
 * canonical" across the marketing/content pages. This script boots the
 * already-built app in headless Chrome, lets React + react-helmet-async
 * paint each route, and snapshots the resulting HTML to disk so crawlers get
 * real content + the correct per-route <title>/<meta>/<link rel=canonical>
 * on the very first fetch, before any JS runs.
 *
 * The route list lives in scripts/prerenderRoutes.mjs (a puppeteer-free module
 * so the CI route test can import it). Anything advertised in sitemap.xml MUST
 * be in that list — otherwise the route falls back to the canonical-less SPA
 * shell and Google files it as a duplicate of the homepage.
 *
 * Design decisions (see also the PR description):
 *
 *  - It runs AFTER `vite build`, never as part of it. `npm run build` stays
 *    Chromium-free so Android/Capacitor builds and lint-only CI don't pull a
 *    browser. Only `deploy-hosting.yml` runs this step.
 *
 *  - We DO prerender "/" (the homepage) — into dist/index.html — so crawlers,
 *    social scrapers, and slow cold mobile loads get real content + the correct
 *    self-canonical on the first fetch instead of a blank SPA shell (real-user
 *    p75 FCP/LCP on "/" was several seconds). The old reason for skipping it was
 *    that dist/index.html doubled as the SPA fallback for every route without
 *    its own file, so baking canonical="/" into it poisoned those fallback
 *    routes. We break that coupling here: BEFORE prerendering "/", we copy the
 *    neutral, canonical-less shell to dist/app.html, and firebase.json's `**`
 *    fallback now points at /app.html. So fallback routes still get a neutral
 *    shell; only a literal request to "/" gets the homepage snapshot.
 *
 *  - Data-driven public pages (/papers, /games, /games/leaderboard, /status)
 *    ARE prerendered. They read live Firestore at runtime, so the snapshot
 *    bakes only the static page chrome + a loading state — but crucially the
 *    correct head/canonical. The live body re-renders on client boot and on
 *    Google's JS pass; the baked-but-stale body in the raw HTML is the price
 *    of giving each page a self-canonical, which is what gets them indexed at
 *    all instead of dropped as duplicates.
 *
 *  - We keep createRoot (no switch to hydrateRoot). The client throws the
 *    snapshot away and re-renders on boot — a sub-frame flash we accept in
 *    exchange for zero hydration-mismatch risk across theme/auth/i18n state.
 *
 * Firebase Hosting serves dist/<route>/index.html for a request to /<route>
 * (directory index); firebase.json sets `trailingSlash: false` so the
 * no-slash sitemap URLs are served without a redirect.
 */

import { preview } from 'vite'
import puppeteer from 'puppeteer'
import { mkdirSync, writeFileSync, existsSync, copyFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildRouteList } from './prerenderRoutes.mjs'
import { MIN_ROOT_TEXT, prerenderRouteWithRetry } from './prerenderRetry.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..')
const DIST = join(ROOT, 'dist')

// Per-route navigation/render timeout. The visible-text floor (MIN_ROOT_TEXT)
// and the attempt budget moved to prerenderRetry.mjs, next to the policy that
// enforces them, so the node test drives the same constants the deploy does.
const NAV_TIMEOUT_MS = 30_000

/** Map a route to the dist file path Firebase serves as its directory index. */
function outputPathFor(route) {
  return join(DIST, route.replace(/^\//, ''), 'index.html')
}

async function launchBrowser() {
  return puppeteer.launch({
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      // Headless/backgrounded pages get their timers and requestAnimationFrame
      // heavily throttled. react-helmet-async flushes head tags (title,
      // canonical, og:*) on an rAF tick, so throttling can delay the canonical
      // landing in <head> past our settle window — which surfaced as an
      // intermittent `canonical "null"` failure on the smallest route
      // (/grade-12's tiny "coming soon" page hit the content gate before the
      // head flush). Keep the renderer foregrounded so the flush is prompt.
      '--disable-background-timer-throttling',
      '--disable-backgrounding-occluded-windows',
      '--disable-renderer-backgrounding',
    ],
  })
}

async function main() {
  if (!existsSync(join(DIST, 'index.html'))) {
    console.error('[prerender] dist/index.html not found — run `npm run build` first.')
    process.exit(1)
  }

  // Preserve the freshly-built, canonical-less SPA shell as dist/app.html BEFORE
  // we prerender "/" over dist/index.html below. Firebase Hosting's `**` fallback
  // now points at /app.html (see firebase.json), so every route without its own
  // prerendered file gets this neutral shell — never the homepage's content or
  // its canonical="/" (which is exactly the duplicate-canonical poisoning we
  // avoided by NOT prerendering "/" before). The homepage itself is served from
  // dist/index.html, which "/" overwrites with a real snapshot in the loop.
  copyFileSync(join(DIST, 'index.html'), join(DIST, 'app.html'))
  console.log('[prerender] saved neutral SPA shell → dist/app.html (Hosting ** fallback)')

  // "/" is prerendered LAST, on purpose. The Vite preview server serves
  // dist/index.html as the live SPA fallback for every route it renders, so if we
  // overwrote it with the homepage snapshot (which carries a baked canonical="/")
  // up front, every subsequent route would read that canonical off the served
  // <head> and fail its gate. Rendering "/" last keeps the neutral shell live
  // until the very end. Anonymous "/" renders <Marketing/> with
  // <SeoHelmet path="/">, so it satisfies the same content + canonical gates;
  // outputPathFor('/') resolves to dist/index.html.
  const routes = [...buildRouteList(), '/']
  console.log(`[prerender] ${routes.length} route(s):`, routes.join(', '))

  const server = await preview({
    root: ROOT,
    preview: { port: 0, strictPort: false, host: '127.0.0.1' },
  })
  const base = server.resolvedUrls.local[0].replace(/\/$/, '')
  console.log(`[prerender] preview server at ${base}`)

  let browser = await launchBrowser()

  // One page per attempt: renderRoute opens its own page and closes it in a
  // finally, so a retry always starts clean instead of reusing the page that
  // stalled. WHEN to retry — and the SEO gates a snapshot must clear before it
  // is written — live in prerenderRetry.mjs, which is puppeteer-free so
  // scripts/test-prerender-retry.mjs can drive the real deploy-blocking policy
  // without launching Chromium.
  const renderRoute = async (route) => {
    if (!browser.connected) {
      browser = await launchBrowser()
    }
    const page = await browser.newPage()
    try {
      await page.goto(`${base}${route}`, {
        waitUntil: 'domcontentloaded',
        timeout: NAV_TIMEOUT_MS,
      })
      // Wait until React has painted real content into #root AND
      // react-helmet-async has flushed the per-route canonical into <head>.
      // We avoid networkidle because dummy/real Firestore keeps a long-poll
      // open that never goes idle. Gating on the canonical (not just text
      // length) is what makes this reliable: every prerendered route renders
      // a <SeoHelmet path="…">, so a present canonical is the precise signal
      // that the head has been written. Waiting on text alone let the tiny
      // "coming soon" route snapshot a default-shell head (correct-looking
      // title from index.html, but a null canonical) before Helmet's rAF
      // flush ran — an intermittent build break.
      await page.waitForFunction(
        (min) => {
          const root = document.getElementById('root')
          const hasText = !!root && (root.innerText || '').trim().length >= min
          const canonical = document.querySelector('link[rel="canonical"]')
          return hasText && !!canonical?.getAttribute('href')
        },
        { timeout: NAV_TIMEOUT_MS },
        MIN_ROOT_TEXT,
      )
      // Small settle so the remaining react-helmet-async tags (description,
      // og:*, twitter:*) have flushed alongside the canonical we waited on.
      await new Promise((r) => setTimeout(r, 250))

      return await page.evaluate(() => {
        // The shell (index.html) ships generic, homepage-flavoured <meta>
        // tags (description, og:*, twitter:*). react-helmet-async appends
        // its own per-route versions to the END of <head> but cannot remove
        // the static ones it didn't author, so the head ends up with
        // duplicates — generic first, correct second. Crawlers read
        // top-down (and Google may pick the FIRST description), so for any
        // name/property that appears more than once we keep the LAST
        // occurrence (Helmet's per-route tag) and drop the earlier static
        // twin. We dedup by document order rather than a marker attribute
        // because react-helmet-async v3 no longer stamps data-rh. (The
        // canonical link has no static twin — that was removed from
        // index.html in the prior fix.)
        const metas = [...document.head.querySelectorAll('meta[name], meta[property]')]
        const keyOf = (m) =>
          m.getAttribute('name')
            ? `name:${m.getAttribute('name')}`
            : `prop:${m.getAttribute('property')}`
        const lastByKey = new Map()
        for (const m of metas) lastByKey.set(keyOf(m), m) // last write wins
        for (const m of metas) {
          if (lastByKey.get(keyOf(m)) !== m) m.remove()
        }

        // Deduplicate <title> elements. React 19's mountHoistable inserts
        // the per-route <title> BEFORE any existing static shell title via
        // head.insertBefore(newTitle, head.querySelector("head > title")),
        // leaving the static shell title as an orphaned second element.
        // Keep the FIRST (the per-route one); remove any later twins.
        // Logic mirrors scripts/prerenderHeadDedup.mjs dedupTitleTags().
        const titles = [...document.head.querySelectorAll('title')]
        if (titles.length > 1) {
          titles.slice(1).forEach((t) => t.remove())
        }

        const root = document.getElementById('root')
        const link = document.querySelector('link[rel="canonical"]')
        return {
          html: `<!DOCTYPE html>\n${document.documentElement.outerHTML}`,
          title: document.title || '',
          canonical: link ? link.getAttribute('href') : null,
          rootLen: (root?.innerText || '').trim().length,
        }
      })
    } finally {
      await page.close().catch(() => {})
    }
  }

  const writeSnapshot = (route, { html, title }) => {
    const out = outputPathFor(route)
    mkdirSync(dirname(out), { recursive: true })
    writeFileSync(out, html, 'utf8')
    console.log(`[prerender] ✓ ${route} → ${out.replace(ROOT + '/', '')} (title: "${title}")`)
  }

  const failures = []
  try {
    for (const route of routes) {
      const failure = await prerenderRouteWithRetry(route, {
        renderRoute,
        onSuccess: writeSnapshot,
        // A dead browser needs a whole new browser; a stalled render only
        // needs a fresh page, which renderRoute already takes every attempt.
        relaunchBrowser: async () => {
          await browser.close().catch(() => {})
          browser = await launchBrowser()
        },
      })
      if (failure) failures.push(failure)
    }
  } finally {
    await browser.close()
    server.httpServer.close()
  }

  if (failures.length) {
    console.error(`\n[prerender] FAILED on ${failures.length} route(s):`)
    for (const f of failures) console.error(`  ✗ ${f}`)
    process.exit(1)
  }
  console.log(`\n[prerender] done — ${routes.length} route(s) prerendered.`)
}

main().catch((err) => {
  console.error('[prerender] fatal:', err)
  process.exit(1)
})
