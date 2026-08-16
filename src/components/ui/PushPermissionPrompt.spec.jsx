/**
 * Tests for the push opt-in card: audience variants, the relaxed learner gate,
 * and honest accept feedback (success only when a token actually mints, mirroring
 * the settings panels / requestPushPermission's 'error' contract).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import PushPermissionPrompt from './PushPermissionPrompt'

const h = vi.hoisted(() => ({
  isPushSupported: vi.fn(() => true),
  pushPermission: vi.fn(() => 'default'),
  requestPushPermission: vi.fn(async () => 'granted'),
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
  currentUser: { uid: 'u1' },
}))

vi.mock('../../contexts/AuthContext', () => ({ useAuth: () => ({ currentUser: h.currentUser }) }))
vi.mock('../../shared/components/Toast', () => ({ useToast: () => h.toast }))
vi.mock('../../services/notifications/fcm', () => ({
  isPushSupported: () => h.isPushSupported(),
  pushPermission: () => h.pushPermission(),
  requestPushPermission: (...args) => h.requestPushPermission(...args),
}))

describe('PushPermissionPrompt', () => {
  beforeEach(() => {
    h.isPushSupported.mockReturnValue(true)
    h.pushPermission.mockReturnValue('default')
    h.requestPushPermission.mockReset().mockResolvedValue('granted')
    h.toast.success.mockReset()
    h.toast.error.mockReset()
    h.currentUser = { uid: 'u1' }
    try { localStorage.clear() } catch { /* jsdom */ }
  })

  it('shows the teacher opt-in with teacher copy', async () => {
    render(<PushPermissionPrompt variant="teacher" />)
    expect(await screen.findByText('Get notified on this device')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Enable notifications' })).toBeInTheDocument()
  })

  it('hides the learner prompt below a 1-day streak', async () => {
    const { container } = render(<PushPermissionPrompt variant="learner" streak={0} />)
    await waitFor(() => expect(container.firstChild).toBeNull())
  })

  it('shows the learner prompt at streak ≥ 1 (newer learners get asked)', async () => {
    render(<PushPermissionPrompt variant="learner" streak={1} />)
    expect(await screen.findByText('Want a friendly daily nudge?')).toBeInTheDocument()
  })

  it('hides when permission was already decided', async () => {
    h.pushPermission.mockReturnValue('granted')
    const { container } = render(<PushPermissionPrompt variant="teacher" />)
    await waitFor(() => expect(container.firstChild).toBeNull())
  })

  it('hides when push is unsupported', async () => {
    h.isPushSupported.mockReturnValue(false)
    const { container } = render(<PushPermissionPrompt variant="teacher" />)
    await waitFor(() => expect(container.firstChild).toBeNull())
  })

  it('reports success only when a token mints (granted)', async () => {
    h.requestPushPermission.mockResolvedValue('granted')
    render(<PushPermissionPrompt variant="teacher" />)
    fireEvent.click(await screen.findByRole('button', { name: 'Enable notifications' }))
    await waitFor(() => expect(h.toast.success).toHaveBeenCalledTimes(1))
    expect(h.toast.error).not.toHaveBeenCalled()
  })

  it('reports an honest failure when no token mints (error)', async () => {
    h.requestPushPermission.mockResolvedValue('error')
    render(<PushPermissionPrompt variant="teacher" />)
    fireEvent.click(await screen.findByRole('button', { name: 'Enable notifications' }))
    await waitFor(() => expect(h.toast.error).toHaveBeenCalledTimes(1))
    expect(h.toast.success).not.toHaveBeenCalled()
  })

  it('dismisses without asking and stays hidden on remount (per-variant seen flag)', async () => {
    const { container, rerender } = render(<PushPermissionPrompt variant="teacher" />)
    fireEvent.click(await screen.findByRole('button', { name: 'Not now' }))
    await waitFor(() => expect(container.firstChild).toBeNull())
    expect(h.requestPushPermission).not.toHaveBeenCalled()

    rerender(<PushPermissionPrompt variant="teacher" />)
    await waitFor(() => expect(container.firstChild).toBeNull())
  })
})
