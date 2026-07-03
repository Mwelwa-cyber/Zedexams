import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import DraftStatusIndicator from './DraftStatusIndicator'

describe('DraftStatusIndicator', () => {
  it('renders nothing before the first edit (idle)', () => {
    const { container } = render(<DraftStatusIndicator status="idle" />)
    expect(container.firstChild).toBeNull()
  })

  it('shows a saving state', () => {
    render(<DraftStatusIndicator status="saving" />)
    expect(screen.getByText(/Saving/)).toBeInTheDocument()
  })

  it('shows saved with a relative time', () => {
    render(<DraftStatusIndicator status="saved" savedAt={Date.now()} online />)
    expect(screen.getByText(/Saved just now/)).toBeInTheDocument()
  })

  it('reflects offline even when the row thinks it saved', () => {
    render(<DraftStatusIndicator status="saved" savedAt={Date.now()} online={false} />)
    expect(screen.getByText(/Offline/)).toBeInTheDocument()
  })

  it('surfaces the too-large local-only state', () => {
    render(<DraftStatusIndicator status="local-only" savedAt={Date.now()} online />)
    expect(screen.getByText(/this device only/)).toBeInTheDocument()
  })
})
