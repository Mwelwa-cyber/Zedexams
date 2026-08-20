import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import CookieConsentBanner from './CookieConsentBanner'
import { getConsent, setConsent, clearConsent } from '../../utils/analyticsConsent'

function renderBanner() {
  return render(
    <MemoryRouter>
      <CookieConsentBanner />
    </MemoryRouter>,
  )
}

describe('CookieConsentBanner', () => {
  beforeEach(() => {
    clearConsent()
  })

  it('shows on first visit and links to the public /preferences page, not /profile', () => {
    renderBanner()
    expect(screen.getByRole('dialog', { name: /cookie consent/i })).toBeInTheDocument()

    const prefs = screen.getByRole('link', { name: /privacy preferences/i })
    expect(prefs).toHaveAttribute('href', '/preferences')

    // Regression guard: the old link sent signed-out visitors to /profile,
    // which is auth-gated, so the banner bounced them to a login wall.
    const links = screen.getAllByRole('link')
    expect(links.every(a => a.getAttribute('href') !== '/profile')).toBe(true)
  })

  it('also exposes a Privacy Policy link so users can read before deciding', () => {
    renderBanner()
    expect(screen.getByRole('link', { name: /privacy policy/i })).toHaveAttribute('href', '/privacy')
  })

  it('records the decision and self-hides once the user accepts', () => {
    renderBanner()
    fireEvent.click(screen.getByRole('button', { name: /accept/i }))
    expect(getConsent()).toBe('accepted')
    expect(screen.queryByRole('dialog', { name: /cookie consent/i })).toBeNull()
  })

  it('stays hidden when a decision already exists (decline-by-default honoured)', () => {
    setConsent('declined')
    renderBanner()
    expect(screen.queryByRole('dialog', { name: /cookie consent/i })).toBeNull()
  })

  /**
   * This banner is the FIRST thing a first-visit learner sees, and it
   * used to be pinned over the tab bar with 32px controls
   * (LEARNER_UI_AUDIT L-19) — a dialog covering the navigation, with
   * targets under the 44px minimum, in front of a child.
   */
  describe('as a child’s first screen', () => {
    it('gives both controls a 44px target', () => {
      renderBanner()
      for (const name of [/accept/i, /no thanks/i]) {
        expect(screen.getByRole('button', { name })).toHaveClass('min-h-[44px]')
      }
    })

    /**
     * jsdom folds the `calc()` (76 + 12 → 88) and mangles `env()`, so
     * neither the computed style nor the raw attribute can be compared to
     * a literal. What is asserted is the claim itself: the banner reserves
     * exactly the height of the bar it found, and nothing when there is
     * none.
     */
    const reservedPx = () => {
      const style = screen.getByRole('dialog', { name: /cookie consent/i }).getAttribute('style')
      const px = /calc\((\d+)px/.exec(style || '')
      expect(px, `no calc() padding in "${style}"`).not.toBeNull()
      return Number(px[1])
    }

    function withBar(height, run) {
      const bar = document.createElement('nav')
      bar.className = 'lhx-nav'
      // Every rect is 0 in jsdom, so the height is stubbed. What is under
      // test is that the banner MEASURES the bar, not arithmetic jsdom
      // cannot produce.
      bar.getBoundingClientRect = () => ({ height })
      document.body.appendChild(bar)
      try { return run() } finally { bar.remove() }
    }

    it('lifts clear of a learner tab bar by exactly the bar’s height', () => {
      renderBanner()
      const withoutBar = reservedPx()
      cleanup()

      const withTabBar = withBar(76, () => { renderBanner(); return reservedPx() })
      expect(withTabBar - withoutBar).toBe(76)
    })

    it('reserves nothing extra on a page with no bottom bar', () => {
      // The trap this guards: `--lhx-nav-h` is declared unconditionally on
      // :root, so reading the token instead of measuring would float the
      // banner 76px above nothing on every marketing page.
      renderBanner()
      const withoutBar = reservedPx()
      cleanup()

      // A different bar height must move it by that amount too, or the
      // component is returning a constant that happens to look right.
      const withShortBar = withBar(56, () => { renderBanner(); return reservedPx() })
      expect(withShortBar - withoutBar).toBe(56)
    })
  })
})
