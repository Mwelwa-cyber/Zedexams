import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { searchSections, getSection, SECTION_IDS } from './sections'

// ── pure config/search ──────────────────────────────────────────────────────
describe('searchSections', () => {
  it('returns every section for an empty query', () => {
    expect(searchSections('').length).toBe(SECTION_IDS.length)
  })
  it('matches by label', () => {
    const r = searchSections('security')
    expect(r.some((s) => s.id === 'security')).toBe(true)
  })
  it('matches by keyword not in the label', () => {
    // "dark mode" is a keyword of Appearance, not in its label.
    const r = searchSections('dark mode')
    expect(r.some((s) => s.id === 'appearance')).toBe(true)
  })
  it('is case-insensitive and returns nothing for gibberish', () => {
    expect(searchSections('ZZnope').length).toBe(0)
    expect(searchSections('BADGES').some((s) => s.id === 'notifications')).toBe(true)
  })
  it('getSection resolves a known id and null otherwise', () => {
    expect(getSection('account')?.label).toBe('My Account')
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
vi.mock('../../shared/components/SeoHelmet', () => ({ default: () => null }))
vi.mock('../../shared/components/PageLoader', () => ({ default: () => <div>loading</div> }))

// Stub the overview cards so the shell spec only exercises the shell. Each stub
// exposes a button that calls onOpen(id) to drill into the detail panel.
vi.mock('./components/DashboardCards', () => {
  const mk = (id) => function CardStub({ onOpen }) {
    return <div data-testid={`card-${id}`}><button type="button" onClick={() => onOpen(id)}>open-{id}</button></div>
  }
  return {
    MyAccountCard: mk('account'),
    LearningCard: mk('learning'),
    ProgressCard: mk('progress'),
    NotificationsCard: mk('notifications'),
    AppearanceCard: mk('appearance'),
    AccessibilityCard: mk('accessibility'),
    PremiumCard: mk('premium'),
    SecurityPrivacyCard: mk('security'),
    HelpCard: mk('help'),
  }
})

// Stub every lazy detail panel (vi.mock is hoisted — static factories only).
vi.mock('./panels/MyAccountPanel', () => ({ default: ({ section }) => <div data-testid={`panel-${section.id}`}>{section.label}</div> }))
vi.mock('./panels/LearningPanel', () => ({ default: ({ section }) => <div data-testid={`panel-${section.id}`}>{section.label}</div> }))
vi.mock('./panels/ProgressPanel', () => ({ default: ({ section }) => <div data-testid={`panel-${section.id}`}>{section.label}</div> }))
vi.mock('./panels/NotificationsPanel', () => ({ default: ({ section }) => <div data-testid={`panel-${section.id}`}>{section.label}</div> }))
vi.mock('./panels/PersonalisationPanel', () => ({ default: ({ section }) => <div data-testid={`panel-${section.id}`}>{section.label}</div> }))
vi.mock('./panels/AccessibilityPanel', () => ({ default: ({ section }) => <div data-testid={`panel-${section.id}`}>{section.label}</div> }))
vi.mock('./panels/PremiumPanel', () => ({ default: ({ section }) => <div data-testid={`panel-${section.id}`}>{section.label}</div> }))
vi.mock('./panels/PrivacySecurityPanel', () => ({ default: ({ section }) => <div data-testid={`panel-${section.id}`}>{section.label}</div> }))
vi.mock('./panels/HelpPanel', () => ({ default: ({ section }) => <div data-testid={`panel-${section.id}`}>{section.label}</div> }))

import LearnerSettings from './LearnerSettings'

function renderShell(url = '/settings') {
  return render(<MemoryRouter initialEntries={[url]}><LearnerSettings /></MemoryRouter>)
}

describe('LearnerSettings shell', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    try { window.localStorage.clear() } catch { /* noop */ }
    global.IntersectionObserver = class {
      observe() {} unobserve() {} disconnect() {}
    }
    window.scrollTo = vi.fn()
    Element.prototype.scrollIntoView = vi.fn()
  })

  it('renders the page heading and profile-completion subtitle', () => {
    renderShell()
    expect(screen.getByRole('heading', { name: 'Settings' })).toBeInTheDocument()
    expect(screen.getByText(/% complete/)).toBeInTheDocument()
  })

  it('shows the overview grid and drills into a detail panel via a card', async () => {
    renderShell()
    expect(screen.getByTestId('card-account')).toBeInTheDocument()
    expect(screen.queryByTestId('panel-account')).not.toBeInTheDocument()
    fireEvent.click(screen.getByText('open-account'))
    expect(await screen.findByTestId('panel-account')).toBeInTheDocument()
  })

  it('honours a ?section= deep link', async () => {
    renderShell('/settings?section=progress')
    expect(await screen.findByTestId('panel-progress')).toBeInTheDocument()
  })

  it('shows a no-match message when a search finds nothing', () => {
    renderShell()
    fireEvent.change(screen.getByLabelText('Search settings'), { target: { value: 'ZZnope' } })
    expect(screen.getByText(/No settings match/)).toBeInTheDocument()
  })
})
