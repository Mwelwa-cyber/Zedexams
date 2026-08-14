/**
 * DiagramPicker — a figure that cannot be drawn truly never reaches a paper.
 *
 * The senior families carry marks, so "it rendered" is not the bar. A
 * circle-theorem figure whose marked angle contradicts the drawing renders
 * perfectly; it is just wrong, and the teacher is the only person who can fix
 * it. So the picker has to say so where they are looking, in words, and refuse
 * the insert — including for a keyboard or screen-reader user, who never sees
 * the red border.
 */

import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import DiagramPicker from './DiagramPicker.jsx'

function open(initial) {
  const onConfirm = vi.fn()
  render(<DiagramPicker open initial={initial} onConfirm={onConfirm} onClose={() => {}} accentColor="#7c2d12" />)
  return { onConfirm }
}

const insertButton = () => screen.getByRole('button', { name: /insert diagram/i })

describe('DiagramPicker validation', () => {
  it('inserts a figure whose parameters are fine', async () => {
    const user = userEvent.setup()
    const { onConfirm } = open({ libraryKey: 'bearings', params: { legs: 'A>B,060,8' } })
    expect(insertButton()).toBeEnabled()
    await user.click(insertButton())
    expect(onConfirm).toHaveBeenCalledWith(expect.objectContaining({ libraryKey: 'bearings' }))
  })

  it('explains an impossible bearing in words, and refuses the insert', async () => {
    const user = userEvent.setup()
    const { onConfirm } = open({ libraryKey: 'bearings', params: { legs: 'A>B,400,8' } })
    // The message names what is wrong and what a bearing may be — not "invalid
    // input", which tells a teacher nothing they can act on.
    expect(screen.getByRole('alert')).toHaveTextContent(/from 000 to 359/)
    expect(insertButton()).toBeDisabled()
    await user.click(insertButton())
    expect(onConfirm).not.toHaveBeenCalled()
  })

  it('ties the message to its own field for a screen reader', () => {
    open({ libraryKey: 'bearings', params: { legs: 'A>B,400,8' } })
    const field = screen.getByLabelText(/Legs, e\.g\./i)
    expect(field).toHaveAttribute('aria-invalid', 'true')
    const describedBy = field.getAttribute('aria-describedby')
    expect(describedBy).toBeTruthy()
    expect(document.getElementById(describedBy)).toHaveTextContent(/from 000 to 359/)
  })

  it('tells a keyboard user why the button is disabled, since they cannot see the border', () => {
    open({ libraryKey: 'labelledtriangle', params: { angleA: '90', angleB: '80', angleC: '30' } })
    expect(screen.getByText(/Fix the problem above to insert this diagram/i)).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent(/must add up to 180°/)
  })

  it('clears the refusal as soon as the teacher corrects the value', async () => {
    const user = userEvent.setup()
    const { onConfirm } = open({ libraryKey: 'elevation', params: { angle: '95' } })
    expect(insertButton()).toBeDisabled()
    const field = screen.getByLabelText(/Angle \(degrees\)/i)
    await user.clear(field)
    await user.type(field, '35')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(insertButton()).toBeEnabled()
    await user.click(insertButton())
    expect(onConfirm).toHaveBeenCalled()
  })

  it('leaves the primary figures exactly as they were', async () => {
    // Every figure that predates this phase has no validate(), and must behave
    // as it always did rather than acquiring an empty error region.
    const user = userEvent.setup()
    const { onConfirm } = open({ libraryKey: 'triangle', params: {} })
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(insertButton()).toBeEnabled()
    await user.click(insertButton())
    expect(onConfirm).toHaveBeenCalledWith(expect.objectContaining({ libraryKey: 'triangle' }))
  })
})
