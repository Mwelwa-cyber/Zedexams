import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import AdminSettings from './AdminSettings.jsx'

// The settings/global doc the mocked getDoc serves. Set per test.
let currentDoc
const setDocMock = vi.fn(() => Promise.resolve())

vi.mock('firebase/firestore', () => ({
  doc: (...args) => ({ __ref: args }),
  getDoc: () => Promise.resolve({ exists: () => true, data: () => currentDoc }),
  setDoc: (...args) => setDocMock(...args),
  serverTimestamp: () => '__ts__',
  increment: (n) => ({ __inc: n }),
}))
vi.mock('../../../firebase/config', () => ({ default: {}, db: {} }))
vi.mock('../../../contexts/AuthContext', () => ({
  useAuth: () => ({
    currentUser: { uid: 'admin-1', email: 'admin@zedexams.com' },
    userProfile: { role: 'superAdmin', displayName: 'Admin' },
  }),
}))
// Live vitals are a separate hook with its own Firestore reads — stub the
// module so the spec exercises rendering, not the data layer.
vi.mock('../lib/useControlCenterData', () => ({
  default: () => ({
    data: {
      users: 120, learners: 100, teachers: 18, admins: 2,
      pendingPayments: 2, agentQueue: 1, pendingContent: 0,
      aiTodayUsd: 1.25, aiMonthUsd: 20.5, aiAnomalous: false,
      health: { healthy: true, summary: 'All agents ran on time.' },
      audit: [{ id: 'a1', actorEmail: 'admin@zedexams.com', action: 'settings.update', createdAt: { toDate: () => new Date('2026-07-08T08:00:00Z') } }],
    },
    loading: false,
    refresh: vi.fn(),
  }),
}))

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/admin/settings']}>
      <AdminSettings />
    </MemoryRouter>,
  )
}

beforeEach(() => {
  setDocMock.mockClear()
  currentDoc = {
    siteName: 'ZedExams',
    registrationOpen: false, // legacy boolean only — no registrationMode
    maintenanceMode: true,
    updatedByEmail: 'admin@zedexams.com',
    configVersion: 3,
  }
})

describe('AdminSettings — Platform Control Center', () => {
  it('renders the console shell with live vitals and derived insights', async () => {
    renderPage()

    expect(await screen.findByText('Platform settings')).toBeInTheDocument()
    // Vitals strip shows the mocked counts.
    expect(screen.getByText('120')).toBeInTheDocument()
    expect(screen.getByText('$1.25')).toBeInTheDocument()
    // Health pill reflects Marshal's verdict.
    expect(screen.getByText('Healthy')).toBeInTheDocument()
    // Deterministic insights from the loaded doc: maintenance ON + registration closed.
    expect(screen.getByText(/Maintenance mode is ON/)).toBeInTheDocument()
    expect(screen.getByText(/Registration is closed/)).toBeInTheDocument()
    // Audit feed renders the mocked entry.
    expect(screen.getByText(/settings\.update/)).toBeInTheDocument()
  })

  it('search filters the category rail down to matches', async () => {
    renderPage()
    await screen.findByText('Platform settings')

    fireEvent.change(screen.getByLabelText('Search settings'), { target: { value: 'maintenance' } })
    // Website category (owner of maintenanceMode) survives; Billing does not.
    expect(screen.getAllByRole('button', { name: /Website/ }).length).toBeGreaterThan(0)
    expect(screen.queryByRole('button', { name: /Billing/ })).not.toBeInTheDocument()
    // The matching field is shown in the detail panel.
    expect(await screen.findByText('Maintenance mode')).toBeInTheDocument()
  })

  it('editing a setting raises the save bar and Save writes the denormalized doc', async () => {
    renderPage()
    await screen.findByText('Platform settings')

    // Open the Registration category (rail + mobile chips both render in jsdom).
    fireEvent.click(screen.getAllByRole('button', { name: /Registration/ })[0])
    // Legacy registrationOpen:false normalised to "Closed".
    const closed = await screen.findAllByRole('radio', { name: 'Closed' })
    expect(closed[0]).toHaveAttribute('aria-checked', 'true')

    fireEvent.click(screen.getAllByRole('radio', { name: 'Open' })[0])
    expect(await screen.findByText(/1 unsaved change/)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /Save changes/ }))
    await waitFor(() => expect(setDocMock).toHaveBeenCalledTimes(1))
    const payload = setDocMock.mock.calls[0][1]
    // registrationMode is the new source of truth; the legacy boolean stays in sync.
    expect(payload.registrationMode).toBe('open')
    expect(payload.registrationOpen).toBe(true)
    expect(payload.updatedByEmail).toBe('admin@zedexams.com')
    expect(payload.configVersion).toEqual({ __inc: 1 })

    // Save bar clears once the write lands.
    await waitFor(() => expect(screen.queryByText(/unsaved change/)).not.toBeInTheDocument())
  })

  it('Undo reverts the staged edit without saving', async () => {
    renderPage()
    await screen.findByText('Platform settings')

    fireEvent.click(screen.getAllByRole('button', { name: /General/ })[0])
    const input = await screen.findByLabelText(/Site name/)
    fireEvent.change(input, { target: { value: 'New name' } })
    expect(await screen.findByText(/1 unsaved change/)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /Undo/ }))
    await waitFor(() => expect(screen.queryByText(/unsaved change/)).not.toBeInTheDocument())
    expect(screen.getByLabelText(/Site name/)).toHaveValue('ZedExams')
    expect(setDocMock).not.toHaveBeenCalled()
  })
})
