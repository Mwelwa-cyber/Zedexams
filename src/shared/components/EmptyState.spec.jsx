import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import EmptyState from './EmptyState.jsx'

describe('EmptyState', () => {
  it('renders title and description text', () => {
    render(<EmptyState title="No quizzes yet" description="Create your first quiz." />)
    expect(screen.getByRole('heading', { name: 'No quizzes yet' })).toBeInTheDocument()
    expect(screen.getByText('Create your first quiz.')).toBeInTheDocument()
  })

  it('renders the icon and action when provided', () => {
    const Icon = (props) => <svg data-testid="icon" {...props} />
    render(
      <EmptyState
        title="Empty"
        icon={Icon}
        action={<button>Add one</button>}
      />,
    )
    expect(screen.getByTestId('icon')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Add one' })).toBeInTheDocument()
  })

  it('omits optional slots when not provided', () => {
    const { container } = render(<EmptyState title="Just a title" />)
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
    // No icon element rendered when `icon` prop is absent.
    expect(container.querySelector('svg')).toBeNull()
  })

  it('applies the error variant tone class', () => {
    const { container } = render(
      <EmptyState
        title="Failed"
        icon={(props) => <svg {...props} />}
        variant="error"
      />,
    )
    expect(container.querySelector('.bg-danger-subtle')).not.toBeNull()
  })
})
