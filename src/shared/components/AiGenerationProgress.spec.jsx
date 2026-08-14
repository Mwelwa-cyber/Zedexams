import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react'
import AiGenerationProgress from './AiGenerationProgress.jsx'
import { CONNECTION_NOTICES, SLOW_CONNECTION_AFTER_MS } from './aiGenerationStages.js'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.useRealTimers()
})

describe('AiGenerationProgress — connection reassurance', () => {
  it('shows nothing about the connection on a fresh, online run', () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true)
    render(<AiGenerationProgress running preset="notes" title="Writing your notes…" />)
    expect(screen.queryByText(CONNECTION_NOTICES.offline)).not.toBeInTheDocument()
    expect(screen.queryByText(CONNECTION_NOTICES.slow)).not.toBeInTheDocument()
  })

  it('shows the offline notice when the browser reports offline mid-run', () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
    render(<AiGenerationProgress running preset="notes" title="Writing your notes…" />)
    expect(screen.getByText(CONNECTION_NOTICES.offline)).toBeInTheDocument()
  })

  it('shows the slow-connection notice once a run drags past the threshold', () => {
    vi.useFakeTimers()
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true)
    render(<AiGenerationProgress running preset="worksheet" title="Writing the worksheet…" />)
    expect(screen.queryByText(CONNECTION_NOTICES.slow)).not.toBeInTheDocument()

    // Advance the panel's internal wall-clock past the slow threshold.
    act(() => { vi.advanceTimersByTime(SLOW_CONNECTION_AFTER_MS + 1500) })
    expect(screen.getByText(CONNECTION_NOTICES.slow)).toBeInTheDocument()
  })
})

describe('AiGenerationProgress — failed state', () => {
  beforeEach(() => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true)
  })

  it('reassures the request is saved and renders a retry button when onRetry is given', () => {
    const onRetry = vi.fn()
    render(
      <AiGenerationProgress running preset="notes" title="Writing your notes…" error="boom" onRetry={onRetry} />,
    )
    expect(screen.getByText(/your request is saved/i)).toBeInTheDocument()
    const button = screen.getByRole('button', { name: /try again/i })
    fireEvent.click(button)
    expect(onRetry).toHaveBeenCalledTimes(1)
  })

  it('suppresses the connection notice once the run has errored', () => {
    render(<AiGenerationProgress running preset="notes" title="Writing your notes…" error="boom" />)
    // Even offline, the error/retry copy owns the panel — no stale "offline" line.
    expect(screen.queryByText(CONNECTION_NOTICES.offline)).not.toBeInTheDocument()
    expect(screen.getByText(/your request is saved/i)).toBeInTheDocument()
  })
})
