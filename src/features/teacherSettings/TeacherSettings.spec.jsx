import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import TeacherSettings from './TeacherSettings'

// Panels are lazy Firebase-heavy modules — stub every one so the router spec
// only exercises routing (redirects, unknown paths, panel selection).
vi.mock('./panels/ProfilePanel', () => ({ default: () => <div data-testid="panel-profile" /> }))
vi.mock('./panels/SecurityPanel', () => ({ default: () => <div data-testid="panel-security" /> }))
vi.mock('./panels/SchoolPanel', () => ({ default: () => <div data-testid="panel-school" /> }))
vi.mock('./panels/BrandingPanel', () => ({ default: () => <div data-testid="panel-branding" /> }))
vi.mock('./panels/ResourcesPanel', () => ({ default: () => <div data-testid="panel-resources" /> }))
vi.mock('./panels/TeachingPanel', () => ({ default: () => <div data-testid="panel-teaching" /> }))
vi.mock('./panels/TimetablePanel', () => ({ default: () => <div data-testid="panel-timetable" /> }))
vi.mock('./panels/CurriculumPanel', () => ({ default: () => <div data-testid="panel-curriculum" /> }))
vi.mock('./panels/CalendarPanel', () => ({ default: () => <div data-testid="panel-calendar" /> }))
vi.mock('./panels/AiPreferencesPanel', () => ({ default: () => <div data-testid="panel-ai" /> }))
vi.mock('./panels/AiMemoryPanel', () => ({ default: () => <div data-testid="panel-memory" /> }))
vi.mock('./panels/SmartDefaultsPanel', () => ({ default: () => <div data-testid="panel-defaults" /> }))
vi.mock('./panels/NotificationsPanel', () => ({ default: () => <div data-testid="panel-notifications" /> }))
vi.mock('./panels/AppearancePanel', () => ({ default: () => <div data-testid="panel-appearance" /> }))
vi.mock('./panels/SubscriptionPanel', () => ({ default: () => <div data-testid="panel-subscription" /> }))
vi.mock('./panels/AdvancedPanel', () => ({ default: () => <div data-testid="panel-advanced" /> }))
// The hub (index route) — stubbed so this spec doesn't need the hero's mocks;
// SettingsHome has its own spec.
vi.mock('./SettingsHome', () => ({ default: () => <div data-testid="settings-home" /> }))

function renderAt(url) {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <Routes>
        <Route path="/settings/*" element={<TeacherSettings />} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('TeacherSettings routing', () => {
  beforeEach(() => vi.clearAllMocks())

  it('renders the hub at /settings', async () => {
    renderAt('/settings')
    expect(await screen.findByTestId('settings-home')).toBeInTheDocument()
  })

  it('redirects the legacy ?tab=school deep link to the School panel', async () => {
    renderAt('/settings?tab=school')
    expect(await screen.findByTestId('panel-school')).toBeInTheDocument()
  })

  it('maps legacy ?tab=account to the Security panel (delete-account lives there)', async () => {
    renderAt('/settings?tab=account')
    expect(await screen.findByTestId('panel-security')).toBeInTheDocument()
  })

  it('renders a detail panel at its nested path', async () => {
    renderAt('/settings/profile')
    expect(await screen.findByTestId('panel-profile')).toBeInTheDocument()
  })

  it('sends unknown subpaths back to the hub', async () => {
    renderAt('/settings/not-a-panel')
    expect(await screen.findByTestId('settings-home')).toBeInTheDocument()
  })

  it('renders the hub for an unknown legacy tab', async () => {
    renderAt('/settings?tab=bogus')
    expect(await screen.findByTestId('settings-home')).toBeInTheDocument()
  })
})
