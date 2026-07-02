import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import ProfilePanel from './ProfilePanel'

const updateProfileFields = vi.fn(() => Promise.resolve())

vi.mock('../../../contexts/AuthContext', () => ({
  useAuth: vi.fn(() => ({
    currentUser: { uid: 'uid-1' },
    userProfile: {
      displayName: 'Mahenga Mwelwa',
      email: 'teacher@example.com',
      teacherProfile: { phone: '', bio: '', photoUrl: 'https://x/photo.jpg', photoPath: 'user-branding/uid-1/profile-photo.jpg' },
    },
    updateProfileFields,
  })),
}))

// Photo uploads hit Firebase Storage — out of scope for this panel spec.
vi.mock('../components/fields/PhotoUploadField', () => ({
  default: () => <div data-testid="photo-upload" />,
}))

function renderPanel() {
  return render(
    <MemoryRouter>
      <ProfilePanel />
    </MemoryRouter>,
  )
}

describe('ProfilePanel', () => {
  beforeEach(() => vi.clearAllMocks())

  it('renders the form seeded from the profile, with a read-only email', () => {
    renderPanel()
    expect(screen.getByLabelText(/full name/i)).toHaveValue('Mahenga Mwelwa')
    expect(screen.getByLabelText(/email/i)).toHaveValue('teacher@example.com')
    expect(screen.getByLabelText(/email/i)).toBeDisabled()
    expect(screen.getByTestId('photo-upload')).toBeInTheDocument()
  })

  it('saves the edited fields as a normalized teacherProfile map (photo preserved)', async () => {
    renderPanel()
    fireEvent.change(screen.getByLabelText(/phone/i), { target: { value: ' 097 1234567 ' } })
    fireEvent.change(screen.getByLabelText(/biography/i), { target: { value: 'Science teacher.' } })
    fireEvent.click(screen.getByRole('button', { name: /save changes/i }))

    await waitFor(() => expect(updateProfileFields).toHaveBeenCalledTimes(1))
    const payload = updateProfileFields.mock.calls[0][0]
    expect(payload.teacherProfile).toMatchObject({
      phone: '097 1234567', // trimmed by the normalizer
      bio: 'Science teacher.',
      // Photo fields saved by the uploader ride along untouched — the
      // merge-over-latest guard against map clobbering.
      photoUrl: 'https://x/photo.jpg',
      photoPath: 'user-branding/uid-1/profile-photo.jpg',
    })
    // Name unchanged → not written.
    expect(payload.displayName).toBeUndefined()
  })

  it('writes displayName when the name is edited', async () => {
    renderPanel()
    fireEvent.change(screen.getByLabelText(/full name/i), { target: { value: 'M. Mwelwa' } })
    fireEvent.click(screen.getByRole('button', { name: /save changes/i }))

    await waitFor(() => expect(updateProfileFields).toHaveBeenCalledTimes(1))
    expect(updateProfileFields.mock.calls[0][0].displayName).toBe('M. Mwelwa')
  })

  it('disables Save until something changes', () => {
    renderPanel()
    expect(screen.getByRole('button', { name: /save changes/i })).toBeDisabled()
    fireEvent.change(screen.getByLabelText(/phone/i), { target: { value: '096' } })
    expect(screen.getByRole('button', { name: /save changes/i })).toBeEnabled()
  })
})
