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

  it('applies the flex h-screen wrapper class', () => {
    const { container } = render(
      <StudioShell sidebar={<div />} canvas={<div />} />,
    )
    const wrapper = container.firstChild
    expect(wrapper.className).toMatch(/flex/)
    expect(wrapper.className).toMatch(/h-screen/)
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
