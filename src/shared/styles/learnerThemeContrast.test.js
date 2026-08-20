/**
 * WCAG AA contrast gate for the LEARNER design system (`lhx`) — the third
 * of the palette gates, beside `teacherThemeContrast.test.js` (the teacher
 * workspace) and `readingThemeContrast.test.js` (the reading palettes).
 *
 * The learner side was the one token set with no gate, and it is the one
 * where a failure costs the most: it is read by children, on the cheapest
 * phones in the product's market, often in daylight. When
 * `docs/learner/LEARNER_UI_AUDIT.md` measured it (L-10 … L-12, L-26), ten
 * of sixteen ink tokens failed AA in the light look and four in Night —
 * including `--lhx-muted`, which 137 rules draw their words in, at 3.15:1,
 * and the three inactive tab labels at 2.16:1.
 *
 * WHY IT PARSES THE STYLESHEET
 * ----------------------------
 * Same reason as the reading-theme gate: `learnerTheme.css` IS the
 * declaration — there is no JS source of truth for these tokens, because
 * CSS cannot import one. Reading the values back out of the file means
 * this measures what ships rather than a second copy of it that is free
 * to drift from the first.
 *
 * THE ONE IDEA WORTH KEEPING IF THIS IS EVER REWRITTEN
 * ---------------------------------------------------
 * A colour has no contrast on its own — only against the thing it is
 * painted on, in the job it is doing. So every assertion below names
 * BOTH: the token, and the surface a rule actually draws it on. That is
 * why the failures existed at all. `--lhx-orange` was one token doing two
 * jobs — a progress-bar fill (fine at 2.8:1) and the 13px percentage
 * printed beside it (not fine at 2.8:1) — and no amount of staring at the
 * hex would tell you that. `--lhx-green` was doing three.
 *
 * ADDING A TOKEN: add it to INK, GLYPH or FILL_WITH_WHITE_TEXT below,
 * naming the surfaces it is drawn on. A token in none of them is not
 * checked, which is correct for radii and shadows and wrong for anything
 * that carries a colour — so if it is a colour, put it in a list.
 *
 * WHAT IS DELIBERATELY NOT ASSERTED, AND WHY
 * ------------------------------------------
 * - **The brand gradients** (`--lhx-coral1/2`, `--lhx-indigo1`) under
 *   white button labels. White measures 2.2–3.5:1 on them. They are the
 *   locked prototype's identity (`zedexams-learner-prototype-v3.html`)
 *   and repainting them is a brand decision for the owner, not a fix to
 *   make inside a contrast test. Stated here rather than silently omitted:
 *   this is a known, open gap, not a surface nobody looked at.
 * - **Progress-bar fills against their track.** The bar is never the only
 *   carrier of its value — the percentage is printed beside it and
 *   `aria-valuenow` is on the element — which is the 1.4.11 exception.
 * - **Hairlines** (`--lhx-line`) against their surfaces, for the reason
 *   the reading-theme gate gives: they are decorative edges on surfaces
 *   that already differ from the page, not the sole boundary of a control.
 *
 * Run: npm run test:learner-contrast
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '../../..')
const css = readFileSync(resolve(root, 'src/shared/styles/learnerTheme.css'), 'utf8')

/**
 * The learner palette is declared TWICE, and both copies are checked here.
 *
 * `learnerTheme.css` declares it as `--lhx-*` tokens for the `.lhx` shell.
 * `papersTheme.css` declares the same palette again as the generic
 * `--text` / `--accent-fg` / `--success-fg` names, because the papers
 * surfaces are built out of Tailwind utilities that read those variables
 * rather than `.lhx` classes.
 *
 * That is a fork, and it is a deliberate one — but a fork with two ends is
 * a fork that drifts, and it had: /papers shipped the identical 3.15:1
 * muted grey and a 3.04:1 accent long after the audit named them. One gate
 * over both is what keeps "the learner palette" a single claim.
 */
const papersCss = readFileSync(resolve(root, 'src/features/papers/papersTheme.css'), 'utf8')

/**
 * And a third: `quizTheme.css`, the same palette again for the quiz
 * surfaces (`docs/learner/LEARNER_UI_AUDIT.md` L-06). Three declarations
 * of one palette is two more than anyone wants; what makes it tolerable
 * is that the extras exist for a structural reason — those pages are
 * Tailwind utilities reading `--card`, not `.lhx` classes — and that the
 * SHARED block at the foot of this file fails if any two of them
 * disagree about a surface.
 */
const quizCss = readFileSync(resolve(root, 'src/features/quiz/quizTheme.css'), 'utf8')

/** Body text. */
const BODY = 4.5
/** Large text (≥18.66px bold / ≥24px) and graphical objects — WCAG 1.4.11. */
const LARGE = 3

/* ── colour maths ─────────────────────────────────────────────────────── */

function parseColor(value) {
  const raw = String(value).trim()
  if (raw.startsWith('#')) {
    let h = raw.slice(1)
    if (h.length === 3) h = h.split('').map((c) => c + c).join('')
    assert.equal(h.length, 6, `unsupported hex colour: ${value}`)
    return { rgb: [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)), alpha: 1 }
  }
  const m = raw.match(/^rgba?\(([^)]+)\)$/)
  assert.ok(m, `unsupported colour format: ${value}`)
  const parts = m[1].split(',').map((s) => parseFloat(s.trim()))
  assert.ok(parts.length === 3 || parts.length === 4, `bad rgb(a): ${value}`)
  return { rgb: parts.slice(0, 3), alpha: parts.length === 4 ? parts[3] : 1 }
}

/**
 * Night's soft washes are translucent (`rgba(255,154,107,0.16)`), so they
 * have no colour until something is behind them. Measuring the raw value
 * reports the contrast of a colour that is never painted.
 */
function composite(fg, bg) {
  const f = parseColor(fg)
  const b = parseColor(bg)
  assert.equal(b.alpha, 1, 'background must be opaque to composite against')
  return f.rgb.map((c, i) => c * f.alpha + b.rgb[i] * (1 - f.alpha))
}

function relativeLuminance(rgb) {
  const [r, g, b] = rgb.map((v) => {
    const s = v / 255
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

/** Contrast of `fg` over `bg`; either may be translucent over `under`. */
function contrast(fg, bg, under) {
  const bgRgb = parseColor(bg).alpha === 1 ? parseColor(bg).rgb : composite(bg, under)
  const bgHex = `rgb(${bgRgb.join(',')})`
  const fgRgb = parseColor(fg).alpha === 1 ? parseColor(fg).rgb : composite(fg, bgHex)
  const [hi, lo] = [relativeLuminance(fgRgb), relativeLuminance(bgRgb)].sort((a, b) => b - a)
  return (hi + 0.05) / (lo + 0.05)
}

/* ── 1. Read the two looks out of learnerTheme.css ────────────────────── */

/** Every `--lhx-*: value;` declaration inside one brace-balanced block. */
function readBlock(source, startPattern, what) {
  const at = source.search(startPattern)
  assert.ok(at >= 0, `no longer declares ${what} in the expected shape`)
  const open = source.indexOf('{', at)
  let depth = 0
  let end = open
  for (; end < source.length; end += 1) {
    if (source[end] === '{') depth += 1
    else if (source[end] === '}') {
      depth -= 1
      if (depth === 0) break
    }
  }
  const body = source.slice(open, end)
  const tokens = {}
  for (const d of body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) tokens[d[1]] = d[2].trim()
  return tokens
}

const DAY = readBlock(css, /^\.lhx \{/m, 'the `.lhx` palette')

/**
 * Night is a token FLIP over the light look, not a second palette: it
 * redeclares only what changes. So it is read as an overlay, which is what
 * makes "this token has no Night value" visible here — the light value
 * carries over, and if it is a dark ink that is exactly the bug
 * (`--lhx-purple-deep` at 2.29:1 on a dark card, before this gate).
 */
const NIGHT = {
  ...DAY,
  ...readBlock(css, /:is\(body\.theme-midnight, html\[data-theme='night'\] body\) \.lhx \{/, 'the Night override'),
}

const QUIZ_DAY = readBlock(quizCss, /^\.quiz-proto \{/m, 'the `.quiz-proto` palette')
const QUIZ_NIGHT = {
  ...QUIZ_DAY,
  ...readBlock(quizCss, /:is\(body\.theme-midnight, html\[data-theme='night'\] body\) \.quiz-proto \{/, 'the quiz Night override'),
}

const PAPERS_DAY = readBlock(papersCss, /^\.papers-proto \{/m, 'the `.papers-proto` palette')
const PAPERS_NIGHT = {
  ...PAPERS_DAY,
  ...readBlock(papersCss, /:is\(body\.theme-midnight, html\[data-theme='night'\] body\) \.papers-proto \{/, 'the papers Night override'),
}

/** `var(--lhx-x)` chains resolve to a literal; anything else is returned as-is. */
function resolveToken(palette, name, seen = new Set()) {
  const raw = palette[name]
  assert.ok(raw, `the palette does not declare ${name}`)
  const m = /^var\((--[\w-]+)\)$/.exec(raw)
  if (!m) return raw
  assert.ok(!seen.has(name), `${name} resolves in a cycle`)
  seen.add(name)
  return resolveToken(palette, m[1], seen)
}

/* ── 2. What each colour is FOR ───────────────────────────────────────── */

/**
 * Ink: tokens a rule draws words in. `on` names every surface token a rule
 * actually paints them over — the audit's finding was that `--lhx-muted`
 * passed nowhere and `--lhx-indigo-text` passed on the card but not the
 * page, so one surface per token is not enough to check.
 */
const INK = [
  ['--lhx-ink', ['--lhx-card', '--lhx-bg'], 'body copy'],
  ['--lhx-muted', ['--lhx-card', '--lhx-bg'], 'secondary copy — subtitles, "3 of 8 topics done"'],
  // The tab bar's two inks. The bar is FROSTED GLASS (#2561), so neither
  // is drawn on --lhx-card: the ground is `--lhx-glass-nav-solid`, the
  // opaque fallback the bar paints where backdrop-filter is unavailable
  // and the darker of the two cases. The active label additionally sits
  // on its own coral chip, which is darker again — so it is measured
  // against that wash, composited over the glass.
  ['--lhx-nav-ink', ['--lhx-glass-nav-solid'], 'inactive tab-bar labels'],
  ['--lhx-nav-ink-active', ['--lhx-glass-nav-solid', '--lhx-nav-active-wash'], 'the active tab-bar label'],
  ['--lhx-coral-text', ['--lhx-card', '--lhx-bg'], 'the active tab label and the small coral labels'],
  ['--lhx-link', ['--lhx-card', '--lhx-bg'], '"See all" and the reader hints'],
  ['--lhx-indigo-text', ['--lhx-card', '--lhx-bg', '--lhx-indigo-soft'], 'soft-button and chip labels'],
  ['--lhx-green-dark', ['--lhx-card', '--lhx-green-soft'], 'a score, a done badge'],
  ['--lhx-red-ink', ['--lhx-card', '--lhx-red-wash'], 'an error heading'],
  ['--lhx-coral-soft-text', ['--lhx-card', '--lhx-coral-soft'], 'the orange chip label'],
  ['--lhx-amber-ink', ['--lhx-card', '--lhx-amber-wash'], '"waiting on a grown-up"'],
  // The five subject INKS — the percentage printed beside each bar, on a card.
  ['--lhx-green-deep', ['--lhx-card'], 'subject percentage (green)'],
  ['--lhx-blue-deep', ['--lhx-card'], 'subject percentage (blue)'],
  ['--lhx-pink-deep', ['--lhx-card'], 'subject percentage (pink)'],
  ['--lhx-orange-deep', ['--lhx-card'], 'subject percentage (orange)'],
  ['--lhx-purple-deep', ['--lhx-card'], 'subject percentage (purple)'],
]

/**
 * Glyphs: chevrons, dots, carets, empty-state icons and the sheet close
 * "×". Graphical objects rather than words, so the 3:1 floor — but a floor
 * all the same, which is what `--lhx-faint` did not clear in either look
 * (2.16:1 light, 2.27:1 Night). Words do not belong on these; the two
 * places that had them now read `--lhx-muted`.
 */
const GLYPH = [
  ['--lhx-faint', ['--lhx-card', '--lhx-bg'], 'chevrons, dots, empty-state icons'],
]

/**
 * Grounds a rule paints WHITE text on. Judged from the other side: what
 * has to be legible is the label, not the fill. `--lhx-green` is absent on
 * purpose — it is the bright hue, white on it is 2.37:1, and the six rules
 * that used to do that now use `--lhx-green-btn`.
 */
const FILL_WITH_WHITE_TEXT = [
  ['--lhx-green-btn', 'the go button, the online toast, a correct-answer letter'],
  ['--lhx-red-btn', 'the destructive button'],
  ['--lhx-indigo2', 'the selected pill and the indigo fills'],
]

/**
 * The same three questions for `papers-proto`, in that palette's own
 * vocabulary. `--accent` is judged from the other side — as a FILL, with
 * `--accent-text` on it — because that is what it is: the button ground.
 */
const PAPERS_INK = [
  ['--text', ['--card', '--bg', '--bg-subtle'], 'body copy'],
  ['--text-muted', ['--card', '--bg', '--bg-subtle', '--input-bg'], 'secondary copy and placeholders'],
  ['--accent-fg', ['--card', '--bg', '--accent-bg'], 'the accent as a link or label'],
  ['--success-fg', ['--card', '--success-bg'], 'a "paper available" message'],
  ['--warning-fg', ['--card', '--warning-bg'], 'a warning message'],
  ['--danger-fg', ['--card', '--danger-bg'], 'an error message'],
  ['--info-fg', ['--card', '--info-bg'], 'an informational message'],
]

const PAPERS_ON_FILL = [
  ['--accent-text', '--accent', 'the button label on the accent fill'],
]

const WHITE = '#ffffff'

/* ── 3. Assert ────────────────────────────────────────────────────────── */

let checked = 0
const failures = []

function check(look, palette, fg, on, threshold, what, cardToken) {
  const fgValue = resolveToken(palette, fg)
  const bgValue = resolveToken(palette, on)
  // A translucent surface is composited over the card, which is the only
  // thing a wash is ever drawn on in this system.
  const ratio = contrast(fgValue, bgValue, resolveToken(palette, cardToken))
  checked += 1
  if (ratio + 1e-9 < threshold) {
    failures.push(
      `${look}: ${fg} (${fgValue}) on ${on} (${bgValue}) is ${ratio.toFixed(2)}:1, needs ${threshold}:1 — ${what}`,
    )
  }
}

for (const [look, palette] of [['lhx light', DAY], ['lhx Night', NIGHT]]) {
  for (const [token, surfaces, what] of INK) {
    // A nav wash is painted on the BAR, not on a card — compositing it
    // over the wrong ground would measure a colour never drawn.
    const ground = token.startsWith('--lhx-nav-') ? '--lhx-glass-nav-solid' : '--lhx-card'
    for (const on of surfaces) check(look, palette, token, on, BODY, what, ground)
  }
  for (const [token, surfaces, what] of GLYPH) {
    for (const on of surfaces) check(look, palette, token, on, LARGE, what, '--lhx-card')
  }
  for (const [token, what] of FILL_WITH_WHITE_TEXT) {
    const fill = resolveToken(palette, token)
    const ratio = contrast(WHITE, fill, resolveToken(palette, '--lhx-card'))
    checked += 1
    if (ratio + 1e-9 < BODY) {
      failures.push(
        `${look}: white text on ${token} (${fill}) is ${ratio.toFixed(2)}:1, needs ${BODY}:1 — ${what}`,
      )
    }
  }
}

for (const [look, palette] of [
  ['papers light', PAPERS_DAY], ['papers Night', PAPERS_NIGHT],
  ['quiz light', QUIZ_DAY], ['quiz Night', QUIZ_NIGHT],
]) {
  for (const [token, surfaces, what] of PAPERS_INK) {
    for (const on of surfaces) check(look, palette, token, on, BODY, what, '--card')
  }
  for (const [ink, fill, what] of PAPERS_ON_FILL) {
    check(look, palette, ink, fill, BODY, what, '--card')
  }
}

assert.deepEqual(failures, [], `\n  ${failures.join('\n  ')}\n`)

/* ── 4. Prove the gate can fail ───────────────────────────────────────── */

/**
 * A contrast test that only ever passes is indistinguishable from one that
 * measures nothing, and this one derives its inputs from a regex over a
 * stylesheet — the failure mode is a selector that stops matching, which
 * would leave an empty token map and pass vacuously. Both halves are
 * checked: the maths rejects a colour it should reject, and the palettes
 * are non-empty and actually differ from each other.
 */
assert.ok(
  contrast('#8a8fb5', '#ffffff') < BODY,
  'the maths no longer rejects the muted grey this gate was written for',
)
assert.ok(
  contrast('#2b2d51', '#ffffff') > 12,
  'the maths no longer accepts the ink it should accept',
)
assert.ok(Object.keys(DAY).length > 40, 'the lhx light palette parsed as near-empty — the selector stopped matching')
assert.notEqual(DAY['--lhx-bg'], NIGHT['--lhx-bg'], 'lhx Night parsed as identical to light — the override stopped matching')
assert.ok(Object.keys(PAPERS_DAY).length > 20, 'the papers palette parsed as near-empty — the selector stopped matching')
assert.notEqual(PAPERS_DAY['--bg'], PAPERS_NIGHT['--bg'], 'papers Night parsed as identical to light — the override stopped matching')
assert.ok(Object.keys(QUIZ_DAY).length > 20, 'the quiz palette parsed as near-empty — the selector stopped matching')
assert.notEqual(QUIZ_DAY['--bg'], QUIZ_NIGHT['--bg'], 'quiz Night parsed as identical to light — the override stopped matching')

/**
 * The two declarations of the same palette must agree where they overlap.
 * Nothing forces this at runtime — they are separate files read by
 * separate rules — so a learner tapping from /notes to /papers is the
 * only thing that would ever notice, which is exactly why it drifted.
 */
const SHARED = [
  ['--lhx-bg', '--bg'], ['--lhx-card', '--card'], ['--lhx-ink', '--text'],
  ['--lhx-muted', '--text-muted'], ['--lhx-line', '--border'],
]
for (const [look, lhx, other, name] of [
  ['light', DAY, PAPERS_DAY, 'papersTheme.css'],
  ['Night', NIGHT, PAPERS_NIGHT, 'papersTheme.css'],
  ['light', DAY, QUIZ_DAY, 'quizTheme.css'],
  ['Night', NIGHT, QUIZ_NIGHT, 'quizTheme.css'],
]) {
  for (const [a, b] of SHARED) {
    assert.equal(
      resolveToken(other, b).toLowerCase(),
      resolveToken(lhx, a).toLowerCase(),
      `${look}: ${name} ${b} and learnerTheme.css ${a} are the same surface and disagree`,
    )
  }
}

console.log(`learner theme contrast: ${checked} pairs across 3 stylesheets × 2 looks — all pass`)
