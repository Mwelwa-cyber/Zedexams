import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { StudioShell } from './StudioShell'

describe('StudioShell — layout', () => {
  it('renders the sidebar slot', () => {
    render(<StudioShell sidebar={<div data-testid="sidebar" />} canvas={<div />} />)
    expect(screen.getByTestId('sidebar')).toBeInTheDocument()
  })

  it('renders the canvas slot', () => {
    render(<StudioShell sidebar={<div />} canvas={<div data-testid="canvas" />} />)
    expect(screen.getByTestId('canvas')).toBeInTheDocument()
  })

  it('renders both slots together', () => {
    render(
      <StudioShell
        sidebar={<div data-testid="sidebar">Sidebar content</div>}
        canvas={<div data-testid="canvas">Canvas content</div>}
      />,
    )
    expect(screen.getByTestId('sidebar')).toBeInTheDocument()
    expect(screen.getByTestId('canvas')).toBeInTheDocument()
  })

  it('applies the flex wrapper class', () => {
    const { container } = render(
      <StudioShell sidebar={<div />} canvas={<div />} />,
    )
    const wrapper = container.firstChild
    expect(wrapper.className).toMatch(/flex/)
  })

  // Regression guard for the "lesson plan hidden on the right on mobile" bug.
  // The shell used to be a row-only `flex h-screen overflow-hidden`, which on a
  // phone kept the sidebar at its min-width and pushed the canvas (the
  // generated plan) off the right edge — the plan rendered but was invisible.
  // The shell must stack vertically by default and only become a side-by-side
  // row at md+, with the locked viewport height + clipping also gated to md+.
  it('stacks vertically on mobile and switches to a row at md+', () => {
    const { container } = render(
      <StudioShell sidebar={<div />} canvas={<div />} />,
    )
    const wrapper = container.firstChild
    expect(wrapper.className).toContain('flex-col')
    expect(wrapper.className).toContain('md:flex-row')
  })

  it('does not lock viewport height or hide overflow on mobile (only at md+)', () => {
    const { container } = render(
      <StudioShell sidebar={<div />} canvas={<div />} />,
    )
    const wrapper = container.firstChild
    // No unconditional h-screen / overflow-hidden — those clip the stacked
    // canvas on a phone. Height + clipping are gated behind the md: breakpoint.
    expect(wrapper.className).not.toMatch(/(^|\s)h-screen(\s|$)/)
    expect(wrapper.className).not.toMatch(/(^|\s)overflow-hidden(\s|$)/)
    expect(wrapper.className).toContain('md:h-screen')
    expect(wrapper.className).toContain('md:overflow-hidden')
  })

  it('renders sidebar text content', () => {
    render(<StudioShell sidebar={<span>Left panel</span>} canvas={<div />} />)
    expect(screen.getByText('Left panel')).toBeInTheDocument()
  })

  it('renders canvas text content', () => {
    render(<StudioShell sidebar={<div />} canvas={<span>Right panel</span>} />)
    expect(screen.getByText('Right panel')).toBeInTheDocument()
  })
})
