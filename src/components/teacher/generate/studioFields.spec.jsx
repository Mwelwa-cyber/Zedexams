import { describe, it, expect, vi } from 'vitest'
import { useState } from 'react'
import { render, screen, fireEvent } from '@testing-library/react'

import { FieldNumberCombo } from './studioFields'

// A small controlled wrapper so the combobox behaves like it does in a studio
// (parent owns the value, mirrors it back in via the `value` prop).
function Harness({ onChange, min = 5, max = 100, initial = 20 }) {
  const [value, setValue] = useState(initial)
  return (
    <FieldNumberCombo
      label="Total marks"
      value={value}
      min={min}
      max={max}
      options={[10, 20, 50].map((n) => ({ value: n, label: `${n} marks` }))}
      onChange={(v) => { setValue(v); onChange(v) }}
    />
  )
}

describe('FieldNumberCombo', () => {
  it('lets a teacher type a custom value the preset list does not offer', () => {
    const onChange = vi.fn()
    render(<Harness onChange={onChange} />)
    const input = screen.getByRole('spinbutton')
    fireEvent.change(input, { target: { value: '75' } })
    expect(onChange).toHaveBeenLastCalledWith(75)
  })

  it('does not prematurely clamp a partial entry on the way to a bigger number', () => {
    const onChange = vi.fn()
    render(<Harness onChange={onChange} min={5} max={100} />)
    const input = screen.getByRole('spinbutton')
    // Typing "100" arrives one digit at a time; "1" must not snap up to min(5)
    // and block the rest, and the field keeps showing what was typed.
    fireEvent.change(input, { target: { value: '1' } })
    fireEvent.change(input, { target: { value: '10' } })
    fireEvent.change(input, { target: { value: '100' } })
    expect(input.value).toBe('100')
    expect(onChange).toHaveBeenLastCalledWith(100)
  })

  it('clamps an out-of-range value into [min, max] on blur', () => {
    const onChange = vi.fn()
    render(<Harness onChange={onChange} min={5} max={100} />)
    const input = screen.getByRole('spinbutton')
    fireEvent.change(input, { target: { value: '250' } })
    fireEvent.blur(input)
    expect(input.value).toBe('100')
    expect(onChange).toHaveBeenLastCalledWith(100)
  })

  it('falls back to min when the field is left empty', () => {
    const onChange = vi.fn()
    render(<Harness onChange={onChange} min={5} />)
    const input = screen.getByRole('spinbutton')
    fireEvent.change(input, { target: { value: '' } })
    fireEvent.blur(input)
    expect(input.value).toBe('5')
    expect(onChange).toHaveBeenLastCalledWith(5)
  })
})
