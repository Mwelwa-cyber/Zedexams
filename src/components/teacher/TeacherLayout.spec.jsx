import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import TeacherLayout from './TeacherLayout'

// The shell's page-level chrome is exercised elsewhere; stub it so the spec
// focuses on the sidebar swap (old Teacher Panel → shared V2 Sidebar).
vi.mock('./TeacherTopBar', () => ({ default: () => <div data-testid="topbar" /> }))
vi.mock('./TeacherGlassHeader', () => ({ default: () => <div data-testid="glass" /> }))
vi.mock('./TeacherBottomNav', () => ({ default: () => <div data-testid="bottomnav" /> }))

const logout = vi.fn().mockResolvedValue()
const auth = {
  logout,
  currentUser: { displayName: 'Bwalya Chanda', email: 'bwalya@example.com' },
  userProfile: { displayName: 'Bwalya Chanda', email: 'bwalya@example.com' },
  isAdmin: false,
}
vi.mock('../../contexts/AuthContext', () => ({
  useAuth: () => auth,
}))

function renderLayout(path = '/teacher/library') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route
          path="*"
          element={
            <TeacherLayout>
              <div>Page content</div>
            </TeacherLayout>
          }
        />
      </Routes>
    </MemoryRouter>,
  )
}

describe('TeacherLayout (V2 shell sidebar)', () => {
  beforeEach(() => {
    logout.mockClear()
    auth.isAdmin = false
  })

  it('renders the shared V2 sidebar with the full teacher map, not the old Teacher Panel', () => {
    renderLayout()
    const sidebar = screen.getByLabelText('Teacher navigation')
    expect(screen.queryByText('Teacher Panel')).not.toBeInTheDocument()
    // Full-coverage destinations the dashboard's curated nav does not list
    for (const label of ['Weekly Focus', 'Record of Work', 'Class Register', 'School Calendar', 'Syllabi Studio', 'Curriculum']) {
      expect(within(sidebar).getByText(label)).toBeInTheDocument()
    }
    // V2 settings group + page content still render
    expect(within(sidebar).getByText('Help & Support')).toBeInTheDocument()
    expect(screen.getByText('Page content')).toBeInTheDocument()
    // No Admin Panel entry for regular teachers
    expect(within(sidebar).queryByText('Admin Panel')).not.toBeInTheDocument()
  })

  it('marks the current section active', () => {
    renderLayout('/teacher/library')
    const active = screen.getByRole('link', { name: /My Library/ })
    expect(active).toHaveAttribute('aria-current', 'page')
  })

  it('logging out asks for confirmation first', async () => {
    const user = userEvent.setup()
    renderLayout()
    await user.click(screen.getByRole('button', { name: /Bwalya Chanda/ }))
    await user.click(screen.getByRole('menuitem', { name: 'Log out' }))
    expect(logout).not.toHaveBeenCalled()
    expect(screen.getByRole('alertdialog', { name: 'Log out of ZedExams?' })).toBeInTheDocument()
    await user.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: /Log out/ }))
    expect(logout).toHaveBeenCalledTimes(1)
  })

  it('admins get the Admin Panel shortcut at the top', () => {
    auth.isAdmin = true
    renderLayout()
    const sidebar = screen.getByLabelText('Teacher navigation')
    expect(within(sidebar).getByText('Admin Panel')).toBeInTheDocument()
  })
})
