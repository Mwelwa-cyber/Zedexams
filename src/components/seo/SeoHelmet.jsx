import { Helmet } from 'react-helmet-async'

const SITE = 'https://zedexams.com'
const DEFAULT_IMAGE = `${SITE}/zedexams-logo.png?v=4`

/**
 * Per-route head metadata.
 *
 * `index.html` ships one set of meta tags for the whole SPA, so every
 * Twitter/WhatsApp share preview looks identical regardless of which page
 * was actually shared. This component lets each route declare its own
 * title, description, canonical, and Open Graph tags. Helmet replaces
 * matching tags from index.html on every navigation.
 *
 * Pass `path` as the route path (no origin) — we build the absolute
 * canonical and og:url from it.
 *
 *   <SeoHelmet
 *     title="Games"
 *     description="Play CBC-aligned learning games."
 *     path="/games"
 *   />
 */
export default function SeoHelmet({
  title,
  description,
  path,
  image = DEFAULT_IMAGE,
  type = 'website',
  noIndex = false,
}) {
  const fullTitle = title ? `${title} — ZedExams` : 'ZedExams'
  const url = path ? `${SITE}${path}` : SITE

  return (
    <Helmet>
      <title>{fullTitle}</title>
      {description && <meta name="description" content={description} />}
      <link rel="canonical" href={url} />

      <meta property="og:title" content={fullTitle} />
      {description && <meta property="og:description" content={description} />}
      <meta property="og:url" content={url} />
      <meta property="og:type" content={type} />
      <meta property="og:image" content={image} />

      <meta name="twitter:title" content={fullTitle} />
      {description && <meta name="twitter:description" content={description} />}
      <meta name="twitter:image" content={image} />

      {noIndex && <meta name="robots" content="noindex" />}
    </Helmet>
  )
}
