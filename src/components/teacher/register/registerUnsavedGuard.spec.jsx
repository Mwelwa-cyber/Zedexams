/**
 * The unsaved-marks guard that lifts MarkEntryGrid's dirty flag to the Class
 * Register shell so tab links / Back / Edit / Archive confirm before an SPA
 * navigation discards typed-but-unsaved marks (BUG_REPORT P3).
 *
 * The Host below mimics ClassRegisterDetail: a guarded "leave" control beside a
 * provider-wrapped child that publishes a dirty flag via useMarkUnsaved.
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import {
  useRegisterUnsavedGuard,
  RegisterUnsavedGuardProvider,
  useMarkUnsaved,
} from './registerUnsavedGuard'

function DirtyChild({ dirty }) {
  useMarkUnsaved(dirty)
  return <div>child</div>
}

function Host({ mounted = true, dirty = false, onNavigate, confirmFn }) {
  const guard = useRegisterUnsavedGuard(confirmFn)
  return (
    <>
      <button type="button" onClick={() => { if (guard.confirmDiscardIfDirty()) onNavigate() }}>
        leave
      </button>
      <RegisterUnsavedGuardProvider value={guard.contextValue}>
        {mounted && <DirtyChild dirty={dirty} />}
      </RegisterUnsavedGuardProvider>
    </>
  )
}

describe('registerUnsavedGuard', () => {
  it('navigates without prompting when nothing is dirty', () => {
    const onNavigate = vi.fn()
    const confirmFn = vi.fn(() => true)
    render(<Host dirty={false} onNavigate={onNavigate} confirmFn={confirmFn} />)
    fireEvent.click(screen.getByText('leave'))
    expect(confirmFn).not.toHaveBeenCalled()
    expect(onNavigate).toHaveBeenCalledTimes(1)
  })

  it('blocks navigation when a child is dirty and the user declines', () => {
    const onNavigate = vi.fn()
    const confirmFn = vi.fn(() => false)
    render(<Host dirty onNavigate={onNavigate} confirmFn={confirmFn} />)
    fireEvent.click(screen.getByText('leave'))
    expect(confirmFn).toHaveBeenCalledTimes(1)
    expect(onNavigate).not.toHaveBeenCalled()
  })

  it('allows navigation when a child is dirty and the user confirms', () => {
    const onNavigate = vi.fn()
    const confirmFn = vi.fn(() => true)
    render(<Host dirty onNavigate={onNavigate} confirmFn={confirmFn} />)
    fireEvent.click(screen.getByText('leave'))
    expect(confirmFn).toHaveBeenCalledTimes(1)
    expect(onNavigate).toHaveBeenCalledTimes(1)
  })

  it('stays armed after a confirm whose caller does NOT unmount the grid', () => {
    // Archive opens a second dialog, a cmd-click opens a new tab, clicking the
    // active tab re-renders in place — the user confirmed once but the grid is
    // still mounted and dirty. The guard must prompt AGAIN on the next attempt,
    // not silently discard because the flag was cleared on the first answer.
    const onNavigate = vi.fn()
    const confirmFn = vi.fn(() => true)
    render(<Host mounted dirty onNavigate={onNavigate} confirmFn={confirmFn} />)
    fireEvent.click(screen.getByText('leave'))
    fireEvent.click(screen.getByText('leave'))
    // Both attempts prompted — the grid never unmounted, so the guard stayed armed.
    expect(confirmFn).toHaveBeenCalledTimes(2)
    expect(onNavigate).toHaveBeenCalledTimes(2)
  })

  it('clears the flag when the dirty child unmounts (no stale prompt afterwards)', () => {
    const onNavigate = vi.fn()
    const confirmFn = vi.fn(() => false)
    const { rerender } = render(<Host mounted dirty onNavigate={onNavigate} confirmFn={confirmFn} />)
    // The dirty child leaves the tree (e.g. the tab switched some other way);
    // its cleanup must reset the flag so a later navigation is not blocked.
    rerender(<Host mounted={false} onNavigate={onNavigate} confirmFn={confirmFn} />)
    fireEvent.click(screen.getByText('leave'))
    expect(confirmFn).not.toHaveBeenCalled()
    expect(onNavigate).toHaveBeenCalledTimes(1)
  })

  it('fails safe (blocks) when the flag is dirty but no confirm function exists', () => {
    // Render the hook directly so we can drive it without window.confirm.
    let guardRef
    function Probe() {
      guardRef = useRegisterUnsavedGuard(null)
      return <RegisterUnsavedGuardProvider value={guardRef.contextValue}><DirtyChild dirty /></RegisterUnsavedGuardProvider>
    }
    const realConfirm = window.confirm
    // Simulate a non-browser / stripped environment.
    delete window.confirm
    try {
      render(<Probe />)
      expect(guardRef.confirmDiscardIfDirty()).toBe(false)
    } finally {
      window.confirm = realConfirm
    }
  })
})
