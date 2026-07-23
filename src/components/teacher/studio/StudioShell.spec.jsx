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

  it('renders the header slot above the wizard', () => {
    render(
      <StudioShell
        header={<div data-testid="header" />}
        sidebar={<div data-testid="sidebar" />}
        canvas={<div />}
      />,
    )
    const header = screen.getByTestId('header')
    const sidebar = screen.getByTestId('sidebar')
    // Header precedes the wizard in document order.
    expect(header.compareDocumentPosition(sidebar) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('does not show a Back to form control in the form view', () => {
    render(<StudioShell sidebar={<div />} canvas={<div />} />)
    expect(screen.queryByRole('button', { name: /back to form/i })).not.toBeInTheDocument()
  })

  // The studio renders INSIDE the TeacherLayout dashboard shell — it must
  // never lock the whole viewport like the old standalone page.
  it('brings no full-viewport chrome on the scrolling form view', () => {
    const { container } = render(<StudioShell sidebar={<div />} canvas={<div />} />)
    const wrapper = container.firstChild
    expect(wrapper.className).not.toMatch(/h-screen/)
    expect(wrapper.className).not.toMatch(/overflow-hidden/)
  })
})

describe('StudioShell — canvas view', () => {
  it('renders the canvas slot (and the header) and hides the wizard', () => {
    render(
      <StudioShell
        view="canvas"
        header={<div data-testid="header" />}
        sidebar={<div data-testid="sidebar" />}
        canvas={<div data-testid="canvas" />}
      />,
    )
    expect(screen.getByTestId('canvas')).toBeInTheDocument()
    expect(screen.getByTestId('header')).toBeInTheDocument()
    expect(screen.queryByTestId('sidebar')).not.toBeInTheDocument()
  })

  it('calls onBackToForm when Back to form is clicked', () => {
    const onBack = vi.fn()
    render(<StudioShell view="canvas" sidebar={<div />} canvas={<div />} onBackToForm={onBack} />)
    fireEvent.click(screen.getByRole('button', { name: /back to form/i }))
    expect(onBack).toHaveBeenCalledTimes(1)
  })

  // Regression guard for the "lesson plan hidden on the right on mobile" bug:
  // the pane row must stack vertically on phones and switch to a row at md+.
  it('stacks vertically on mobile and switches to a row at md+', () => {
    const { container } = render(<StudioShell view="canvas" sidebar={<div />} canvas={<div />} />)
    const row = container.querySelector('.lps-shell-row')
    expect(row).not.toBeNull()
    expect(row.className).toContain('flex-col')
    expect(row.className).toContain('md:flex-row')
  })

  // Bounded to the space under the dashboard top bar — never h-screen, and
  // clipping (internal pane scroll) gated behind md.
  it('bounds height below the dashboard chrome instead of locking the viewport', () => {
    const { container } = render(<StudioShell view="canvas" sidebar={<div />} canvas={<div />} />)
    const row = container.querySelector('.lps-shell-row')
    expect(row.className).not.toMatch(/(^|\s)h-screen(\s|$)/)
    expect(row.className).not.toMatch(/md:h-screen/)
    expect(row.className).not.toMatch(/(^|\s)overflow-hidden(\s|$)/)
    expect(row.className).toContain('md:overflow-hidden')
    expect(row.className).toMatch(/md:h-\[calc\(100dvh/)
  })
})
