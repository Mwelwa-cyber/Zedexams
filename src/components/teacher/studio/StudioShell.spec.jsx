import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { StudioShell } from './StudioShell'

describe('StudioShell — form view (default)', () => {
  it('renders the wizard slot', () => {
    render(<StudioShell sidebar={<div data-testid="sidebar" />} canvas={<div data-testid="canvas" />} />)
    expect(screen.getByTestId('sidebar')).toBeInTheDocument()
  })

  it('does NOT render the canvas while the teacher is filling in the form', () => {
    render(<StudioShell sidebar={<div data-testid="sidebar" />} canvas={<div data-testid="canvas" />} />)
    expect(screen.queryByTestId('canvas')).not.toBeInTheDocument()
  })

  it('does not show a Back to form control in the form view', () => {
    render(<StudioShell sidebar={<div />} canvas={<div />} />)
    expect(screen.queryByRole('button', { name: /back to form/i })).not.toBeInTheDocument()
  })

  it('does not lock viewport height on the scrolling form view', () => {
    const { container } = render(<StudioShell sidebar={<div />} canvas={<div />} />)
    const wrapper = container.firstChild
    expect(wrapper.className).not.toMatch(/(^|\s)h-screen(\s|$)/)
    expect(wrapper.className).not.toMatch(/overflow-hidden/)
  })
})

describe('StudioShell — canvas view', () => {
  it('renders the canvas slot and hides the wizard', () => {
    render(
      <StudioShell
        view="canvas"
        sidebar={<div data-testid="sidebar" />}
        canvas={<div data-testid="canvas" />}
      />,
    )
    expect(screen.getByTestId('canvas')).toBeInTheDocument()
    expect(screen.queryByTestId('sidebar')).not.toBeInTheDocument()
  })

  it('calls onBackToForm when Back to form is clicked', () => {
    const onBack = vi.fn()
    render(<StudioShell view="canvas" sidebar={<div />} canvas={<div />} onBackToForm={onBack} />)
    fireEvent.click(screen.getByRole('button', { name: /back to form/i }))
    expect(onBack).toHaveBeenCalledTimes(1)
  })

  // Regression guard for the "lesson plan hidden on the right on mobile" bug:
  // the canvas view must stack vertically on phones and only lock the viewport
  // height + clipping at md+.
  it('stacks vertically on mobile and gates h-screen/overflow to md+', () => {
    const { container } = render(<StudioShell view="canvas" sidebar={<div />} canvas={<div />} />)
    const wrapper = container.firstChild
    expect(wrapper.className).toContain('flex-col')
    expect(wrapper.className).toContain('md:flex-row')
    expect(wrapper.className).not.toMatch(/(^|\s)h-screen(\s|$)/)
    expect(wrapper.className).not.toMatch(/(^|\s)overflow-hidden(\s|$)/)
    expect(wrapper.className).toContain('md:h-screen')
    expect(wrapper.className).toContain('md:overflow-hidden')
  })
})
