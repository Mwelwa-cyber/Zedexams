/**
 * Icon — consistent sizing + stroke width wrapper around Heroicons.
 *
 * Why this exists: the app currently uses emoji for most iconography,
 * which doesn't render consistently across OSes and can't adapt to the
 * theme colour. Migrating surfaces to SVG one at a time requires a
 * single primitive so every `<Icon />` has the same scale and weight.
 *
 * Usage
 *   import Icon from '@/components/ui/Icon'
 *   import { Home, BookOpen, ChevronRight } from './icons'
 *
 *   <Icon as={Home} />                    // md, stroke 2.25
 *   <Icon as={ChevronRight} size="sm" />
 *   <Icon as={BookOpen} size="lg" className="text-[color:var(--accent-fg)]" />
 *
 * Size tokens
 *   xs — 12 px   (inline with dense text)
 *   sm — 16 px   (toolbar, list-item leading)
 *   md — 20 px   (default, nav, buttons)
 *   lg — 24 px   (section headers)
 *   xl — 32 px   (feature cards, empty states)
 *
 * Stroke width is intentionally shared across every outline icon so the
 * dashboard, nav, and page controls keep one visual weight.
 */

const SIZE_PX = { xs: 12, sm: 16, md: 20, lg: 24, xl: 32 }

export default function Icon({
  as: Component,
  size = 'md',
  strokeWidth = 2.25,
  className = '',
  label,
  ...rest
}) {
  if (!Component) return null
  const px = SIZE_PX[size] ?? SIZE_PX.md

  // If a `label` is provided the icon is considered meaningful content
  // and exposed to assistive tech. Otherwise it's decorative and hidden.
  const a11y = label
    ? { role: 'img', 'aria-label': label }
    : { 'aria-hidden': 'true', focusable: 'false' }

  return (
    <Component
      width={px}
      height={px}
      strokeWidth={strokeWidth}
      className={`shrink-0 ${className}`}
      {...a11y}
      {...rest}
    />
  )
}
