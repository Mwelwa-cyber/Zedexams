import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
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
})
