/**
 * Node tests for the shared-shell nav guard core: the module-scope registry
 * and the in-app-link click predicate.
 */

import assert from 'node:assert/strict'
import {
  setActiveShellNavGuard,
  confirmShellNavigation,
  __resetShellNavGuard,
  isPlainInAppLinkClick,
} from './shellNavGuardCore.js'

const ORIGIN = 'https://zedexams.com'
const anchor = (over = {}) => ({
  target: '',
  href: `${ORIGIN}/teacher/dashboard`,
  getAttribute: (n) => (n === 'href' ? (over.rawHref ?? '/teacher/dashboard') : null),
  ...over,
})
const leftClick = (over = {}) => ({ defaultPrevented: false, button: 0, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, ...over })

function run(name, fn) {
  __resetShellNavGuard()
  fn()
  console.log(`  ✓ ${name}`)
}

console.log('shellNavGuardCore')

// ── registry ────────────────────────────────────────────────────────────────
run('confirmShellNavigation returns true when no guard is registered', () => {
  assert.equal(confirmShellNavigation(), true)
})

run('a registered guard decides navigation', () => {
  setActiveShellNavGuard(() => false)
  assert.equal(confirmShellNavigation(), false)
  setActiveShellNavGuard(() => true)
  assert.equal(confirmShellNavigation(), true)
})

run('the guard is consulted live (reflects changing dirty state)', () => {
  let dirty = true
  setActiveShellNavGuard(() => !dirty)
  assert.equal(confirmShellNavigation(), false)
  dirty = false
  assert.equal(confirmShellNavigation(), true)
})

run('the disposer clears only the guard it registered', () => {
  const disposeA = setActiveShellNavGuard(() => false)
  const disposeB = setActiveShellNavGuard(() => true) // B wins
  disposeA() // stale disposer must NOT clear B
  assert.equal(confirmShellNavigation(), true)
  disposeB()
  assert.equal(confirmShellNavigation(), true) // back to no-guard default
})

run('registering null/non-function clears the guard', () => {
  setActiveShellNavGuard(() => false)
  setActiveShellNavGuard(null)
  assert.equal(confirmShellNavigation(), true)
})

// ── predicate ─────────────────────────────────────────────────────────────
run('a plain left-click on an in-app link is guarded', () => {
  assert.equal(isPlainInAppLinkClick(leftClick(), anchor(), ORIGIN), true)
})

run('modified clicks (new tab / context menu) are NOT guarded', () => {
  for (const mod of ['metaKey', 'ctrlKey', 'shiftKey', 'altKey']) {
    assert.equal(isPlainInAppLinkClick(leftClick({ [mod]: true }), anchor(), ORIGIN), false, mod)
  }
  assert.equal(isPlainInAppLinkClick(leftClick({ button: 1 }), anchor(), ORIGIN), false, 'middle-click')
})

run('an already-prevented event is NOT guarded', () => {
  assert.equal(isPlainInAppLinkClick(leftClick({ defaultPrevented: true }), anchor(), ORIGIN), false)
})

run('target=_blank / named target is NOT guarded', () => {
  assert.equal(isPlainInAppLinkClick(leftClick(), anchor({ target: '_blank' }), ORIGIN), false)
})

run('fragment, mailto, tel and javascript hrefs are NOT guarded', () => {
  assert.equal(isPlainInAppLinkClick(leftClick(), anchor({ rawHref: '#top' }), ORIGIN), false)
  assert.equal(isPlainInAppLinkClick(leftClick(), anchor({ rawHref: 'mailto:x@y.z', href: 'mailto:x@y.z' }), ORIGIN), false)
  assert.equal(isPlainInAppLinkClick(leftClick(), anchor({ rawHref: 'tel:123', href: 'tel:123' }), ORIGIN), false)
})

run('a cross-origin link is NOT guarded (real document navigation)', () => {
  assert.equal(
    isPlainInAppLinkClick(leftClick(), anchor({ rawHref: 'https://google.com', href: 'https://google.com/' }), ORIGIN),
    false,
  )
})

run('missing event or anchor is safe (false)', () => {
  assert.equal(isPlainInAppLinkClick(null, anchor(), ORIGIN), false)
  assert.equal(isPlainInAppLinkClick(leftClick(), null, ORIGIN), false)
})

__resetShellNavGuard()
console.log('All shellNavGuardCore tests passed.')
