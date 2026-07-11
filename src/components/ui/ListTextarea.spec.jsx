import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { useState } from 'react'
import ListTextarea from './ListTextarea.jsx'

// Stateful harness so we can test the resync (external-update) paths.
function Harness({ initial = [], onEmit = () => {} }) {
  const [list, setList] = useState(initial)
  return (
    <>
      <ListTextarea
        value={list}
        onChange={(l) => { setList(l); onEmit(l) }}
        aria-label="items"
        rows={4}
      />
      <button onClick={() => setList((l) => [...l, 'appended'])}>append</button>
      <button onClick={() => setList(['replaced'])}>replace</button>
    </>
  )
}

describe('ListTextarea', () => {
  it('initialises the textarea with the value prop joined by newlines', () => {
    render(<ListTextarea value={['alpha', 'beta']} onChange={() => {}} aria-label="items" />)
    expect(screen.getByRole('textbox')).toHaveValue('alpha\nbeta')
  })

  it('typing Enter at end of text inserts a newline and the emitted list stays correct', () => {
    const onChange = vi.fn()
    render(<ListTextarea value={['hello']} onChange={onChange} aria-label="items" />)
    const ta = screen.getByRole('textbox')
    fireEvent.change(ta, { target: { value: 'hello\n' } })
    // Raw text must keep the newline — Enter must not be eaten on re-render.
    expect(ta).toHaveValue('hello\n')
    // Emitted list is still ['hello'] (trailing empty line filtered out).
    expect(onChange).toHaveBeenLastCalledWith(['hello'])
  })

  it('a trailing space survives in the textarea while typing', () => {
    const onChange = vi.fn()
    render(<ListTextarea value={['hello']} onChange={onChange} aria-label="items" />)
    const ta = screen.getByRole('textbox')
    fireEvent.change(ta, { target: { value: 'hello ' } })
    expect(ta).toHaveValue('hello ')
    // Emitted list is trimmed.
    expect(onChange).toHaveBeenLastCalledWith(['hello'])
  })

  it('an externally appended item (value prop grows while not focused) appears in the textarea', () => {
    render(<Harness initial={['first']} />)
    const ta = screen.getByRole('textbox')
    expect(ta).toHaveValue('first')
    fireEvent.click(screen.getByRole('button', { name: 'append' }))
    expect(ta).toHaveValue('first\nappended')
  })

  it('an externally appended item appears in the textarea while focused', () => {
    render(<Harness initial={['first']} />)
    const ta = screen.getByRole('textbox')
    fireEvent.focus(ta)
    // External mutation while textarea is focused — must still resync.
    fireEvent.click(screen.getByRole('button', { name: 'append' }))
    expect(ta).toHaveValue('first\nappended')
  })

  it('parsed list emitted on change matches split/trim/filter semantics', () => {
    const onChange = vi.fn()
    render(<ListTextarea value={[]} onChange={onChange} aria-label="items" />)
    fireEvent.change(screen.getByRole('textbox'), {
      target: { value: '  alpha  \n\n  beta  \n  \ngamma\n' },
    })
    expect(onChange).toHaveBeenLastCalledWith(['alpha', 'beta', 'gamma'])
  })

  it('does not overwrite raw text when the parent echoes back the same list after a keystroke', () => {
    render(<Harness initial={[]} />)
    const ta = screen.getByRole('textbox')
    // Simulate pressing Enter — produces 'hello\n'; parent gets ['hello'], re-renders
    // with value=['hello'] — the trailing newline must survive.
    fireEvent.change(ta, { target: { value: 'hello\n' } })
    expect(ta).toHaveValue('hello\n')
    // Continue typing on line 2.
    fireEvent.change(ta, { target: { value: 'hello\nworld' } })
    expect(ta).toHaveValue('hello\nworld')
  })

  it('an external wholesale replacement (e.g. AI generation) updates the textarea', () => {
    render(<Harness initial={['old']} />)
    fireEvent.click(screen.getByRole('button', { name: 'replace' }))
    expect(screen.getByRole('textbox')).toHaveValue('replaced')
  })

  it('renders an empty textarea when value is an empty array', () => {
    render(<ListTextarea value={[]} onChange={() => {}} aria-label="items" />)
    expect(screen.getByRole('textbox')).toHaveValue('')
  })

  it('forwards extra props (placeholder, rows, className) to the textarea', () => {
    render(
      <ListTextarea
        value={[]}
        onChange={() => {}}
        aria-label="items"
        placeholder="one per line"
        rows={6}
        className="my-class"
      />,
    )
    const ta = screen.getByRole('textbox')
    expect(ta).toHaveAttribute('placeholder', 'one per line')
    expect(ta).toHaveAttribute('rows', '6')
    expect(ta).toHaveClass('my-class')
  })
})
