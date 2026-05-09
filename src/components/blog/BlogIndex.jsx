/**
 * /blog — list of every published post (audit C5).
 *
 * Pure static surface — posts ship inside the JS bundle via the Vite
 * import.meta.glob loader. No Firestore reads, no API hits, fast
 * TTFB. Shape:
 *   - Hero with the section title + a one-line pitch.
 *   - Card per post (title + description + meta + tag chips).
 *   - Clicking a card → /blog/:slug.
 *
 * Stays public (no auth) and Disallow'd-from-search-no, intentionally
 * indexable — this is the SEO surface.
 */

import { Link } from 'react-router-dom'
import { listAllPosts } from '../../utils/blogPosts'
import SeoHelmet from '../seo/SeoHelmet'
import Logo from '../ui/Logo'

function fmtDate(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' })
}

function PostCard({ post }) {
  return (
    <Link
      to={`/blog/${post.slug}`}
      className="theme-card border theme-border rounded-radius-md p-5 hover:theme-bg-subtle transition-colors block"
    >
      <p className="theme-text-muted text-[11px] uppercase tracking-widest font-bold">
        {fmtDate(post.publishedAt)} · {post.readingMinutes} min read
      </p>
      <h2 className="theme-text font-display font-black text-xl mt-2 leading-tight">
        {post.title}
      </h2>
      {post.description && (
        <p className="theme-text-muted text-sm mt-2 leading-relaxed">{post.description}</p>
      )}
      {post.tags.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {post.tags.slice(0, 4).map((t) => (
            <span key={t} className="text-[10px] font-bold theme-bg-subtle theme-text-muted px-2 py-0.5 rounded-full">
              {t}
            </span>
          ))}
        </div>
      )}
    </Link>
  )
}

export default function BlogIndex() {
  const posts = listAllPosts()
  return (
    <div className="min-h-screen theme-bg pb-16">
      <SeoHelmet
        title="ZedExams Blog — CBC revision, ECZ tips, and study habits"
        description="Practical revision guides, ECZ exam tips, and study-habit advice for Zambian Grade 4–12 learners. New posts every week."
        path="/blog"
      />

      <header className="theme-hero px-4 pt-8 pb-12" data-bg-gradient="true">
        <div className="max-w-3xl mx-auto">
          <Link to="/welcome" className="inline-flex items-center gap-2 mb-4">
            <Logo className="h-6 w-auto" />
          </Link>
          <p className="text-white/80 font-black text-xs uppercase tracking-widest">Revision blog</p>
          <h1 className="text-white text-3xl sm:text-4xl font-black mt-1">Notes from the classroom</h1>
          <p className="text-white/85 text-sm sm:text-base mt-2 max-w-2xl">
            Practical revision guides, ECZ exam tips, and study habits — written
            for Zambian classrooms. New posts most weeks.
          </p>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 -mt-6 space-y-4">
        {posts.length === 0 ? (
          <div className="theme-card border theme-border rounded-radius-md p-8 text-center">
            <div className="text-5xl mb-3">📝</div>
            <h2 className="theme-text font-black text-lg">First post coming soon</h2>
            <p className="theme-text-muted text-sm mt-2 max-w-sm mx-auto">
              We&apos;re writing the opening posts now — check back in a few days,
              or follow the WhatsApp number on the homepage to be notified.
            </p>
          </div>
        ) : (
          posts.map((post) => <PostCard key={post.slug} post={post} />)
        )}
      </main>
    </div>
  )
}
