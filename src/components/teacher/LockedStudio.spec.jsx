import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { HelmetProvider } from 'react-helmet-async'
import LockedStudio from './LockedStudio.jsx'

// LockedStudio renders sample artifacts through the flashcards feature index,
// which re-exports useFlashcardProgress → AuthContext → firebase/config. The
// sample view needs none of that, so stub the front door rather than configure
// Firebase for a render test.
vi.mock('../../features/flashcards', () => ({ FlashcardsView: () => null }))
import { paywall } from '../../utils/paywall.js'
import { SAMPLE_TOOL_KEYS, STUDIO_SAMPLES } from '../../data/studioSamples.js'

// Render LockedStudio for every gated tool and assert the sample mounts without
// throwing. The samples feed real View components (NotesView, SbaTaskView,
// ClassTimetableView, …), so a shape mismatch would crash here — this is the
// guard that keeps the locked-studio previews honest.
function renderTool(tool) {
  return render(
    <HelmetProvider>
      <MemoryRouter>
        <LockedStudio tool={tool} />
      </MemoryRouter>
    </HelmetProvider>,
  )
}

describe('LockedStudio', () => {
  afterEach(() => paywall.hide())

  it('exposes a sample for each gated tool', () => {
    expect(SAMPLE_TOOL_KEYS.length).toBeGreaterThanOrEqual(15)
    // Lesson plans are deliberately NOT gated — they stay open on Free.
    expect(SAMPLE_TOOL_KEYS).not.toContain('lesson_plan')
  })

  for (const tool of SAMPLE_TOOL_KEYS) {
    it(`renders the ${tool} sample without crashing`, () => {
      renderTool(tool)
      // Every locked studio surfaces the upgrade CTA and a "Sample" marker.
      expect(screen.getAllByText(/sample/i).length).toBeGreaterThan(0)
      expect(screen.getByText(STUDIO_SAMPLES[tool].title)).toBeInTheDocument()
      cleanup()
    })
  }

  it('falls back gracefully for an unknown tool', () => {
    renderTool('not_a_real_tool')
    expect(screen.getByText(/A Pro & Max studio/i)).toBeInTheDocument()
  })

  // A Free teacher who presses a gated studio must be told, on arrival, that
  // they've reached a paid studio — not just shown a quiet sample. LockedStudio
  // pushes the 'feature-locked' paywall on mount; PaywallHost renders it.
  it('raises the paywall on mount so the pay message is unmissable', () => {
    const events = []
    const unsubscribe = paywall.subscribe((s) => events.push(s))
    // subscribe() replays current state first; ignore that, watch what mount adds.
    events.length = 0
    renderTool('worksheet')
    const shown = events.find((s) => s?.reason === 'feature-locked')
    expect(shown).toBeTruthy()
    expect(shown.ctx.feature).toBe(STUDIO_SAMPLES.worksheet.feature)
    unsubscribe()
    cleanup()
  })
})
