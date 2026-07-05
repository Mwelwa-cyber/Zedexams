/**
 * Tests for useFocusTrap — the shared modal focus-management hook.
 *
 * These lock in the three behaviours the ad-hoc modals were missing before
 * the hook existed: Escape-to-close, Tab wrapping inside the panel, and
 * focus restoration to the opener on unmount.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { useRef } from 'react'
import { render, screen, fireEvent, act } from '@testing-library/react'
import useFocusTrap from './useFocusTrap'

function Modal({ active = true, onEscape, withInitial = false }) {
  const panelRef = useRef(null)
  const initialRef = useRef(null)
  useFocusTrap(panelRef, {
    active,
    onEscape,
    initialFocusRef: withInitial ? initialRef : undefined,
  })
  return (
    <div ref={panelRef} role="dialog">
      <button type="button">first</button>
      <button type="button" ref={initialRef}>middle</button>
      <button type="button">last</button>
    </div>
  )
}

beforeEach(() => {
  vi.useFakeTimers()
})

function flushRaf() {
  // requestAnimationFrame is backed by fake timers in jsdom + vitest.
  act(() => { vi.advanceTimersByTime(20) })
}

describe('useFocusTrap', () => {
  it('moves focus to the first focusable element on open', () => {
    render(<Modal />)
    flushRaf()
    expect(screen.getByText('first')).toHaveFocus()
  })

  it('honours an explicit initialFocusRef', () => {
    render(<Modal withInitial />)
    flushRaf()
    expect(screen.getByText('middle')).toHaveFocus()
  })

  it('calls onEscape when Escape is pressed', () => {
    const onEscape = vi.fn()
    render(<Modal onEscape={onEscape} />)
    flushRaf()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onEscape).toHaveBeenCalledTimes(1)
  })

  it('does nothing on Escape when inactive', () => {
    const onEscape = vi.fn()
    render(<Modal active={false} onEscape={onEscape} />)
    flushRaf()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onEscape).not.toHaveBeenCalled()
  })

  it('wraps Tab from the last element back to the first', () => {
    render(<Modal />)
    flushRaf()
    const last = screen.getByText('last')
    last.focus()
    fireEvent.keyDown(document, { key: 'Tab' })
    expect(screen.getByText('first')).toHaveFocus()
  })

  it('wraps Shift+Tab from the first element to the last', () => {
    render(<Modal />)
    flushRaf()
    screen.getByText('first').focus()
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true })
    expect(screen.getByText('last')).toHaveFocus()
  })

  it('restores focus to the opener when the trap unmounts', () => {
    // An element outside the modal holds focus before the modal opens.
    const opener = document.createElement('button')
    opener.textContent = 'opener'
    document.body.appendChild(opener)
    opener.focus()
    expect(opener).toHaveFocus()

    const { unmount } = render(<Modal />)
    flushRaf()
    expect(screen.getByText('first')).toHaveFocus()

    unmount()
    expect(opener).toHaveFocus()
    opener.remove()
  })
})
