/**
 * Showing an interactive state without interacting with it — the pure half.
 *
 * The audit page has to show hover and focus side by side across four
 * variants and four themes. You cannot hover sixteen buttons, and a hover
 * that inverts badly in one theme is precisely the class of bug a theme pass
 * misses — so the states have to be pinned open.
 *
 * THE RULE THAT KEEPS THIS FROM LYING
 * A forced state must be derived from the component's OWN declarations, never
 * re-typed. A hand-written `.audit-hover { background: … }` looks identical
 * on screen and is a second source of truth: the day someone changes Button's
 * hover, the audit page keeps showing yesterday's — confidently, and with no
 * way to tell from looking.
 *
 * So `ForceHover` (in forcedStates.jsx) reads the `hover:` utilities off the
 * rendered element and re-applies each one unprefixed. Button's own class
 * string is the source; if Button's hover changes, this follows it with no
 * edit here.
 *
 * THE ONE THING THAT CANNOT FOLLOW AUTOMATICALLY
 * Tailwind emits a utility only when it can find the class as a literal
 * string in the source. `hover:brightness-110` generates
 * `.hover\:brightness-110` — it does NOT generate a bare `.brightness-110`
 * that nothing writes. So the unprefixed forms have to appear somewhere the
 * scanner reads, which is what HOVER_SAFELIST is for.
 *
 * That safelist is the drift risk, and it is guarded rather than trusted:
 * `test:ui-audit-forced-states` parses the audited primitives for every
 * `hover:` utility and fails if one is missing here. A hover class added
 * without a safelist entry would otherwise show up as a forced-hover cell
 * rendering the default state — a passing-looking audit of a state nobody
 * checked.
 *
 * Split from the .jsx purely so the guard can run under plain `node`.
 */

/** Strip the `hover:` prefix off every hover utility in a class string. */
export function hoverClassesFrom(className) {
  if (!className || typeof className !== 'string') return []
  return className
    .split(/\s+/)
    .filter((c) => c.startsWith('hover:') && c.length > 'hover:'.length)
    .map((c) => c.slice('hover:'.length))
}

/**
 * The unprefixed forms of every `hover:` utility the audited primitives use,
 * written out so Tailwind's content scanner emits them. Not read at runtime —
 * `hoverClassesFrom` is. This string exists purely so the CSS is in the build.
 *
 * Kept honest by test:ui-audit-forced-states.
 */
export const HOVER_SAFELIST =
  '-translate-y-px shadow-elev-md shadow-elev-lg shadow-elev-xl brightness-110 ' +
  'border-[var(--accent)] theme-accent-text theme-bg-subtle theme-text ' +
  '-translate-y-0.5'
