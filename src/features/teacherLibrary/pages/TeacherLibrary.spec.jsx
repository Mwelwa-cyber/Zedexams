/**
 * The library home grid renders from the studio registry.
 *
 * The point of the refactor these tests guard is that there is no parallel card
 * list any more: the grid, the Create menu and the folder filter chips all read
 * STUDIOS. So the load-bearing assertion is not "the twelve cards are there" —
 * it is that a THIRTEENTH registry entry appears with no other change to this
 * file, which is the registry guarantee stated in the spec.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

// Controllable mock so per-test rejection can be tested.
const mockGetMyAssessments = vi.hoisted(() => vi.fn().mockResolvedValue([]))

vi.mock('../../../firebase/config', () => ({ db: {}, auth: {}, storage: {} }))
vi.mock('../../../contexts/AuthContext', () => ({
  useAuth: () => ({ currentUser: { uid: 'teacher_1' } }),
}))
vi.mock('../../../hooks/useFirestore', () => ({
  useFirestore: () => ({ getMyAssessments: mockGetMyAssessments }),
}))
vi.mock('../../../utils/teacherLibraryService', async (importOriginal) => {
  const actual = await importOriginal()
  return { ...actual, listMyGenerations: async () => [] }
})
vi.mock('../../../shared/components/SeoHelmet', () => ({ default: () => null }))

// The registry is mocked per test so a fake entry can be added without touching
// the component — which is exactly the guarantee under test. The override lives
// on globalThis because vi.mock's factory is hoisted above every binding in this
// file, so a module-scope `let` would still be in its temporal dead zone.
vi.mock('../../../lib/library/studios.js', async (importOriginal) => {
  const actual = await importOriginal()
  const studios = () => globalThis.__libraryStudiosOverride || actual.STUDIOS
  return {
    ...actual,
    get STUDIOS() { return studios() },
    get STUDIO_BY_ID() { return Object.fromEntries(studios().map((s) => [s.id, s])) },
    creatableStudios: () => studios().filter((s) => s.createRoute && !s.readOnly),
  }
})

const { STUDIOS: REAL_STUDIOS } = await import('../../../lib/library/studios.js')
const TeacherLibrary = (await import('./TeacherLibrary')).default

const renderLibrary = () => render(
  <MemoryRouter initialEntries={['/teacher/library']}>
    <TeacherLibrary />
  </MemoryRouter>,
)

describe('TeacherLibrary home grid', () => {
  beforeEach(() => {
    delete globalThis.__libraryStudiosOverride
    mockGetMyAssessments.mockResolvedValue([])
  })

  it('renders exactly one card per registry entry', async () => {
    renderLibrary()
    await waitFor(() => expect(screen.getByText('Lesson Plans')).toBeInTheDocument())
    for (const studio of REAL_STUDIOS) {
      expect(screen.getByText(studio.label), `no card for ${studio.id}`).toBeInTheDocument()
    }
  })

  it('keeps the registry order on screen', async () => {
    renderLibrary()
    await waitFor(() => expect(screen.getByText('Lesson Plans')).toBeInTheDocument())
    const rendered = REAL_STUDIOS.map((s) => screen.getByText(s.label))
    const positions = rendered.map((node) => node.compareDocumentPosition(rendered[0]))
    // Every card after the first is positioned after it in document order.
    positions.slice(1).forEach((mask) => {
      expect(mask & Node.DOCUMENT_POSITION_PRECEDING).toBeTruthy()
    })
  })

  it('a new registry entry surfaces a card and a Create action, with no other change', async () => {
    globalThis.__libraryStudiosOverride = [...REAL_STUDIOS, Object.freeze({
      id: 'reading_logs',
      label: 'Reading Logs',
      icon: 'BookOpen',
      tint: 'soft-mint',
      collection: 'aiGenerations',
      createRoute: '/teacher/generate/reading-log',
      readOnly: false,
      emptyHint: '',
      hierarchy: ['curriculum', 'grade', 'term'],
      requiredDimensions: ['grade'],
    })]

    renderLibrary()
    await waitFor(() => expect(screen.getByText('Reading Logs')).toBeInTheDocument())

    fireEvent.click(screen.getByRole('button', { name: /create/i }))
    const createItem = await screen.findByText('New Reading Log')
    expect(createItem.closest('a')).toHaveAttribute('href', '/teacher/generate/reading-log')
  })

  it('the Create menu offers only studios that can be created into', async () => {
    renderLibrary()
    await waitFor(() => expect(screen.getByText('Lesson Plans')).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: /create/i }))

    await screen.findByText('New Lesson Plan')
    // Syllabi are platform-owned and view-only — a create action there would
    // lead nowhere.
    expect(screen.queryByText('New Syllabi')).not.toBeInTheDocument()
    expect(screen.queryByText('New Syllabu')).not.toBeInTheDocument()
  })

  it('the folder filter chips come from the registry too', async () => {
    renderLibrary()
    await waitFor(() => expect(screen.getByText('Lesson Plans')).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: /filter by folder/i }))

    const group = await screen.findByRole('group', { name: /filter search results by folder/i })
    for (const studio of REAL_STUDIOS) {
      expect(
        within(group).getByRole('button', { name: studio.label }),
        `no filter chip for ${studio.id}`,
      ).toBeInTheDocument()
    }
  })
})

describe('TeacherLibrary — assessment read failure', () => {
  beforeEach(() => {
    delete globalThis.__libraryStudiosOverride
    mockGetMyAssessments.mockResolvedValue([])
  })

  it('shows error state with retry button, not a false-empty grid, when getMyAssessments throws', async () => {
    mockGetMyAssessments.mockRejectedValue(new Error('network blip'))
    renderLibrary()
    // The error state message appears instead of the normal grid.
    await waitFor(() =>
      expect(screen.getByText('Could not load your library')).toBeInTheDocument()
    )
    // The error detail is shown.
    expect(screen.getByText(/network blip/i)).toBeInTheDocument()
    // A retry button is present.
    expect(screen.getByRole('button', { name: /try again/i })).toBeInTheDocument()
    // The normal studio grid is NOT shown — the user is not misled into
    // thinking they have no papers.
    expect(screen.queryByText('Lesson Plans')).not.toBeInTheDocument()
  })

  it('retrying after a failure re-loads and shows the grid on success', async () => {
    // All calls reject while we wait for the error state.
    // Using persistent rejection (not Once) means the component stays in error
    // state even if the effect re-runs due to reference-unstable mock objects,
    // which lets us safely get a reference to the retry button before switching.
    mockGetMyAssessments.mockRejectedValue(new Error('transient failure'))

    renderLibrary()
    // findByRole internally retries until the button appears.
    const retryBtn = await screen.findByRole('button', { name: /try again/i })

    // Switch to success BEFORE clicking, then fire the click.
    // React reuses the same DOM node while the component is in error state,
    // so the stored reference is still valid for the click event.
    mockGetMyAssessments.mockResolvedValue([])
    fireEvent.click(retryBtn)

    // The library grid returns after the retry effect run resolves.
    await waitFor(() =>
      expect(screen.getByText('Lesson Plans')).toBeInTheDocument()
    )
    // Error state is gone.
    expect(screen.queryByText('Could not load your library')).not.toBeInTheDocument()
  })
})
