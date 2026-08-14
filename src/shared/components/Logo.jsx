/**
 * ZedExams Logo component
 *
 * Assets in /public:
 *   /public/zedexams-logo.png        — original PNG (fallback for old browsers)
 *   /public/zedexams-logo.webp       — WebP variant (~78% smaller, served first)
 *   /public/zedexams-logo-light.png  — dark-theme variant: the navy wordmark/
 *   /public/zedexams-logo-light.webp   tagline ink is white; mark unchanged
 *
 * Both variants render and CSS decides which is visible (`.zx-logo-default` /
 * `.zx-logo-on-dark` in index.css, keyed to the two dark hooks). The swap
 * lives in CSS rather than JS so it flips with the theme class immediately,
 * needs no context, and works pre-hydration.
 *
 * Props:
 *   variant:   'full' | 'icon'
 *   size:      'sm' | 'md' | 'lg' | 'xl'
 *   className: extra tailwind classes
 */
const LOGO_PNG  = '/zedexams-logo.png?v=5'
const LOGO_WEBP = '/zedexams-logo.webp?v=2'
const LOGO_LIGHT_PNG  = '/zedexams-logo-light.png?v=1'
const LOGO_LIGHT_WEBP = '/zedexams-logo-light.webp?v=1'
// Intrinsic pixel dimensions of the source art. Passed to <img> so the
// browser can reserve layout space before the image finishes loading
// (prevents CLS in the sticky header).
const LOGO_W = 312
const LOGO_H = 384

function LogoPicture({ webp, png, imgClass, variantClass, decorative = false }) {
  // The on-dark twin is presentational (empty alt + aria-hidden): with both
  // variants in the DOM, a second "ZedExams" alt would double-announce the
  // brand to screen readers and break every getByAltText query. The default
  // variant carries the accessible name in all themes.
  return (
    <picture className={variantClass}>
      <source type="image/webp" srcSet={webp} />
      <img
        src={png}
        alt={decorative ? '' : 'ZedExams'}
        aria-hidden={decorative || undefined}
        width={LOGO_W}
        height={LOGO_H}
        className={imgClass}
      />
    </picture>
  )
}

export default function Logo({ variant = 'full', size = 'md', className = '' }) {
  // Heights for the full logo (wider landscape image)
  const fullH = { sm: 'h-14', md: 'h-20', lg: 'h-28', xl: 'h-40' }
  // Sizes for the square icon
  const iconH = { sm: 'h-12 w-12', md: 'h-14 w-14', lg: 'h-20 w-20', xl: 'h-28 w-28' }

  const imgClass = variant === 'icon'
    ? `${iconH[size] ?? iconH.md} object-contain flex-shrink-0 ${className}`
    : `${fullH[size] ?? fullH.md} w-auto object-contain flex-shrink-0 ${className}`

  return (
    <>
      <LogoPicture webp={LOGO_WEBP} png={LOGO_PNG} imgClass={imgClass} variantClass="zx-logo-default" />
      <LogoPicture webp={LOGO_LIGHT_WEBP} png={LOGO_LIGHT_PNG} imgClass={imgClass} variantClass="zx-logo-on-dark" decorative />
    </>
  )
}
