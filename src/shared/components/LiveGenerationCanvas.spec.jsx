import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import LiveGenerationCanvas from './LiveGenerationCanvas.jsx'

/**
 * Regression tests for two bugs in LiveGenerationCanvas:
 *
 * [15] handleRegenerateSection swallowed falsy results and throws — the teacher
 *      watched 'Rewriting this section…' then the old content silently reappeared.
 *      Fix: setSectionError(sectionId) on null/falsy return or catch; render an
 *      inline "Could not rewrite this section — please try again." notice.
 *
 * [22] On phones, validation/generation errors rendered below the fold because
 *      the mobile full-screen overlay only activated for generating/success.
 *      Fix: extend the overlay condition to include status === 'error'.
 *      Also added role="alert" to ErrorState's wrapper for screen readers.
 */

// A minimal one-section result with an explicit sectionConfig so label overrides
// from TOOL_SECTION_CONFIG are avoided and assertions stay predictable.
const MIN_RESULT = { content: 'Section body text' }
// Only list 'content' in order; skip list is the default ALWAYS_SKIP which does
// not include 'content'.
const MIN_CONFIG = { order: ['content'] }
// humanizeKey('content') → 'Content'; button title is built as
// `Regenerate ${section.title}` in RevealSection.
const REGEN_BTN_TITLE = 'Regenerate Content'

// ── helpers ────────────────────────────────────────────────────────────────

function renderSuccess(onRegenerateSection, extra = {}) {
  return render(
    <LiveGenerationCanvas
      sectionConfig={MIN_CONFIG}
      status="success"
      result={MIN_RESULT}
      onRegenerateSection={onRegenerateSection}
      onRetry={vi.fn()}
      {...extra}
    />,
  )
}

// ── [15] per-section regenerate error handling ──────────────────────────────

describe('LiveGenerationCanvas — section regenerate error handling [15]', () => {
  it('shows an inline error notice in the section when onRegenerateSection returns null', async () => {
    // status='success' + sectionCount=1 → useLiveReveal immediately sets
    // revealedCount=1 so complete=true and the Regenerate button is visible.
    renderSuccess(vi.fn().mockResolvedValue(null))

    fireEvent.click(screen.getByTitle(REGEN_BTN_TITLE))

    // findByText uses waitFor internally, polling until the notice appears or
    // the timeout is reached.
    expect(
      await screen.findByText(/could not rewrite this section/i),
    ).toBeInTheDocument()
  })

  it('clears the section error notice after a subsequent successful regenerate', async () => {
    const freshResult = { content: 'Updated content' }
    const onRegen = vi.fn()
      .mockResolvedValueOnce(null)         // first attempt: failure
      .mockResolvedValueOnce(freshResult)  // second attempt: success

    renderSuccess(onRegen)
    const btn = screen.getByTitle(REGEN_BTN_TITLE)

    // First click — error notice appears.
    fireEvent.click(btn)
    await screen.findByText(/could not rewrite this section/i)

    // Second click — succeeds; busy state clears; new content appears.
    fireEvent.click(btn)
    // Wait for the section to show the fresh value, confirming the update landed.
    await screen.findByText('Updated content')

    expect(
      screen.queryByText(/could not rewrite this section/i),
    ).not.toBeInTheDocument()
  })

  it('shows the inline error notice when onRegenerateSection throws', async () => {
    // The rejection is caught by handleRegenerateSection's catch block, so no
    // unhandled rejection propagates to Vitest.
    renderSuccess(vi.fn().mockRejectedValue(new Error('server error')))

    fireEvent.click(screen.getByTitle(REGEN_BTN_TITLE))

    expect(
      await screen.findByText(/could not rewrite this section/i),
    ).toBeInTheDocument()
  })
})

// ── [22] mobile error overlay ───────────────────────────────────────────────

describe('LiveGenerationCanvas — mobile error overlay [22]', () => {
  it('applies the mobile overlay classes to the panel wrapper when status is error', () => {
    const { container } = render(
      <LiveGenerationCanvas
        sectionConfig={MIN_CONFIG}
        status="error"
        errorMessage="Quota exceeded"
        onRetry={vi.fn()}
      />,
    )
    // The overlay condition is (active || status === 'error') && !embedded.
    // With variant='panel' (default) and status='error', the max-md:fixed set
    // must be on the <section> wrapper.
    expect(container.querySelector('section')).toHaveClass('max-md:fixed')
  })

  it('does not apply the mobile overlay classes when variant is embedded', () => {
    const { container } = render(
      <LiveGenerationCanvas
        sectionConfig={MIN_CONFIG}
        status="error"
        errorMessage="Quota exceeded"
        variant="embedded"
        onRetry={vi.fn()}
      />,
    )
    // embedded=true → wrapperClass='', so no overlay classes at all.
    expect(container.querySelector('section')).not.toHaveClass('max-md:fixed')
  })

  it('renders ErrorState with role="alert" so screen readers announce generation failures', () => {
    render(
      <LiveGenerationCanvas
        sectionConfig={MIN_CONFIG}
        status="error"
        errorMessage="Something failed"
        onRetry={vi.fn()}
      />,
    )
    expect(screen.getByRole('alert')).toBeInTheDocument()
  })
})
