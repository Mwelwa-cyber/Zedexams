/**
 * Pure logic for the Dashboard V2 onboarding tour (OnboardingTour.jsx):
 * spotlight geometry, tour-card placement, and the show/replay decision.
 * Kept free of React/DOM imports so it tests under plain `node`
 * (onboardingTourCore.test.js → npm run test:dashboard-v2-tour).
 */

// Own key — dismissing the classic-dashboard tour (zedexams:teacher-onboarded)
// must not suppress this one: the V2 dashboard is a new surface and this tour
// doubles as its "meet your new dashboard" introduction.
export const TOUR_STORAGE_KEY = 'zedexams:tdv2-tour'

// Dispatched on window to restart the tour imperatively (preview control
// panel). The Help & Support page replays via the /teacher?tour=1 link.
export const TOUR_REPLAY_EVENT = 'zedexams:tdv2-tour-replay'

const EDGE = 4 // spotlight never touches the exact viewport edge

/**
 * The dimmed-page cutout around a highlighted element: the target's
 * bounding rect grown by `pad`, clamped to the viewport.
 */
export function spotlightRect(rect, viewport, pad = 8) {
  const top = Math.max(rect.top - pad, EDGE)
  const left = Math.max(rect.left - pad, EDGE)
  const right = Math.min(rect.left + rect.width + pad, viewport.width - EDGE)
  const bottom = Math.min(rect.top + rect.height + pad, viewport.height - EDGE)
  return {
    top,
    left,
    width: Math.max(right - left, 0),
    height: Math.max(bottom - top, 0),
  }
}

/**
 * Position the tour card relative to a spotlight: below it when there is
 * room, above it otherwise, pinned to the bottom edge as a last resort;
 * horizontally centred on the spotlight and clamped inside the viewport.
 * Returns null for target-less steps (the card centres itself via CSS).
 */
export function placeCard({ spot, cardWidth, cardHeight, viewport, gap = 14, margin = 12 }) {
  if (!spot) return null
  const below = spot.top + spot.height + gap
  let top
  if (below + cardHeight + margin <= viewport.height) {
    top = below
  } else if (spot.top - gap - cardHeight >= margin) {
    top = spot.top - gap - cardHeight
  } else {
    top = Math.max(viewport.height - cardHeight - margin, margin)
  }
  let left = spot.left + spot.width / 2 - cardWidth / 2
  left = Math.min(Math.max(left, margin), Math.max(viewport.width - cardWidth - margin, margin))
  return { top, left }
}

/**
 * Show the tour when the device has never dismissed it, or when the URL
 * explicitly asks for a replay (?tour=1 — the Help & Support link).
 */
export function shouldShowTour({ stored, search }) {
  if (typeof search === 'string' && /[?&]tour=1(&|$)/.test(search)) return true
  return !stored
}
