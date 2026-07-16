import { describe, it, expect, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import TeachingProfileMigrationCard from './TeachingProfileMigrationCard'
import { normalizeDetectedAssignments } from '../../../../utils/detectedAssignments'

// Realistic fixtures: raw candidates run through the SAME normaliser the panel
// uses (via buildMigrationPlan), so the spec exercises normalised suggestions.
const SUGGESTIONS = normalizeDetectedAssignments([
  {
    grade: 'G4', subject: 'Mathematics', className: '', curriculumType: 'cbc', curriculumSource: 'structured',
    sources: [
      { id: 'd1', title: 'Grade 4 Mathematics Lesson Plan', typeLabel: 'Lesson Plan', dateMs: Date.UTC(2026, 6, 14) },
      { id: 'd2', title: 'Mathematics Term 2 Scheme of Work', typeLabel: 'Scheme of Work', dateMs: Date.UTC(2026, 6, 10) },
      { id: 'd3', title: 'Grade 4 Mathematics Syllabus', typeLabel: 'Document', dateMs: Date.UTC(2026, 6, 2) },
    ],
  },
  {
    grade: 'G5', subject: 'English', className: '5A', curriculumType: 'cbc', curriculumSource: 'structured',
    sources: [{ id: 'd4', title: 'Grade 5 English Worksheet', typeLabel: 'Worksheet', dateMs: Date.UTC(2026, 6, 1) }],
  },
])
const allKeys = () => new Set(SUGGESTIONS.map((s) => s.key))

// A long list (> 8) to surface the search + filter controls.
const MANY = normalizeDetectedAssignments(
  Array.from({ length: 10 }, (_, i) => ({
    grade: `G${(i % 7) + 1}`,
    subject: i % 2 === 0 ? 'Mathematics' : 'English',
    className: `${i}`,
    curriculumType: 'cbc',
    curriculumSource: 'structured',
    sources: [{ id: `m${i}` }],
  })),
)

const noop = () => {}
function renderCard(overrides = {}) {
  const props = {
    suggestions: SUGGESTIONS,
    selectedKeys: allKeys(),
    onToggle: noop,
    onSelectKeys: noop,
    onClearAll: noop,
    onApply: noop,
    onSkip: noop,
    ...overrides,
  }
  return render(<TeachingProfileMigrationCard {...props} />)
}

describe('TeachingProfileMigrationCard', () => {
  it('renders nothing without suggestions', () => {
    const { container } = renderCard({ suggestions: [] })
    expect(container.firstChild).toBeNull()
  })

  it('shows the banner, a dynamic found-count and normalised rows', () => {
    renderCard()
    expect(screen.getByText(/we found possible teaching assignments from your recent work/i)).toBeInTheDocument()
    expect(screen.getByText(/nothing is saved until you continue/i)).toBeInTheDocument()
    // Counts are computed from the data — never hard-coded.
    expect(screen.getByText('Teaching assignments found (2)')).toBeInTheDocument()
    expect(screen.getByText('2 selected')).toBeInTheDocument()
    expect(screen.getByText('Grade 4 · Mathematics')).toBeInTheDocument()
    expect(screen.getByText(/From 3 documents/)).toBeInTheDocument()
    expect(screen.getByText(/From 1 document$/)).toBeInTheDocument()
    // Real semantic checkboxes.
    expect(screen.getAllByRole('checkbox')).toHaveLength(2)
  })

  it('announces when nothing is selected and disables the continue button', () => {
    renderCard({ selectedKeys: new Set() })
    expect(screen.getByText('No assignments selected')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /add 0 & continue/i })).toBeDisabled()
  })

  it('uses singular grammar for one selected assignment', () => {
    renderCard({ selectedKeys: new Set([SUGGESTIONS[0].key]) })
    expect(screen.getByRole('button', { name: 'Add 1 & continue' })).toBeEnabled()
    expect(screen.getByText('1 selected')).toBeInTheDocument()
  })

  it('select all / clear all hand the right keys back to the parent', async () => {
    const onSelectKeys = vi.fn()
    const onClearAll = vi.fn()
    renderCard({ selectedKeys: new Set(), onSelectKeys, onClearAll })
    await userEvent.click(screen.getByRole('button', { name: 'Select all' }))
    expect(onSelectKeys).toHaveBeenCalledWith(SUGGESTIONS.map((s) => s.key))
    // Clear all is disabled at zero selected; re-render with a selection.
    renderCard({ onClearAll })
    await userEvent.click(screen.getAllByRole('button', { name: 'Clear all' })[1])
    expect(onClearAll).toHaveBeenCalled()
  })

  it('toggles a row via its checkbox and confirms via the primary button', async () => {
    const onToggle = vi.fn()
    const onApply = vi.fn()
    renderCard({ onToggle, onApply })
    await userEvent.click(screen.getAllByRole('checkbox')[0])
    expect(onToggle).toHaveBeenCalledWith(SUGGESTIONS[0].key)
    await userEvent.click(screen.getByRole('button', { name: /add 2 & continue/i }))
    expect(onApply).toHaveBeenCalled()
  })

  it('expands source details from the chevron WITHOUT toggling selection (keyboard accessible)', async () => {
    const onToggle = vi.fn()
    renderCard({ onToggle })
    const expand = screen.getByRole('button', { name: /show source documents for grade 4 · mathematics/i })
    expect(expand).toHaveAttribute('aria-expanded', 'false')

    // Keyboard: focus + Enter (native button semantics).
    expand.focus()
    await userEvent.keyboard('{Enter}')
    expect(expand).toHaveAttribute('aria-expanded', 'true')
    const detailsId = expand.getAttribute('aria-controls')
    const details = document.getElementById(detailsId)
    expect(details).toBeTruthy()
    expect(within(details).getByText('Detected from:')).toBeInTheDocument()
    expect(within(details).getByText('Grade 4 Mathematics Lesson Plan')).toBeInTheDocument()
    expect(within(details).getByText(/Lesson Plan · 14 July 2026/)).toBeInTheDocument()
    // No internal Firestore ids anywhere in the details panel.
    expect(within(details).queryByText(/d1|d2|d3/)).toBeNull()
    // Selection untouched.
    expect(onToggle).not.toHaveBeenCalled()

    // Collapses again.
    await userEvent.keyboard('{Enter}')
    expect(expand).toHaveAttribute('aria-expanded', 'false')
  })

  it('offers start-from-scratch and surfaces save errors accessibly', async () => {
    const onSkip = vi.fn()
    renderCard({ onSkip, error: 'We could not add those assignments.' })
    expect(screen.getByRole('alert')).toHaveTextContent('We could not add those assignments.')
    await userEvent.click(screen.getByRole('button', { name: /start from scratch/i }))
    expect(onSkip).toHaveBeenCalled()
  })

  it('prevents double submission while applying', () => {
    renderCard({ applying: true })
    expect(screen.getByRole('button', { name: /adding…/i })).toBeDisabled()
    expect(screen.getByRole('button', { name: /start from scratch/i })).toBeDisabled()
  })

  it('hides search + filters for short lists, shows them past 8 assignments', () => {
    renderCard()
    expect(screen.queryByRole('searchbox')).toBeNull()
    renderCard({ suggestions: MANY, selectedKeys: new Set() })
    expect(screen.getByRole('searchbox', { name: /search assignments/i })).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: /filter by grade/i })).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: /filter by curriculum/i })).toBeInTheDocument()
  })

  it('search + filters narrow the NORMALISED list and can be cleared', async () => {
    renderCard({ suggestions: MANY, selectedKeys: new Set() })
    const search = screen.getByRole('searchbox', { name: /search assignments/i })
    await userEvent.type(search, 'english')
    // 5 of the 10 fixtures are English.
    expect(screen.getAllByRole('checkbox')).toHaveLength(5)
    await userEvent.click(screen.getByRole('button', { name: 'Clear filters' }))
    expect(screen.getAllByRole('checkbox')).toHaveLength(10)
    // Grade filter alone.
    await userEvent.selectOptions(screen.getByRole('combobox', { name: /filter by grade/i }), 'G1')
    expect(screen.getAllByRole('checkbox').length).toBeLessThan(10)
  })

  it('select all with an active filter only selects the visible assignments', async () => {
    const onSelectKeys = vi.fn()
    renderCard({ suggestions: MANY, selectedKeys: new Set(), onSelectKeys })
    await userEvent.type(screen.getByRole('searchbox', { name: /search assignments/i }), 'english')
    await userEvent.click(screen.getByRole('button', { name: 'Select all' }))
    const keys = onSelectKeys.mock.calls[0][0]
    expect(keys).toHaveLength(5)
    expect(keys.every((k) => k.includes('english'))).toBe(true)
  })
})
