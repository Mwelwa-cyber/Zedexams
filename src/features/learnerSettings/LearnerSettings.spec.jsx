import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { searchSections, getSection, SECTION_IDS } from './sections'

// ── pure config/search ──────────────────────────────────────────────────────
describe('searchSections', () => {
  it('returns every section for an empty query', () => {
    expect(searchSections('').length).toBe(SECTION_IDS.length)
  })
  it('matches by label', () => {
    const r = searchSections('privacy')
    expect(r.some((s) => s.id === 'privacy')).toBe(true)
  })
  it('matches by keyword not in the label', () => {
    // "dark mode" is a keyword of Personalisation, not in its label.
    const r = searchSections('dark mode')
    expect(r.some((s) => s.id === 'personalisation')).toBe(true)
  })
  it('is case-insensitive and returns nothing for gibberish', () => {
    expect(searchSections('ZZnope').length).toBe(0)
    expect(searchSections('BADGES').some((s) => s.id === 'notifications')).toBe(true)
  })
  it('getSection resolves a known id and null otherwise', () => {
    expect(getSection('profile')?.label).toBe('Profile')
    expect(getSection('nope')).toBeNull()
  })
})

// ── shell smoke ─────────────────────────────────────────────────────────────
const updateProfileFields = vi.fn().mockResolvedValue(undefined)

vi.mock('../../contexts/AuthContext', () => ({
  useAuth: () => ({
    userProfile: { id: 'u1', displayName: 'Test Learner', grade: 5, learnerSettings: {} },
    currentUser: { uid: 'u1', email: 't@example.com', emailVerified: true, metadata: {} },
    updateProfileFields,
  }),
}))
vi.mock('../../hooks/useSubscription', () => ({
  useSubscription: () => ({ tierLabel: 'Free', isPremium: false }),
}))
vi.mock('../../components/seo/SeoHelmet', () => ({ default: () => null }))
vi.mock('../../components/profile/CharacterAvatar', () => ({ default: () => <div /> }))
vi.mock('../../components/ui/PageLoader', () => ({ default: () => <div>loading</div> }))

// Stub every lazy panel so the shell spec only exercises the shell. Each mock
// must be a static top-level call (vi.mock is hoisted — no loops) with a
// self-contained factory (no outer-scope references).
vi.mock('./panels/ProfilePanel', () => ({ default: ({ section }) => <div data-testid={`panel-${section.id}`}>{section.label}</div> }))
vi.mock('./panels/SecurityPanel', () => ({ default: ({ section }) => <div data-testid={`panel-${section.id}`}>{section.label}</div> }))
vi.mock('./panels/NotificationsPanel', () => ({ default: ({ section }) => <div data-testid={`panel-${section.id}`}>{section.label}</div> }))
vi.mock('./panels/LearningPanel', () => ({ default: ({ section }) => <div data-testid={`panel-${section.id}`}>{section.label}</div> }))
vi.mock('./panels/AccessibilityPanel', () => ({ default: ({ section }) => <div data-testid={`panel-${section.id}`}>{section.label}</div> }))
vi.mock('./panels/ParentPanel', () => ({ default: ({ section }) => <div data-testid={`panel-${section.id}`}>{section.label}</div> }))
vi.mock('./panels/AccountPanel', () => ({ default: ({ section }) => <div data-testid={`panel-${section.id}`}>{section.label}</div> }))
vi.mock('./panels/DashboardPanel', () => ({ default: ({ section }) => <div data-testid={`panel-${section.id}`}>{section.label}</div> }))
vi.mock('./panels/PersonalisationPanel', () => ({ default: ({ section }) => <div data-testid={`panel-${section.id}`}>{section.label}</div> }))
vi.mock('./panels/ZedAiPanel', () => ({ default: ({ section }) => <div data-testid={`panel-${section.id}`}>{section.label}</div> }))
vi.mock('./panels/PrivacyPanel', () => ({ default: ({ section }) => <div data-testid={`panel-${section.id}`}>{section.label}</div> }))

import LearnerSettings from './LearnerSettings'

function renderShell(url = '/settings') {
  return render(<MemoryRouter initialEntries={[url]}><LearnerSettings /></MemoryRouter>)
}

describe('LearnerSettings shell', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    try { window.localStorage.clear() } catch { /* noop */ }
  })

  it('renders the hero with the learner name and completion ring', async () => {
    renderShell()
    expect(screen.getByRole('heading', { name: 'Test Learner' })).toBeInTheDocument()
    // A profile with only name+grade set is partially complete (not 0, not 100).
    expect(screen.getByText(/%/)).toBeInTheDocument()
  })

  it('shows the profile panel first and switches section on nav click', async () => {
    renderShell()
    expect(await screen.findByTestId('panel-profile')).toBeInTheDocument()
    // The desktop sidebar + mobile tabs both list every section; click a nav item.
    const nav = document.querySelector('.lset-nav')
    fireEvent.click(within(nav).getByText('Notifications'))
    expect(await screen.findByTestId('panel-notifications')).toBeInTheDocument()
  })

  it('filters to a search-results list when typing a query', async () => {
    renderShell()
    fireEvent.change(screen.getByLabelText('Search settings'), { target: { value: 'privacy' } })
    // Section content is replaced by the results list; Privacy should appear.
    expect(screen.getByText('Data sharing and visibility')).toBeInTheDocument()
    // A non-matching panel is no longer mounted.
    expect(screen.queryByTestId('panel-profile')).not.toBeInTheDocument()
  })

  it('honours a ?section= deep link', async () => {
    renderShell('/settings?section=account')
    expect(await screen.findByTestId('panel-account')).toBeInTheDocument()
  })
})
