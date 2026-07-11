/**
 * ClassRegisterEditor — regression tests for the edit-mode load-failure bug.
 *
 * [Bug fix #2] A null getRegister result or a rejected promise previously
 * left loading=false with pristine form defaults, so saving would overwrite
 * the real class fields. Now both paths render a role="alert" error card and
 * never show the form.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'

import ClassRegisterEditor from './ClassRegisterEditor'

// Mock react-router-dom — component uses useParams, useNavigate.
vi.mock('react-router-dom', () => ({
  useParams: vi.fn(() => ({ classId: 'c-edit' })),
  useNavigate: () => vi.fn(),
}))

// Mock the register service — the only async dependency we care about here.
const getRegisterMock = vi.fn()
vi.mock('../../../utils/classRegister', () => ({
  getRegister: (...args) => getRegisterMock(...args),
  createRegister: vi.fn(),
  updateRegister: vi.fn(),
}))

vi.mock('../../../contexts/AuthContext', () => ({
  useAuth: () => ({ currentUser: { uid: 'teacher-1' } }),
}))

vi.mock('../../ui/Toast', () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn() }),
}))

// Stub the heavy curriculum selector — not under test here.
vi.mock('../curriculum/StudioCurriculumSelector', () => ({
  default: () => null,
}))

vi.mock('../../seo/SeoHelmet', () => ({ default: () => null }))

describe('ClassRegisterEditor — edit-mode load failure', () => {
  beforeEach(() => vi.clearAllMocks())

  it('renders the form (not an error card) when the register loads successfully', async () => {
    getRegisterMock.mockResolvedValueOnce({
      id: 'c-edit',
      className: 'Grade 5 Red',
      grade: '5',
      term: 'Term 2',
      year: 2026,
      subject: 'Mathematics',
      curriculum: 'cbc',
      school: 'Test School',
    })
    render(<ClassRegisterEditor />)
    // Wait for loading to finish — the form heading should appear.
    await waitFor(() => expect(screen.getByText('Edit class')).toBeInTheDocument())
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('shows a not-found error card (not the form) when getRegister returns null', async () => {
    getRegisterMock.mockResolvedValueOnce(null)
    render(<ClassRegisterEditor />)
    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument())
    expect(screen.getByText(/This class could not be found/i)).toBeInTheDocument()
    // The form must not be rendered — no Save button visible.
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
