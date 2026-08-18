/**
 * LearnerSettingsPage.spec — the prototype-v6 Settings screen.
 * Pins the mockup's five groups and, more importantly, that every
 * switch writes real state: a control that changed nothing would be a
 * lie told in the shape of a setting.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'

vi.mock('../../../firebase/config', () => ({ default: {}, auth: {}, db: {} }))
vi.mock('../../../hooks/useNetworkStatus', () => ({ useNetworkStatus: () => true }))

const updateProfileFields = vi.fn().mockResolvedValue()
let mockProfile
vi.mock('../../../contexts/AuthContext', () => ({
  useAuth: () => ({ currentUser: { uid: 'u1' }, userProfile: mockProfile, updateProfileFields }),
}))

const setTheme = vi.fn()
let mockTheme
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
        <Route path="/offline" element={<div>OFFLINE ROUTE</div>} />
      </Routes>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  updateProfileFields.mockClear()
  setTheme.mockClear()
  mockTheme = 'oatmeal'
  mockProfile = {
    role: 'learner',
    displayName: 'Milton Phiri',
    grade: '7',
    guardian: { consentStatus: 'granted' },
  }
})

describe('LearnerSettingsPage (prototype-v6)', () => {
  it('renders the mockup’s five groups and the version footer', () => {
    renderSettings()
    for (const head of ['Appearance', 'Notifications', 'Learning', 'Account', 'Privacy & safety']) {
      expect(screen.getByText(head)).toBeInTheDocument()
    }
    expect(screen.getByText(/Made for Zambian learners/)).toBeInTheDocument()
  })

  it('draws no control the product cannot honour', () => {
    renderSettings()
    // There is no learner-to-learner challenge in this product (the duel
    // races Zed), so the mockup's "Challenge invites" switch would be a
    // dead control.
    expect(screen.queryByText(/challenge invites/i)).toBeNull()
  })

  it('Night mode drives the real theme both ways', () => {
    renderSettings()
    fireEvent.click(screen.getByLabelText('Night mode'))
    expect(setTheme).toHaveBeenCalledWith('midnight')

    setTheme.mockClear()
    mockTheme = 'midnight'
    renderSettings()
    fireEvent.click(screen.getAllByLabelText('Night mode')[1])
    expect(setTheme).toHaveBeenCalledWith('oatmeal')
  })

  it('notification switches write the real notificationPrefs shape', () => {
    renderSettings()
    fireEvent.click(screen.getByLabelText('Push notifications'))
    expect(updateProfileFields).toHaveBeenCalledWith(
      expect.objectContaining({
        notificationPrefs: expect.objectContaining({
          // objectContaining on the channels too: `email` joined the
          // shape when the guardian's Sunday report grew a real switch,
          // and this assertion is about the PUSH toggle writing what it
          // says it writes — not about the full channel list, which is
          // pinned by the notification-prefs tests.
          channels: expect.objectContaining({ push: false, inApp: true }),
        }),
      }),
    )

    updateProfileFields.mockClear()
    fireEvent.click(screen.getByLabelText('Exam reminders'))
    const patch = updateProfileFields.mock.calls[0][0].notificationPrefs
    expect(patch.categories.assessments).toBe(false)
    // Untouched categories survive the write.
    expect(patch.categories.learning).toBe(true)
  })

  it('Ask Zed writes the flag the launcher reads', () => {
    renderSettings()
    fireEvent.click(screen.getByLabelText('Ask Zed'))
    expect(updateProfileFields).toHaveBeenCalledWith(
      expect.objectContaining({
        learnerSettings: expect.objectContaining({ zedAi: expect.objectContaining({ enabled: false }) }),
      }),
    )
  })

  it('the daily goal cycles through the real options', () => {
    renderSettings()
    const row = screen.getByText('Daily goal').closest('button')
    expect(within(row).getByText('20 min')).toBeInTheDocument() // default
    fireEvent.click(row)
    expect(updateProfileFields).toHaveBeenCalledWith(
      expect.objectContaining({ learningPrefs: expect.objectContaining({ dailyGoal: 30 }) }),
    )
  })

  it('shows guardian state honestly and links the account rows to the real flows', () => {
    renderSettings()
    expect(screen.getByText('Verified · manages approvals')).toBeInTheDocument()

    mockProfile = { ...mockProfile, guardian: null }
    renderSettings()
    // No guardian record: the row says what it IS for rather than
    // reporting a state, because the thing a learner needs from it in
    // that case is the family code, not a verdict.
    expect(
      screen.getAllByText('Family code and who can see your progress').length,
    ).toBeGreaterThan(0)
  })

  it('Downloads & storage opens the offline library; back goes to Profile', () => {
    renderSettings()
    fireEvent.click(screen.getByText('Downloads & storage').closest('button'))
    expect(screen.getByText('OFFLINE ROUTE')).toBeInTheDocument()

    renderSettings()
    fireEvent.click(screen.getByLabelText('Back to My Profile'))
    expect(screen.getByText('PROFILE ROUTE')).toBeInTheDocument()
  })
})
