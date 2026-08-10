/**
 * Plain-node tests for the onboarding tour's pure logic.
 * Run: npm run test:dashboard-v2-tour
 */
import assert from 'node:assert/strict'
import { placeCard, shouldShowTour, spotlightRect, TOUR_STORAGE_KEY } from './onboardingTourCore.js'

const VP = { width: 1280, height: 800 }

// ── spotlightRect ─────────────────────────────────────────────────────

// Grows the target rect by the padding on every side.
assert.deepEqual(
  spotlightRect({ top: 100, left: 200, width: 300, height: 120 }, VP),
  { top: 92, left: 192, width: 316, height: 136 },
)

// Clamped to the viewport when the target touches an edge.
{
  const s = spotlightRect({ top: 0, left: 0, width: 300, height: 100 }, VP)
  assert.equal(s.top, 4)
  assert.equal(s.left, 4)
  assert.equal(s.width, 304) // 0..308 clamped at left=4
}

// A target wider than the viewport never yields a spotlight wider than it.
{
  const s = spotlightRect({ top: 10, left: -50, width: 5000, height: 50 }, VP)
  assert.equal(s.left, 4)
  assert.equal(s.width, VP.width - 8)
}

// Degenerate off-screen rect never goes negative.
{
  const s = spotlightRect({ top: 900, left: 1300, width: 10, height: 10 }, VP)
  assert.equal(s.width, 0)
  assert.equal(s.height, 0)
}

// ── placeCard ─────────────────────────────────────────────────────────

const CARD = { cardWidth: 360, cardHeight: 220, viewport: VP }

// Prefers below the spotlight, horizontally centred on it.
{
  const pos = placeCard({ spot: { top: 100, left: 400, width: 300, height: 120 }, ...CARD })
  assert.equal(pos.top, 100 + 120 + 14)
  assert.equal(pos.left, 400 + 150 - 180)
}

// Flips above when there is no room below.
{
  const pos = placeCard({ spot: { top: 600, left: 400, width: 300, height: 150 }, ...CARD })
  assert.equal(pos.top, 600 - 14 - 220)
}

// Pins to the bottom margin when neither side fits (tall spotlight).
{
  const pos = placeCard({ spot: { top: 40, left: 400, width: 300, height: 720 }, ...CARD })
  assert.equal(pos.top, VP.height - 220 - 12)
}

// Clamps horizontally inside the viewport.
{
  const left = placeCard({ spot: { top: 100, left: 0, width: 40, height: 40 }, ...CARD }).left
  assert.equal(left, 12)
  const right = placeCard({ spot: { top: 100, left: 1250, width: 20, height: 40 }, ...CARD }).left
  assert.equal(right, VP.width - 360 - 12)
}

// Card on a narrow phone viewport still stays inside it.
{
  const pos = placeCard({
    spot: { top: 100, left: 10, width: 300, height: 80 },
    cardWidth: 296,
    cardHeight: 240,
    viewport: { width: 320, height: 640 },
  })
  assert.ok(pos.left >= 12)
  assert.ok(pos.left + 296 <= 320 - 12 + 0.001)
}

// Target-less steps centre via CSS — no coordinates.
assert.equal(placeCard({ spot: null, ...CARD }), null)

// ── shouldShowTour ────────────────────────────────────────────────────

assert.equal(shouldShowTour({ stored: null, search: '' }), true)
assert.equal(shouldShowTour({ stored: 'done', search: '' }), false)
assert.equal(shouldShowTour({ stored: 'done', search: '?tour=1' }), true)
assert.equal(shouldShowTour({ stored: 'done', search: '?from=x&tour=1' }), true)
assert.equal(shouldShowTour({ stored: 'done', search: '?tour=10' }), false)
assert.equal(shouldShowTour({ stored: 'done', search: '?detour=1' }), false)
assert.equal(shouldShowTour({ stored: null, search: undefined }), true)

// The key is V2-specific — never the classic dashboard's key.
assert.notEqual(TOUR_STORAGE_KEY, 'zedexams:teacher-onboarded')

console.log('onboardingTourCore: all assertions passed')
