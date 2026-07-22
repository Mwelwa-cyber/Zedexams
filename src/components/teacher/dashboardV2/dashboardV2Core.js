/**
 * Pure logic for the Teacher Dashboard V2 preview.
 *
 * Kept free of React/DOM imports so it tests under plain `node`
 * (see dashboardV2Core.test.js, npm run test:dashboard-v2).
 *
 * Greeting boundaries follow the dashboard spec exactly:
 *   before 12:00        → morning
 *   12:00 – 17:59       → afternoon
 *   18:00 onward        → evening
 * (Note: the legacy dashboard's greetingForHour switches to evening at
 * 17:00 — this surface is specced at 18:00, so it has its own helper.)
 */

export const GREETING_PARTS = ['morning', 'afternoon', 'evening']

export function greetingPartForHour(hour) {
  const h = Number(hour)
  if (!Number.isFinite(h) || h < 0 || h > 23) return 'afternoon'
  if (h < 12) return 'morning'
  if (h < 18) return 'afternoon'
  return 'evening'
}

export function greetingLabel(part) {
  if (part === 'morning') return 'Good morning'
  if (part === 'evening') return 'Good evening'
  return 'Good afternoon'
}

/**
 * Resolve the greeting to display. `override` comes from the preview
 * control panel ('morning' | 'afternoon' | 'evening' | null); when unset
 * the browser's local hour decides.
 */
export function resolveGreeting({ hour, override = null, firstName = 'there' } = {}) {
  const part = GREETING_PARTS.includes(override) ? override : greetingPartForHour(hour)
  const name = (firstName && String(firstName).trim()) || 'there'
  return { part, label: greetingLabel(part), name }
}

/** Fraction (0..1) for checklist progress rings; tolerant of zero totals. */
export function progressFraction(done, total) {
  const d = Number(done)
  const t = Number(total)
  if (!Number.isFinite(d) || !Number.isFinite(t) || t <= 0) return 0
  return Math.min(1, Math.max(0, d / t))
}
