/**
 * LearnerSettingsRoute.spec — what /settings/* serves a learner.
 *
 * Two guarantees, and the second is why the file exists.
 *
 *  1. **Each screen has its own URL.** "Name & avatar" and "Delete account"
 *     were the same URL for as long as settings was one page with a
 *     `?section=` parameter, which is how a child looking to change their
 *     nickname reached a screen carrying invoices and an irreversible delete
 *     button. A test that the two paths differ is the cheapest possible guard
 *     against them being merged again by a future tidy-up.
 *
 *  2. **No old link breaks.** `?section=` is in sent emails, in push deep
 *     links and in the parent app's own instructions to guardians, none of
 *     which can be edited now. Every value the app ever wrote still resolves,
 *     and it resolves with `replace` so Back skips the redirect rather than
 *     bouncing off it.
 *
 * The original negative still holds too: a learner must never land in the old
 * settings dashboard chrome (a rail of ten sections, a search box, a card grid
 * for Progress / Premium / Accessibility / AI). Panels render `bare`.
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'

vi.mock('../LearnerSettings', () => ({
  default: ({ bare, forceSection }) => (
    <div>SETTINGS DASHBOARD bare={String(!!bare)} section={String(forceSection)}</div>
  ),
}))
vi.mock('./LearnerSettingsPage', () => ({
  default: () => <div>V6 SETTINGS SCREEN</div>,
}))
vi.mock('./NameAvatarPage', () => ({ default: () => <div>NAME AND AVATAR</div> }))
vi.mock('./DeleteAccountPage', () => ({ default: () => <div>DELETE ACCOUNT</div> }))
vi.mock('./YourDataPage', () => ({ default: () => <div>YOUR DATA</div> }))

import LearnerSettingsRoute from './LearnerSettingsRoute'
import { SETTINGS_ROUTES } from '../lib/settingsRoutes'

function Where() {
  const { pathname, search } = useLocation()
  return <div data-testid="where">{pathname}{search}</div>
}

function renderAt(path) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Where />
      <Routes>
        <Route path="/settings/*" element={<LearnerSettingsRoute />} />
      </Routes>
    </MemoryRouter>,
  )
}

const at = () => screen.getByTestId('where').textContent

describe('LearnerSettingsRoute', () => {
  it('serves the prototype-v6 Settings screen at /settings', () => {
    renderAt('/settings')
    expect(screen.getByText('V6 SETTINGS SCREEN')).toBeInTheDocument()
  })

  it('gives Name & avatar and Delete account DIFFERENT urls', async () => {
    const a = renderAt('/settings/profile')
    expect(await screen.findByText('NAME AND AVATAR')).toBeInTheDocument()
    expect(screen.queryByText('DELETE ACCOUNT')).toBeNull()
    a.unmount()

    renderAt('/settings/delete')
    expect(await screen.findByText('DELETE ACCOUNT')).toBeInTheDocument()
    expect(screen.queryByText('NAME AND AVATAR')).toBeNull()
  })

  it('gives Your data its own url, away from the delete button', async () => {
    renderAt('/settings/data')
    expect(await screen.findByText('YOUR DATA')).toBeInTheDocument()
    expect(screen.queryByText('DELETE ACCOUNT')).toBeNull()
  })

  it('renders the four panel routes BARE — never the dashboard chrome', async () => {
    for (const [path, section] of [
      ['security', 'security'],
      ['notifications', 'notifications'],
      ['learning', 'learning'],
      ['guardian', 'parent'],
      ['help', 'help'],
    ]) {
      const { unmount } = renderAt(`/settings/${path}`)
      expect(
        await screen.findByText(`SETTINGS DASHBOARD bare=true section=${section}`),
      ).toBeInTheDocument()
      unmount()
    }
  })

  it('every declared route resolves to something', async () => {
    for (const route of SETTINGS_ROUTES) {
      const { unmount } = renderAt(`/settings/${route.path}`)
      // Not the index: a declared path that fell through to the catch-all
      // would redirect to /settings and look like a working menu item.
      expect(screen.queryByText('V6 SETTINGS SCREEN')).toBeNull()
      unmount()
    }
  })

  /* ── The old parameter ─────────────────────────────────────────────── */

  it('redirects the sections that have their own screen', async () => {
    for (const [section, path] of [
      ['account', '/settings/profile'],
      ['parent', '/settings/guardian'],
      ['help', '/settings/help'],
      ['security', '/settings/security'],
      ['notifications', '/settings/notifications'],
      ['learning', '/settings/learning'],
    ]) {
      const { unmount } = renderAt(`/settings?section=${section}`)
      expect(at()).toBe(path)
      unmount()
    }
  })

  it('a section with no screen stays on the index rather than going somewhere odd', () => {
    for (const section of ['premium', 'progress', 'accessibility', 'ai', 'appearance']) {
      const { unmount } = renderAt(`/settings?section=${section}`)
      expect(screen.getByText('V6 SETTINGS SCREEN')).toBeInTheDocument()
      expect(screen.queryByText(/SETTINGS DASHBOARD/)).toBeNull()
      unmount()
    }
  })

  it('an unknown or empty section is not a way in either', () => {
    for (const path of ['/settings?section=', '/settings?section=nope', '/settings?section=account-x']) {
      const { unmount } = renderAt(path)
      expect(screen.getByText('V6 SETTINGS SCREEN')).toBeInTheDocument()
      unmount()
    }
  })

  it('an unknown settings PATH lands on the index, not on a 404', () => {
    renderAt('/settings/nonsense')
    expect(at()).toBe('/settings')
    expect(screen.getByText('V6 SETTINGS SCREEN')).toBeInTheDocument()
  })
})
