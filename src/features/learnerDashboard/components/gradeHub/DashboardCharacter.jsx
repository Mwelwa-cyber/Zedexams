/**
 * A character illustration on the hero or on an action card.
 */
import { memo } from 'react'

const DashboardCharacter = memo(function DashboardCharacter({ image, alt, variant = 'card', loading = 'lazy', className = '' }) {
  // Some callers omit the character image (text-only cards). Render nothing
  // rather than crashing on `image.webp` / `image.png`.
  if (!image) return null

  const sizeClass = {
    hero: 'h-40 sm:h-52 md:h-[220px]',
    card: 'h-24 sm:h-28',
    games: 'h-24 sm:h-[118px]',
  }[variant] || 'h-24 sm:h-28'

  // width/height give the browser the aspect ratio up-front so the page
  // doesn't jump when the image finishes loading (CLS).
  //
  // `w-auto` is load-bearing: the HTML `width` attribute doubles as a CSS
  // presentational hint (`width: 1402px` for the hero, etc.) which without
  // an explicit CSS width rule would blow out the absolute-positioned
  // layout and shift/clip the art. `w-auto` forces the rendered width to
  // come from the CSS height × aspect-ratio instead.
  return (
    <img
      src={image.src}
      alt={alt}
      width={image.width}
      height={image.height}
      loading={loading}
      decoding="async"
      className={`pointer-events-none select-none object-contain drop-shadow-[0_14px_18px_rgba(15,23,42,0.16)] w-auto ${sizeClass} ${className}`}
    />
  )
})

export default DashboardCharacter
