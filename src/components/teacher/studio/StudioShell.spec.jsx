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

  it('renders the header slot above the panes', () => {
    render(
      <StudioShell
        header={<div data-testid="header" />}
        sidebar={<div data-testid="sidebar" />}
        canvas={<div />}
      />,
    )
    const header = screen.getByTestId('header')
    const sidebar = screen.getByTestId('sidebar')
    // Header precedes the pane row in document order.
    expect(header.compareDocumentPosition(sidebar) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('applies the flex classes to the pane row', () => {
    const { container } = render(
      <StudioShell sidebar={<div />} canvas={<div />} />,
    )
    const row = container.querySelector('.lps-shell-row')
    expect(row).not.toBeNull()
    expect(row.className).toMatch(/flex/)
  })

  // Regression guard for the "lesson plan hidden on the right on mobile" bug.
  // The pane row must stack vertically by default and only become a
  // side-by-side row at md+, with the bounded height + clipping also gated to
  // md+ — otherwise the canvas is pushed off the right edge of a phone.
  it('stacks vertically on mobile and switches to a row at md+', () => {
    const { container } = render(
      <StudioShell sidebar={<div />} canvas={<div />} />,
    )
    const row = container.querySelector('.lps-shell-row')
    expect(row.className).toContain('flex-col')
    expect(row.className).toContain('md:flex-row')
  })

  // The studio renders INSIDE the TeacherLayout dashboard shell now — it must
  // never lock the whole viewport (h-screen) like the old standalone page: the
  // md+ height is bounded to the space under the dashboard top bar, and
  // clipping (each pane scrolls internally) is gated behind md too.
  it('bounds height below the dashboard chrome instead of locking the viewport', () => {
    const { container } = render(
      <StudioShell sidebar={<div />} canvas={<div />} />,
    )
    const row = container.querySelector('.lps-shell-row')
    expect(row.className).not.toMatch(/(^|\s)h-screen(\s|$)/)
    expect(row.className).not.toMatch(/md:h-screen/)
    expect(row.className).not.toMatch(/(^|\s)overflow-hidden(\s|$)/)
    expect(row.className).toContain('md:overflow-hidden')
    expect(row.className).toMatch(/md:h-\[calc\(100dvh/)
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
