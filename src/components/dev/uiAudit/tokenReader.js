/**
 * Read the design tokens back out of the browser, as the browser resolved them.
 *
 * WHY THIS EXISTS RATHER THAN A LIST OF HEXES
 * -------------------------------------------
 * The point of the UI audit page is to catch a component whose colour has
 * drifted from the token that is supposed to own it. A page that PRINTS a
 * hardcoded hex next to each swatch cannot do that: the moment someone edits
 * `--zt-accent` in index.css the label is a lie, and a lying reference is
 * worse than no reference — it makes the audit agree with itself while the app
 * disagrees with both.
 *
 * So nothing here knows a colour. The name list is scraped from the
 * stylesheets the page actually loaded, and every value is read back through
 * `getComputedStyle` against a probe inside the scope being audited. Change a
 * token, reload, and the page tells you the new value with no edit to any of
 * this.
 *
 * THE ONE TRICK WORTH KNOWING
 * `getComputedStyle(el).getPropertyValue('--x')` returns the token's raw TEXT,
 * not a colour. For most tokens that is a hex and the distinction never shows
 * up. But several tokens in this codebase are `color-mix(in srgb, …)`
 * expressions (`--accent-tint`, `--bg-subtle`, the whole `.studio-theme`
 * block), and those come back as the literal expression — unrenderable in a
 * label and impossible to compare against a swatch by eye.
 *
 * `resolveColour` therefore ASSIGNS the value to a probe element and reads the
 * computed `color` back, which is always an `rgb()` / `rgba()` triple with
 * every function evaluated. The sentinel comparison is what makes it safe:
 * assigning an invalid colour leaves the previous computed value in place, so
 * without a known starting value an invalid token would silently report the
 * last valid one.
 */

/* ── Pure helpers (tested under plain node) ─────────────────────────── */

/**
 * Selectors that declare a PALETTE, as opposed to the several hundred other
 * custom properties in index.css (the MoE calendar, the games hub, per-studio
 * scopes). Matching on the selector rather than on a name list is what keeps
 * a newly added token visible on this page without anyone remembering to add
 * it here.
 */
export function isThemeSelector(selectorText) {
  if (!selectorText || typeof selectorText !== 'string') return false
  return selectorText
    .split(',')
    .map((s) => s.trim())
    .some(
      (s) =>
        s === ':root' ||
        s === '.studio-theme' ||
        // Anchored at BOTH ends: `[data-theme='night'] .studio-theme
        // .studio-input` starts identically and declares no palette — it
        // restyles one control. Matching it would pull every private studio
        // variable onto the page.
        /^\[data-theme=('|")[a-z-]+\1\]$/.test(s) ||
        /^html\[data-theme=.+\]\s+body$/.test(s) ||
        /^body\.theme-[a-z]+$/.test(s),
    )
}

/**
 * Group a custom property so the page can lay tokens out by role.
 *
 * Prefix rules, not a lookup table: an unrecognised token lands in `other`
 * and is still rendered. A token that vanishes from the page because nobody
 * added it to a list is the failure this ordering avoids — `other` is meant
 * to be read as "someone added a token and nothing here knows what it is
 * for", which is a finding rather than a gap.
 */
export function classifyToken(name) {
  if (!name || !name.startsWith('--')) return null
  const bare = name.slice(2)
  if (bare.startsWith('zt-')) return 'workspace'
  if (/^(success|warning|danger|info)(-|$)/.test(bare)) return 'semantic'
  if (/^(radius|r)-/.test(bare)) return 'radius'
  if (/^shadow(-|$)/.test(bare)) return 'shadow'
  if (/^(duration|ease)-/.test(bare)) return 'motion'
  if (
    /^(bg|card|text|border|accent|input|hero|surface|line|on|banner)(-|$)/.test(
      bare,
    )
  ) {
    return 'reading'
  }
  return 'other'
}

/** Human-facing group labels + the order they read best in. */
export const TOKEN_GROUPS = Object.freeze([
  {
    id: 'workspace',
    title: 'Workspace tokens (--zt-*)',
    hint: 'Declared on <html data-theme>. The four themes change these values and nothing else.',
    kind: 'colour',
  },
  {
    id: 'reading',
    title: 'Reading / surface tokens',
    hint: 'What every shared primitive is written in. Inside .studio-theme these are remapped from the --zt-* set above.',
    kind: 'colour',
  },
  {
    id: 'semantic',
    title: 'Semantic tokens',
    hint: 'Success / warning / danger / info. Deliberately near-constant across themes — a validation error means the same thing in every palette.',
    kind: 'colour',
  },
  {
    id: 'other',
    title: 'Unclassified tokens',
    hint: 'Declared in a palette rule but matching no known group. An entry here usually means a token was added without a role.',
    kind: 'colour',
  },
  { id: 'radius', title: 'Radius scale', hint: '', kind: 'length' },
  { id: 'shadow', title: 'Elevation scale', hint: '', kind: 'shadow' },
  { id: 'motion', title: 'Motion tokens', hint: '', kind: 'raw' },
])

/**
 * Sort tokens so a ramp reads as a ramp. Names sharing a stem stay together
 * and a bare stem sorts before its modifiers (`--accent` then `--accent-bg`
 * then `--accent-deep`), which is the order they are reasoned about in.
 */
export function sortTokenNames(names) {
  return [...names].sort((a, b) => a.localeCompare(b, 'en'))
}

/* ── DOM readers ────────────────────────────────────────────────────── */

/**
 * Every custom property declared by a palette rule in the loaded stylesheets.
 *
 * A stylesheet from another origin throws on `.cssRules`; that is expected
 * (nothing in this app's palette comes from a CDN) and is skipped rather than
 * reported, because a warning nobody can act on is noise.
 */
export function collectDeclaredTokenNames(doc = document) {
  const names = new Set()
  const sheets = Array.from(doc.styleSheets || [])
  for (const sheet of sheets) {
    let rules
    try {
      rules = sheet.cssRules
    } catch {
      continue
    }
    if (!rules) continue
    walkRules(rules, names)
  }
  return names
}

function walkRules(rules, names) {
  for (const rule of Array.from(rules)) {
    // Read the declarations FIRST, then recurse — never one or the other.
    //
    // The obvious shape for this loop is "if it has cssRules it is a group,
    // so recurse and move on; otherwise read its declarations". That is how
    // it was written, and it found exactly zero tokens.
    //
    // Since CSS nesting shipped, a plain CSSStyleRule ALSO has a `.cssRules`
    // list — empty, but present. So every palette rule in the file looked
    // like a grouping rule, got recursed into, found nothing, and its
    // declarations were never read. Nothing throws and nothing warns; the
    // page simply renders its Tailwind ramps and no CSS tokens, which reads
    // as "we have no design tokens" rather than as a broken scraper.
    if (rule.style && rule.selectorText && isThemeSelector(rule.selectorText)) {
      for (let i = 0; i < rule.style.length; i += 1) {
        const prop = rule.style[i]
        if (prop && prop.startsWith('--')) names.add(prop)
      }
    }
    // @media / @supports / @layer wrap the rules that matter — the reading
    // palettes sit inside a @layer — so grouping rules must still be walked.
    if (rule.cssRules && rule.cssRules.length) walkRules(rule.cssRules, names)
  }
}

/**
 * A hidden probe parented inside `scope`, so custom properties resolve with
 * the same inheritance the audited components see. Reused across reads —
 * creating one per token would be hundreds of layout-flushing insertions.
 */
function probeFor(scope) {
  let probe = scope.querySelector(':scope > [data-ui-audit-probe]')
  if (!probe) {
    probe = scope.ownerDocument.createElement('span')
    probe.setAttribute('data-ui-audit-probe', '')
    probe.setAttribute('aria-hidden', 'true')
    probe.style.position = 'absolute'
    probe.style.width = '0'
    probe.style.height = '0'
    probe.style.overflow = 'hidden'
    probe.style.pointerEvents = 'none'
    scope.appendChild(probe)
  }
  return probe
}

/** Sentinel that no real token uses, so "unchanged" means "not a colour". */
const SENTINEL = 'rgb(1, 2, 3)'

/**
 * Resolve a CSS value to a concrete `rgb()` / `rgba()` string, or null when
 * the value is not a colour (a radius, a duration, a gradient, a typo).
 */
export function resolveColour(scope, value) {
  if (!scope || !value) return null
  const probe = probeFor(scope)
  const win = scope.ownerDocument.defaultView
  probe.style.color = SENTINEL
  const before = win.getComputedStyle(probe).color
  probe.style.color = value
  const after = win.getComputedStyle(probe).color
  probe.style.color = ''
  if (after === before) return null
  return after
}

/**
 * A computed colour string → `#RRGGBB` (or `#RRGGBBAA`).
 *
 * TWO SERIALISATIONS, AND THE SECOND ONE IS A TRAP.
 * An ordinary colour comes back as `rgb(185, 92, 58)` — channels 0–255. But a
 * `color-mix()` result comes back as `color(srgb 0.7255 0.3608 0.2275)` —
 * channels 0–1, in a different function. Parsing the numbers out of both with
 * one regex and rounding gives 0 or 1 for every channel of the second, so
 * every color-mix token on the page reported `#010101`: a plausible-looking
 * near-black next to a swatch that was visibly pale peach. The swatch was
 * right and the label was wrong, which is the exact failure mode this whole
 * module exists to prevent.
 *
 * That form is not exotic here — `--accent-bg`, `--accent-tint`, `--bg-subtle`,
 * `--card-hover` and most of the `.studio-theme` block are all `color-mix()`.
 *
 * Alpha is kept as an eighth pair rather than dropped: several sidebar tokens
 * are the same white at different alphas, and printing them as `#FFFFFF`
 * would claim four themes share a value they do not.
 */
export function rgbToHex(colour) {
  if (!colour || typeof colour !== 'string') return null

  // `color(srgb r g b / a)` — fractional channels. Any other colour space
  // would need a real conversion, so it is refused rather than mis-reported.
  const colorFn = colour.match(/^color\(\s*([a-z0-9-]+)\s+(.+)\)$/i)
  if (colorFn) {
    if (colorFn[1].toLowerCase() !== 'srgb') return null
    const parts = colorFn[2].match(/-?[\d.]+(?:e-?\d+)?/g)
    if (!parts || parts.length < 3) return null
    return toHex(parts.slice(0, 3).map((n) => Number(n) * 255), parts[3])
  }

  // `rgb()` / `rgba()` — 0–255 channels. Anything else (oklch, lab, hwb, a
  // gradient, a keyword) is REFUSED rather than parsed by digit-scraping:
  // those channels are not RGB, and a hex derived from them would be a
  // confident wrong answer sitting next to a correct swatch. A blank cell
  // sends you to devtools; a wrong hex sends you nowhere.
  const rgbFn = colour.match(/^rgba?\((.+)\)$/i)
  if (!rgbFn) return null
  const nums = rgbFn[1].match(/-?[\d.]+(?:e-?\d+)?/g)
  if (!nums || nums.length < 3) return null
  return toHex(nums.slice(0, 3).map(Number), nums[3])
}

function toHex(channels, alpha) {
  if (channels.some((n) => !Number.isFinite(n))) return null
  const pair = (n) =>
    Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0')
  let hex = `#${channels.map(pair).join('')}`
  const a = alpha === undefined ? 1 : Number(alpha)
  if (Number.isFinite(a) && a < 1) hex += pair(a * 255)
  return hex.toUpperCase()
}

/**
 * Read every requested token against `scope`.
 *
 * Returns `{ name, raw, resolved, hex }` per token. `raw` is the declaration
 * text (which is what you would grep for), `resolved`/`hex` are what the
 * browser actually painted — they differ for every `color-mix()` token, and
 * that difference is frequently the bug.
 */
export function readTokens(scope, names) {
  if (!scope) return []
  const win = scope.ownerDocument.defaultView
  const computed = win.getComputedStyle(scope)
  return names.map((name) => {
    const raw = computed.getPropertyValue(name).trim()
    const resolved = resolveColour(scope, raw)
    return { name, raw, resolved, hex: resolved ? rgbToHex(resolved) : null }
  })
}

/**
 * Resolve a list of `{ label, value }` swatches — used for the Tailwind ramps,
 * whose values come from tailwind.config.js rather than from a CSS token.
 */
export function readSwatches(scope, entries) {
  if (!scope) return entries.map((e) => ({ ...e, resolved: null, hex: null }))
  return entries.map((entry) => {
    const resolved = resolveColour(scope, entry.value)
    return { ...entry, resolved, hex: resolved ? rgbToHex(resolved) : null }
  })
}
