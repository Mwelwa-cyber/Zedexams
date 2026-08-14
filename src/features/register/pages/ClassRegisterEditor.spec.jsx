/**
 * ClassRegisterEditor — Class Management → Edit Class.
 *
 * Two things are pinned here.
 *
 * [Bug fix #2] A null getRegister result or a rejected promise used to leave
 * loading=false with pristine form defaults, so saving overwrote the real
 * class fields. Both paths now render a role="alert" card and never the form.
 *
 * [The class/subject/term split] A class is an academic group that runs for
 * the whole year. Subject and Term must NOT be editable here — a subject on
 * the class is what produced a separate learner list per subject — and a class
 * that already carries one must have it written back untouched rather than
 * silently dropped by an edit.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import ClassRegisterEditor from './ClassRegisterEditor'

// Mock react-router-dom — component uses useParams, useNavigate.
vi.mock('react-router-dom', () => ({
  useParams: vi.fn(() => ({ classId: 'c-edit' })),
  useNavigate: () => vi.fn(),
}))

// Mock the register service — the only async dependency we care about here.
const getRegisterMock = vi.fn()
const updateRegisterMock = vi.fn(() => Promise.resolve())
vi.mock('../../../utils/classRegister', () => ({
  getRegister: (...args) => getRegisterMock(...args),
  createRegister: vi.fn(),
  updateRegister: (...args) => updateRegisterMock(...args),
}))

// The editor seeds a NEW class from the teacher's school profile; that module
// pulls in the Firebase client, which has no config under test.
vi.mock('../../../utils/schoolProfileService', () => ({
  getSchoolProfile: vi.fn(() => Promise.resolve(null)),
}))

vi.mock('../../../contexts/AuthContext', () => ({
  useAuth: () => ({ currentUser: { uid: 'teacher-1' }, userProfile: { displayName: 'Mahenga Mwelwa' } }),
}))

vi.mock('../../../shared/components/Toast', () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }),
}))

vi.mock('../../../shared/components/SeoHelmet', () => ({ default: () => null }))

const LOADED = {
  id: 'c-edit',
  className: 'Grade 5 Red',
  grade: '5',
  stream: 'Red',
  term: 'Term 2',
  year: 2026,
  subject: 'Mathematics',
  curriculum: 'cbc',
  school: 'Test School',
  classTeacherName: 'Mahenga Mwelwa',
  status: 'active',
}

describe('ClassRegisterEditor — edit-mode load failure', () => {
  beforeEach(() => vi.clearAllMocks())

  it('renders the form (not an error card) when the register loads successfully', async () => {
    getRegisterMock.mockResolvedValueOnce(LOADED)
    render(<ClassRegisterEditor />)
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Edit Class' })).toBeInTheDocument())
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('shows a not-found error card (not the form) when getRegister returns null', async () => {
    getRegisterMock.mockResolvedValueOnce(null)
    render(<ClassRegisterEditor />)
    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument())
    expect(screen.getByText(/This class could not be found/i)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Save changes/i })).not.toBeInTheDocument()
  })

  it('shows a load-failure error card (not the form) when getRegister rejects', async () => {
    getRegisterMock.mockRejectedValueOnce(new Error('permission-denied'))
    render(<ClassRegisterEditor />)
    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument())
    expect(screen.getByText(/refresh and try again/i)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Save changes/i })).not.toBeInTheDocument()
  })
})

describe('ClassRegisterEditor — a class is not a subject and not a term', () => {
  beforeEach(() => vi.clearAllMocks())

  it('offers only the fields that identify a class', async () => {
    getRegisterMock.mockResolvedValueOnce(LOADED)
    render(<ClassRegisterEditor />)
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Edit Class' })).toBeInTheDocument())

    for (const label of [
      /^Class name$/i, /^Curriculum$/i, /^Grade \/ Form$/i, /^Class \/ Stream$/i,
      /^Academic year$/i, /^Class teacher$/i, /^School$/i, /^Status$/i,
    ]) {
      expect(screen.getByLabelText(label)).toBeInTheDocument()
    }
  })

  it('has no Subject and no Term field', async () => {
    getRegisterMock.mockResolvedValueOnce(LOADED)
    render(<ClassRegisterEditor />)
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Edit Class' })).toBeInTheDocument())

    expect(screen.queryByLabelText(/^Subject$/i)).not.toBeInTheDocument()
    expect(screen.queryByLabelText(/^Term$/i)).not.toBeInTheDocument()
  })

  it('is headed Class Management, not Class Register', async () => {
    getRegisterMock.mockResolvedValueOnce(LOADED)
    render(<ClassRegisterEditor />)
    await waitFor(() => expect(screen.getByText('Class Management')).toBeInTheDocument())
  })

  it('tells the teacher when a class still carries the older settings', async () => {
    getRegisterMock.mockResolvedValueOnce(LOADED)
    render(<ClassRegisterEditor />)
    await waitFor(() => expect(screen.getByText(/still carries older settings/i)).toBeInTheDocument())
    expect(screen.getByText(/Nothing is lost/i)).toBeInTheDocument()
  })

  it('writes a legacy subject and term back untouched instead of dropping them', async () => {
    getRegisterMock.mockResolvedValueOnce(LOADED)
    render(<ClassRegisterEditor />)
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Edit Class' })).toBeInTheDocument())

    await userEvent.click(screen.getByRole('button', { name: /Save changes/i }))

    await waitFor(() => expect(updateRegisterMock).toHaveBeenCalled())
    const [, fields] = updateRegisterMock.mock.calls[0]
    expect(fields.subject).toBe('Mathematics')
    expect(fields.term).toBe('Term 2')
    expect(fields.stream).toBe('Red')
    expect(fields.grade).toBe('5')
  })

  it('shows no legacy notice for a class that never had a subject or term', async () => {
    getRegisterMock.mockResolvedValueOnce({ ...LOADED, subject: null, term: '' })
    render(<ClassRegisterEditor />)
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Edit Class' })).toBeInTheDocument())
    expect(screen.queryByText(/still carries older settings/i)).not.toBeInTheDocument()
  })
})
