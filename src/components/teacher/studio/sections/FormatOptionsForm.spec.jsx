import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { FormatOptionsForm } from './FormatOptionsForm'

// ── Default props ─────────────────────────────────────────────────────────────

const DEFAULT_FORMAT_OPTIONS = {
  detail: 'standard',
  writingStyle: 'standard',
  format: 'modern',
  illustrations: 'none',
  advanced: {
    compactMetadata: false,
    includeEnrolment: false,
    includeAttendance: false,
    includeLessonEvaluation: false,
    includeKeyVocabulary: false,
    autoIllustrations: false,
    localLanguage: false,
  },
}

function renderForm(props = {}) {
  const defaults = {
    formatOptions: { ...DEFAULT_FORMAT_OPTIONS, advanced: { ...DEFAULT_FORMAT_OPTIONS.advanced } },
    onUpdateFormat: vi.fn(),
    onUpdateAdvanced: vi.fn(),
    lessonMedium: 'English',
    ...props,
  }
  return {
    ...render(<FormatOptionsForm {...defaults} />),
    onUpdateFormat: defaults.onUpdateFormat,
    onUpdateAdvanced: defaults.onUpdateAdvanced,
  }
}

// ── Section header ────────────────────────────────────────────────────────────

// Helper: the section header button is the one with aria-expanded (not aria-pressed)
function getSectionToggle() {
  return screen
    .getAllByRole('button')
    .find((btn) => btn.hasAttribute('aria-expanded') && btn.textContent.includes('Format'))
}

describe('FormatOptionsForm — section header', () => {
  it('renders "Format & Options" heading', () => {
    renderForm()
    expect(screen.getByText('Format & Options')).toBeInTheDocument()
  })

  it('toggle button has aria-expanded="true" by default', () => {
    renderForm()
    const btn = getSectionToggle()
    expect(btn).toHaveAttribute('aria-expanded', 'true')
  })

  it('collapses body on header click', () => {
    renderForm()
    const btn = getSectionToggle()
    fireEvent.click(btn)
    expect(btn).toHaveAttribute('aria-expanded', 'false')
    // body content disappears — check a sub-section label is gone
    expect(screen.queryByText('Lesson Plan Detail')).not.toBeInTheDocument()
  })

  it('expands body on second header click', () => {
    renderForm()
    const btn = getSectionToggle()
    fireEvent.click(btn)
    fireEvent.click(btn)
    expect(btn).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByText('Lesson Plan Detail')).toBeInTheDocument()
  })
})

// ── Sub-section presence ──────────────────────────────────────────────────────

describe('FormatOptionsForm — all 5 sub-sections present', () => {
  it('renders "Lesson Plan Detail" sub-section label', () => {
    renderForm()
    expect(screen.getByText('Lesson Plan Detail')).toBeInTheDocument()
  })

  it('renders "Writing Style" sub-section label', () => {
    renderForm()
    expect(screen.getByText('Writing Style')).toBeInTheDocument()
  })

  it('renders "Lesson Plan Format" sub-section label', () => {
    renderForm()
    expect(screen.getByText('Lesson Plan Format')).toBeInTheDocument()
  })

  it('renders "Illustrations" sub-section label', () => {
    renderForm()
    expect(screen.getByText('Illustrations')).toBeInTheDocument()
  })

  it('renders "Advanced Options" toggle button', () => {
    renderForm()
    expect(screen.getByRole('button', { name: /advanced options/i })).toBeInTheDocument()
  })
})

// ── Lesson Plan Detail ────────────────────────────────────────────────────────

describe('FormatOptionsForm — Lesson Plan Detail', () => {
  it('renders Simplified, Standard, Detailed option cards', () => {
    renderForm()
    expect(screen.getByText('Simplified')).toBeInTheDocument()
    // 'Standard' appears in both Detail options and Writing Style pills — getAllByText is correct here
    expect(screen.getAllByText('Standard').length).toBeGreaterThanOrEqual(1)
    expect(screen.getByText('Detailed')).toBeInTheDocument()
  })

  it('calls onUpdateFormat("detail", "simplified") when Simplified is clicked', () => {
    const { onUpdateFormat } = renderForm()
    fireEvent.click(screen.getByText('Simplified').closest('button'))
    expect(onUpdateFormat).toHaveBeenCalledWith('detail', 'simplified')
  })

  it('calls onUpdateFormat("detail", "detailed") when Detailed is clicked', () => {
    const { onUpdateFormat } = renderForm()
    fireEvent.click(screen.getByText('Detailed').closest('button'))
    expect(onUpdateFormat).toHaveBeenCalledWith('detail', 'detailed')
  })

  it('selected detail card has blue border', () => {
    renderForm({
      formatOptions: {
        ...DEFAULT_FORMAT_OPTIONS,
        advanced: { ...DEFAULT_FORMAT_OPTIONS.advanced },
        detail: 'simplified',
      },
    })
    const btn = screen.getByText('Simplified').closest('button')
    expect(btn.className).toMatch(/border-blue-500/)
  })

  it('unselected detail card does not have blue border', () => {
    renderForm({
      formatOptions: {
        ...DEFAULT_FORMAT_OPTIONS,
        advanced: { ...DEFAULT_FORMAT_OPTIONS.advanced },
        detail: 'simplified',
      },
    })
    const btn = screen.getByText('Detailed').closest('button')
    expect(btn.className).not.toMatch(/border-blue-500/)
  })
})

// ── Writing Style ─────────────────────────────────────────────────────────────

describe('FormatOptionsForm — Writing Style', () => {
  it('renders Simple, Standard, Professional pills', () => {
    renderForm()
    expect(screen.getByRole('button', { name: 'Simple' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Professional' })).toBeInTheDocument()
  })

  it('calls onUpdateFormat("writingStyle", "simple") when Simple is clicked', () => {
    const { onUpdateFormat } = renderForm()
    fireEvent.click(screen.getByRole('button', { name: 'Simple' }))
    expect(onUpdateFormat).toHaveBeenCalledWith('writingStyle', 'simple')
  })

  it('calls onUpdateFormat("writingStyle", "professional") when Professional is clicked', () => {
    const { onUpdateFormat } = renderForm()
    fireEvent.click(screen.getByRole('button', { name: 'Professional' }))
    expect(onUpdateFormat).toHaveBeenCalledWith('writingStyle', 'professional')
  })

  it('selected writing style pill has blue border', () => {
    renderForm({
      formatOptions: {
        ...DEFAULT_FORMAT_OPTIONS,
        advanced: { ...DEFAULT_FORMAT_OPTIONS.advanced },
        writingStyle: 'professional',
      },
    })
    const btn = screen.getByRole('button', { name: 'Professional' })
    expect(btn.className).toMatch(/border-blue-500/)
  })
})

// ── Lesson Plan Format (FormatCard) ───────────────────────────────────────────

describe('FormatOptionsForm — Lesson Plan Format cards', () => {
  it('renders Modern Clean, Classic, Official CBC format cards', () => {
    renderForm()
    expect(screen.getByAltText('Modern Clean format preview')).toBeInTheDocument()
    expect(screen.getByAltText('Classic format preview')).toBeInTheDocument()
    expect(screen.getByAltText('Official CBC format preview')).toBeInTheDocument()
  })

  it('calls onUpdateFormat("format", "classic") when Classic card is clicked', () => {
    const { onUpdateFormat } = renderForm()
    const classicCard = screen.getByAltText('Classic format preview').closest('button')
    fireEvent.click(classicCard)
    expect(onUpdateFormat).toHaveBeenCalledWith('format', 'classic')
  })

  it('calls onUpdateFormat("format", "official") when Official CBC card is clicked', () => {
    const { onUpdateFormat } = renderForm()
    const officialCard = screen.getByAltText('Official CBC format preview').closest('button')
    fireEvent.click(officialCard)
    expect(onUpdateFormat).toHaveBeenCalledWith('format', 'official')
  })

  it('selected format card has aria-pressed="true"', () => {
    renderForm({
      formatOptions: {
        ...DEFAULT_FORMAT_OPTIONS,
        advanced: { ...DEFAULT_FORMAT_OPTIONS.advanced },
        format: 'classic',
      },
    })
    const classicCard = screen.getByAltText('Classic format preview').closest('button')
    expect(classicCard).toHaveAttribute('aria-pressed', 'true')
  })

  it('unselected format cards have aria-pressed="false"', () => {
    renderForm({
      formatOptions: {
        ...DEFAULT_FORMAT_OPTIONS,
        advanced: { ...DEFAULT_FORMAT_OPTIONS.advanced },
        format: 'modern',
      },
    })
    const classicCard = screen.getByAltText('Classic format preview').closest('button')
    expect(classicCard).toHaveAttribute('aria-pressed', 'false')
  })
})

// ── Illustrations ─────────────────────────────────────────────────────────────

describe('FormatOptionsForm — Illustrations', () => {
  it('renders None, Automatic, Add Manually pills', () => {
    renderForm()
    expect(screen.getByRole('button', { name: 'None' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Automatic' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Add Manually' })).toBeInTheDocument()
  })

  it('calls onUpdateFormat("illustrations", "automatic") when Automatic is clicked', () => {
    const { onUpdateFormat } = renderForm()
    fireEvent.click(screen.getByRole('button', { name: 'Automatic' }))
    expect(onUpdateFormat).toHaveBeenCalledWith('illustrations', 'automatic')
  })

  it('calls onUpdateFormat("illustrations", "manual") when Add Manually is clicked', () => {
    const { onUpdateFormat } = renderForm()
    fireEvent.click(screen.getByRole('button', { name: 'Add Manually' }))
    expect(onUpdateFormat).toHaveBeenCalledWith('illustrations', 'manual')
  })

  it('does NOT show the Add Diagram note when illustrations is "none"', () => {
    renderForm()
    expect(
      screen.queryByText(/use the add diagram button/i),
    ).not.toBeInTheDocument()
  })

  it('shows the Add Diagram note when illustrations is "manual"', () => {
    renderForm({
      formatOptions: {
        ...DEFAULT_FORMAT_OPTIONS,
        advanced: { ...DEFAULT_FORMAT_OPTIONS.advanced },
        illustrations: 'manual',
      },
    })
    expect(
      screen.getByText(/use the add diagram button/i),
    ).toBeInTheDocument()
  })

  it('does NOT show the Add Diagram note when illustrations is "automatic"', () => {
    renderForm({
      formatOptions: {
        ...DEFAULT_FORMAT_OPTIONS,
        advanced: { ...DEFAULT_FORMAT_OPTIONS.advanced },
        illustrations: 'automatic',
      },
    })
    expect(
      screen.queryByText(/use the add diagram button/i),
    ).not.toBeInTheDocument()
  })
})

// ── Advanced Options — collapse/expand ────────────────────────────────────────

describe('FormatOptionsForm — Advanced Options collapse/expand', () => {
  it('advanced toggle rows are hidden by default', () => {
    renderForm()
    expect(screen.queryByText('Compact Metadata Layout')).not.toBeInTheDocument()
  })

  it('advanced toggle rows appear after clicking Advanced Options', () => {
    renderForm()
    fireEvent.click(screen.getByRole('button', { name: /advanced options/i }))
    expect(screen.getByText('Compact Metadata Layout')).toBeInTheDocument()
  })

  it('Advanced Options button has aria-expanded="false" by default', () => {
    renderForm()
    expect(
      screen.getByRole('button', { name: /advanced options/i }),
    ).toHaveAttribute('aria-expanded', 'false')
  })

  it('Advanced Options button has aria-expanded="true" after clicking', () => {
    renderForm()
    const btn = screen.getByRole('button', { name: /advanced options/i })
    fireEvent.click(btn)
    expect(btn).toHaveAttribute('aria-expanded', 'true')
  })

  it('advanced rows collapse again after a second click', () => {
    renderForm()
    const btn = screen.getByRole('button', { name: /advanced options/i })
    fireEvent.click(btn)
    fireEvent.click(btn)
    expect(screen.queryByText('Compact Metadata Layout')).not.toBeInTheDocument()
  })
})

// ── Advanced Options — all 7 toggle rows ─────────────────────────────────────

describe('FormatOptionsForm — Advanced toggle rows', () => {
  function renderWithAdvancedOpen(advancedOverrides = {}) {
    const result = renderForm({
      formatOptions: {
        ...DEFAULT_FORMAT_OPTIONS,
        advanced: { ...DEFAULT_FORMAT_OPTIONS.advanced, ...advancedOverrides },
      },
    })
    fireEvent.click(screen.getByRole('button', { name: /advanced options/i }))
    return result
  }

  const ALL_TOGGLE_LABELS = [
    'Compact Metadata Layout',
    'Include Enrolment Row',
    'Include Attendance Row',
    'Include Lesson Evaluation',
    'Include Key Vocabulary',
    'Auto-add AI Illustrations',
    'Write in Local Language',
  ]

  it('renders all 7 toggle rows', () => {
    renderWithAdvancedOpen()
    for (const label of ALL_TOGGLE_LABELS) {
      expect(screen.getByText(label)).toBeInTheDocument()
    }
  })

  it('calls onUpdateAdvanced("compactMetadata", true) when its checkbox is clicked (currently false)', () => {
    const { onUpdateAdvanced } = renderWithAdvancedOpen({ compactMetadata: false })
    const checkbox = screen.getByRole('checkbox', { name: /compact metadata layout/i })
    fireEvent.click(checkbox)
    expect(onUpdateAdvanced).toHaveBeenCalledWith('compactMetadata', true)
  })

  it('calls onUpdateAdvanced("includeEnrolment", true) when its checkbox is clicked', () => {
    const { onUpdateAdvanced } = renderWithAdvancedOpen({ includeEnrolment: false })
    const checkbox = screen.getByRole('checkbox', { name: /include enrolment row/i })
    fireEvent.click(checkbox)
    expect(onUpdateAdvanced).toHaveBeenCalledWith('includeEnrolment', true)
  })

  it('calls onUpdateAdvanced("includeAttendance", true) when its checkbox is clicked', () => {
    const { onUpdateAdvanced } = renderWithAdvancedOpen({ includeAttendance: false })
    const checkbox = screen.getByRole('checkbox', { name: /include attendance row/i })
    fireEvent.click(checkbox)
    expect(onUpdateAdvanced).toHaveBeenCalledWith('includeAttendance', true)
  })

  it('calls onUpdateAdvanced with toggled value (true → false)', () => {
    const { onUpdateAdvanced } = renderWithAdvancedOpen({ includeKeyVocabulary: true })
    const checkbox = screen.getByRole('checkbox', { name: /include key vocabulary/i })
    fireEvent.click(checkbox)
    expect(onUpdateAdvanced).toHaveBeenCalledWith('includeKeyVocabulary', false)
  })
})

// ── localLanguage enable/disable ──────────────────────────────────────────────

describe('FormatOptionsForm — localLanguage toggle', () => {
  function openAdvanced(lessonMedium) {
    const result = renderForm({ lessonMedium })
    fireEvent.click(screen.getByRole('button', { name: /advanced options/i }))
    return result
  }

  it('Write in Local Language checkbox is disabled when medium is English', () => {
    openAdvanced('English')
    const checkbox = screen.getByRole('checkbox', { name: /write in local language/i })
    expect(checkbox).toBeDisabled()
  })

  it('Write in Local Language checkbox is enabled when medium is Bemba', () => {
    openAdvanced('Bemba')
    const checkbox = screen.getByRole('checkbox', { name: /write in local language/i })
    expect(checkbox).not.toBeDisabled()
  })

  it('Write in Local Language checkbox is enabled when medium is Nyanja', () => {
    openAdvanced('Nyanja')
    const checkbox = screen.getByRole('checkbox', { name: /write in local language/i })
    expect(checkbox).not.toBeDisabled()
  })

  it('Write in Local Language checkbox is enabled when medium is Tonga', () => {
    openAdvanced('Tonga')
    const checkbox = screen.getByRole('checkbox', { name: /write in local language/i })
    expect(checkbox).not.toBeDisabled()
  })

  it('Write in Local Language checkbox is enabled when medium is Lozi', () => {
    openAdvanced('Lozi')
    const checkbox = screen.getByRole('checkbox', { name: /write in local language/i })
    expect(checkbox).not.toBeDisabled()
  })

  it('Write in Local Language checkbox is enabled when medium is Kaonde', () => {
    openAdvanced('Kaonde')
    const checkbox = screen.getByRole('checkbox', { name: /write in local language/i })
    expect(checkbox).not.toBeDisabled()
  })

  it('Write in Local Language checkbox is enabled when medium is Luvale', () => {
    openAdvanced('Luvale')
    const checkbox = screen.getByRole('checkbox', { name: /write in local language/i })
    expect(checkbox).not.toBeDisabled()
  })

  it('calls onUpdateAdvanced("localLanguage", true) when enabled and clicked', () => {
    const { onUpdateAdvanced } = openAdvanced('Bemba')
    const checkbox = screen.getByRole('checkbox', { name: /write in local language/i })
    fireEvent.click(checkbox)
    expect(onUpdateAdvanced).toHaveBeenCalledWith('localLanguage', true)
  })
})
