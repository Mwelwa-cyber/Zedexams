/**
 * Public routes to statically prerender — the shared source of truth.
 *
 * This lives in its own puppeteer/vite-free module so the list can be imported
 * by BOTH scripts/prerender.mjs (the actual headless renderer, which pulls in
 * Chromium) and scripts/test-public-routes.mjs (a plain `node` test in the
 * required CI suite, which must NOT pull in a browser). The test asserts every
 * public sitemap URL is in this list, so no advertised page can ever ship the
 * canonical-less SPA shell again.
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..')
const BLOG_DIR = join(ROOT, 'content', 'blog')

/**
 * Discover blog posts from the markdown source (mirrors blogPosts.js).
 * Returns `{ slug, publishedAt, updatedAt }` per post — the dates feed the
 * sitemap generator's <lastmod> (scripts/generateSitemap.mjs); prerendering
 * itself only needs the slug.
 */
export function discoverBlogPosts() {
  if (!existsSync(BLOG_DIR)) return []
  return readdirSync(BLOG_DIR)
    .filter((f) => f.endsWith('.md'))
    .map((file) => {
      const raw = readFileSync(join(BLOG_DIR, file), 'utf8')
      const m = raw.match(/^---\s*\n([\s\S]*?)\n---/)
      const fmValue = (key) => {
        const line = m && m[1].split('\n').find((l) => l.trim().startsWith(`${key}:`))
        return line ? line.slice(line.indexOf(':') + 1).trim().replace(/^['"]|['"]$/g, '') : null
      }
      return {
        slug: fmValue('slug') || file.replace(/\.md$/, ''),
        publishedAt: fmValue('publishedAt'),
        updatedAt: fmValue('updatedAt'),
      }
    })
}

/** Discover blog post slugs from the markdown source (mirrors blogPosts.js). */
export function discoverBlogSlugs() {
  return discoverBlogPosts().map((p) => p.slug)
}

/**
 * Every PUBLIC, INDEXABLE route gets a build-time snapshot so crawlers read a
 * stable self-referencing <link rel="canonical"> on the very first fetch,
 * before any JS runs. A route that ISN'T listed here falls back to
 * dist/index.html — the neutral SPA shell, which carries no canonical — so
 * Googlebot reads identical raw HTML for it and the homepage and files it under
 * "Duplicate without user-selected canonical", keeping it out of the index.
 * Anything we advertise in public/sitemap.xml therefore MUST be listed here
 * (enforced by scripts/test-public-routes.mjs).
 *
 * The homepage ("/") is NOT in this list, but it IS prerendered — prerender.mjs
 * handles it directly (writing dist/index.html) after first copying the neutral
 * shell to dist/app.html, which Firebase Hosting's `**` fallback now serves. So
 * "/" gets its own snapshot without re-poisoning fallback routes with
 * canonical="/". Keeping it out of buildRouteList keeps this module the single
 * source of truth for the *sitemap* routes that test-public-routes enforces.
 *
 * Data-driven public pages (/papers, /games, /games/leaderboard, /status) read
 * live Firestore at runtime. We still prerender them: the snapshot captures the
 * static page chrome plus the correct per-route head/canonical, and the live
 * body re-renders on client boot and on Google's JS pass. That trade — a baked
 * loading/chrome state in the raw HTML — is what gets these pages indexed at
 * all instead of dropped as duplicates.
 */
export function buildRouteList() {
  const routes = [
    // Marketing / legal — fully static.
    '/pricing',
    '/teachers',
    '/privacy',
    '/terms',
    // Play Data safety "delete account" URL. Indexable on purpose: someone
    // who can no longer sign in has to be able to FIND this page, and search
    // is how they will look for it.
    '/delete-account',
    // Child safety standards — Play's CSAE declaration links to it, and a
    // parent looking for it will search rather than guess the URL.
    '/child-safety',
    // Revision blog index (individual posts appended below).
    '/blog',
    // ECZ past-paper archive + public games surfaces (data-driven; see above).
    '/papers',
    '/games',
    '/games/leaderboard',
    '/status',
  ]
  for (const slug of discoverBlogSlugs()) routes.push(`/blog/${slug}`)
  // Grade-pack landings — ECZ exam grades 7 (live) + 12 (coming soon).
  for (const grade of ['7', '12']) routes.push(`/grade-${grade}`)
  // The per-grade game subject pickers retired with learner redesign
  // step 8 — /games/g/* is a redirect to /games now, so the hub is the
  // one advertised games URL.
  return routes
}
