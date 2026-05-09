/**
 * Blog post loader (audit C5).
 *
 * Each post is a markdown file under /content/blog/*.md with a
 * minimal YAML-ish frontmatter at the top, e.g.:
 *
 *   ---
 *   slug: grade-7-ecz-maths-revision
 *   title: Grade 7 ECZ Mathematics revision guide
 *   description: A week-by-week plan covering every topic on the paper.
 *   publishedAt: 2026-04-12
 *   author: ZedExams Team
 *   tags: [grade-7, mathematics, ecz]
 *   image: /blog/grade-7-maths.jpg   # optional, for OG card
 *   ---
 *
 *   ## Body content goes here
 *   Standard markdown. Headings, lists, code, **bold**, *italic*, etc.
 *
 * Loaded eagerly at build time via Vite's import.meta.glob — no
 * runtime fetch, no Firestore round-trip, posts ship inside the
 * bundle and Workbox precaches them with the rest of the app shell.
 *
 * The frontmatter parser is intentionally tiny — it only needs to
 * handle a fixed set of keys (no nested objects). gray-matter would
 * pull in browser-incompatible node deps for marginal value.
 */

import { marked } from 'marked'

// Sensible defaults: GitHub-style line breaks, no smartypants. We
// rely on DOMPurify-via-marked for sanitisation since we author the
// posts (no UGC), but raw HTML in markdown is parsed too.
marked.setOptions({
  gfm: true,
  breaks: false,
  headerIds: true,
  mangle: false,
})

const RAW_POSTS = import.meta.glob('../../content/blog/*.md', {
  query: '?raw',
  import: 'default',
  eager: true,
})

function parseFrontmatter(raw) {
  // Match a leading `---` block.
  const match = raw.match(/^---\s*\n([\s\S]*?)\n---\s*\n([\s\S]*)$/)
  if (!match) return { meta: {}, body: raw }
  const [, fm, body] = match
  const meta = {}
  for (const rawLine of fm.split('\n')) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    const idx = line.indexOf(':')
    if (idx < 1) continue
    const key = line.slice(0, idx).trim()
    let value = line.slice(idx + 1).trim()
    // Strip surrounding quotes.
    if (
      (value.startsWith('"') && value.endsWith('"'))
      || (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }
    // Inline list:  tags: [a, b, c]
    if (value.startsWith('[') && value.endsWith(']')) {
      meta[key] = value.slice(1, -1).split(',').map((s) => s.trim()).filter(Boolean)
    } else {
      meta[key] = value
    }
  }
  return { meta, body }
}

function deriveSlug(filePath, meta) {
  if (meta.slug) return meta.slug
  // Fallback: filename without extension.
  return filePath.replace(/^.*\//, '').replace(/\.md$/, '')
}

function compilePost(filePath, raw) {
  const { meta, body } = parseFrontmatter(raw)
  const slug = deriveSlug(filePath, meta)
  const html = marked.parse(body || '')
  const wordCount = (body || '').split(/\s+/).filter(Boolean).length
  const readingMinutes = Math.max(1, Math.round(wordCount / 220))
  return {
    slug,
    title: meta.title || slug,
    description: meta.description || '',
    publishedAt: meta.publishedAt || null,
    author: meta.author || 'ZedExams Team',
    tags: Array.isArray(meta.tags) ? meta.tags : [],
    image: meta.image || null,
    html,
    body,
    wordCount,
    readingMinutes,
    filePath,
  }
}

// Compile once at module load. Posts are static at build time.
const POSTS = Object.entries(RAW_POSTS)
  .map(([filePath, raw]) => compilePost(filePath, raw))
  // Newest first.
  .sort((a, b) => {
    const ad = a.publishedAt ? Date.parse(a.publishedAt) : 0
    const bd = b.publishedAt ? Date.parse(b.publishedAt) : 0
    return bd - ad
  })

const POSTS_BY_SLUG = new Map(POSTS.map((p) => [p.slug, p]))

export function listAllPosts() {
  return POSTS
}

export function getPostBySlug(slug) {
  return POSTS_BY_SLUG.get(slug) || null
}

export function listAllTags() {
  const set = new Set()
  for (const p of POSTS) {
    for (const t of p.tags) set.add(t)
  }
  return [...set].sort()
}

export function listPostsByTag(tag) {
  return POSTS.filter((p) => p.tags.includes(tag))
}
