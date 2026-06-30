/**
 * Pure helpers for the adaptive transparent status bar (Android Capacitor
 * shell). These have **no** DOM or Capacitor dependency so they unit-test under
 * plain `node` (see scripts/test-statusbar-brightness.mjs) — the DOM sampling +
 * native plugin wiring lives in src/utils/statusBarManager.js, which imports
 * from here.
 *
 * The job: given the colour of whatever content is scrolling behind the
 * transparent status bar, decide whether the OS status-bar icons (time, signal,
 * Wi-Fi, battery) should be drawn dark (over a light background) or light (over
 * a dark background), with hysteresis so they never flicker at the boundary.
 */

// Hysteresis thresholds on relative luminance (0 = black, 1 = white). We use a
// dead-band between the two so a background hovering near mid-grey — or a
// scroll that wobbles a pixel back and forth — can't thrash the icon colour:
//   • icons go DARK (background is light) only once luminance climbs past HI
//   • icons go LIGHT (background is dark) only once luminance drops below LO
// Anything in [LO, HI] keeps the previous decision.
export const STATUS_BAR_HYSTERESIS = Object.freeze({ lo: 0.42, hi: 0.6 })

/**
 * Parse a CSS colour string into {r,g,b,a} (0–255 channels, 0–1 alpha), or
 * null if it isn't an opaque-enough colour we can reason about. Handles the
 * shapes `getComputedStyle` actually returns — `rgb(...)`, `rgba(...)` — plus
 * `#rgb` / `#rrggbb` hex in case a sampled inline style or gradient stop uses
 * them. `transparent` and fully/near-transparent colours return null so the
 * caller keeps walking up the ancestor chain for a real backdrop.
 */
export function parseCssColor(input) {
  if (typeof input !== 'string') return null
  const str = input.trim().toLowerCase()
  if (!str || str === 'transparent' || str === 'none') return null

  // rgb()/rgba() — the canonical getComputedStyle output.
  const rgbMatch = str.match(/^rgba?\(([^)]+)\)$/)
  if (rgbMatch) {
    const parts = rgbMatch[1].split(/[,/\s]+/).filter(Boolean)
    if (parts.length < 3) return null
    const r = Number(parts[0])
    const g = Number(parts[1])
    const b = Number(parts[2])
    const a = parts.length >= 4 ? Number(parts[3]) : 1
    if ([r, g, b, a].some((n) => Number.isNaN(n))) return null
    // Treat barely-there overlays as see-through so we don't lock onto, e.g., a
    // 4%-opacity scrim and ignore the real background beneath it.
    if (a < 0.12) return null
    return { r, g, b, a }
  }

  // #rgb / #rrggbb hex.
  const hex = str.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/)
  if (hex) {
    let h = hex[1]
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2]
    return {
      r: parseInt(h.slice(0, 2), 16),
      g: parseInt(h.slice(2, 4), 16),
      b: parseInt(h.slice(4, 6), 16),
      a: 1,
    }
  }

  return null
}

/**
 * WCAG relative luminance of an {r,g,b} colour, 0 (black) → 1 (white). Used as
 * the brightness signal that drives the icon-colour decision.
 */
export function relativeLuminance({ r, g, b }) {
  const toLinear = (c) => {
    const s = c / 255
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b)
}

/**
 * Best-effort average luminance of a CSS `background-image` value that is a
 * gradient (linear/radial/conic). We pull every colour stop we can parse and
 * average their luminance — enough to pick the right icon colour over the
 * gradient hero/banner backgrounds the app uses. Returns null for raster
 * images (`url(...)`) or anything with no parseable stops, so the caller falls
 * back to an explicit override or the theme default.
 */
export function gradientLuminance(backgroundImage) {
  if (typeof backgroundImage !== 'string') return null
  if (!/gradient\(/i.test(backgroundImage)) return null

  const tokens =
    backgroundImage.match(/rgba?\([^)]*\)|#[0-9a-fA-F]{3,6}\b/g) || []
  const lums = []
  for (const tok of tokens) {
    const c = parseCssColor(tok)
    if (c) lums.push(relativeLuminance(c))
  }
  if (!lums.length) return null
  return lums.reduce((sum, l) => sum + l, 0) / lums.length
}

/**
 * Apply hysteresis to a luminance reading.
 *
 * @param {number}        luminance  0–1 brightness behind the status bar.
 * @param {boolean|null}  prevIconsDark  previous decision (true = dark icons),
 *                                       or null for the first reading.
 * @param {{lo:number,hi:number}} [thresholds]
 * @returns {boolean} true → draw dark icons (light background); false → light
 *                    icons (dark background).
 */
export function decideIconsDark(luminance, prevIconsDark, thresholds = STATUS_BAR_HYSTERESIS) {
  const { lo, hi } = thresholds
  if (typeof luminance !== 'number' || Number.isNaN(luminance)) {
    // No usable reading — keep what we had, or default to dark icons (the
    // light-background assumption matches the app's default light themes).
    return prevIconsDark == null ? true : prevIconsDark
  }
  if (prevIconsDark == null) {
    // First reading: pick from the midpoint of the dead-band.
    return luminance >= (lo + hi) / 2
  }
  if (prevIconsDark) {
    // Currently dark icons (light bg) — only flip to light icons once the
    // backdrop is convincingly dark.
    return luminance >= lo
  }
  // Currently light icons (dark bg) — only flip to dark icons once the backdrop
  // is convincingly light.
  return luminance > hi
}
