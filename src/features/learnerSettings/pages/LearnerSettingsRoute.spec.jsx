/**
 * LearnerSettingsRoute.spec — what /settings serves a learner.
 *
 * The point of these is the negative: a learner must never land in the
 * old settings dashboard (a rail of ten sections, a settings search, a
 * card grid for Progress / Premium / Accessibility / AI / Security).
 * None of that is in the learner mockup.
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'

vi.mock('../LearnerSettings', () => ({
  default: ({ bare }) => <div>SETTINGS DASHBOARD bare={String(!!bare)}</div>,
}))
vi.mock('./LearnerSettingsPage', () => ({
  default: () => <div>V6 SETTINGS SCREEN</div>,
}))

import LearnerSettingsRoute from './LearnerSettingsRoute'
import { LEARNER_REACHABLE_SECTIONS } from '../sections'

function renderAt(path) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/settings" element={<LearnerSettingsRoute />} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('LearnerSettingsRoute', () => {
  it('serves the prototype-v6 Settings screen by default', () => {
    renderAt('/settings')
    expect(screen.getByText('V6 SETTINGS SCREEN')).toBeInTheDocument()
  })

  it('opens the account and help panels BARE — never the dashboard chrome', async () => {
    for (const section of ['account', 'help']) {
      const { unmount } = renderAt(`/settings?section=${section}`)
      expect(await screen.findByText('SETTINGS DASHBOARD bare=true')).toBeInTheDocument()
      unmount()
    }
  })

  it('falls back to the mockup screen for every other section', async () => {
    // These are real sections of the old dashboard; a learner has no
    // route to them any more.
    for (const section of ['premium', 'security', 'accessibility', 'ai', 'progress', 'appearance', 'learning', 'notifications']) {
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

  it('the reachable list is exactly the three the mockup links to', () => {
    // `parent` joined the list when family codes became child-confirmed:
    // the Guardian row is where a learner mints a code AND where they
    // answer "is this your grown-up?", so it has to be reachable. The
    // list stays short on purpose — the old ten-section settings
    // dashboard is not part of the learner mockup.
    expect(LEARNER_REACHABLE_SECTIONS).toEqual(['account', 'help', 'parent'])
  })
})
