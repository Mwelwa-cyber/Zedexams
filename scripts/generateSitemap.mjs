#!/usr/bin/env node
/* global console, process */
/**
 * Sitemap generator — public/sitemap.xml is GENERATED, don't hand-edit it.
 *
 *   npm run sitemap          # regenerate public/sitemap.xml
 *   npm run test:sitemap-sync  # CI guard: checked-in file matches a fresh build
 *
 * Why generated: the sitemap used to be a hand-maintained file, so adding a
 * blog post (or any public route) silently left it stale — the post was
 * prerendered and indexable but never advertised to crawlers. Building the
 * URL list from scripts/prerenderRoutes.mjs (the same source of truth the
 * prerender step and scripts/test-public-routes.mjs already use) makes that
 * drift impossible: every advertised URL is prerendered by construction, and
 * every blog post is advertised the moment its markdown file exists.
 *
 * <lastmod> policy — only ever emit dates we can stand behind (Google ignores
 * lastmod entirely once it catches a site lying about it):
 *   - Blog posts: `updatedAt` (optional frontmatter key) falling back to
 *     `publishedAt`. /blog itself gets the newest post date.
 *   - Static marketing/legal routes: an explicit date in ROUTE_META, bumped
 *     by hand when a page's content materially changes. The initial values
 *     are the June 2026 prerender/canonical relaunch (#1187, #1444) — the
 *     last time every public page's head/canonical genuinely changed.
 *   - Data-driven routes (/papers, /games/leaderboard, /status): NO lastmod.
 *     Their prerendered shell is stable while the live data changes daily;
 *     either date we could emit would be wrong for one of the two.
 */
import { writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildRouteList, discoverBlogPosts } from './prerenderRoutes.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const OUT_PATH = join(resolve(__dirname, '..'), 'public', 'sitemap.xml')
const ORIGIN = 'https://zedexams.com'

// Per-route sitemap metadata. Every non-blog route in buildRouteList() MUST
// have an entry here — the generator throws otherwise, so adding a public
// route forces a conscious changefreq/priority (and optional lastmod) choice.
const ROUTE_META = {
  '/': { changefreq: 'weekly', priority: '1.0', lastmod: '2026-06-30' },
  '/pricing': { changefreq: 'monthly', priority: '0.8', lastmod: '2026-06-21' },
  '/teachers': { changefreq: 'monthly', priority: '0.9', lastmod: '2026-06-21' },
  '/grade-7': { changefreq: 'monthly', priority: '0.9', lastmod: '2026-06-21' },
  '/grade-12': { changefreq: 'monthly', priority: '0.7', lastmod: '2026-06-21' },
  '/papers': { changefreq: 'weekly', priority: '0.9' },
  '/blog': { changefreq: 'weekly', priority: '0.7' }, // lastmod: newest post, added below
  '/games': { changefreq: 'weekly', priority: '0.8', lastmod: '2026-08-17' },
  '/games/leaderboard': { changefreq: 'daily', priority: '0.6' },
  '/privacy': { changefreq: 'yearly', priority: '0.3', lastmod: '2026-07-29' },
  '/terms': { changefreq: 'yearly', priority: '0.3', lastmod: '2026-07-29' },
  '/delete-account': { changefreq: 'yearly', priority: '0.3', lastmod: '2026-07-29' },
  '/child-safety': { changefreq: 'yearly', priority: '0.3', lastmod: '2026-07-29' },
  '/status': { changefreq: 'daily', priority: '0.3' },
}

const BLOG_POST_META = { changefreq: 'monthly', priority: '0.6' }

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

function assertDate(value, context) {
  if (value != null && !DATE_RE.test(value)) {
    throw new Error(`${context}: lastmod "${value}" is not a YYYY-MM-DD date`)
  }
  return value
}

function urlEntry(path, { changefreq, priority, lastmod }) {
  const lines = [
    '  <url>',
    `    <loc>${ORIGIN}${path === '/' ? '/' : path}</loc>`,
  ]
  if (lastmod) lines.push(`    <lastmod>${lastmod}</lastmod>`)
  lines.push(
    `    <changefreq>${changefreq}</changefreq>`,
    `    <priority>${priority}</priority>`,
    '  </url>',
  )
  return lines.join('\n')
}

export function buildSitemapXml() {
  const posts = discoverBlogPosts()
  const postDates = new Map(
    posts.map((p) => [
      `/blog/${p.slug}`,
      assertDate(p.updatedAt, `blog ${p.slug} updatedAt`)
        || assertDate(p.publishedAt, `blog ${p.slug} publishedAt`),
    ]),
  )
  const newestPost = [...postDates.values()].filter(Boolean).sort().at(-1) || null

  const entries = ['/', ...buildRouteList()].map((path) => {
    if (postDates.has(path)) {
      return urlEntry(path, { ...BLOG_POST_META, lastmod: postDates.get(path) })
    }
    const meta = ROUTE_META[path]
    if (!meta) {
      throw new Error(
        `generateSitemap: route "${path}" from buildRouteList() has no ROUTE_META entry — `
          + 'add one (changefreq/priority, optional lastmod) so it can be advertised.',
      )
    }
    assertDate(meta.lastmod, `ROUTE_META ${path}`)
    const lastmod = path === '/blog' ? (meta.lastmod || newestPost) : meta.lastmod
    return urlEntry(path, { ...meta, lastmod })
  })

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!-- GENERATED FILE — do not edit by hand. Regenerate with `npm run sitemap`',
    '     (scripts/generateSitemap.mjs). URL list comes from',
    '     scripts/prerenderRoutes.mjs, so every advertised page is prerendered',
    '     with a self-canonical by construction. -->',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...entries,
    '</urlset>',
    '',
  ].join('\n')
}

// CLI: write the file when invoked directly (not when imported by the test).
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const xml = buildSitemapXml()
  writeFileSync(OUT_PATH, xml)
  const count = (xml.match(/<url>/g) || []).length
  console.log(`sitemap: wrote ${count} URLs to public/sitemap.xml`)
}
