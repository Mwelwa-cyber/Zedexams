import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import AttendanceStatusPicker from './AttendanceStatusPicker'

describe('AttendanceStatusPicker', () => {
  it('renders all six statuses with their symbols', () => {
    render(<AttendanceStatusPicker value={null} onChange={() => {}} />)
    for (const label of ['Present', 'Absent', 'Sick', 'Late', 'Excused', 'Not applicable']) {
      expect(screen.getByRole('radio', { name: label })).toBeInTheDocument()
    }
    expect(screen.getByRole('radio', { name: 'Present' })).toHaveTextContent('P')
    expect(screen.getByRole('radio', { name: 'Not applicable' })).toHaveTextContent('–')
  })

  it('fires onChange for a new status but not for the active one', () => {
    const onChange = vi.fn()
    render(<AttendanceStatusPicker value="present" onChange={onChange} />)
    expect(screen.getByRole('radio', { name: 'Present' })).toBeChecked()
    fireEvent.click(screen.getByRole('radio', { name: 'Sick' }))
    expect(onChange).toHaveBeenCalledWith('sick')
    onChange.mockClear()
    fireEvent.click(screen.getByRole('radio', { name: 'Present' }))
    expect(onChange).not.toHaveBeenCalled()
  })

  it('blocks changes when disabled', () => {
    const onChange = vi.fn()
    render(<AttendanceStatusPicker value="present" onChange={onChange} disabled />)
    fireEvent.click(screen.getByRole('radio', { name: 'Absent' }))
    expect(onChange).not.toHaveBeenCalled()
  })
})
