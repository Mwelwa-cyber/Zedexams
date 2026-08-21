/**
 * `color-mix()` needs a fallback, or a whole surface disappears (#android-dock)
 * ============================================================================
 *
 * `color-mix()` landed in Chrome/WebView **111** (March 2023). The Android
 * build's `minSdkVersion` is 24, and a budget handset that never took a
 * WebView update sits well below that, so the function is genuinely absent on
 * devices this product is FOR. There is no polyfill: this is CSS parsing, not
 * a missing API.
 *
 * What an engine without it does is worse than "the tint is missing", and the
 * two failure modes are different:
 *
 *   1. A NORMAL property (`background: color-mix(...)`) is invalid at parse
 *      time, so the declaration is dropped and the property keeps whatever it
 *      had — usually the initial value. The teacher dock's dark-teal pill
 *      became `transparent`, and its white icons and labels were then white
 *      text on a white page. Reported as "the icons are colourless".
 *
 *   2. A CUSTOM PROPERTY (`--sidebar-teal: color-mix(...)`) is NOT dropped,
 *      because custom properties accept any token stream at parse time. The
 *      unusable value is stored and poisons every consumer: the mobile
 *      drawer's `linear-gradient(..., var(--sidebar-teal))` became invalid at
 *      computed-value time and fell back to `transparent`, so the drawer
 *      opened as floating white text over the page. Reported as "it is only
 *      showing a few words".
 *
 * The second case is why this is a build step rather than twenty hand edits:
 * one poisoned variable takes out surfaces that never mention `color-mix()`
 * themselves.
 *
 * THE FALLBACK IS THE DOMINANT OPERAND, and that choice is what makes this
 * safe to apply to all ~200 call sites unread. For `color-mix(in srgb, A p%,
 * B)` the result is always nearer whichever operand carries more weight, so
 * that operand is emitted as the fallback:
 *
 *   - `var(--zt-sidebar-bg) 88%, #000000`  → `var(--zt-sidebar-bg)`  (a real
 *     dark surface, a shade lighter than intended — invisible in practice)
 *   - `var(--sidebar-teal) 94%, transparent` → `var(--sidebar-teal)` (94% vs
 *     100% opaque; the dock is solid again)
 *   - `var(--zt-accent) 12%, var(--zt-card)` → `var(--zt-card)` (a 12% tint
 *     over a card ≈ the card)
 *
 * When the dominant operand is `transparent` — a light tint like
 * `var(--x) 10%, transparent` — the fallback IS `transparent`, which is
 * exactly what those declarations already resolve to on an old WebView today.
 * So the rule is **never a visual regression**: it can only turn a dropped
 * declaration into a usable one, never a working one into something worse.
 *
 * When BOTH operands are static colours the mix is computed exactly at build
 * time (sRGB, premultiplied alpha per css-color-5) and no approximation is
 * needed at all.
 *
 * Custom properties can't use the cascade trick — a browser stores the
 * unparsed token stream, so a preceding fallback declaration is simply
 * overwritten. Those are inverted instead: the definition becomes the
 * fallback, and the real `color-mix()` value is re-declared inside an
 * `@supports (color: color-mix(in srgb, red 50%, blue))` block that an engine
 * without the function skips entirely.
 */

import { AtRule } from 'postcss'

const COLOR_MIX = 'color-mix('
const SUPPORTS_COLOR_MIX = '(color: color-mix(in srgb, red 50%, blue))'

/** Split a comma-separated argument list, respecting nested parentheses. */
function splitTopLevel(input, separator = ',') {
  const parts = []
  let depth = 0
  let current = ''
  for (const char of input) {
    if (char === '(') depth += 1
    else if (char === ')') depth -= 1
    if (char === separator && depth === 0) {
      parts.push(current.trim())
      current = ''
      continue
    }
    current += char
  }
  parts.push(current.trim())
  return parts
}

/**
 * Find the balanced extent of the `color-mix(` starting at `start`.
 * Returns the index just past its closing paren, or -1 if unbalanced.
 */
function matchParen(value, start) {
  let depth = 0
  for (let i = start; i < value.length; i += 1) {
    if (value[i] === '(') depth += 1
    else if (value[i] === ')') {
      depth -= 1
      if (depth === 0) return i + 1
    }
  }
  return -1
}

/**
 * Split one `color-mix()` argument into its colour and its percentage.
 * The percentage may sit on either side of the colour per css-color-5, and
 * a `var(--x)` colour can itself contain a `%` in a fallback — so only a
 * TOP-LEVEL trailing/leading percentage token counts.
 */
function readOperand(text) {
  const trimmed = text.trim()
  const leading = /^(-?[\d.]+)%\s+(.+)$/.exec(trimmed)
  if (leading) return { color: leading[2].trim(), percent: Number(leading[1]) }
  // A trailing percentage is only a weight when it is outside every paren.
  let depth = 0
  for (let i = 0; i < trimmed.length; i += 1) {
    if (trimmed[i] === '(') depth += 1
    else if (trimmed[i] === ')') depth -= 1
  }
  if (depth !== 0) return { color: trimmed, percent: null }
  const trailing = /^(.+?)\s+(-?[\d.]+)%$/.exec(trimmed)
  if (trailing) {
    const color = trailing[1].trim()
    // Guard against `var(--x, 10%)`-shaped values where the % is inside.
    if (matchParen(color, color.indexOf('(')) !== -1 || !color.includes('(')) {
      return { color, percent: Number(trailing[2]) }
    }
  }
  return { color: trimmed, percent: null }
}

const NAMED = {
  transparent: [0, 0, 0, 0],
  black: [0, 0, 0, 1],
  white: [255, 255, 255, 1],
  red: [255, 0, 0, 1],
  blue: [0, 0, 255, 1],
  green: [0, 128, 0, 1],
}

/** Parse a static colour to [r,g,b,a], or null when it isn't statically known. */
function parseStaticColor(input) {
  const value = input.trim().toLowerCase()
  if (Object.prototype.hasOwnProperty.call(NAMED, value)) return NAMED[value].slice()
  const hex = /^#([0-9a-f]{3,8})$/.exec(value)
  if (hex) {
    const digits = hex[1]
    const expand = (c) => parseInt(c + c, 16)
    if (digits.length === 3 || digits.length === 4) {
      return [
        expand(digits[0]), expand(digits[1]), expand(digits[2]),
        digits.length === 4 ? expand(digits[3]) / 255 : 1,
      ]
    }
    if (digits.length === 6 || digits.length === 8) {
      const pair = (i) => parseInt(digits.slice(i, i + 2), 16)
      return [pair(0), pair(2), pair(4), digits.length === 8 ? pair(6) / 255 : 1]
    }
    return null
  }
  const fn = /^rgba?\(([^)]*)\)$/.exec(value)
  if (!fn) return null
  // The modern form separates channels with spaces and alpha with a slash;
  // turn the slash into a separator rather than a token of its own.
  const parts = fn[1].includes(',')
    ? splitTopLevel(fn[1])
    : splitTopLevel(fn[1].replace('/', ' '), ' ').filter(Boolean)
  if (parts.length < 3) return null
  const channel = (raw) => {
    const text = String(raw).trim()
    if (text.endsWith('%')) return (Number(text.slice(0, -1)) / 100) * 255
    return Number(text)
  }
  const alphaOf = (raw) => {
    if (raw === undefined) return 1
    const text = String(raw).trim()
    return text.endsWith('%') ? Number(text.slice(0, -1)) / 100 : Number(text)
  }
  const rgba = [channel(parts[0]), channel(parts[1]), channel(parts[2]), alphaOf(parts[3])]
  return rgba.every((n) => Number.isFinite(n)) ? rgba : null
}

function formatColor([r, g, b, a]) {
  const round = (n) => Math.max(0, Math.min(255, Math.round(n)))
  if (a >= 1) {
    return `#${[r, g, b].map((n) => round(n).toString(16).padStart(2, '0')).join('')}`
  }
  const alpha = Math.max(0, Math.min(1, a))
  return `rgba(${round(r)}, ${round(g)}, ${round(b)}, ${Number(alpha.toFixed(4))})`
}

/** Mix two static sRGB colours with premultiplied alpha (css-color-5 §2.1). */
function mixStatic(a, b, weightA) {
  const wa = weightA
  const wb = 1 - weightA
  const alpha = a[3] * wa + b[3] * wb
  if (alpha === 0) return [0, 0, 0, 0]
  const channel = (i) => (a[i] * a[3] * wa + b[i] * b[3] * wb) / alpha
  return [channel(0), channel(1), channel(2), alpha]
}

/**
 * Resolve the weights of a two-operand mix to a normalised [0..1] pair.
 * Mirrors css-color-5: a single stated percentage implies its complement,
 * an omitted pair is 50/50, and a pair that doesn't sum to 100 is scaled.
 */
function resolveWeights(first, second) {
  let p1 = first.percent
  let p2 = second.percent
  if (p1 == null && p2 == null) return 0.5
  if (p1 == null) p1 = 100 - p2
  if (p2 == null) p2 = 100 - p1
  const total = p1 + p2
  if (total <= 0) return 0.5
  return p1 / total
}

/**
 * Replace one `color-mix(...)` expression with a value an engine that lacks
 * the function can use. Nested mixes resolve innermost-first via recursion.
 */
function fallbackForExpression(expression) {
  const open = expression.indexOf('(')
  const inner = expression.slice(open + 1, expression.length - 1)
  const args = splitTopLevel(inner)
  // args[0] is the colour space (`in srgb`, `in oklch longer hue`, …).
  if (args.length < 3) return null
  const first = readOperand(args[1])
  const second = readOperand(args[2])
  // Operands may themselves be mixes; resolve them before choosing.
  const firstColor = fallbackForValue(first.color)
  const secondColor = fallbackForValue(second.color)
  if (firstColor == null || secondColor == null) return null

  const weightA = resolveWeights(first, second)

  const staticA = parseStaticColor(firstColor)
  const staticB = parseStaticColor(secondColor)
  // Both sides known → compute the real mix, so the fallback is exact.
  // Only sRGB is computed here; any other space keeps the dominant operand
  // rather than pretending a wrong-space mix is the true colour.
  const space = args[0].trim().toLowerCase()
  if (staticA && staticB && space === 'in srgb') {
    return formatColor(mixStatic(staticA, staticB, weightA))
  }
  return weightA >= 0.5 ? firstColor : secondColor
}

/**
 * Rewrite every top-level `color-mix()` inside a declaration value.
 * Returns the rewritten value, or null when any expression is unparseable
 * (in which case the caller leaves the declaration completely alone).
 */
export function fallbackForValue(value) {
  if (!value || !value.toLowerCase().includes(COLOR_MIX)) return value
  let out = ''
  let index = 0
  const lower = value.toLowerCase()
  while (index < value.length) {
    const at = lower.indexOf(COLOR_MIX, index)
    if (at === -1) {
      out += value.slice(index)
      break
    }
    // Only match a real function token, never `--my-color-mix(` or `x-color-mix(`.
    const before = at === 0 ? '' : value[at - 1]
    if (before && /[\w-]/.test(before)) {
      out += value.slice(index, at + COLOR_MIX.length)
      index = at + COLOR_MIX.length
      continue
    }
    const end = matchParen(value, at + COLOR_MIX.length - 1)
    if (end === -1) return null
    const replacement = fallbackForExpression(value.slice(at, end))
    if (replacement == null) return null
    out += value.slice(index, at) + replacement
    index = end
  }
  return out
}

/** True when this declaration defines a custom property. */
function isCustomProperty(decl) {
  return decl.prop.startsWith('--')
}

/**
 * The PostCSS plugin. Runs late (after Tailwind has emitted its utilities) so
 * generated declarations are covered too.
 */
export default function colorMixFallback() {
  return {
    postcssPlugin: 'color-mix-fallback',
    OnceExit(root) {
      // Rules whose custom properties need re-declaring under @supports,
      // collected first so one @supports block serves each source rule.
      const deferred = new Map()

      root.walkDecls((decl) => {
        const value = decl.value
        if (!value || !value.toLowerCase().includes(COLOR_MIX)) return
        // Already inside the @supports guard this plugin emits — leave it.
        let ancestor = decl.parent
        while (ancestor) {
          // Any @supports gated on color-mix already protects what it holds —
          // ours, or one an author wrote. Matching the condition text exactly
          // would miss both a minified copy and a hand-written variant.
          if (ancestor.type === 'atrule' && ancestor.name === 'supports'
            && /color-mix/i.test(ancestor.params)) return
          ancestor = ancestor.parent
        }

        const fallback = fallbackForValue(value)
        // Unparseable, or the fallback is the value itself — nothing to add.
        if (fallback == null || fallback === value) return

        if (isCustomProperty(decl)) {
          const rule = decl.parent
          if (!rule || rule.type !== 'rule') return
          if (!deferred.has(rule)) deferred.set(rule, [])
          deferred.get(rule).push({ prop: decl.prop, value, important: decl.important })
          // The definition itself becomes the value an old engine can use.
          decl.value = fallback
          return
        }

        // A normal property: the cascade does the work. An engine that
        // understands color-mix takes the second declaration; one that does
        // not drops it at parse time and keeps this fallback.
        // Skip when the fallback is already sitting in front of it, so a
        // second pass over already-processed CSS stacks nothing.
        const previous = decl.prev()
        if (previous && previous.type === 'decl' && previous.prop === decl.prop
          && previous.value === fallback && previous.important === decl.important) return
        decl.cloneBefore({ value: fallback })
      })

      for (const [rule, decls] of deferred) {
        const supports = buildSupportsBlock(rule, decls)
        rule.parent.insertAfter(rule, supports)
      }
    },
  }
}

/** Build `@supports (…) { <selector> { --x: color-mix(…) } }` for one rule. */
function buildSupportsBlock(rule, decls) {
  const inner = rule.clone()
  inner.removeAll()
  inner.raws.before = '\n  '
  for (const { prop, value, important } of decls) {
    inner.append({ prop, value, important })
  }
  const supports = new AtRule({ name: 'supports', params: SUPPORTS_COLOR_MIX })
  supports.raws.before = '\n'
  supports.append(inner)
  return supports
}

colorMixFallback.postcss = true
