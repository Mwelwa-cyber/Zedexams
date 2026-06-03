/**
 * Static prerendering of the public, content-only routes (SEO follow-up).
 *
 * ZedExams is a pure client-rendered SPA. Googlebot *can* render JS, but on
 * a young, low-authority domain the two-pass render queue is slow and
 * unreliable — which showed up in Search Console as "Discovered – currently
 * not indexed" across the marketing/content pages. This script boots the
 * already-built app in headless Chrome, lets React + react-helmet-async
 * paint each route, and snapshots the resulting HTML to disk so crawlers get
 * real content + the correct per-route <title>/<meta>/<link rel=canonical>
 * on the very first fetch, before any JS runs.
 *
 * Design decisions (see also the PR description):
 *
 *  - It runs AFTER `vite build`, never as part of it. `npm run build` stays
 *    Chromium-free so Android/Capacitor builds and lint-only CI don't pull a
 *    browser. Only `deploy-hosting.yml` runs this step.
 *
 *  - We DO NOT prerender "/" (the homepage). dist/index.html doubles as the
 *    SPA fallback that Firebase Hosting serves for every route without its
 *    own file (e.g. /papers, /games, /status, the whole authed app). If we
 *    baked the homepage's canonical="/" into it, every fallback route would
 *    re-inherit the homepage-canonical bug we just removed. Leaving
 *    index.html as the neutral shell keeps the fallback safe; the homepage
 *    is already indexed and Google renders it fine.
 *
 *  - Only STATIC routes are listed. Data-driven public pages (/papers,
 *    /games/leaderboard, /status) read live Firestore at runtime; a build-
 *    time snapshot would bake in stale/empty content, so they stay on the
 *    client-rendered fallback on purpose.
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
import { readFileSync, readdirSync, mkdirSync, writeFileSync, existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..')
const DIST = join(ROOT, 'dist')
const BLOG_DIR = join(ROOT, 'content', 'blog')

// Per-route render timeout and the minimum amount of visible text we require
// before we trust a route has actually painted (guards against snapshotting
// an empty shell or a crash screen).
const NAV_TIMEOUT_MS = 30_000
const MIN_ROOT_TEXT = 200

/** Discover blog post slugs from the markdown source (mirrors blogPosts.js). */
function discoverBlogSlugs() {
  if (!existsSync(BLOG_DIR)) return []
  return readdirSync(BLOG_DIR)
    .filter((f) => f.endsWith('.md'))
    .map((file) => {
      const raw = readFileSync(join(BLOG_DIR, file), 'utf8')
      const m = raw.match(/^---\s*\n([\s\S]*?)\n---/)
      const slugLine = m && m[1].split('\n').find((l) => l.trim().startsWith('slug:'))
      const slug = slugLine
        ? slugLine.split(':')[1].trim().replace(/^['"]|['"]$/g, '')
        : file.replace(/\.md$/, '')
      return slug
    })
}

/**
 * Static, content-only public routes. The homepage is intentionally absent
 * (it stays the neutral SPA fallback — see header).
 *
 * The /grade-N marketing pages are deliberately excluded: the route pattern
 * `/grade-:gradeSlug` is a partial dynamic segment that React Router v6 does
 * not match, so those URLs currently render the 404 page. Prerendering them
 * would bake a "not found" screen into a real file. They're not in the
 * sitemap either. Add them back here once the routing is fixed.
 */
function buildRouteList() {
  const routes = ['/pricing', '/privacy', '/terms', '/blog']
  for (const slug of discoverBlogSlugs()) routes.push(`/blog/${slug}`)
  return routes
}

/** Map a route to the dist file path Firebase serves as its directory index. */
function outputPathFor(route) {
  return join(DIST, route.replace(/^\//, ''), 'index.html')
}

async function main() {
  if (!existsSync(join(DIST, 'index.html'))) {
    console.error('[prerender] dist/index.html not found — run `npm run build` first.')
    process.exit(1)
  }

  const routes = buildRouteList()
  console.log(`[prerender] ${routes.length} route(s):`, routes.join(', '))

  const server = await preview({
    root: ROOT,
    preview: { port: 0, strictPort: false, host: '127.0.0.1' },
  })
  const base = server.resolvedUrls.local[0].replace(/\/$/, '')
  console.log(`[prerender] preview server at ${base}`)

  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  })

  const failures = []
  try {
    for (const route of routes) {
      const page = await browser.newPage()
      try {
        await page.goto(`${base}${route}`, {
          waitUntil: 'domcontentloaded',
          timeout: NAV_TIMEOUT_MS,
        })
        // Wait until React has painted real content into #root. We avoid
        // networkidle because dummy/real Firestore keeps a long-poll open
        // that never goes idle.
        await page.waitForFunction(
          (min) => {
            const root = document.getElementById('root')
            return !!root && (root.innerText || '').trim().length >= min
          },
          { timeout: NAV_TIMEOUT_MS },
          MIN_ROOT_TEXT,
        )
        // Small settle so react-helmet-async has flushed head tags.
        await new Promise((r) => setTimeout(r, 250))

        const { html, title, canonical, rootLen } = await page.evaluate(() => {
          // The shell (index.html) ships generic, homepage-flavoured <meta>
          // tags (description, og:*, twitter:*). react-helmet-async appends
          // its own per-route versions (marked data-rh="true") but cannot
          // remove the static ones it didn't author, so the head ends up
          // with duplicates — generic first, correct second. Crawlers read
          // top-down, so strip the static duplicate whenever Helmet set its
          // own for the same name/property. (The canonical link has no static
          // twin — that was removed from index.html in the prior fix.)
          const metas = [...document.head.querySelectorAll('meta[name], meta[property]')]
          const keyOf = (m) =>
            m.getAttribute('name')
              ? `name:${m.getAttribute('name')}`
              : `prop:${m.getAttribute('property')}`
          const helmetKeys = new Set(
            metas.filter((m) => m.hasAttribute('data-rh')).map(keyOf),
          )
          for (const m of metas) {
            if (!m.hasAttribute('data-rh') && helmetKeys.has(keyOf(m))) m.remove()
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

        // Sanity gates — a route that renders an empty/crash shell, loses its
        // SEO title, or carries the wrong canonical must fail the build
        // rather than ship a regression.
        const expectedCanonical = `https://zedexams.com${route}`
        if (rootLen < MIN_ROOT_TEXT) {
          failures.push(`${route}: too little content (${rootLen} chars)`)
        } else if (!title.includes('ZedExams')) {
          failures.push(`${route}: missing SEO title (got "${title}")`)
        } else if (canonical !== expectedCanonical) {
          failures.push(`${route}: canonical "${canonical}" != "${expectedCanonical}"`)
        } else {
          const out = outputPathFor(route)
          mkdirSync(dirname(out), { recursive: true })
          writeFileSync(out, html, 'utf8')
          console.log(`[prerender] ✓ ${route} → ${out.replace(ROOT + '/', '')}  (title: "${title}")`)
        }
      } catch (err) {
        failures.push(`${route}: ${err?.message || err}`)
      } finally {
        await page.close()
      }
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
