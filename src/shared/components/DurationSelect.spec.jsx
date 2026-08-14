import { describe, it, expect, vi } from 'vitest'
import { useState } from 'react'
import { render, screen, fireEvent, within } from '@testing-library/react'

import DurationSelect from './DurationSelect'
import { DURATION_PRESETS } from '../../utils/durationOptions'

// Controlled wrapper mirroring how a studio owns the value. `extra` is an
// unrelated piece of state whose button forces a re-render — used to prove a
// custom value survives an unrelated timetable-setting change.
function Harness({ onChange = () => {}, initial = 20, min = 1, max = 180 }) {
  const [value, setValue] = useState(initial)
  const [ticks, setTicks] = useState(0)
  return (
    <>
      <button type="button" onClick={() => setTicks((t) => t + 1)}>bump {ticks}</button>
      <DurationSelect
        label="Assembly duration"
        value={value}
        min={min}
        max={max}
        onChange={(v) => { setValue(v); onChange(v) }}
      />
    </>
  )
}

describe('DurationSelect', () => {
  it('connects the label to the dropdown', () => {
    render(<Harness />)
    const select = screen.getByLabelText('Assembly duration')
    expect(select.tagName).toBe('SELECT')
  })

  it('offers every preset plus a Custom duration option', () => {
    render(<Harness />)
    const select = screen.getByLabelText('Assembly duration')
    const options = within(select).getAllByRole('option').map((o) => o.textContent)
    for (const m of DURATION_PRESETS) expect(options).toContain(`${m} minutes`)
    expect(options).toContain('Custom duration')
  })

  it('calls onChange with the integer minutes for every preset selected', () => {
    const onChange = vi.fn()
    render(<Harness onChange={onChange} />)
    const select = screen.getByLabelText('Assembly duration')
    for (const m of DURATION_PRESETS) {
      fireEvent.change(select, { target: { value: String(m) } })
      expect(onChange).toHaveBeenLastCalledWith(m)
    }
  })

  it('does not show a numeric input in preset mode (no mobile keyboard until Custom)', () => {
    render(<Harness initial={20} />)
    expect(screen.queryByRole('spinbutton')).toBeNull()
  })

  it('reveals a numeric input and saves a custom value', () => {
    const onChange = vi.fn()
    render(<Harness onChange={onChange} initial={20} />)
    const select = screen.getByLabelText('Assembly duration')
    fireEvent.change(select, { target: { value: 'custom' } })
    const input = screen.getByRole('spinbutton')
    expect(input).toBeInTheDocument()
    expect(input).toHaveAttribute('inputmode', 'numeric')
    // 33 is deliberately NOT a preset, so its "33 minutes" summary is unique.
    fireEvent.change(input, { target: { value: '33' } })
    expect(onChange).toHaveBeenLastCalledWith(33)
    // Displays the selected value as "33 minutes".
    expect(screen.getByText('33 minutes')).toBeInTheDocument()
  })

  it('rejects zero, negative and non-numeric custom entries and announces the error', () => {
    const onChange = vi.fn()
    render(<Harness onChange={onChange} initial={20} />)
    fireEvent.change(screen.getByLabelText('Assembly duration'), { target: { value: 'custom' } })
    const input = screen.getByRole('spinbutton')

    for (const bad of ['0', '-5', 'abc']) {
      onChange.mockClear()
      fireEvent.change(input, { target: { value: bad } })
      // An error is announced (role=alert), and no invalid value propagates.
      expect(screen.getByRole('alert')).toBeInTheDocument()
      expect(onChange).not.toHaveBeenCalled()
    }
  })

  it('rejects a custom value above the maximum', () => {
    const onChange = vi.fn()
    render(<Harness onChange={onChange} initial={20} max={180} />)
    fireEvent.change(screen.getByLabelText('Assembly duration'), { target: { value: 'custom' } })
    const input = screen.getByRole('spinbutton')
    fireEvent.change(input, { target: { value: '181' } })
    expect(screen.getByRole('alert')).toBeInTheDocument()
    expect(onChange).not.toHaveBeenCalledWith(181)
  })

  it('shows Custom automatically for a non-preset value (e.g. a loaded 33)', () => {
    render(<Harness initial={33} />)
    const select = screen.getByLabelText('Assembly duration')
    expect(select).toHaveValue('custom')
    expect(screen.getByRole('spinbutton')).toHaveValue(33)
  })

  it('preserves a custom value across an unrelated re-render', () => {
    render(<Harness initial={33} />)
    expect(screen.getByRole('spinbutton')).toHaveValue(33)
    // Simulate the teacher changing an unrelated timetable setting.
    fireEvent.click(screen.getByText(/^bump/))
    // The custom input and value survive.
    expect(screen.getByLabelText('Assembly duration')).toHaveValue('custom')
    expect(screen.getByRole('spinbutton')).toHaveValue(33)
  })
})
