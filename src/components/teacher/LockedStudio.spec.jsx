import { describe, it, expect } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { HelmetProvider } from 'react-helmet-async'
import LockedStudio from './LockedStudio.jsx'
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
})
