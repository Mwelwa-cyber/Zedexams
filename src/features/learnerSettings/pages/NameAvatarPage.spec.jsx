/**
 * Name & avatar — the promises this screen makes.
 *
 * The one that matters most is the negative: this page holds a live preview,
 * a picture and two name fields, and NOTHING ELSE. It replaced a screen that
 * also carried invoices, payment history, a plan, an email, a school, a class,
 * a grade, a date of birth, a gender and an irreversible delete button — which
 * is how a child looking to change their nickname ended up somewhere they
 * could delete their account. A test that no currency and no delete control is
 * on this page is what stops that being reassembled.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

vi.mock('../../../firebase/config', () => ({ default: {}, auth: {}, db: {} }))

let profile
let updateProfileFields
vi.mock('../../../contexts/AuthContext', () => ({
  useAuth: () => ({
    currentUser: { uid: 'u1', email: 'lydia@example.com' },
    userProfile: profile,
    updateProfileFields,
  }),
}))

vi.mock('../../../hooks/useLearnerStats', () => ({
  default: () => ({ stats: { currentStreak: 12 }, level: 3 }),
}))

vi.mock('../../../shared/components/SeoHelmet', () => ({ default: () => null }))

import NameAvatarPage from './NameAvatarPage'

const renderPage = () => render(
  <MemoryRouter><NameAvatarPage /></MemoryRouter>,
)

beforeEach(() => {
  profile = {
    uid: 'u1',
    role: 'learner',
    grade: 7,
    displayName: 'Lydia Banda',
    preferredName: 'Lydia',
    avatarCharacter: 'questioner',
    avatarPhotoUrl: '',
  }
  updateProfileFields = vi.fn().mockResolvedValue(undefined)
})

describe('NameAvatarPage', () => {
  it('shows the live preview with the preferred name, grade and streak', () => {
    renderPage()
    const preview = screen.getByTestId('name-avatar-preview')
    expect(preview.textContent).toContain("This is how you'll appear")
    expect(preview.textContent).toContain('Lydia')
    expect(preview.textContent).toContain('Grade 7')
    expect(preview.textContent).toContain('12 day streak')
  })

  it('updates the preview as the child types', () => {
    renderPage()
    fireEvent.change(screen.getByLabelText(/What should we call you/i), {
      target: { value: 'Lydie' },
    })
    expect(screen.getByTestId('name-avatar-preview').textContent).toContain('Lydie')
  })

  it('shows the FIRST name in the preview when no preferred name is set, never the surname', () => {
    profile = { ...profile, preferredName: '' }
    renderPage()
    const preview = screen.getByTestId('name-avatar-preview')
    expect(preview.textContent).toContain('Lydia')
    expect(preview.textContent).not.toContain('Banda')
  })

  it('has exactly two name fields and nothing else that collects', () => {
    renderPage()
    const inputs = [...document.querySelectorAll('input')]
      .filter((i) => i.type !== 'file')
    expect(inputs).toHaveLength(2)
    expect(screen.getByLabelText(/What should we call you/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/Full name/i)).toBeInTheDocument()
  })

  it('carries no price, no billing and no delete control', () => {
    const { container } = renderPage()
    expect(container.textContent).not.toMatch(/K\s?\d/)
    expect(container.textContent).not.toMatch(/invoice|payment history|subscription/i)
    expect(container.textContent).not.toMatch(/delete/i)
  })

  it('groups avatars by grade and opens on the learner\'s own group', () => {
    renderPage()
    expect(screen.getByRole('tab', { name: 'Junior Scholars' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tab', { name: 'Exam Candidates' })).toHaveAttribute('aria-selected', 'false')
    // A Grade 7 sees the junior set first — but the senior tab is right there.
    expect(screen.getByRole('button', { name: /Bookworm/ })).toBeInTheDocument()
  })

  it('opens a Grade 11 on Exam Candidates instead', () => {
    profile = { ...profile, grade: 11 }
    renderPage()
    expect(screen.getByRole('tab', { name: 'Exam Candidates' })).toHaveAttribute('aria-selected', 'true')
  })

  it('names every avatar — never a number', () => {
    renderPage()
    const tiles = screen.getAllByRole('button').filter((b) => b.className.includes('lhx-av-tile'))
    expect(tiles.length).toBeGreaterThan(0)
    for (const tile of tiles) {
      expect(tile.textContent.trim().length).toBeGreaterThan(2)
      expect(tile.textContent.trim()).not.toMatch(/^\d/)
    }
  })

  it('save is inert until something changes, then writes only what changed', async () => {
    renderPage()
    const saveBtn = screen.getByRole('button', { name: /Save changes/i })
    expect(saveBtn).toBeDisabled()

    fireEvent.change(screen.getByLabelText(/What should we call you/i), {
      target: { value: 'Lydie' },
    })
    expect(saveBtn).toBeEnabled()

    fireEvent.click(saveBtn)
    expect(updateProfileFields).toHaveBeenCalledWith({ preferredName: 'Lydie' })
  })

  it('goes back to inert when the child undoes their edit', () => {
    renderPage()
    const field = screen.getByLabelText(/What should we call you/i)
    const saveBtn = screen.getByRole('button', { name: /Save changes/i })

    fireEvent.change(field, { target: { value: 'Lydiaa' } })
    expect(saveBtn).toBeEnabled()
    fireEvent.change(field, { target: { value: 'Lydia' } })
    expect(saveBtn).toBeDisabled()
  })

  it('never says "Saved" before anything has been saved', () => {
    renderPage()
    expect(screen.queryByRole('button', { name: /^Saved$/ })).toBeNull()
  })

  it('picking a character makes the form dirty and selects that tile', () => {
    renderPage()
    fireEvent.click(screen.getByRole('button', { name: /Bookworm/ }))
    expect(screen.getByRole('button', { name: /Save changes/i })).toBeEnabled()
    fireEvent.click(screen.getByRole('button', { name: /Save changes/i }))
    expect(updateProfileFields).toHaveBeenCalledWith(
      expect.objectContaining({ avatarCharacter: 'bookworm' }),
    )
  })

  it('refuses to save an empty full name, and says why', () => {
    renderPage()
    fireEvent.change(screen.getByLabelText(/Full name/i), { target: { value: '   ' } })
    expect(screen.getByRole('button', { name: /Save changes/i })).toBeDisabled()
    expect(screen.getByRole('alert').textContent).toMatch(/full name/i)
    expect(updateProfileFields).not.toHaveBeenCalled()
  })

  it('still renders a legacy avatar id rather than an empty circle', () => {
    // `ruby` is from the retired sprite sheet and is on live profiles.
    profile = { ...profile, avatarCharacter: 'ruby' }
    renderPage()
    const imgs = [...document.querySelectorAll('img')]
      .filter((i) => i.getAttribute('src')?.includes('/images/avatars/'))
    expect(imgs.length).toBeGreaterThan(0)
  })
})
