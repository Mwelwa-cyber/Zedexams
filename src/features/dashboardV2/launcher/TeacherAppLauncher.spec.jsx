import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, within, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import TeacherAppLauncher from './TeacherAppLauncher'
import { STUDIO_CATEGORIES, TEACHER_STUDIOS } from '../../../components/teacher/dashboardV2/launcher/teacherStudios'

// Every teacher navigation surface now asks studioAvailability which studios
// are on offer, and that reads settings/global. Stubbed to the LAUNCH state
// (no flags set → Worksheet Studio withdrawn, Rubric Studio retired).
vi.mock('../../../contexts/PlatformSettingsContext', () => ({
  usePlatformSettings: () => ({ settings: { featureFlags: {} }, loaded: true, live: true }),
}))

// ── Auth mock (favourites persistence hooks read this) ──────────────────
const updateProfileFields = vi.fn().mockResolvedValue()
let authValue
vi.mock('../../../contexts/AuthContext', () => ({
  useAuth: () => authValue,
}))

function setViewport(width) {
  Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: width })
  Object.defineProperty(window, 'innerHeight', { configurable: true, writable: true, value: 800 })
}

function renderLauncher(props = {}, { route = '/teacher' } = {}) {
  return render(
    <MemoryRouter initialEntries={[route]}>
      <Routes>
        <Route path="/teacher" element={<TeacherAppLauncher {...props} />} />
        <Route path="/teacher/lesson-plans/new" element={<div>Lesson Plan Studio Page</div>} />
        <Route path="/teacher/generate/scheme-of-work" element={<div>Scheme Page</div>} />
        <Route path="/teacher/library" element={<div>Library Page</div>} />
      </Routes>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  localStorage.clear()
  updateProfileFields.mockClear()
  authValue = { isTeacher: true, currentUser: { uid: 'u1' }, userProfile: {}, updateProfileFields }
  setViewport(1440)
})
afterEach(() => { vi.useRealTimers() })

const lessonIcon = () => screen.getByLabelText(/^Lesson Plans.*Open studio$/)

describe('registry integrity', () => {
  it('has 19 unique studios across the four categories with real /teacher routes', () => {
    // 21 until Rubric Studio was retired and the Question Bank stopped being a
    // destination of its own (both 2026-08). Worksheets is still here: it is
    // withdrawn behind a feature flag, and the launcher filters it at render —
    // the registry keeps it so flipping the flag restores it.
    expect(TEACHER_STUDIOS).toHaveLength(19)
    const ids = new Set(TEACHER_STUDIOS.map((s) => s.id))
    expect(ids.size).toBe(19)
    expect(ids.has('rubrics')).toBe(false)
    // The bank is a VIEW of the Assessment Paper Studio, not a studio tile.
    expect(ids.has('question-bank')).toBe(false)
    expect(ids.has('worksheets')).toBe(true)
    const cats = new Set(STUDIO_CATEGORIES.map((c) => c.id))
    for (const s of TEACHER_STUDIOS) {
      expect(s.route.startsWith('/teacher')).toBe(true)
      expect(cats.has(s.category)).toBe(true)
      expect(s.description.length).toBeGreaterThan(10)
      expect(s.icon).toBeTruthy()
    }
  })
})

describe('TeacherAppLauncher', () => {
  it('renders the header, all categories and every studio icon', () => {
    renderLauncher()
    expect(screen.getByRole('region', { name: 'Teacher Workspace' })).toBeInTheDocument()
    expect(screen.getByText('Everything you need to plan, teach, assess and record')).toBeInTheDocument()
    for (const c of STUDIO_CATEGORIES) {
      // CSS uppercases the label; the DOM text is the original label.
      expect(screen.getByText(c.label, { selector: '.tsl-cat-title' })).toBeTruthy()
    }
    // one icon per studio (aria-labelled) — assert a representative sample
    expect(lessonIcon()).toBeInTheDocument()
    expect(screen.getByLabelText(/^Class Register.*Open studio$/)).toBeInTheDocument()
  })

  it('clicking an icon opens the studio route', async () => {
    const user = userEvent.setup()
    renderLauncher()
    await user.click(lessonIcon())
    expect(screen.getByText('Lesson Plan Studio Page')).toBeInTheDocument()
  })

  it('shows a live saved-count badge and a static New badge', () => {
    renderLauncher({ savedCounts: { lesson_plan: 4, assessment: 2 } })
    // 4 saved on Lesson Plans (dynamic), New on Visual Studio (static)
    expect(screen.getByText('4 saved')).toBeInTheDocument()
    expect(within(screen.getByLabelText(/^Visual Studio/)).getByText('New')).toBeInTheDocument()
    // a live count overrides the static New on Assessment Paper Studio
    expect(screen.getByLabelText(/^Assessment Paper Studio, 2 saved/)).toBeInTheDocument()
  })

  it('renders skeleton (not zeros) while counts load', () => {
    const { container } = renderLauncher({ savedCounts: null, loading: true })
    expect(container.querySelector('.tsl-app-badge.is-skeleton')).toBeTruthy()
    expect(screen.queryByText('0 saved')).not.toBeInTheDocument()
  })

  it('desktop hover opens a positioned info popover with actions', async () => {
    const user = userEvent.setup()
    renderLauncher({ savedCounts: { lesson_plan: 4 } })
    await user.hover(lessonIcon())
    const pop = await screen.findByRole('dialog', { name: /Lesson Plans — details/ })
    expect(within(pop).getByText('Open Studio')).toBeInTheDocument()
    expect(within(pop).getByText('View saved work')).toBeInTheDocument()
    expect(within(pop).getByText('4 saved')).toBeInTheDocument()
  })

  it('keyboard focus opens the popover and Escape closes it', async () => {
    renderLauncher()
    fireEvent.focus(lessonIcon())
    expect(await screen.findByRole('dialog', { name: /Lesson Plans/ })).toBeInTheDocument()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog', { name: /Lesson Plans/ })).not.toBeInTheDocument()
  })

  it('press-and-hold opens the mobile info bottom sheet (tap still opens)', () => {
    vi.useFakeTimers()
    renderLauncher()
    const icon = lessonIcon()
    fireEvent.pointerDown(icon, { pointerType: 'touch', clientX: 10, clientY: 10 })
    act(() => { vi.advanceTimersByTime(600) })
    const sheet = screen.getByRole('dialog', { name: /Lesson Plans — details/ })
    expect(sheet).toBeInTheDocument()
    expect(within(sheet).getByText('View saved work')).toBeInTheDocument()
  })

  it('favourite toggling persists per teacher and syncs to the profile', async () => {
    const user = userEvent.setup()
    renderLauncher()
    fireEvent.focus(lessonIcon())
    const pop = await screen.findByRole('dialog', { name: /Lesson Plans/ })
    await user.click(within(pop).getByRole('button', { name: /Add to favourites/ }))
    // persisted to Firestore profile + localStorage mirror
    expect(updateProfileFields).toHaveBeenCalledWith({ teacherFavouriteStudios: ['lesson-plans'] })
    expect(JSON.parse(localStorage.getItem('zedexams:teacher-favourites:u1'))).toEqual(['lesson-plans'])
  })

  it('Favourites chip shows only pinned studios', async () => {
    const user = userEvent.setup()
    localStorage.setItem('zedexams:teacher-favourites:u1', JSON.stringify(['notes']))
    renderLauncher()
    await user.click(screen.getByRole('tab', { name: /Favourites/ }))
    expect(screen.getByLabelText(/^Notes Studio.*Open studio$/)).toBeInTheDocument()
    expect(screen.queryByLabelText(/^Lesson Plans.*Open studio$/)).not.toBeInTheDocument()
  })

  it('surfaces a Recently used row in most-recent-first order', () => {
    localStorage.setItem('zedexams:teacher-recents:u1', JSON.stringify({ ids: ['notes', 'schemes'], at: {} }))
    const { container } = renderLauncher()
    const recent = container.querySelector('.tsl-recent')
    expect(recent).toBeTruthy()
    const names = within(recent).getAllByLabelText(/Open studio$/).map((n) => n.getAttribute('data-studio'))
    expect(names.slice(0, 2)).toEqual(['notes', 'schemes'])
  })

  /* Recents and favourites are stored on the DEVICE, so they are the one way
     a studio the registry no longer offers could walk back onto the grid. */
  it('drops a withdrawn studio from recents and favourites', () => {
    localStorage.setItem('zedexams:teacher-recents:u1', JSON.stringify({ ids: ['worksheets', 'schemes'], at: {} }))
    localStorage.setItem('zedexams:teacher-favourites:u1', JSON.stringify(['worksheets', 'notes']))
    const { container } = renderLauncher()
    const recentIds = within(container.querySelector('.tsl-recent'))
      .getAllByLabelText(/Open studio$/).map((n) => n.getAttribute('data-studio'))
    expect(recentIds).not.toContain('worksheets')
    const favIds = within(container.querySelector('.tsl-favs'))
      .getAllByLabelText(/Open studio$/).map((n) => n.getAttribute('data-studio'))
    expect(favIds).toEqual(['notes'])
  })

  it('search filters to matching tools and shows an empty state otherwise', async () => {
    const user = userEvent.setup()
    renderLauncher()
    const box = screen.getByRole('searchbox', { name: 'Search teacher tools' })
    await user.type(box, 'flashcard')
    expect(screen.getByLabelText(/^Flashcards.*Open studio$/)).toBeInTheDocument()
    expect(screen.queryByLabelText(/^Lesson Plans.*Open studio$/)).not.toBeInTheDocument()
    // Search must not be a back door into a studio the grid has hidden.
    await user.clear(box)
    await user.type(box, 'worksheet')
    expect(screen.queryByLabelText(/^Worksheets.*Open studio$/)).not.toBeInTheDocument()
    await user.clear(box)
    await user.type(box, 'zzznope')
    expect(screen.getByText(/No tools match/)).toBeInTheDocument()
  })

  it('permission-filters tools for signed-in non-teachers', () => {
    // A real signed-in account without the teacher role sees nothing;
    // signed-OUT (currentUser: null) is the mock-data preview page, which
    // intentionally shows the full registry instead.
    authValue = { isTeacher: false, currentUser: { uid: 'u-1' }, userProfile: null, updateProfileFields }
    renderLauncher()
    expect(screen.queryByLabelText(/Open studio$/)).not.toBeInTheDocument()
  })

  it('shows the full registry on the signed-out preview page', () => {
    authValue = { isTeacher: false, currentUser: null, userProfile: null, updateProfileFields }
    renderLauncher()
    expect(screen.getByLabelText(/^Lesson Plans.*Open studio$/)).toBeInTheDocument()
  })

  it('collapses and expands a category section', async () => {
    const user = userEvent.setup()
    renderLauncher()
    const head = screen.getByRole('button', {
      name: (n) => n.startsWith('Planning') && !n.includes('Setup'),
    })
    expect(head).toHaveAttribute('aria-expanded', 'true')
    await user.click(head)
    expect(head).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByLabelText(/^Lesson Plans.*Open studio$/)).not.toBeInTheDocument()
  })

  it('uses a minmax(0,1fr) grid so it never overflows horizontally at 320px', () => {
    setViewport(320)
    const { container } = renderLauncher()
    const grid = container.querySelector('.tsl-grid')
    // 4 columns at 320px; the CSS grid uses repeat(var(--tsl-cols),
    // minmax(0,1fr)) so tracks can shrink to 0 → never a horizontal scroll.
    expect(grid.style.getPropertyValue('--tsl-cols')).toBe('4')
  })

  it('Enter in search opens the top result directly', async () => {
    const user = userEvent.setup()
    renderLauncher()
    const box = screen.getByRole('searchbox', { name: 'Search teacher tools' })
    await user.type(box, 'scheme{Enter}')
    expect(screen.getByText('Scheme Page')).toBeInTheDocument()
  })

  it('Shift+F10 opens the info sheet for keyboard users (favourites path)', async () => {
    renderLauncher()
    const icon = lessonIcon()
    icon.focus()
    fireEvent.keyDown(icon, { key: 'F10', shiftKey: true })
    const sheet = screen.getByRole('dialog', { name: /Lesson Plans — details/ })
    expect(within(sheet).getByRole('button', { name: /Add to favourites/ })).toBeInTheDocument()
  })

  it('mouse right-click keeps the native context menu (no info sheet)', () => {
    renderLauncher()
    const icon = lessonIcon()
    fireEvent.pointerDown(icon, { pointerType: 'mouse', button: 2 })
    fireEvent.contextMenu(icon)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('Recent chip with no history shows an honest empty state, not all tools', async () => {
    const user = userEvent.setup()
    renderLauncher()
    await user.click(screen.getByRole('tab', { name: 'Recent' }))
    expect(screen.getByText(/No recently used tools yet/)).toBeInTheDocument()
    expect(screen.queryByLabelText(/^Lesson Plans.*Open studio$/)).not.toBeInTheDocument()
  })

  it('View saved work deep-links to the library from the popover', async () => {
    const user = userEvent.setup()
    renderLauncher()
    fireEvent.focus(lessonIcon())
    const pop = await screen.findByRole('dialog', { name: /Lesson Plans/ })
    await user.click(within(pop).getByRole('button', { name: /View saved work/ }))
    expect(screen.getByText('Library Page')).toBeInTheDocument()
  })

  it('hub studios (route IS the list) hide View saved work', async () => {
    renderLauncher()
    fireEvent.focus(screen.getByLabelText(/^Curriculum.*Open studio$/))
    const pop = await screen.findByRole('dialog', { name: /Curriculum — details/ })
    expect(within(pop).queryByRole('button', { name: /View saved work/ })).not.toBeInTheDocument()
    expect(within(pop).getByRole('button', { name: /Add to favourites/ })).toBeInTheDocument()
  })

  it('every studio declares savedWorkTo explicitly (string or null)', () => {
    for (const s of TEACHER_STUDIOS) {
      expect(s.savedWorkTo === null || typeof s.savedWorkTo === 'string').toBe(true)
    }
  })

  it('pinned favourites surface as a row on the default view', () => {
    localStorage.setItem('zedexams:teacher-favourites:u1', JSON.stringify(['notes', 'flashcards']))
    const { container } = renderLauncher()
    const favRow = container.querySelector('.tsl-favs')
    expect(favRow).toBeTruthy()
    const ids = within(favRow).getAllByLabelText(/Open studio$/).map((n) => n.getAttribute('data-studio'))
    expect(ids).toEqual(['notes', 'flashcards'])
  })

  it('warning dot renders from the warnings prop and outranks the saved count', () => {
    renderLauncher({ savedCounts: { assessment: 3 }, warnings: ['assessment-papers'] })
    // aria-label carries the state — never colour-only
    const icons = screen.getAllByLabelText(/^Assessment Paper Studio, Needs attention/)
    expect(icons.length).toBeGreaterThan(0)
    expect(icons[0].querySelector('.tsl-badge-dot')).toBeTruthy()
  })
})
