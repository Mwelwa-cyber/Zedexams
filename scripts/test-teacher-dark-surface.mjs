/**
 * The teacher workspace must stay fully covered on the Night palette.
 *
 * WHAT THIS GUARDS
 * ----------------
 * Three separate things went wrong at once when a teacher picked Night, and
 * each has a different failure mode. This guards all three mechanically,
 * because every one of them is invisible to a reviewer working in a light
 * theme — nothing throws, nothing looks wrong in the diff.
 *
 * 1. THE STUDIO DESIGN SYSTEM IS A REMAP, NOT A TOKEN SET.
 *    The `.studio-*` and `.teacher-*` component classes in index.css are
 *    written with literals (#ffffff cards, #0e2a32 ink, #d9cfb8 hairlines)
 *    rather than the --zt-* tokens the shell around them uses. Night support
 *    is therefore a block that names each rule and states its dark twin —
 *    and a remap degrades one component at a time. Add a card with a white
 *    background and it is correct in three themes and a white slab in the
 *    fourth. So every rule that declares a LIGHT background or DARK ink must
 *    be named in the Night block, or be a declared exception.
 *
 * 2. THE SYLLABI STUDIO EXISTS TWICE.
 *    SyllabiLibrary.jsx (teacher) and CbcKbAdmin.jsx (admin) each carry their
 *    own copy of the same six-token stylesheet inside a template literal.
 *    They are not imported from one place, so a fix applied to one is simply
 *    absent from the other — which is exactly how the admin editor kept its
 *    cream palette after the teacher page was fixed. Both must declare the
 *    same Night tokens.
 *
 * 3. A TOKEN THAT FILLS AND ALSO INKS CANNOT INVERT.
 *    --ss-teal fills the header, the section rows and the active tab (dark in
 *    both themes, white text on them) AND inks the headings drawn on cream
 *    (which must go light). --ss-orange has the same split. One value cannot
 *    serve both directions, so the ink halves are separate tokens and the
 *    fill tokens must never be used as `color:` again — that regression looks
 *    like an ordinary tidy-up and produces dark-on-dark text.
 *
 * WHAT IS DELIBERATELY OUT OF SCOPE
 * ---------------------------------
 * Pastel CATEGORY chips — the quickcreate icon tiles, activity badges, the
 * `--studio-tone-*` pairs, the library folder palettes. Each is a coloured
 * sticker carrying its own dark ink and is legible on any background, and
 * remapping them to neutral dark surfaces is what broke the Games
 * leaderboard in #2027: the class remap outranked the tint utility the card
 * was built from and left the one element meant to be noticed at 1.61:1.
 * They are listed in STICKER_FILLS so the exemption is stated rather than
 * silent.
 *
 * Gradient-backed chrome (the page header, the hero) is also out: those are
 * dark in every theme and already carry white text.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '..')

/* ── A minimal CSS reader ─────────────────────────────────────────────── */
// Enough to walk rules and read flat declarations. Comments are stripped
// first: without that, a comment before a rule is absorbed into its selector.

function parseRules(src) {
  const out = []
  let i = 0
  while (i < src.length) {
    const open = src.indexOf('{', i)
    if (open === -1) break
    let depth = 1
    let j = open + 1
    while (j < src.length && depth > 0) {
      if (src[j] === '{') depth++
      else if (src[j] === '}') depth--
      j++
    }
    const selector = src.slice(i, open).split('}').pop().split('{').pop().trim()
    const body = src.slice(open + 1, j - 1)
    // @layer / @media wrap rules rather than being one; recurse into them so a
    // rule inside a breakpoint is checked exactly like one outside.
    if (selector.startsWith('@')) out.push(...parseRules(body))
    else out.push({ selector, body })
    i = j
  }
  return out
}

const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, ' ')

function relativeLuminance(hex) {
  let h = hex
  if (h.length === 4) h = '#' + [...h.slice(1)].map((c) => c + c).join('')
  const [r, g, b] = [1, 3, 5]
    .map((i) => parseInt(h.slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

function declaration(body, prop) {
  const m = body.match(new RegExp(`(?:^|;|\\s)${prop}\\s*:\\s*([^;]+)`, 'i'))
  return m ? m[1].trim() : null
}

const flatHex = (v) => (v && /^#[0-9a-f]{3,6}$/i.test(v.trim()) ? v.trim().toLowerCase() : null)

/* ── 1. The studio remap covers every light rule ──────────────────────── */

const indexCss = stripComments(readFileSync(resolve(root, 'src/index.css'), 'utf8'))
const rules = parseRules(indexCss)

const studioRules = rules.filter(
  (r) => /^\.studio-theme\s+\S/.test(r.selector) && !r.selector.includes("[data-theme='night']"),
)
assert.ok(
  studioRules.length > 200,
  `expected the studio design system in src/index.css; found ${studioRules.length} rules. ` +
    'If it moved, update this guard rather than deleting it.',
)

// Selectors the Night block already speaks for, with the theme prefix removed
// so they compare against the light rule they answer.
const nightCovered = new Set(
  rules
    .filter((r) => r.selector.includes("[data-theme='night']"))
    .flatMap((r) => r.selector.split(','))
    .map((s) => s.trim().replace(/^\[data-theme='night'\]\s*/, ''))
    .filter(Boolean),
)

// Coloured stickers: a fill that stays light on purpose. See the header.
const STICKER_FILLS = new Set([
  '#fde2c4', '#e3dcf5', '#d8ecd0', '#dbe7f4', '#e8d8f0', '#e3dcc8',
  '#faecb8', '#fde9b8', '#f0d6e0', '#cfe9f5', '#e8e1f6', '#d9ecff', '#e7e1cf',
])

const LIGHT_BG = 0.5   // above this a flat fill reads as a light surface
const DARK_INK = 0.3   // below this a colour reads as ink meant for a light one

const uncovered = []
for (const rule of studioRules) {
  const bg = flatHex(declaration(rule.body, 'background') || declaration(rule.body, 'background-color'))
  const fg = flatHex(declaration(rule.body, 'color'))
  const lightBg = bg && relativeLuminance(bg) > LIGHT_BG
  const darkInk = fg && relativeLuminance(fg) < DARK_INK
  if (!lightBg && !darkInk) continue
  if (bg && STICKER_FILLS.has(bg)) continue
  const selector = rule.selector.split(',')[0].trim()
  if (nightCovered.has(selector)) continue
  uncovered.push(
    `${selector}  (${[lightBg && `background ${bg}`, darkInk && `color ${fg}`].filter(Boolean).join(', ')})`,
  )
}

assert.deepEqual(
  uncovered,
  [],
  'These .studio-theme rules paint a light surface or dark ink with no Night ' +
    "twin, so they render wrong for a teacher on Night. Add a matching " +
    "[data-theme='night'] rule in src/index.css, or — if the fill is a " +
    'coloured sticker that is meant to stay light — add its colour to ' +
    `STICKER_FILLS here and say why:\n  ${uncovered.join('\n  ')}`,
)

/* ── 2. Both copies of the Syllabi Studio declare the Night palette ───── */

const SYLLABI_COPIES = [
  'src/features/teacherHome/pages/SyllabiLibrary.jsx',
  'src/features/adminCbcKb/pages/CbcKbAdmin.jsx',
]

// Every token the light `.ss-root` block declares must be restated for Night,
// plus the two split-ink tokens that only exist because of this theme.
const SS_TOKENS = [
  '--ss-cream', '--ss-cream2', '--ss-teal', '--ss-orange',
  '--ss-white', '--ss-text', '--ss-muted',
  '--ss-ink-strong', '--ss-orange-solid', '--ss-accent-ink',
]

for (const file of SYLLABI_COPIES) {
  const src = readFileSync(resolve(root, file), 'utf8')
  const style = src.match(/<style>\{`([\s\S]*?)`\}<\/style>/)
  assert.ok(style, `${file} no longer carries its <style> block`)
  const sheet = stripComments(style[1])

  const nightBlock = sheet.match(/\[data-theme='night'\]\s+\.ss-root[^{]*\{([^}]*)\}/)
  assert.ok(
    nightBlock,
    `${file} has no [data-theme='night'] .ss-root block. This studio paints ` +
      'from its own tokens rather than the workspace ones, so without that ' +
      'block it stays at full cream brightness on Night. The other copy in ' +
      `${SYLLABI_COPIES.filter((f) => f !== file)} has one — mirror it.`,
  )
  for (const token of SS_TOKENS) {
    assert.match(
      nightBlock[1],
      new RegExp(`${token}\\s*:`),
      `${file}: the Night .ss-root block does not declare ${token}. Every ` +
        'token the light block sets has to be restated, or that one value ' +
        'stays at its cream setting while everything around it goes dark.',
    )
  }

  /* ── 3. The fill tokens are never used as ink ─────────────────────── */

  for (const [fill, ink] of [['--ss-teal', '--ss-ink-strong'], ['--ss-orange', '--ss-accent-ink']]) {
    const asInk = sheet.match(new RegExp(`(?<!-)color:\\s*var\\(${fill}\\)`, 'g')) || []
    assert.equal(
      asInk.length,
      0,
      `${file}: ${fill} is used as a text colour ${asInk.length} time(s). It ` +
        `is a FILL — dark in both themes, carrying white text — so as ink it ` +
        `goes dark-on-dark the moment the page inverts. Use ${ink}, which is ` +
        'the same colour in the light themes and inverts on Night.',
    )
  }
}

/* ── 4. The two copies agree ──────────────────────────────────────────── */
// Not a full diff — the two studios legitimately differ (the admin one has an
// editor). Only the Night palette has to match, because a teacher and an
// admin looking at the same syllabus should not see two different pages.

const nightPalettes = SYLLABI_COPIES.map((file) => {
  const sheet = stripComments(readFileSync(resolve(root, file), 'utf8'))
  const block = sheet.match(/\[data-theme='night'\]\s+\.ss-root[^{]*\{([^}]*)\}/)[1]
  return Object.fromEntries(
    SS_TOKENS.map((t) => [t, block.match(new RegExp(`${t}\\s*:\\s*([^;]+)`))?.[1].trim()]),
  )
})

assert.deepEqual(
  nightPalettes[0],
  nightPalettes[1],
  'The teacher and admin copies of the Syllabi Studio declare DIFFERENT Night ' +
    'palettes. They are two hand-maintained copies of one design system: ' +
    'whichever was edited last is the one that got the fix, and the other is ' +
    'now quietly wrong. Bring them back into step.',
)

console.log('teacher dark surface: ok')
