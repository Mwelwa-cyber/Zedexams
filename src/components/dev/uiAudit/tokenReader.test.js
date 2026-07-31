/**
 * The pure half of the UI audit's token reader.
 *
 * Only the parts that can be wrong SILENTLY are worth pinning here. The DOM
 * half fails loudly (no swatches render); these three can each be wrong while
 * the page still looks like it is working:
 *
 *   • isThemeSelector — too narrow and tokens quietly disappear from the page,
 *     which reads as "we don't have that token" rather than "the scraper
 *     missed it". Too wide and the page fills with the MoE calendar's private
 *     variables and stops being scannable.
 *   • classifyToken — a misgrouped token still renders, in the wrong section.
 *   • rgbToHex — an alpha channel dropped here makes four different sidebar
 *     tokens print as the same #FFFFFF.
 */
import assert from 'node:assert/strict'
import {
  classifyToken,
  isThemeSelector,
  rgbToHex,
  sortTokenNames,
  TOKEN_GROUPS,
} from './tokenReader.js'

let passed = 0
function test(name, fn) {
  fn()
  passed += 1
  console.log(`  ✓ ${name}`)
}

console.log('\nisThemeSelector — matches the palette rules and nothing else')

test('matches the four workspace theme rules', () => {
  for (const id of ['terracotta', 'miombo', 'copperbelt', 'night']) {
    assert.equal(isThemeSelector(`[data-theme='${id}']`), true, id)
  }
})

test('matches :root, .studio-theme and the reading palettes', () => {
  assert.equal(isThemeSelector(':root'), true)
  assert.equal(isThemeSelector('.studio-theme'), true)
  assert.equal(isThemeSelector('body.theme-oatmeal'), true)
  assert.equal(isThemeSelector('body.theme-midnight'), true)
})

test('matches the night bridge, which is declared on BODY', () => {
  // The bridge is `html[data-theme='night'] body` rather than the plain
  // attribute selector, for the proximity reason spelled out in index.css.
  // Missing it would drop Midnight's entire reading palette from the page.
  assert.equal(isThemeSelector("html[data-theme='night'] body"), true)
})

test('matches a grouped selector if any part is a palette rule', () => {
  assert.equal(isThemeSelector(":root,\n[data-theme='terracotta']"), true)
})

test('does NOT match the private scopes that also declare custom properties', () => {
  for (const s of [
    '.moe-calendar',
    '.tdv2',
    '.learner-game-theme',
    '.force-light-theme',
    ':is(body.theme-midnight, html[data-theme=\'night\'] body) .moe-calendar',
    '.studio-theme .studio-card',
    "[data-theme='night'] .studio-theme .studio-input",
  ]) {
    assert.equal(isThemeSelector(s), false, s)
  }
})

test('survives a missing or non-string selector', () => {
  assert.equal(isThemeSelector(undefined), false)
  assert.equal(isThemeSelector(null), false)
  assert.equal(isThemeSelector(42), false)
})

console.log('\nclassifyToken — every token lands in a rendered group')

test('workspace tokens are the --zt- set', () => {
  assert.equal(classifyToken('--zt-accent'), 'workspace')
  assert.equal(classifyToken('--zt-sidebar-bg'), 'workspace')
})

test('reading tokens are the names the shared primitives are written in', () => {
  for (const n of ['--bg', '--bg-subtle', '--card', '--card-hover', '--text',
    '--text-muted', '--border', '--accent', '--accent-fg', '--input-bg',
    '--hero-gradient', '--on-dark', '--banner-bg']) {
    assert.equal(classifyToken(n), 'reading', n)
  }
})

test('semantic tokens keep their own group', () => {
  for (const n of ['--success', '--success-bg', '--warning-fg', '--danger', '--info-bg']) {
    assert.equal(classifyToken(n), 'semantic', n)
  }
})

test('scale tokens are not treated as colours', () => {
  assert.equal(classifyToken('--radius-lg'), 'radius')
  assert.equal(classifyToken('--r-2xl'), 'radius')
  assert.equal(classifyToken('--shadow-md'), 'shadow')
  assert.equal(classifyToken('--shadow'), 'shadow')
  assert.equal(classifyToken('--duration-base'), 'motion')
  assert.equal(classifyToken('--ease-spring'), 'motion')
})

test('an unrecognised token is surfaced, not swallowed', () => {
  assert.equal(classifyToken('--mint'), 'other')
  assert.equal(classifyToken('--pink-bg'), 'other')
})

test('every classification has a group that renders it', () => {
  const ids = new Set(TOKEN_GROUPS.map((g) => g.id))
  for (const n of ['--zt-accent', '--card', '--success', '--radius-lg',
    '--shadow-md', '--ease-out', '--mint']) {
    const group = classifyToken(n)
    assert.ok(ids.has(group), `${n} classified as "${group}", which no group renders`)
  }
})

test('a non-custom property is rejected', () => {
  assert.equal(classifyToken('color'), null)
  assert.equal(classifyToken(''), null)
  assert.equal(classifyToken(undefined), null)
})

console.log('\nrgbToHex — alpha survives')

test('opaque colours round-trip to six digits', () => {
  assert.equal(rgbToHex('rgb(185, 92, 58)'), '#B95C3A')
  assert.equal(rgbToHex('rgb(255, 255, 255)'), '#FFFFFF')
  assert.equal(rgbToHex('rgb(0, 0, 0)'), '#000000')
})

test('a translucent colour keeps its alpha as an eighth pair', () => {
  // Three of the four themes ship a sidebar text token at a different alpha
  // over the same white. Dropping alpha prints them as one value.
  assert.equal(rgbToHex('rgba(255, 255, 255, 0.78)'), '#FFFFFFC7')
  assert.equal(rgbToHex('rgba(255, 255, 255, 0.8)'), '#FFFFFFCC')
  assert.notEqual(
    rgbToHex('rgba(255, 255, 255, 0.78)'),
    rgbToHex('rgba(255, 255, 255, 0.55)'),
  )
})

test('alpha of exactly 1 is not written out', () => {
  assert.equal(rgbToHex('rgba(16, 22, 31, 1)'), '#10161F')
})

test('fractional channels are rounded, not truncated', () => {
  assert.equal(rgbToHex('rgb(184.6, 92.4, 58.5)'), '#B95C3B')
})

test('a value that is not a colour returns null rather than a fake hex', () => {
  assert.equal(rgbToHex('none'), null)
  assert.equal(rgbToHex(''), null)
  assert.equal(rgbToHex(null), null)
  assert.equal(rgbToHex('rgb(1)'), null)
})

console.log('\nrgbToHex — the color-mix serialisation')

test('color(srgb …) channels are fractions, not 0-255', () => {
  // This is the one that shipped wrong. A color-mix() result serialises as
  // `color(srgb …)` with 0–1 channels; parsing it like rgb() and rounding
  // turns every one of them into #000000 or #010101 — a plausible near-black
  // printed beside a visibly pale swatch. Most of the .studio-theme block and
  // --accent-bg / --accent-tint / --bg-subtle / --card-hover are color-mix().
  assert.equal(rgbToHex('color(srgb 0.7255 0.3608 0.2275)'), '#B95C3A')
  assert.equal(rgbToHex('color(srgb 1 1 1)'), '#FFFFFF')
  assert.equal(rgbToHex('color(srgb 0 0 0)'), '#000000')
})

test('a near-black result is genuinely near-black, not a parse failure', () => {
  // Guards the specific symptom, so a regression is recognisable from the
  // page rather than only from this file.
  assert.notEqual(rgbToHex('color(srgb 0.976 0.933 0.882)'), '#010101')
  assert.equal(rgbToHex('color(srgb 0.976 0.933 0.882)'), '#F9EEE1')
})

test('color(srgb …) carries alpha through the slash form', () => {
  assert.equal(rgbToHex('color(srgb 1 1 1 / 0.5)'), '#FFFFFF80')
})

test('a colour space we cannot convert is refused, not guessed', () => {
  // These channels are not RGB. Scraping the digits out of them yields a hex
  // that looks like an answer — `oklch(0.7 0.1 40)` would read as #010028 —
  // and it would sit next to a correctly painted swatch, so the page would be
  // disagreeing with itself in the one place it must not. A blank cell sends
  // you to devtools; a wrong hex sends you nowhere.
  assert.equal(rgbToHex('color(display-p3 0.7 0.3 0.2)'), null)
  assert.equal(rgbToHex('oklch(0.7 0.1 40)'), null)
  assert.equal(rgbToHex('lab(54% 81 70)'), null)
  assert.equal(rgbToHex('linear-gradient(135deg, #000 0%, #fff 100%)'), null)
})

console.log('\nsortTokenNames')

test('is stable and does not mutate its input', () => {
  const input = ['--card', '--accent', '--bg']
  const out = sortTokenNames(input)
  assert.deepEqual(input, ['--card', '--accent', '--bg'])
  assert.deepEqual(out, ['--accent', '--bg', '--card'])
})

console.log(`\n${passed} assertions passed.\n`)
