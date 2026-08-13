/**
 * The focus watcher behind the Paper Header's deferred collapse.
 *
 * The case that matters is the one a naive implementation gets wrong: moving
 * between two fields INSIDE the watched element. At the moment `focusout`
 * fires, focus has left the old field and not yet reached the new one, so
 * `document.activeElement` is `<body>` — reading it there reports "focus left"
 * for a split second, which is precisely when the deferred collapse fires and
 * eats the next keystroke. Reading `relatedTarget` instead is what makes the
 * move invisible.
 */
import { describe, it, expect } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import { useRef } from 'react'
import useFocusWithin from './useFocusWithin'

function Harness() {
  const inside = useFocusWithin('[data-watched]')
  const ref = useRef(null)
  return (
    <div>
      <span data-testid="state">{inside ? 'inside' : 'outside'}</span>
      <div data-watched>
        <input aria-label="first" ref={ref} />
        <input aria-label="second" />
      </div>
      <input aria-label="elsewhere" />
    </div>
  )
}

const state = () => screen.getByTestId('state').textContent
const field = (name) => screen.getByLabelText(name)

describe('useFocusWithin', () => {
  it('starts outside when nothing is focused', () => {
    render(<Harness />)
    expect(state()).toBe('outside')
  })

  it('reports inside once a field within the element takes focus', () => {
    render(<Harness />)
    act(() => field('first').focus())
    expect(state()).toBe('inside')
  })

  it('STAYS inside while focus moves between two fields in the element', () => {
    // The regression this file exists for: a real browser fires focusout on the
    // first field before focusin on the second. If the intervening frame reads
    // as "outside", a deferred collapse fires between two keystrokes.
    render(<Harness />)
    act(() => field('first').focus())
    expect(state()).toBe('inside')
    fireEvent.focusOut(field('first'), { relatedTarget: field('second') })
    expect(state()).toBe('inside')
    act(() => field('second').focus())
    expect(state()).toBe('inside')
  })

  it('reports outside when focus genuinely leaves', () => {
    render(<Harness />)
    act(() => field('first').focus())
    act(() => field('elsewhere').focus())
    expect(state()).toBe('outside')
  })

  it('reports outside when focus leaves the document entirely', () => {
    // relatedTarget is null when focus goes to browser chrome. That is not
    // inside, and treating null as "unknown, assume inside" would defer the
    // collapse forever.
    render(<Harness />)
    act(() => field('first').focus())
    fireEvent.focusOut(field('first'), { relatedTarget: null })
    expect(state()).toBe('outside')
  })

  it('seeds from the live focus when it mounts around an already-focused field', () => {
    // The header form re-renders while the teacher is typing in it; a hook that
    // assumed "outside" until the next event would report wrong for the whole
    // window in which the collapse can fire.
    const { unmount } = render(<Harness />)
    act(() => field('first').focus())
    expect(state()).toBe('inside')
    unmount()
    render(<Harness />)
    // A fresh mount with focus already on body reads outside — the seed is a
    // live read, not a remembered value.
    expect(state()).toBe('outside')
  })
})
