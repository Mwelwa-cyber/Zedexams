/**
 * Behaviour tests for the prototype-v7 learner Settings screen.
 *
 * What matters here is that every switch is wired to the thing it
 * claims: the group layout, the Night toggle sharing the app theme, each
 * preference writing the field the rest of the app reads, the guardian
 * override rendering as locked, and the two rows the mockup has that
 * this product deliberately does not.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'

vi.mock('../../../firebase/config', () => ({ default: {}, auth: {}, db: {} }))
vi.mock('../../../hooks/useNetworkStatus', () => ({ useNetworkStatus: () => true }))

const updateProfileFields = vi.fn(() => Promise.resolve())
let mockProfile
vi.mock('../../../contexts/AuthContext', () => ({
  useAuth: () => ({
    currentUser: { uid: 'learner-1' },
    userProfile: mockProfile,
    updateProfileFields,
  }),
}))

let mockTheme
const setTheme = vi.fn((t) => { mockTheme = t })
vi.mock('../../../contexts/ThemeContext', () => ({
  useTheme: () => ({ theme: mockTheme, setTheme }),
  DEFAULT_THEME: 'oatmeal',
}))

import LearnerSettingsPage from './LearnerSettingsPage'

function renderSettings() {
  return render(
    <MemoryRouter initialEntries={['/settings']}>
      <Routes>
        <Route path="/settings" element={<LearnerSettingsPage />} />
        <Route path="/profile" element={<div>PROFILE ROUTE</div>} />
        <Route path="/guardian" element={<div>GUARDIAN ROUTE</div>} />
        <Route path="/offline" element={<div>OFFLINE ROUTE</div>} />
      </Routes>
    </MemoryRouter>,
  )
}

const row = (title) => screen.getByRole('switch', { name: title })

beforeEach(() => {
  updateProfileFields.mockClear()
  setTheme.mockClear()
  mockTheme = 'oatmeal'
  mockProfile = {
    id: 'learner-1',
    role: 'learner',
    displayName: 'Milton Phiri',
    grade: '7',
    guardian: { consentStatus: 'granted' },
    isMinor: true,
  }
})

describe('LearnerSettingsPage', () => {
  it('renders the mockup groups in order', () => {
    renderSettings()
    const heads = screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent)
    expect(heads).toEqual(['Appearance', 'Notifications', 'Learning', 'Account', 'Privacy & safety'])
  })

  it('Night mode drives the app theme, so it cannot disagree with the topbar toggle', () => {
    renderSettings()
    const night = row('Night mode')
    expect(night.getAttribute('aria-checked')).toBe('false')
    fireEvent.click(night)
    expect(setTheme).toHaveBeenCalledWith('midnight')
  })

  it('Night mode reads as on when the app is already in midnight', () => {
    mockTheme = 'midnight'
    renderSettings()
    expect(row('Night mode').getAttribute('aria-checked')).toBe('true')
  })

  it('each switch writes the field the rest of the app reads', () => {
    renderSettings()

    fireEvent.click(row('Sound & effects'))
    expect(updateProfileFields).toHaveBeenLastCalledWith(
      expect.objectContaining({ learningPrefs: expect.objectContaining({ soundEffects: false }) }),
    )

    fireEvent.click(row('Push notifications'))
    expect(updateProfileFields).toHaveBeenLastCalledWith(
      expect.objectContaining({ notificationPrefs: expect.objectContaining({ channels: expect.objectContaining({ push: false }) }) }),
    )

    fireEvent.click(row('Study reminders'))
    expect(updateProfileFields).toHaveBeenLastCalledWith(
      expect.objectContaining({ notificationPrefs: expect.objectContaining({ categories: expect.objectContaining({ learning: false }) }) }),
    )

    fireEvent.click(row('Quiet hours'))
    expect(updateProfileFields).toHaveBeenLastCalledWith(
      expect.objectContaining({ notificationPrefs: expect.objectContaining({ quietHours: expect.objectContaining({ enabled: true }) }) }),
    )
  })

  it('a toggled switch moves immediately, before the profile snapshot lands', () => {
    // The profile prop never changes in this test — the switch has to be
    // optimistic or it would spring back under the learner's thumb.
    renderSettings()
    const sound = row('Sound & effects')
    expect(sound.getAttribute('aria-checked')).toBe('true')
    fireEvent.click(sound)
    expect(row('Sound & effects').getAttribute('aria-checked')).toBe('false')
  })

  it('a guardian who turned Ask Zed off locks the row, and says who did it', () => {
    mockProfile = { ...mockProfile, guardianControls: { askZed: false } }
    renderSettings()
    const ask = row('Ask Zed')
    expect(ask.getAttribute('aria-checked')).toBe('false')
    expect(ask).toBeDisabled()
    expect(screen.getByText('Turned off by your guardian')).toBeInTheDocument()
  })

  it('an account with no guardian decision leaves Ask Zed to the learner', () => {
    renderSettings()
    const ask = row('Ask Zed')
    expect(ask).not.toBeDisabled()
    expect(ask.getAttribute('aria-checked')).toBe('true')
    fireEvent.click(ask)
    expect(updateProfileFields).toHaveBeenLastCalledWith(
      expect.objectContaining({ learningPrefs: expect.objectContaining({ askZed: false }) }),
    )
  })

  it('offers the Guardian Zone only when a guardian actually approved', () => {
    renderSettings()
    fireEvent.click(screen.getByRole('button', { name: /Guardian Zone/ }))
    expect(screen.getByText('GUARDIAN ROUTE')).toBeInTheDocument()
  })

  it('hides the Guardian Zone row on an account with no approved guardian', () => {
    mockProfile = { ...mockProfile, guardian: null }
    renderSettings()
    expect(screen.queryByRole('button', { name: /Guardian Zone/ })).toBeNull()
  })

  it('Childline dials a phone number rather than opening a page', () => {
    renderSettings()
    const help = screen.getByRole('link', { name: /Get help/ })
    expect(help.getAttribute('href')).toBe('tel:116')
    expect(within(help).getByText(/Childline Zambia · 116/)).toBeInTheDocument()
  })

  it('carries no switch for a feature that does not exist', () => {
    // The mockup has "Challenge invites — when a friend challenges you".
    // There is no learner-to-learner challenge in ZedExams: the duel
    // opponent is Zed. A switch gating nothing would tell a parent their
    // child can be contacted by other children.
    renderSettings()
    expect(screen.queryByRole('switch', { name: /challenge/i })).toBeNull()
    expect(screen.queryByText(/friend challenges you/i)).toBeNull()
  })

  it('the back arrow returns to My Profile', () => {
    renderSettings()
    fireEvent.click(screen.getByRole('button', { name: 'Back to My Profile' }))
    expect(screen.getByText('PROFILE ROUTE')).toBeInTheDocument()
  })
})
