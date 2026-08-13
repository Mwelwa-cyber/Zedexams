/**
 * The UI audit page's forced hover/focus specimens, and the two ways they can
 * go quietly stale.
 *
 * Both failures below render something. That is what makes them worth a test:
 * a forced-hover cell that shows the DEFAULT state looks like a button, and a
 * focus ring drawn from a stale declaration looks like a focus ring. Neither
 * announces that the state it claims to be showing is not the state the app
 * actually produces — you would be auditing the audit page.
 *
 *   1. Tailwind emits `.hover\:brightness-110`, not `.brightness-110`. Forcing
 *      hover works by re-applying the utility unprefixed, so every unprefixed
 *      form must exist in the build — which, for Tailwind, means appearing as
 *      a literal string somewhere under src/. HOVER_SAFELIST is that string.
 *      A hover class added to Button with no safelist entry produces a cell
 *      that silently renders the default state.
 *
 *   2. The focus ring is a global `*:focus-visible` rule; a pseudo-class
 *      cannot be applied programmatically, so uiAudit.css repeats that one
 *      declaration. Repeating it is acceptable only while the two stay
 *      identical.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { hoverClassesFrom, HOVER_SAFELIST } from './forcedStates.js'

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '../../../..')
const read = (rel) => readFileSync(resolve(root, rel), 'utf8')

let passed = 0
function test(name, fn) {
  fn()
  passed += 1
  console.log(`  ✓ ${name}`)
}

console.log('\nhoverClassesFrom')

test('strips the prefix off hover utilities and leaves the rest alone', () => {
  assert.deepEqual(
    hoverClassesFrom('inline-flex hover:-translate-y-px font-black hover:shadow-elev-md'),
    ['-translate-y-px', 'shadow-elev-md'],
  )
})

test('keeps an arbitrary-value utility intact', () => {
  assert.deepEqual(
    hoverClassesFrom('border hover:border-[var(--accent)]'),
    ['border-[var(--accent)]'],
  )
})

test('ignores other variants — only hover is being forced', () => {
  assert.deepEqual(
    hoverClassesFrom('focus:ring active:scale-95 disabled:opacity-60 sm:hover:underline'),
    [],
  )
})

test('a bare "hover:" is not a class', () => {
  assert.deepEqual(hoverClassesFrom('hover:'), [])
})

test('survives an empty or non-string class attribute', () => {
  assert.deepEqual(hoverClassesFrom(''), [])
  assert.deepEqual(hoverClassesFrom(null), [])
  assert.deepEqual(hoverClassesFrom(undefined), [])
})

console.log('\nHOVER_SAFELIST covers every audited primitive')

// The primitives the audit page pins a hover state on. Adding one here is how
// a new forced-hover specimen gets covered.
const AUDITED = [
  'src/components/ui/Button.jsx',
  'src/components/ui/Card.jsx',
]

const safelisted = new Set(HOVER_SAFELIST.split(/\s+/).filter(Boolean))

/**
 * Hover utilities that the component actually RENDERS.
 *
 * Comments are stripped first, and that is not tidiness: Button.jsx's own
 * header documents the inline `bg-green-600 hover:bg-green-700 …` soup it
 * replaced. Counting prose as a rendered class demands a safelist entry for a
 * class the app has not used since the primitive was written — the guard
 * would fail on day one for a reason that has nothing to do with the audit.
 */
function renderedHoverClasses(src) {
  const code = src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1 ')
  const used = new Set()
  for (const m of code.matchAll(/hover:([^\s'"`]+)/g)) used.add(m[1])
  return used
}

for (const file of AUDITED) {
  test(`${file}'s hover utilities are all in the safelist`, () => {
    // Class strings in these primitives are plain string literals, so the
    // hover utilities can be read straight out of the source.
    const used = renderedHoverClasses(read(file))
    assert.ok(used.size > 0, `no hover: utilities found in ${file} — did its class strings change shape?`)
    const missing = [...used].filter((c) => !safelisted.has(c))
    assert.deepEqual(
      missing,
      [],
      `${file} uses hover:${missing.join(', hover:')} but HOVER_SAFELIST has no unprefixed form. ` +
        'Tailwind will not emit the bare utility, so the forced-hover column would render the DEFAULT state ' +
        'while claiming to show hover. Add the unprefixed class to HOVER_SAFELIST in forcedStates.jsx.',
    )
  })
}

test('the safelist has no dead entries', () => {
  const used = new Set()
  for (const file of AUDITED) {
    for (const c of renderedHoverClasses(read(file))) used.add(c)
  }
  const dead = [...safelisted].filter((c) => !used.has(c))
  assert.deepEqual(
    dead,
    [],
    `HOVER_SAFELIST carries ${dead.join(', ')}, which no audited primitive uses any more. ` +
      'Dead entries make the list look maintained while hiding whether it is.',
  )
})

console.log('\nthe pinned focus ring still matches the global one')

test('uiAudit.css repeats index.css\'s focus-visible box-shadow exactly', () => {
  const appCss = read('src/index.css')
  const auditCss = read('src/components/dev/uiAudit/uiAudit.css')

  const globalRule = appCss.match(/\*:focus-visible\s*\{([^}]*)\}/)
  assert.ok(globalRule, 'no `*:focus-visible` rule in src/index.css — the audit page mirrors it, so it must exist')
  const auditRule = auditCss.match(/\.ui-audit-force-focus\s*>\s*\*\s*\{([^}]*)\}/)
  assert.ok(auditRule, 'no `.ui-audit-force-focus > *` rule in uiAudit.css')

  const shadowOf = (block) => {
    const m = block.match(/box-shadow:\s*([^;]+);/)
    return m ? m[1].replace(/\s+/g, ' ').trim() : null
  }

  const expected = shadowOf(globalRule[1])
  const actual = shadowOf(auditRule[1])
  assert.ok(expected, 'the global focus-visible rule declares no box-shadow')
  assert.equal(
    actual,
    expected,
    'The audit page\'s pinned focus ring has drifted from the real one. It exists to show what a ' +
      'keyboard user sees; a ring drawn from a stale declaration is a ring nobody has. ' +
      `index.css: "${expected}" / uiAudit.css: "${actual}".`,
  )
})

test('uiAudit.css repeats .tdv2-nav-item:hover exactly', () => {
  const dashCss = read('src/shared/styles/dashboardV2.css')
  const auditCss = read('src/components/dev/uiAudit/uiAudit.css')

  const real = dashCss.match(/\.tdv2-nav-item:hover\s*\{([^}]*)\}/)
  assert.ok(real, 'no `.tdv2-nav-item:hover` rule in dashboardV2.css — the audit page mirrors it')
  const pinned = auditCss.match(/\.ui-audit-nav-hover\s*\{([^}]*)\}/)
  assert.ok(pinned, 'no `.ui-audit-nav-hover` rule in uiAudit.css')

  const decls = (block) =>
    block
      .split(';')
      .map((d) => d.replace(/\s+/g, ' ').trim())
      .filter(Boolean)
      .sort()

  assert.deepEqual(
    decls(pinned[1]),
    decls(real[1]),
    'The audit page\'s pinned sidebar hover has drifted from the real one. The whole reason the ' +
      'row is on the page is to show the hover a teacher gets in each theme; a stale copy shows ' +
      'a hover nobody has.',
  )
})

test('the pinned ring resolves its colours from tokens, not literals', () => {
  const auditCss = read('src/components/dev/uiAudit/uiAudit.css')
  const rule = auditCss.match(/\.ui-audit-force-focus\s*>\s*\*\s*\{([^}]*)\}/)[1]
  assert.ok(
    !/#[0-9a-fA-F]{3,8}\b|rgba?\(/.test(rule),
    'The pinned focus ring contains a colour literal. Its whole job is to show whether the ' +
      'ACCENT ring survives each theme — a literal would show the same ring in all four.',
  )
})

console.log(`\n${passed} assertions passed.\n`)
