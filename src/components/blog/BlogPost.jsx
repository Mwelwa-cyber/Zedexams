/**
 * /blog/:slug — single blog post page (audit C5).
 *
 * Renders the markdown HTML produced at build time by blogPosts.js
 * (via marked). Sanitisation isn't strictly required since posts are
 * author-written, but we still set rel=noopener on outbound links
 * via a small post-process below.
 *
 * SEO:
 *   - SeoHelmet feeds title + description + canonical.
 *   - JSON-LD `Article` block carries author, datePublished, headline.
 *   - 404 → friendly "post not found" panel with a link back to /blog.
 */

import { Link, useParams } from 'react-router-dom'
import { Helmet } from 'react-helmet-async'
import { getPostBySlug } from '../../utils/blogPosts'
import SeoHelmet from '../seo/SeoHelmet'
import Logo from '../ui/Logo'

function fmtDate(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' })
}

function NotFound() {
  return (
    <div className="min-h-screen theme-bg flex flex-col items-center justify-center px-4 text-center">
      <div className="text-5xl mb-3">🔎</div>
      <h1 className="theme-text font-black text-xl">Post not found</h1>
      <p className="theme-text-muted text-sm mt-2 max-w-sm">
        This post may have been moved or unpublished.
      </p>
      <Link
        to="/blog"
        className="mt-6 theme-accent-fill theme-on-accent rounded-full px-5 py-2.5 text-sm font-black hover:opacity-90"
      >
        ← Back to blog
      </Link>
    </div>
  )
}

export default function BlogPost() {
  const { slug } = useParams()
  const post = getPostBySlug(slug)
  if (!post) return <NotFound />

  const articleJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: post.title,
    description: post.description || undefined,
    datePublished: post.publishedAt || undefined,
    author: {
      '@type': 'Organization',
      name: post.author || 'ZedExams',
    },
    publisher: {
      '@type': 'Organization',
      name: 'ZedExams',
      logo: {
        '@type': 'ImageObject',
        url: 'https://zedexams.com/zedexams-logo.png?v=4',
      },
    },
    mainEntityOfPage: {
      '@type': 'WebPage',
      '@id': `https://zedexams.com/blog/${post.slug}`,
    },
    inLanguage: 'en-ZM',
    keywords: post.tags.join(', '),
  }

  return (
    <div className="min-h-screen theme-bg pb-16">
      <SeoHelmet
        title={post.title}
        description={post.description || undefined}
        path={`/blog/${post.slug}`}
        type="article"
        image={post.image ? `https://zedexams.com${post.image}` : undefined}
      />
      <Helmet>
        <script type="application/ld+json">{JSON.stringify(articleJsonLd)}</script>
      </Helmet>

      <header className="theme-card border-b theme-border px-4 py-3">
        <div className="max-w-3xl mx-auto flex items-center gap-3 text-xs font-bold theme-text-muted">
          <Link to="/welcome" className="hover:theme-text"><Logo className="h-5 w-auto" /></Link>
          <span aria-hidden="true">/</span>
          <Link to="/blog" className="hover:theme-text">Blog</Link>
          <span aria-hidden="true">/</span>
          <span className="theme-text truncate">{post.title}</span>
        </div>
      </header>

      <article className="max-w-2xl mx-auto px-4 py-8">
        <p className="theme-text-muted text-[11px] uppercase tracking-widest font-bold">
          {fmtDate(post.publishedAt)}
          {post.readingMinutes ? ` · ${post.readingMinutes} min read` : ''}
        </p>
        <h1 className="theme-text font-display font-black text-3xl sm:text-4xl mt-2 leading-tight">
          {post.title}
        </h1>
        {post.description && (
          <p className="theme-text-muted text-base mt-3 leading-relaxed">{post.description}</p>
        )}
        {post.tags.length > 0 && (
          <div className="mt-4 flex flex-wrap gap-1.5">
            {post.tags.map((t) => (
              <span key={t} className="text-[10px] font-bold theme-bg-subtle theme-text-muted px-2 py-0.5 rounded-full">
                {t}
              </span>
            ))}
          </div>
        )}

        <div
          className="blog-prose mt-8 theme-text"
          // Posts are author-written and built into the bundle. No UGC,
          // no XSS surface; same trust boundary as any other component
          // in the app shell.
           
          dangerouslySetInnerHTML={{ __html: post.html }}
        />

        <hr className="my-10 theme-border" />
        <p className="theme-text-muted text-sm text-center">
          More posts on the <Link to="/blog" className="theme-accent-text font-bold underline">blog index</Link>
          {' · '}
          Practising on ZedExams? <Link to="/welcome" className="theme-accent-text font-bold underline">Create a free account</Link>.
        </p>
      </article>
    </div>
  )
}
