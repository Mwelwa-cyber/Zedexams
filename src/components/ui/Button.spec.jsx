import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import Button from './Button.jsx'

describe('Button', () => {
  it('renders children and defaults to type="button" (never submits a form)', () => {
    render(<Button>Save</Button>)
    const btn = screen.getByRole('button', { name: 'Save' })
    expect(btn).toHaveAttribute('type', 'button')
  })

  it('applies the variant + size classes', () => {
    render(<Button variant="danger" size="lg">Delete</Button>)
    const btn = screen.getByRole('button', { name: 'Delete' })
    expect(btn.className).toMatch(/var\(--danger\)/)
    expect(btn).toHaveClass('rounded-2xl') // lg size token
  })

  it('fires onClick when enabled', () => {
    const onClick = vi.fn()
    render(<Button onClick={onClick}>Go</Button>)
    fireEvent.click(screen.getByRole('button', { name: 'Go' }))
    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it('does not fire onClick when disabled', () => {
    const onClick = vi.fn()
    render(<Button disabled onClick={onClick}>Go</Button>)
    const btn = screen.getByRole('button', { name: 'Go' })
    expect(btn).toBeDisabled()
    fireEvent.click(btn)
    expect(onClick).not.toHaveBeenCalled()
  })

  it('shows a spinner, disables, and swaps out the leading icon while loading', () => {
    const onClick = vi.fn()
    const { container } = render(
      <Button loading leadingIcon={<span data-testid="lead">L</span>} onClick={onClick}>
        Saving
      </Button>,
    )
    const btn = screen.getByRole('button', { name: 'Saving' })
    expect(btn).toBeDisabled()
    expect(container.querySelector('.animate-spin')).toBeInTheDocument()
    expect(screen.queryByTestId('lead')).not.toBeInTheDocument()
    fireEvent.click(btn)
    expect(onClick).not.toHaveBeenCalled()
  })

  it('renders leading and trailing icons when not loading', () => {
    render(
      <Button leadingIcon={<span data-testid="lead">L</span>} trailingIcon={<span data-testid="trail">T</span>}>
        Both
      </Button>,
    )
    expect(screen.getByTestId('lead')).toBeInTheDocument()
    expect(screen.getByTestId('trail')).toBeInTheDocument()
  })

  it('renders as a link (no type attr, aria-disabled) when as="a"', () => {
    render(<Button as="a" href="/x" disabled>Link</Button>)
    const link = screen.getByRole('link', { name: 'Link' })
    expect(link).not.toHaveAttribute('type')
    expect(link).toHaveAttribute('aria-disabled', 'true')
  })

  it('stretches with fullWidth', () => {
    render(<Button fullWidth>Wide</Button>)
    expect(screen.getByRole('button', { name: 'Wide' })).toHaveClass('w-full')
  })
})
