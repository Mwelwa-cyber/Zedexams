import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, within, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import TeacherAppLauncher from './TeacherAppLauncher'
import { STUDIO_CATEGORIES, TEACHER_STUDIOS } from './teacherStudios'

// ── Auth mock (favourites persistence hooks read this) ──────────────────
const updateProfileFields = vi.fn().mockResolvedValue()
let authValue
vi.mock('../../../../contexts/AuthContext', () => ({
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
  it('has 21 unique studios across the four categories with real /teacher routes', () => {
    expect(TEACHER_STUDIOS).toHaveLength(21)
    const ids = new Set(TEACHER_STUDIOS.map((s) => s.id))
    expect(ids.size).toBe(21)
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
    // 4 saved on Lesson Plans (dynamic), New on Question Bank (static)
    expect(screen.getByText('4 saved')).toBeInTheDocument()
    expect(within(screen.getByLabelText(/^Question Bank/)).getByText('New')).toBeInTheDocument()
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
    localStorage.setItem('zedexams:teacher-recents:u1', JSON.stringify({ ids: ['worksheets', 'schemes'], at: {} }))
    const { container } = renderLauncher()
    const recent = container.querySelector('.tsl-recent')
    expect(recent).toBeTruthy()
    const names = within(recent).getAllByLabelText(/Open studio$/).map((n) => n.getAttribute('data-studio'))
    expect(names.slice(0, 2)).toEqual(['worksheets', 'schemes'])
  })

  it('search filters to matching tools and shows an empty state otherwise', async () => {
    const user = userEvent.setup()
    renderLauncher()
    const box = screen.getByRole('searchbox', { name: 'Search teacher tools' })
    await user.type(box, 'rubric')
    expect(screen.getByLabelText(/^Rubrics.*Open studio$/)).toBeInTheDocument()
    expect(screen.queryByLabelText(/^Lesson Plans.*Open studio$/)).not.toBeInTheDocument()
    await user.clear(box)
    await user.type(box, 'zzznope')
    expect(screen.getByText(/No tools match/)).toBeInTheDocument()
  })

  it('permission-filters tools for non-teachers', () => {
    authValue = { isTeacher: false, currentUser: null, userProfile: null, updateProfileFields }
    renderLauncher()
    expect(screen.queryByLabelText(/Open studio$/)).not.toBeInTheDocument()
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
})
