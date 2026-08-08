import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { LessonDetailsForm } from './LessonDetailsForm'
import { useAvailableGrades } from '../hooks/useAvailableGrades.js'

// Subjects now come from the syllabi data via this hook (so the picked value
// is a real syllabi key). Mock it so the form's subject dropdown is
// deterministic and we avoid the firebase/fetch chain in jsdom.
vi.mock('../hooks/useSubjectsForGrade.js', () => ({
  useSubjectsForGrade: vi.fn((grade) => ({
    subjects: grade
      ? ['Mathematics Syllabus (Grades 4-6)', 'Science Syllabus (Grades 4-6)']
      : [],
    loading: false,
    error: null,
  })),
}))

// The Class picker filters its grade list down to grades with subject data via
// this hook. Default mock returns `available: null` → "unknown / load not
// resolved", which makes the form fall back to the full static candidate list,
// so the existing grade-list assertions below are unaffected. Individual tests
// override it to exercise the data-driven filtering.
vi.mock('../hooks/useAvailableGrades.js', () => ({
  useAvailableGrades: vi.fn(() => ({ available: null, loading: false })),
}))

const DEFAULT_DETAILS = {
  grade: '',
  subject: '',
  duration: '40',
  medium: 'English',
  date: '',
  time: '',
}

function renderForm(props = {}) {
  const defaults = {
    lessonDetails: { ...DEFAULT_DETAILS },
    curriculumMode: 'cbc',
    onChange: vi.fn(),
    disabled: false,
    ...props,
  }
  return { ...render(<LessonDetailsForm {...defaults} />), onChange: defaults.onChange }
}

// ── Planned-date hint + non-teaching-day warning ─────────────────────────────
describe('planned-date guidance', () => {
  it('shows an inline hint when a date could not be suggested', () => {
    const { getByText, queryByRole } = renderForm({ dateHint: 'Select the date you plan to teach this lesson.' })
    expect(getByText('Select the date you plan to teach this lesson.')).toBeInTheDocument()
    expect(queryByRole('alert')).toBeNull()
  })
  it('shows a non-teaching-day warning (which supersedes the hint)', () => {
    const { getByRole, queryByText } = renderForm({
      lessonDetails: { ...DEFAULT_DETAILS, date: '2026-05-16' },
      dateHint: 'Select the date you plan to teach this lesson.',
      dateWarning: 'This date is not a normal teaching day. Weekends are currently treated as non-teaching days. Choose another date or confirm that your school teaches on this day.',
    })
    expect(getByRole('alert')).toHaveTextContent(/not a normal teaching day/i)
    expect(queryByText('Select the date you plan to teach this lesson.')).toBeNull()
  })
  it('shows neither by default', () => {
    const { queryByRole, queryByText } = renderForm()
    expect(queryByRole('alert')).toBeNull()
    expect(queryByText(/plan to teach/i)).toBeNull()
  })
})

// ── Section header ────────────────────────────────────────────────────────────

describe('LessonDetailsForm — section header', () => {
  it('renders the "Lesson Details" heading', () => {
    renderForm()
    expect(screen.getByText('Lesson Details')).toBeInTheDocument()
  })

  it('shows a grey status dot when grade and subject are empty', () => {
    renderForm({ lessonDetails: { ...DEFAULT_DETAILS, grade: '', subject: '' } })
    // The dot element is aria-hidden; query by class fragment via container
    const { container } = render(
      <LessonDetailsForm
        lessonDetails={{ ...DEFAULT_DETAILS }}
        curriculumMode="cbc"
        onChange={vi.fn()}
        disabled={false}
      />,
    )
    // grey dot class contains bg-[#c9c0b0]
    expect(container.querySelector('.bg-\\[\\#c9c0b0\\]')).toBeInTheDocument()
  })

  it('shows a green status dot when both grade and subject are filled', () => {
    const { container } = render(
      <LessonDetailsForm
        lessonDetails={{ ...DEFAULT_DETAILS, grade: 'Grade 4', subject: 'Mathematics' }}
        curriculumMode="cbc"
        onChange={vi.fn()}
        disabled={false}
      />,
    )
    expect(container.querySelector('.bg-green-500')).toBeInTheDocument()
  })
})

// ── Collapse / expand ─────────────────────────────────────────────────────────

describe('LessonDetailsForm — collapse/expand', () => {
  it('body is visible by default (starts open)', () => {
    renderForm()
    // The Class select is inside the body
    expect(screen.getByRole('combobox', { name: /class/i })).toBeInTheDocument()
  })

  it('hides the body after clicking the toggle button', () => {
    renderForm()
    const toggle = screen.getByRole('button', { name: /lesson details/i })
    fireEvent.click(toggle)
    expect(screen.queryByRole('combobox', { name: /class/i })).not.toBeInTheDocument()
  })

  it('shows the body again after a second click', () => {
    renderForm()
    const toggle = screen.getByRole('button', { name: /lesson details/i })
    fireEvent.click(toggle)
    fireEvent.click(toggle)
    expect(screen.getByRole('combobox', { name: /class/i })).toBeInTheDocument()
  })

  it('toggle button exposes aria-expanded', () => {
    renderForm()
    const toggle = screen.getByRole('button', { name: /lesson details/i })
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    fireEvent.click(toggle)
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
  })
})

// ── Grade optgroups differ by curriculum mode ─────────────────────────────────

describe('LessonDetailsForm — CBC grade optgroups', () => {
  it('renders CBC optgroups: ECE, Lower Primary, Upper Primary, Secondary', () => {
    const { container } = render(
      <LessonDetailsForm
        lessonDetails={{ ...DEFAULT_DETAILS }}
        curriculumMode="cbc"
        onChange={vi.fn()}
        disabled={false}
      />,
    )
    const groups = [...container.querySelectorAll('optgroup')].map((g) => g.label)
    expect(groups).toContain('ECE')
    expect(groups).toContain('Lower Primary')
    expect(groups).toContain('Upper Primary')
    expect(groups).toContain('Secondary')
  })

  it('CBC Lower Primary contains Grade 1, Grade 2, Grade 3', () => {
    const { container } = render(
      <LessonDetailsForm
        lessonDetails={{ ...DEFAULT_DETAILS }}
        curriculumMode="cbc"
        onChange={vi.fn()}
        disabled={false}
      />,
    )
    const lp = [...container.querySelectorAll('optgroup')].find((g) => g.label === 'Lower Primary')
    const values = [...lp.querySelectorAll('option')].map((o) => o.value)
    expect(values).toContain('Grade 1')
    expect(values).toContain('Grade 2')
    expect(values).toContain('Grade 3')
  })

  it('CBC Secondary contains Form 1 through Form 4', () => {
    const { container } = render(
      <LessonDetailsForm
        lessonDetails={{ ...DEFAULT_DETAILS }}
        curriculumMode="cbc"
        onChange={vi.fn()}
        disabled={false}
      />,
    )
    const sec = [...container.querySelectorAll('optgroup')].find((g) => g.label === 'Secondary')
    const values = [...sec.querySelectorAll('option')].map((o) => o.value)
    expect(values).toContain('Form 1')
    expect(values).toContain('Form 2')
    expect(values).toContain('Form 3')
    expect(values).toContain('Form 4')
  })
})

// ── Class picker hides grades with no subject data ────────────────────────────

describe('LessonDetailsForm — grades filtered to those with subjects', () => {
  it('omits classes that have no subject data (CBC Grade 5/6, ECE)', () => {
    // Real CBC data only resolves subjects for Grade 1-4 + Form 1-4.
    useAvailableGrades.mockReturnValueOnce({
      available: ['Grade 1', 'Grade 2', 'Grade 3', 'Grade 4', 'Form 1', 'Form 2', 'Form 3', 'Form 4'],
      loading: false,
    })
    const { container } = render(
      <LessonDetailsForm
        lessonDetails={{ ...DEFAULT_DETAILS }}
        curriculumMode="cbc"
        onChange={vi.fn()}
        disabled={false}
      />,
    )
    const classSelect = container.querySelectorAll('select')[0]
    const values = [...classSelect.querySelectorAll('option')].map((o) => o.value)
    // The dead-end classes are gone…
    expect(values).not.toContain('Grade 5')
    expect(values).not.toContain('Grade 6')
    expect(values).not.toContain('Nursery')
    expect(values).not.toContain('Reception')
    // …but the ones with data remain.
    expect(values).toContain('Grade 4')
    expect(values).toContain('Form 1')
  })

  it('clears a selected grade once it is found to have no subjects', () => {
    const onChange = vi.fn()
    useAvailableGrades.mockReturnValueOnce({
      available: ['Grade 4', 'Form 1'],
      loading: false,
    })
    render(
      <LessonDetailsForm
        lessonDetails={{ ...DEFAULT_DETAILS, grade: 'Grade 5' }}
        curriculumMode="cbc"
        onChange={onChange}
        disabled={false}
      />,
    )
    expect(onChange).toHaveBeenCalledWith('grade', '')
  })

  it('shows a loading placeholder while availability is resolving', () => {
    useAvailableGrades.mockReturnValueOnce({ available: null, loading: true })
    render(
      <LessonDetailsForm
        lessonDetails={{ ...DEFAULT_DETAILS }}
        curriculumMode="cbc"
        onChange={vi.fn()}
        disabled={false}
      />,
    )
    expect(screen.getByRole('option', { name: /loading classes/i })).toBeInTheDocument()
  })
})

describe('LessonDetailsForm — Previous Curriculum grade optgroups', () => {
  // Regression: the Previous "Lower Primary" group used to be a single option
  // whose value was the literal string "Lower Primary" — which matches no sheet
  // in curriculum-data-2013.json, so it showed the group with no real grades and
  // produced an empty subject list. It must expand to Grade 1–4.
  it('Previous Lower Primary contains Grade 1 through Grade 4 (real grade values)', () => {
    const { container } = render(
      <LessonDetailsForm
        lessonDetails={{ ...DEFAULT_DETAILS }}
        curriculumMode="previous"
        onChange={vi.fn()}
        disabled={false}
      />,
    )
    const lp = [...container.querySelectorAll('optgroup')].find((g) => g.label === 'Lower Primary')
    expect(lp).toBeTruthy()
    const values = [...lp.querySelectorAll('option')].map((o) => o.value)
    expect(values).toEqual(['Grade 1', 'Grade 2', 'Grade 3', 'Grade 4'])
    // No group-name placeholder leaks back in.
    expect(values).not.toContain('Lower Primary')
  })

  it('Previous Upper Primary contains Grade 5, Grade 6, Grade 7 (not Grade 1-3)', () => {
    const { container } = render(
      <LessonDetailsForm
        lessonDetails={{ ...DEFAULT_DETAILS }}
        curriculumMode="previous"
        onChange={vi.fn()}
        disabled={false}
      />,
    )
    const up = [...container.querySelectorAll('optgroup')].find((g) => g.label === 'Upper Primary')
    const values = [...up.querySelectorAll('option')].map((o) => o.value)
    expect(values).toContain('Grade 5')
    expect(values).toContain('Grade 6')
    expect(values).toContain('Grade 7')
    expect(values).not.toContain('Grade 1')
    expect(values).not.toContain('Grade 2')
    expect(values).not.toContain('Grade 3')
  })

  it('Previous Secondary contains Grade 8 through Grade 12', () => {
    const { container } = render(
      <LessonDetailsForm
        lessonDetails={{ ...DEFAULT_DETAILS }}
        curriculumMode="previous"
        onChange={vi.fn()}
        disabled={false}
      />,
    )
    const sec = [...container.querySelectorAll('optgroup')].find((g) => g.label === 'Secondary')
    const values = [...sec.querySelectorAll('option')].map((o) => o.value)
    expect(values).toContain('Grade 8')
    expect(values).toContain('Grade 12')
    expect(values).not.toContain('Form 1')
  })

  it('Previous does not have Form 1-4 anywhere in class options', () => {
    const { container } = render(
      <LessonDetailsForm
        lessonDetails={{ ...DEFAULT_DETAILS }}
        curriculumMode="previous"
        onChange={vi.fn()}
        disabled={false}
      />,
    )
    // Only look at the class select (first select in the form)
    const classSelect = container.querySelectorAll('select')[0]
    const values = [...classSelect.querySelectorAll('option')].map((o) => o.value)
    expect(values).not.toContain('Form 1')
    expect(values).not.toContain('Form 4')
  })
})

// ── Grade resets on mode change ───────────────────────────────────────────────

describe('LessonDetailsForm — grade reset on curriculum mode change', () => {
  it('calls onChange("grade", "") when curriculumMode changes and grade is invalid', () => {
    const onChange = vi.fn()
    // "Form 1" is valid in CBC but not Previous
    const { rerender } = render(
      <LessonDetailsForm
        lessonDetails={{ ...DEFAULT_DETAILS, grade: 'Form 1' }}
        curriculumMode="cbc"
        onChange={onChange}
        disabled={false}
      />,
    )
    rerender(
      <LessonDetailsForm
        lessonDetails={{ ...DEFAULT_DETAILS, grade: 'Form 1' }}
        curriculumMode="previous"
        onChange={onChange}
        disabled={false}
      />,
    )
    expect(onChange).toHaveBeenCalledWith('grade', '')
  })

  it('does NOT call onChange("grade", "") when grade is still valid after mode change', () => {
    const onChange = vi.fn()
    // "Grade 5" is valid in both CBC and Previous
    const { rerender } = render(
      <LessonDetailsForm
        lessonDetails={{ ...DEFAULT_DETAILS, grade: 'Grade 5' }}
        curriculumMode="cbc"
        onChange={onChange}
        disabled={false}
      />,
    )
    rerender(
      <LessonDetailsForm
        lessonDetails={{ ...DEFAULT_DETAILS, grade: 'Grade 5' }}
        curriculumMode="previous"
        onChange={onChange}
        disabled={false}
      />,
    )
    expect(onChange).not.toHaveBeenCalledWith('grade', '')
  })

  it('does NOT reset grade when curriculumMode is null', () => {
    const onChange = vi.fn()
    render(
      <LessonDetailsForm
        lessonDetails={{ ...DEFAULT_DETAILS, grade: 'Form 1' }}
        curriculumMode={null}
        onChange={onChange}
        disabled={true}
      />,
    )
    expect(onChange).not.toHaveBeenCalledWith('grade', '')
  })
})

// ── onChange fired correctly ──────────────────────────────────────────────────

describe('LessonDetailsForm — onChange callbacks', () => {
  it('calls onChange("grade", value) when class is changed', () => {
    const onChange = vi.fn()
    render(
      <LessonDetailsForm
        lessonDetails={{ ...DEFAULT_DETAILS }}
        curriculumMode="cbc"
        onChange={onChange}
        disabled={false}
      />,
    )
    fireEvent.change(screen.getByRole('combobox', { name: /class/i }), {
      target: { value: 'Grade 4' },
    })
    expect(onChange).toHaveBeenCalledWith('grade', 'Grade 4')
  })

  it('calls onChange("subject", value) when subject is changed', () => {
    const onChange = vi.fn()
    render(
      <LessonDetailsForm
        lessonDetails={{ ...DEFAULT_DETAILS, grade: 'Grade 4' }}
        curriculumMode="cbc"
        onChange={onChange}
        disabled={false}
      />,
    )
    // The subject dropdown is enabled once a grade is chosen and its options are
    // the syllabi subject keys (mocked above) — not static labels.
    fireEvent.change(screen.getByRole('combobox', { name: /subject/i }), {
      target: { value: 'Mathematics Syllabus (Grades 4-6)' },
    })
    expect(onChange).toHaveBeenCalledWith('subject', 'Mathematics Syllabus (Grades 4-6)')
  })

  it('disables the subject dropdown until a grade is chosen', () => {
    renderForm({ lessonDetails: { ...DEFAULT_DETAILS, grade: '' } })
    expect(screen.getByRole('combobox', { name: /subject/i })).toBeDisabled()
  })

  it('lists syllabi subjects (cleaned label) once a grade is chosen', () => {
    renderForm({ lessonDetails: { ...DEFAULT_DETAILS, grade: 'Grade 4' } })
    const subjectSelect = screen.getByRole('combobox', { name: /subject/i })
    expect(subjectSelect).not.toBeDisabled()
    // Cleaned label shown to the teacher…
    const opt = screen.getByRole('option', { name: 'Mathematics' })
    // …but the stored value is the full syllabi key that topic lookup needs.
    expect(opt).toHaveValue('Mathematics Syllabus (Grades 4-6)')
  })

  it('clears a stale subject that is not offered for the new grade', () => {
    const onChange = vi.fn()
    render(
      <LessonDetailsForm
        lessonDetails={{ ...DEFAULT_DETAILS, grade: 'Grade 4', subject: 'Some Old Subject' }}
        curriculumMode="cbc"
        onChange={onChange}
        disabled={false}
      />,
    )
    expect(onChange).toHaveBeenCalledWith('subject', '')
  })

  it('calls onChange("duration", value) when duration is changed', () => {
    const onChange = vi.fn()
    render(
      <LessonDetailsForm
        lessonDetails={{ ...DEFAULT_DETAILS }}
        curriculumMode="cbc"
        onChange={onChange}
        disabled={false}
      />,
    )
    fireEvent.change(screen.getByLabelText('Duration'), { target: { value: '60' } })
    expect(onChange).toHaveBeenCalledWith('duration', '60')
  })
})

// ── School resources picker ───────────────────────────────────────────────────

describe('LessonDetailsForm — school resources', () => {
  it('renders the School Resources select with all three levels', () => {
    renderForm()
    const select = screen.getByRole('combobox', { name: /school resources/i })
    const values = [...select.querySelectorAll('option')].map((o) => o.value)
    expect(values).toEqual(['low', 'basic', 'full'])
  })

  it('defaults to basic when lessonDetails has no resources value', () => {
    renderForm() // DEFAULT_DETAILS has no `resources` key
    expect(screen.getByRole('combobox', { name: /school resources/i })).toHaveValue('basic')
  })

  it('calls onChange("resources", "low") when the rural level is picked', () => {
    const { onChange } = renderForm()
    fireEvent.change(screen.getByRole('combobox', { name: /school resources/i }), {
      target: { value: 'low' },
    })
    expect(onChange).toHaveBeenCalledWith('resources', 'low')
  })

  it('reflects a stored resources value', () => {
    renderForm({ lessonDetails: { ...DEFAULT_DETAILS, resources: 'low' } })
    expect(screen.getByRole('combobox', { name: /school resources/i })).toHaveValue('low')
  })
})

// ── Compact layout (B3): two-column + three-column rows ──────────────────────

describe('LessonDetailsForm — compact grid layout', () => {
  it('lays Class | Subject in a two-column row (≥640px)', () => {
    const { container } = renderForm()
    const row = container.querySelector('.sm\\:grid-cols-2')
    expect(row).toBeTruthy()
    expect(row.contains(document.getElementById('ldf-grade'))).toBe(true)
    expect(row.contains(document.getElementById('ldf-subject'))).toBe(true)
  })

  it('lays Duration | Date | Time in a three-column row (≥640px)', () => {
    const { container } = renderForm()
    const row = container.querySelector('.sm\\:grid-cols-3')
    expect(row).toBeTruthy()
    expect(row.contains(document.getElementById('ldf-duration'))).toBe(true)
    expect(row.contains(document.getElementById('ldf-date'))).toBe(true)
    expect(row.contains(document.getElementById('ldf-time'))).toBe(true)
  })

  it('labels Time as optional', () => {
    renderForm()
    expect(screen.getByLabelText(/time \(optional\)/i)).toBe(document.getElementById('ldf-time'))
  })

  it('keeps the School Resources helper line visible', () => {
    renderForm()
    expect(screen.getByText(/activities and materials will only use what your school has/i)).toBeInTheDocument()
  })
})

// ── The Date control reads the date, it does not repeat it ───────────────────
// The control itself now displays "Tue, 4 Aug 2026" instead of the native
// 07/08/2026 rendering, and the confirmation line that used to sit underneath
// it (#ldf-date-friendly) is gone: two renderings of one value asked the
// teacher to reconcile them, and the ambiguous one was in the field.

describe('LessonDetailsForm — the Date control', () => {
  it('displays the unambiguous readable form inside the control', () => {
    const { container } = renderForm({ lessonDetails: { ...DEFAULT_DETAILS, date: '2026-08-04' } })
    const display = container.querySelector('.ldf-date-display')
    expect(display).toBeTruthy()
    expect(display.textContent).toBe('Tue, 4 Aug 2026')
    // Same wrapper as the input, so it paints over the control rather than
    // adding a line below it.
    expect(display.parentElement.contains(document.getElementById('ldf-date'))).toBe(true)
  })

  it('keeps the raw ISO value on the input itself', () => {
    renderForm({ lessonDetails: { ...DEFAULT_DETAILS, date: '2026-08-04' } })
    expect(document.getElementById('ldf-date')).toHaveValue('2026-08-04')
  })

  it('prompts rather than showing a date when none is set', () => {
    const { container } = renderForm()
    const display = container.querySelector('.ldf-date-display')
    expect(display.textContent).toBe('Select a date')
    expect(display.className).toContain('ldf-date-display--empty')
  })

  it('no longer renders the separate confirmation line', () => {
    const { container } = renderForm({ lessonDetails: { ...DEFAULT_DETAILS, date: '2026-08-04' } })
    expect(container.querySelector('#ldf-date-friendly')).toBeNull()
  })
})

// ── Teacher & school collapsed row ────────────────────────────────────────────

describe('LessonDetailsForm — teacher & school details row', () => {
  it('collapses Teacher Name + School into a <details> row, keeping the field ids', () => {
    const { container } = renderForm()
    const details = container.querySelector('details')
    expect(details).toBeTruthy()
    expect(details.contains(document.getElementById('ldf-teacher'))).toBe(true)
    expect(details.contains(document.getElementById('ldf-school'))).toBe(true)
    const summary = details.querySelector('summary')
    expect(summary.textContent).toContain('Teacher & school details')
    // No prefilled claim while either field is empty.
    expect(summary.textContent).not.toContain('✓')
  })

  it('shows the prefilled ✓ once both teacher and school carry values', () => {
    const { container } = renderForm({
      lessonDetails: { ...DEFAULT_DETAILS, teacherName: 'Mr Banda', school: 'Kabulonga Primary' },
    })
    const summary = container.querySelector('details summary')
    expect(summary.textContent).toContain('prefilled from last time ✓')
  })

  it('shows no ✓ when only one of the two is prefilled', () => {
    const { container } = renderForm({
      lessonDetails: { ...DEFAULT_DETAILS, teacherName: 'Mr Banda', school: '' },
    })
    expect(container.querySelector('details summary').textContent).not.toContain('✓')
  })
})

// ── Disabled state ────────────────────────────────────────────────────────────

describe('LessonDetailsForm — disabled state', () => {
  it('applies pointer-events-none and opacity-50 when disabled', () => {
    const { container } = render(
      <LessonDetailsForm
        lessonDetails={{ ...DEFAULT_DETAILS }}
        curriculumMode={null}
        onChange={vi.fn()}
        disabled={true}
      />,
    )
    const root = container.firstChild
    expect(root.className).toMatch(/pointer-events-none/)
    expect(root.className).toMatch(/opacity-50/)
  })

  it('does NOT apply disabled classes when enabled', () => {
    const { container } = render(
      <LessonDetailsForm
        lessonDetails={{ ...DEFAULT_DETAILS }}
        curriculumMode="cbc"
        onChange={vi.fn()}
        disabled={false}
      />,
    )
    const root = container.firstChild
    expect(root.className).not.toMatch(/pointer-events-none/)
    expect(root.className).not.toMatch(/opacity-50/)
  })

  it('toggle button is disabled when disabled prop is true', () => {
    render(
      <LessonDetailsForm
        lessonDetails={{ ...DEFAULT_DETAILS }}
        curriculumMode={null}
        onChange={vi.fn()}
        disabled={true}
      />,
    )
    expect(screen.getByRole('button', { name: /lesson details/i })).toBeDisabled()
  })
})
