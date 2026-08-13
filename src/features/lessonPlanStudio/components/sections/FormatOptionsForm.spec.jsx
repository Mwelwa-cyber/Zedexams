import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import { FormatOptionsForm } from './FormatOptionsForm'
import { initialFormatOptions } from '../../../../utils/lessonPlanFormat'

// ── Default props ─────────────────────────────────────────────────────────────

// The studio's real defaults, so this spec cannot drift from the shape the
// form actually receives — with the advanced toggles forced off so the
// "clicking turns it on" cases below start from a known state.
const DEFAULT_FORMAT_OPTIONS = {
  ...initialFormatOptions('2'),
  advanced: {
    compactMetadata: false,
    includeEnrolment: false,
    includeAttendance: false,
    autoIllustrations: false,
    localLanguage: false,
  },
}

function renderForm(props = {}) {
  const defaults = {
    formatOptions: { ...DEFAULT_FORMAT_OPTIONS, advanced: { ...DEFAULT_FORMAT_OPTIONS.advanced } },
    onUpdateFormat: vi.fn(),
    onUpdateAdvanced: vi.fn(),
    onUpdateSection: vi.fn(),
    onUpdateMedium: vi.fn(),
    lessonMedium: 'English',
    ...props,
  }
  return {
    ...render(<FormatOptionsForm {...defaults} />),
    onUpdateFormat: defaults.onUpdateFormat,
    onUpdateAdvanced: defaults.onUpdateAdvanced,
    onUpdateSection: defaults.onUpdateSection,
    onUpdateMedium: defaults.onUpdateMedium,
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
    expect(screen.queryByText('Page Budget')).not.toBeInTheDocument()
  })

  it('expands body on second header click', () => {
    renderForm()
    const btn = getSectionToggle()
    fireEvent.click(btn)
    fireEvent.click(btn)
    expect(btn).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByText('Page Budget')).toBeInTheDocument()
  })
})

// ── Sub-section presence ──────────────────────────────────────────────────────

describe('FormatOptionsForm — all 5 sub-sections present', () => {
  it('renders "Page Budget" sub-section label', () => {
    renderForm()
    // §2.1 — Page Budget replaced Detail Level, which changed tone and called
    // it length. What a teacher cares about is how much paper the plan costs.
    expect(screen.getByText('Page Budget')).toBeInTheDocument()
    expect(screen.queryByText('Lesson Plan Detail')).not.toBeInTheDocument()
  })

  it('renders "Writing Style" sub-section label', () => {
    renderForm()
    expect(screen.getByText('Writing Style')).toBeInTheDocument()
  })

  it('renders "Lesson Plan Format" sub-section label', () => {
    renderForm()
    expect(screen.getByText('Lesson Plan Format')).toBeInTheDocument()
  })

  it('does NOT render the "Illustrations" sub-section label (bar is hidden)', () => {
    renderForm()
    expect(screen.queryByText('Illustrations')).not.toBeInTheDocument()
  })

  it('renders "Advanced Options" toggle button', () => {
    renderForm()
    expect(screen.getByRole('button', { name: /advanced options/i })).toBeInTheDocument()
  })
})

// ── Page Budget (§2.1) ────────────────────────────────────────────────────────

describe('FormatOptionsForm — Page Budget (§2.1)', () => {
  const budgetOptions = { ...DEFAULT_FORMAT_OPTIONS, pageBudget: '1' }

  it('renders 1 page, 2 pages and No limit option cards', () => {
    renderForm()
    expect(screen.getByText('1 page')).toBeInTheDocument()
    expect(screen.getByText('2 pages')).toBeInTheDocument()
    expect(screen.getByText('No limit')).toBeInTheDocument()
  })

  it('calls onUpdateFormat("pageBudget", "1") when 1 page is clicked', () => {
    const { onUpdateFormat } = renderForm()
    fireEvent.click(screen.getByText('1 page').closest('button'))
    expect(onUpdateFormat).toHaveBeenCalledWith('pageBudget', '1')
  })

  it('calls onUpdateFormat("pageBudget", "none") when No limit is clicked', () => {
    const { onUpdateFormat } = renderForm()
    fireEvent.click(screen.getByText('No limit').closest('button'))
    expect(onUpdateFormat).toHaveBeenCalledWith('pageBudget', 'none')
  })

  it('the selected page-budget card has a blue border', () => {
    renderForm({ formatOptions: budgetOptions })
    expect(screen.getByText('1 page').closest('button').className).toMatch(/border-blue-500/)
  })

  it('an unselected page-budget card does not have a blue border', () => {
    renderForm({ formatOptions: budgetOptions })
    expect(screen.getByText('No limit').closest('button').className).not.toMatch(/border-blue-500/)
  })
})

// ── Paper Fit (§2.5) ──────────────────────────────────────────────────────────

describe('FormatOptionsForm — Paper Fit (§2.5)', () => {
  it('offers the three margin presets and a fine slider', () => {
    renderForm()
    expect(screen.getByText('Normal')).toBeInTheDocument()
    expect(screen.getByText('Narrow')).toBeInTheDocument()
    expect(screen.getByText('Minimum')).toBeInTheDocument()
    expect(screen.getByLabelText('Margin in millimetres')).toBeInTheDocument()
  })

  it('a preset sets the margin in millimetres', () => {
    const { onUpdateFormat } = renderForm()
    fireEvent.click(screen.getByText('Narrow'))
    expect(onUpdateFormat).toHaveBeenCalledWith('marginMm', 10)
  })

  it('warns below 8 mm but never blocks', () => {
    renderForm({ formatOptions: { ...DEFAULT_FORMAT_OPTIONS, marginMm: 7 } })
    const warning = screen.getByTestId('margin-safe-warning')
    expect(warning.textContent).toMatch(/cut off/i)
    expect(warning.textContent).toMatch(/You can still print/i)
    // The slider stays usable — a warning is advice, not a gate.
    expect(screen.getByLabelText('Margin in millimetres')).not.toBeDisabled()
  })

  it('turns red at the printer safe area', () => {
    renderForm({ formatOptions: { ...DEFAULT_FORMAT_OPTIONS, marginMm: 5 } })
    expect(screen.getByTestId('margin-safe-warning').className).toMatch(/red/)
  })

  it('says nothing at a normal margin', () => {
    renderForm({ formatOptions: { ...DEFAULT_FORMAT_OPTIONS, marginMm: 15 } })
    expect(screen.queryByTestId('margin-safe-warning')).not.toBeInTheDocument()
  })

  it('offers a density choice', () => {
    const { onUpdateFormat } = renderForm()
    fireEvent.click(screen.getByText('Comfortable'))
    expect(onUpdateFormat).toHaveBeenCalledWith('density', 'comfortable')
  })
})

// ── Learning environment display (§2.3) ───────────────────────────────────────

describe('FormatOptionsForm — Learning Environment display (§2.3)', () => {
  const envGroup = () => screen.getByRole('group', { name: 'Learning environment display' })

  it('offers Simple and Detailed, and explains what each prints', () => {
    renderForm()
    const group = envGroup()
    expect(within(group).getByRole('button', { name: 'Simple' })).toBeInTheDocument()
    expect(within(group).getByRole('button', { name: 'Detailed' })).toBeInTheDocument()
    expect(screen.getByText(/Prints one line/)).toBeInTheDocument()
  })

  it('switches to Detailed', () => {
    const { onUpdateFormat } = renderForm()
    fireEvent.click(within(envGroup()).getByRole('button', { name: 'Detailed' }))
    expect(onUpdateFormat).toHaveBeenCalledWith('environmentDisplay', 'detailed')
  })

  it('is hidden for OBC, which has no learning-environment section', () => {
    renderForm({ curriculumMode: 'previous' })
    expect(screen.queryByText('Learning Environment')).not.toBeInTheDocument()
  })
})

// ── Header style (§4.3) ───────────────────────────────────────────────────────

describe('FormatOptionsForm — Header style (§4.3)', () => {
  it('offers School and Ministry + School', () => {
    renderForm()
    expect(screen.getByText('School')).toBeInTheDocument()
    expect(screen.getByText('Ministry + School')).toBeInTheDocument()
  })

  it('reveals an editable ministry line when Ministry is chosen', () => {
    renderForm({ formatOptions: { ...DEFAULT_FORMAT_OPTIONS, headerStyle: 'ministry' } })
    // The wording stays editable — older documents say "Ministry of General
    // Education", and a GRZ teacher sets theirs once.
    expect(screen.getByLabelText('Ministry line')).toBeInTheDocument()
  })

  it('hides the ministry line for the School header', () => {
    renderForm()
    expect(screen.queryByLabelText('Ministry line')).not.toBeInTheDocument()
  })
})

// ── Writing Style ─────────────────────────────────────────────────────────────

describe('FormatOptionsForm — Writing Style', () => {
  it('renders Point form, Simple, Standard and Professional pills', () => {
    renderForm()
    for (const label of ['Point form', 'Simple', 'Standard', 'Professional']) {
      expect(screen.getAllByRole('button', { name: label }).length).toBeGreaterThan(0)
    }
  })

  it('Point form is the default whenever the pages are limited (§2.2)', () => {
    renderForm({ formatOptions: initialFormatOptions('2') })
    expect(screen.getByRole('button', { name: 'Point form' }).className).toMatch(/border-blue-500/)
    expect(screen.getByText(/as teachers write in a plan book/i)).toBeInTheDocument()
  })

  it('No limit keeps the old Standard prose default', () => {
    renderForm({ formatOptions: initialFormatOptions('none') })
    expect(screen.getByRole('button', { name: 'Standard' }).className).toMatch(/border-blue-500/)
  })

  it('calls onUpdateFormat("writingStyle", "simple") when Simple is clicked', () => {
    const { onUpdateFormat } = renderForm()
    // "Simple" is also the Learning Environment display label, so scope the
    // query to the writing-style pills rather than matching the first hit.
    fireEvent.click(screen.getAllByRole('button', { name: 'Simple' })[0])
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

// The Illustrations bar is temporarily hidden behind SHOW_ILLUSTRATIONS while
// the feature is reworked. None of its controls should render.
describe('FormatOptionsForm — Illustrations (hidden)', () => {
  it('does NOT render the None / Automatic / Add Manually pills', () => {
    renderForm()
    expect(screen.queryByRole('button', { name: 'None' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Automatic' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Add Manually' })).not.toBeInTheDocument()
  })

  it('does NOT show the Add Diagram note even when illustrations is "manual"', () => {
    renderForm({
      formatOptions: {
        ...DEFAULT_FORMAT_OPTIONS,
        advanced: { ...DEFAULT_FORMAT_OPTIONS.advanced },
        illustrations: 'manual',
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

  // 'Auto-add AI Illustrations' is intentionally omitted — it's hidden along
  // with the Illustrations bar (see SHOW_ILLUSTRATIONS in FormatOptionsForm).
  // "Include Lesson Evaluation" moved into the per-section checkboxes (§2.4),
  // where it sits with every other section a teacher can drop.
  const ALL_TOGGLE_LABELS = [
    'Compact Metadata Layout',
    'Include Enrolment Row',
    'Include Attendance Row',
    'Write in Local Language',
  ]

  it('renders every layout toggle row', () => {
    renderWithAdvancedOpen()
    for (const label of ALL_TOGGLE_LABELS) {
      expect(screen.getByText(label)).toBeInTheDocument()
    }
  })

  it('offers a checkbox per optional section (§2.4)', () => {
    renderWithAdvancedOpen()
    for (const label of ['Rationale', 'Prior knowledge', 'References', 'Remedial work', 'Lesson evaluation']) {
      expect(screen.getByRole('checkbox', { name: label })).toBeInTheDocument()
    }
  })

  it('switching a section off reports it through onUpdateSection', () => {
    const { onUpdateSection } = renderWithAdvancedOpen()
    fireEvent.click(screen.getByRole('checkbox', { name: 'Rationale' }))
    expect(onUpdateSection).toHaveBeenCalledWith('rationale', false)
  })

  it('the 1-page budget shows rationale, remedial and extension already off', () => {
    renderForm({ formatOptions: initialFormatOptions('1') })
    fireEvent.click(screen.getByRole('button', { name: /advanced options/i }))
    expect(screen.getByRole('checkbox', { name: 'Rationale' })).not.toBeChecked()
    expect(screen.getByRole('checkbox', { name: 'Remedial work' })).not.toBeChecked()
    expect(screen.getByRole('checkbox', { name: 'Prior knowledge' })).toBeChecked()
  })

  it('does NOT render the "Auto-add AI Illustrations" toggle while illustrations are hidden', () => {
    renderWithAdvancedOpen()
    expect(screen.queryByText('Auto-add AI Illustrations')).not.toBeInTheDocument()
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
    const { onUpdateAdvanced } = renderWithAdvancedOpen({ compactMetadata: true })
    fireEvent.click(screen.getByRole('checkbox', { name: /compact metadata layout/i }))
    expect(onUpdateAdvanced).toHaveBeenCalledWith('compactMetadata', false)
  })
})

// ── Medium of Instruction (moved into Advanced) ───────────────────────────────

describe('FormatOptionsForm — Medium of Instruction', () => {
  it('is hidden until Advanced Options is expanded', () => {
    renderForm()
    expect(screen.queryByLabelText(/medium of instruction/i)).not.toBeInTheDocument()
  })

  it('appears inside Advanced Options with the current medium selected', () => {
    renderForm({ lessonMedium: 'Bemba' })
    fireEvent.click(screen.getByRole('button', { name: /advanced options/i }))
    const select = screen.getByLabelText(/medium of instruction/i)
    expect(select).toBeInTheDocument()
    expect(select).toHaveValue('Bemba')
  })

  it('calls onUpdateMedium when a different language is chosen', () => {
    const { onUpdateMedium } = renderForm()
    fireEvent.click(screen.getByRole('button', { name: /advanced options/i }))
    fireEvent.change(screen.getByLabelText(/medium of instruction/i), {
      target: { value: 'Nyanja' },
    })
    expect(onUpdateMedium).toHaveBeenCalledWith('Nyanja')
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
