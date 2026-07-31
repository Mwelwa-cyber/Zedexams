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

vi.mock('../../../firebase/config', () => ({ db: {}, auth: {}, storage: {} }))
vi.mock('../../../contexts/AuthContext', () => ({
  useAuth: () => ({ currentUser: { uid: 'teacher_1' } }),
}))
vi.mock('../../../hooks/useFirestore', () => ({
  useFirestore: () => ({ getMyAssessments: async () => [] }),
}))
vi.mock('../../../utils/teacherLibraryService', async (importOriginal) => {
  const actual = await importOriginal()
  return { ...actual, listMyGenerations: async () => [] }
})
vi.mock('../../seo/SeoHelmet', () => ({ default: () => null }))

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
  beforeEach(() => { delete globalThis.__libraryStudiosOverride })

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
