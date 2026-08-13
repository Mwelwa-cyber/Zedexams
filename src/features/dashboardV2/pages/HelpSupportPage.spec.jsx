import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { HelmetProvider } from 'react-helmet-async'
import HelpSupportPage from './HelpSupportPage'

// The real dialogs import firebase; stub them and assert on open/source.
const contactCalls = []
vi.mock('../../marketing', () => ({
  ContactDialog: ({ open, source }) => {
    if (open) contactCalls.push(source)
    return open ? <div role="dialog" aria-label={`contact:${source}`} /> : null
  },
}))
vi.mock('../../../components/feedback/FeedbackDialog', () => ({
  default: ({ open, source }) => (open ? <div role="dialog" aria-label={`feedback:${source}`} /> : null),
}))

const logout = vi.fn().mockResolvedValue()
vi.mock('../../../contexts/AuthContext', () => ({
  useAuth: () => ({
    currentUser: { displayName: 'Bwalya Chanda', email: 'bwalya@example.com' },
    userProfile: { displayName: 'Bwalya Chanda', email: 'bwalya@example.com' },
    logout,
  }),
}))
vi.mock('../../../contexts/PlatformSettingsContext', () => ({
  usePlatformSettings: () => ({ settings: { supportEmail: 'support@zedexams.com' } }),
}))
vi.mock('../../../contexts/NotificationContext', () => ({
  useNotifications: () => ({ unreadCount: 0, open: false, setOpen: () => {} }),
}))

function renderPage() {
  return render(
    <HelmetProvider>
      <MemoryRouter initialEntries={['/teacher/help']}>
        <HelpSupportPage />
      </MemoryRouter>
    </HelmetProvider>,
  )
}

describe('HelpSupportPage', () => {
  beforeEach(() => {
    contactCalls.length = 0
  })

  it('renders every support channel with a real destination', () => {
    renderPage()
    expect(screen.getByRole('heading', { name: /Help & Support/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Send us a message/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Report a problem/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Suggest a feature/ })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Chat on WhatsApp/ })).toHaveAttribute(
      'href',
      'https://wa.me/260977740465',
    )
    expect(screen.getByRole('link', { name: /Email support/ })).toHaveAttribute(
      'href',
      'mailto:support@zedexams.com',
    )
  })

  it('opens the contact dialog with a distinct source per action', async () => {
    const user = userEvent.setup()
    renderPage()
    await user.click(screen.getByRole('button', { name: /Send us a message/ }))
    expect(screen.getByRole('dialog', { name: 'contact:teacher-help-contact' })).toBeInTheDocument()
  })

  it('report a problem uses the report source; suggest opens the feedback dialog', async () => {
    const user = userEvent.setup()
    renderPage()
    await user.click(screen.getByRole('button', { name: /Report a problem/ }))
    expect(screen.getByRole('dialog', { name: 'contact:teacher-help-report' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /Suggest a feature/ }))
    expect(screen.getByRole('dialog', { name: 'feedback:teacher-help' })).toBeInTheDocument()
  })

  it('FAQ answers expand on click', async () => {
    const user = userEvent.setup()
    renderPage()
    const q = screen.getByRole('button', { name: /How do I upgrade or pay\?/ })
    expect(q).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByText(/mobile money/)).not.toBeInTheDocument()
    await user.click(q)
    expect(q).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByText(/mobile money/)).toBeInTheDocument()
  })
})
