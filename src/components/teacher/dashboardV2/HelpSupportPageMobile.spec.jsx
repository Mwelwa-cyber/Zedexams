import { describe, it, expect, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { HelmetProvider } from 'react-helmet-async'
import TeacherLayout from '../TeacherLayout'
import HelpSupportPage from './HelpSupportPage'

// Force the mobile chrome regardless of jsdom viewport.
vi.mock('../../../shared/hooks/useIsMobile', () => ({ default: () => true }))
vi.mock('../../marketing/ContactDialog', () => ({
  default: ({ open, source }) => (open ? <div role="dialog" aria-label={`contact:${source}`} /> : null),
}))
vi.mock('../../feedback/FeedbackDialog', () => ({
  default: ({ open, source }) => (open ? <div role="dialog" aria-label={`feedback:${source}`} /> : null),
}))
vi.mock('../../../contexts/AuthContext', () => ({
  useAuth: () => ({
    currentUser: { displayName: 'Bwalya Chanda', email: 'bwalya@example.com' },
    userProfile: { displayName: 'Bwalya Chanda', email: 'bwalya@example.com' },
    logout: vi.fn().mockResolvedValue(),
  }),
}))
vi.mock('../../../contexts/PlatformSettingsContext', () => ({
  usePlatformSettings: () => ({ settings: { supportEmail: 'support@zedexams.com' } }),
}))
vi.mock('../../../contexts/NotificationContext', () => ({
  useNotifications: () => ({ unreadCount: 0, open: false, setOpen: () => {} }),
}))
// Not part of the chrome under test, and it boots Firebase.
vi.mock('../TeacherTopBar', () => ({ default: () => <div data-testid="topbar" /> }))

function renderPage() {
  return render(
    <HelmetProvider>
      <MemoryRouter initialEntries={['/teacher/help']}>
        <TeacherLayout variant="dashboard">
          <HelpSupportPage />
        </TeacherLayout>
      </MemoryRouter>
    </HelmetProvider>,
  )
}

describe('HelpSupportPage (mobile chrome)', () => {
  it('renders mobile header + bottom nav instead of the desktop sidebar', () => {
    renderPage()
    expect(screen.queryByLabelText('Teacher navigation')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Open menu' })).toBeInTheDocument()
    const bottom = screen.getByRole('navigation', { name: 'Quick navigation' })
    expect(within(bottom).getByText('Home')).toBeInTheDocument()
    // Help content still fully present
    expect(screen.getByRole('heading', { name: /Help & Support/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Send us a message/ })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Chat on WhatsApp/ })).toBeInTheDocument()
  })

  it('drawer opens, and its Log out path requires confirmation', async () => {
    const user = userEvent.setup()
    renderPage()
    await user.click(screen.getByRole('button', { name: 'Open menu' }))
    expect(document.querySelector('.tdv2m-drawer-root')).toHaveClass('is-open')

    await user.click(screen.getByRole('button', { name: /Bwalya Chanda/ }))
    await user.click(screen.getByRole('menuitem', { name: 'Log out' }))
    expect(screen.getByRole('alertdialog', { name: 'Log out of ZedExams?' })).toBeInTheDocument()
  })

  it('contact channels still open their dialogs on mobile', async () => {
    const user = userEvent.setup()
    renderPage()
    await user.click(screen.getByRole('button', { name: /Report a problem/ }))
    expect(screen.getByRole('dialog', { name: 'contact:teacher-help-report' })).toBeInTheDocument()
  })
})
