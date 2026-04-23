/**
 * ZedExams Logo component
 *
 * Assets in /public:
 *   /public/zedexams-logo.png  — original PNG (fallback for old browsers)
 *   /public/zedexams-logo.webp — WebP variant (~78% smaller, served first)
 *
 * Props:
 *   variant:   'full' | 'icon'
 *   size:      'sm' | 'md' | 'lg' | 'xl'
 *   className: extra tailwind classes
 */
const LOGO_PNG  = '/zedexams-logo.png?v=4'
const LOGO_WEBP = '/zedexams-logo.webp?v=1'
// Intrinsic pixel dimensions of the source art. Passed to <img> so the
// browser can reserve layout space before the image finishes loading
// (prevents CLS in the sticky header).
const LOGO_W = 1431
const LOGO_H = 1762

export default function Logo({ variant = 'full', size = 'md', className = '' }) {
  // Heights for the full logo (wider landscape image)
  const fullH = { sm: 'h-14', md: 'h-20', lg: 'h-28', xl: 'h-40' }
  // Sizes for the square icon
  const iconH = { sm: 'h-12 w-12', md: 'h-14 w-14', lg: 'h-20 w-20', xl: 'h-28 w-28' }

  if (variant === 'icon') {
    return (
      <picture>
        <source type="image/webp" srcSet={LOGO_WEBP} />
        <img
          src={LOGO_PNG}
          alt="ZedExams"
          width={LOGO_W}
          height={LOGO_H}
          className={`${iconH[size] ?? iconH.md} object-contain flex-shrink-0 ${className}`}
        />
      </picture>
    )
  }

  return (
    <picture>
      <source type="image/webp" srcSet={LOGO_WEBP} />
      <img
        src={LOGO_PNG}
        alt="ZedExams"
        width={LOGO_W}
        height={LOGO_H}
        className={`${fullH[size] ?? fullH.md} w-auto object-contain flex-shrink-0 ${className}`}
      />
    </picture>
  )
}
