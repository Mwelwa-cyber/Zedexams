import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import SettingsHome from './SettingsHome'
import { SETTINGS_SECTIONS, ALL_SETTINGS_ROWS } from './settingsSections'

vi.mock('../../contexts/AuthContext', () => ({
  useAuth: vi.fn(() => ({
    currentUser: { uid: 'uid-1', metadata: { creationTime: 'Mon, 06 Jan 2025 10:00:00 GMT' } },
    userProfile: {
      displayName: 'Mahenga Mwelwa',
      school: 'Jemareen Academy',
      teacherPlan: 'pro',
      teaching: { grades: ['G5'], subjects: ['mathematics', 'english'], streams: ['5A', '5B'] },
    },
  })),
}))

vi.mock('../../hooks/useTeacherUsage', () => ({
  useTeacherUsage: vi.fn(() => ({
    loading: false,
    data: { used: { plans: 124 }, caps: {}, credits: 0, daily: 10, today: 0, resetDays: 3 },
  })),
  FEATURE_LABELS: {},
}))

// The hero derives its Classes/Subjects tiles from the Teaching Profile
// assignments; stub the IO so the spec never touches firebase/config. No
// assignments here → counts fall back to the legacy `teaching` field below.
vi.mock('../../utils/teachingProfileService', () => ({
  getTeachingProfile: vi.fn(() => Promise.resolve(null)),
  listAssignments: vi.fn(() => Promise.resolve([])),
}))
// useTeachingProfile also imports the library service (connection probes for
// the completion checklist — not exercised here); stub it for the same reason.
vi.mock('../../utils/teacherLibraryService', () => ({
  hasGenerationOfTool: vi.fn(() => Promise.resolve(false)),
}))

// The feedback dialog pulls Firestore; the hub only needs its launcher.
vi.mock('../feedback', () => ({
  FeedbackDialog: () => null,
}))
vi.mock('../../components/seo/SeoHelmet', () => ({ default: () => null }))
// resolveTeacherPlan reads only the profile — real import is fine (pure).

function renderHome() {
  return render(
    <MemoryRouter>
      <SettingsHome />
    </MemoryRouter>,
  )
}

describe('SettingsHome', () => {
  beforeEach(() => vi.clearAllMocks())

  it('renders the five section eyebrows', () => {
    renderHome()
    for (const section of SETTINGS_SECTIONS) {
      expect(screen.getByText(section.label)).toBeInTheDocument()
    }
    expect(SETTINGS_SECTIONS).toHaveLength(5)
  })

  it('renders every settings row as a link to its panel', () => {
    renderHome()
    const links = screen.getAllByRole('link')
    for (const row of ALL_SETTINGS_ROWS) {
      // Row titles overlap ("Profile" vs "Edit profile") so match on href +
      // title together.
      const hit = links.find(
        (l) =>
          l.getAttribute('href') === `/settings/${row.path}` &&
          l.textContent.includes(row.title),
      )
      expect(hit, `row link for ${row.id}`).toBeTruthy()
    }
    expect(ALL_SETTINGS_ROWS).toHaveLength(16)
  })

  it('shows the hero with greeting, plan badge, school and stats', () => {
    renderHome()
    expect(screen.getByText(/Mahenga!/)).toBeInTheDocument()
    expect(screen.getByText('Pro Teacher')).toBeInTheDocument()
    expect(screen.getByText('Jemareen Academy')).toBeInTheDocument()
    // Classes = 2 streams; Subjects = 2; Lesson Plans = 124 from the meter.
    expect(screen.getByText('Classes')).toBeInTheDocument()
    expect(screen.getByText('Subjects')).toBeInTheDocument()
    expect(screen.getByText('Lesson Plans')).toBeInTheDocument()
    expect(screen.getByText('124')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Edit profile/i })).toHaveAttribute(
      'href',
      '/settings/profile',
    )
  })

  it('renders the tip strip and no dashboard artifacts', () => {
    const { container } = renderHome()
    expect(screen.getByText(/used across all studios/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /need help/i })).toBeInTheDocument()
    // The calm-surface guarantee: no gauges, charts or progress meters.
    expect(container.querySelector('svg circle')).toBeNull()
    expect(container.querySelector('canvas')).toBeNull()
    expect(screen.queryByText(/quick actions/i)).toBeNull()
  })
})
