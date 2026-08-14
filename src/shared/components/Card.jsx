import { forwardRef } from 'react'

/**
 * Card — standardised surface primitive.
 *
 * Variants
 *   • flat     — bordered, no shadow. Dense lists, secondary panels.
 *   • elevated — bordered + shadow-md. Interactive content (quiz/lesson cards).
 *   • hero     — gradient bg + shadow-lg. Dashboard heads, upgrade modal.
 *
 * Sizes (controls padding + radius)
 *   • sm — tight list item
 *   • md — default
 *   • lg — feature/hero
 *
 * Props
 *   interactive — adds hover lift (only meaningful on flat/elevated)
 *   as          — render as a different element (e.g., "button" or "a")
 */

const BASE_BY_VARIANT = {
  flat:     'theme-card border theme-border',
  elevated: 'theme-card border theme-border shadow-elev-md',
  hero:     'theme-hero text-white shadow-elev-lg',
}

const SIZE = {
  sm: 'p-3 rounded-[12px]',
  md: 'p-5 rounded-2xl',
  lg: 'p-6 rounded-3xl',
}

const Card = forwardRef(function Card(
  {
    variant = 'elevated',
    size = 'md',
    interactive = false,
    as: Component = 'div',
    className = '',
    children,
    ...rest
  },
  ref,
) {
  const classes = [
    BASE_BY_VARIANT[variant] || BASE_BY_VARIANT.elevated,
    SIZE[size] || SIZE.md,
    // All cards transition smoothly on hover so parents can animate them
    'transition-all duration-base ease-out',
    // Interactive cards lift on hover — only for flat/elevated, gets a
    // light shadow boost and upgrades the cursor to pointer
    interactive
      ? 'cursor-pointer hover:-translate-y-0.5 ' +
        (variant === 'hero' ? 'hover:shadow-elev-xl' : 'hover:shadow-elev-lg')
      : '',
    className,
  ].filter(Boolean).join(' ')

  return (
    <Component ref={ref} className={classes} {...rest}>
      {children}
    </Component>
  )
})

export default Card
