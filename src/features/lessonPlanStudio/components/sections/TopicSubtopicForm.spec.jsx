import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { TopicSubtopicForm } from './TopicSubtopicForm'

// Mock hooks so tests don't touch real async data fetching or Firebase
vi.mock('../../../../components/teacher/studio/hooks/useSubjectTopics.js', () => ({
  useSubjectTopics: vi.fn(),
}))

vi.mock('../../../../components/teacher/studio/hooks/useSubtopicDetail.js', () => ({
  useSubtopicDetail: vi.fn(() => ({ subtopicRow: null, loading: false, error: null })),
}))

import { useSubjectTopics } from '../../../../components/teacher/studio/hooks/useSubjectTopics.js'

const TOPICS = [
  { label: 'Nutrition', subtopics: ['Macronutrients', 'Micronutrients'] },
  { label: 'Food Safety', subtopics: ['Hygiene', 'Storage'] },
]

const DEFAULT_TOPIC_DATA = { topic: '', subtopic: '', subtopicRow: null }
const DEFAULT_LESSON = { grade: 'Grade 4', subject: 'Science', term: '', week: '' }

function renderForm(props = {}) {
  const defaults = {
    topicData: { ...DEFAULT_TOPIC_DATA },
    lessonDetails: { ...DEFAULT_LESSON },
    curriculumMode: 'cbc',
    onTopicChange: vi.fn(),
    onSubtopicChange: vi.fn(),
    disabled: false,
    ...props,
  }
  return { ...render(<TopicSubtopicForm {...defaults} />), ...defaults }
}

beforeEach(() => {
  useSubjectTopics.mockReturnValue({ topics: TOPICS, loading: false, error: null })
})

// ── Section header ─────────────────────────────────────────────────────────────

describe('TopicSubtopicForm — section header', () => {
  it('renders the "Topic & Subtopic" heading', () => {
    renderForm()
    expect(screen.getByText('Topic & Subtopic')).toBeInTheDocument()
  })

  it('shows a grey status dot when topic and subtopic are empty', () => {
    const { container } = renderForm()
    expect(container.querySelector('.bg-\\[\\#c9c0b0\\]')).toBeInTheDocument()
  })

  it('shows a green status dot when both topic and subtopic are filled', () => {
    const { container } = renderForm({
      topicData: { topic: 'Nutrition', subtopic: 'Macronutrients', subtopicRow: null },
    })
    expect(container.querySelector('.bg-green-500')).toBeInTheDocument()
  })
})

// ── Collapse / expand ──────────────────────────────────────────────────────────

describe('TopicSubtopicForm — collapse/expand', () => {
  it('body is visible by default (starts open)', () => {
    renderForm()
    expect(screen.getByRole('combobox', { name: /^topic$/i })).toBeInTheDocument()
  })

  it('hides body after clicking the toggle button', () => {
    renderForm()
    const toggle = screen.getByRole('button', { name: /topic & subtopic/i })
    fireEvent.click(toggle)
    expect(screen.queryByRole('combobox', { name: /^topic$/i })).not.toBeInTheDocument()
  })

  it('shows body again after a second click', () => {
    renderForm()
    const toggle = screen.getByRole('button', { name: /topic & subtopic/i })
    fireEvent.click(toggle)
    fireEvent.click(toggle)
    expect(screen.getByRole('combobox', { name: /^topic$/i })).toBeInTheDocument()
  })

  it('toggle button exposes aria-expanded', () => {
    renderForm()
    const toggle = screen.getByRole('button', { name: /topic & subtopic/i })
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    fireEvent.click(toggle)
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
  })
})

// ── Topic dropdown ─────────────────────────────────────────────────────────────

describe('TopicSubtopicForm — topic dropdown', () => {
  it('populates topic options from the hook', () => {
    renderForm()
    const select = screen.getByRole('combobox', { name: /^topic$/i })
    const options = [...select.querySelectorAll('option')].map((o) => o.value)
    expect(options).toContain('Nutrition')
    expect(options).toContain('Food Safety')
  })

  it('shows loading placeholder when loading is true', () => {
    useSubjectTopics.mockReturnValue({ topics: [], loading: true, error: null })
    renderForm()
    const select = screen.getByRole('combobox', { name: /^topic$/i })
    expect(select.querySelector('option').textContent).toBe('Loading topics…')
  })

  it('shows error placeholder when error is set', () => {
    useSubjectTopics.mockReturnValue({ topics: [], loading: false, error: 'Network failure' })
    renderForm()
    const select = screen.getByRole('combobox', { name: /^topic$/i })
    expect(select.querySelector('option').textContent).toMatch(/Network failure/)
  })

  it('shows default placeholder when idle with no topics', () => {
    useSubjectTopics.mockReturnValue({ topics: [], loading: false, error: null })
    renderForm()
    const select = screen.getByRole('combobox', { name: /^topic$/i })
    expect(select.querySelector('option').textContent).toBe('Select topic...')
  })
})

// ── Subtopic dropdown ──────────────────────────────────────────────────────────

describe('TopicSubtopicForm — subtopic dropdown', () => {
  it('subtopic dropdown is disabled when no topic is selected', () => {
    renderForm({ topicData: { topic: '', subtopic: '', subtopicRow: null } })
    expect(screen.getByRole('combobox', { name: /subtopic/i })).toBeDisabled()
  })

  it('subtopic dropdown is enabled when a topic is selected', () => {
    renderForm({ topicData: { topic: 'Nutrition', subtopic: '', subtopicRow: null } })
    expect(screen.getByRole('combobox', { name: /subtopic/i })).not.toBeDisabled()
  })

  it('populates subtopics from the selected topic object', () => {
    renderForm({ topicData: { topic: 'Nutrition', subtopic: '', subtopicRow: null } })
    const select = screen.getByRole('combobox', { name: /subtopic/i })
    const options = [...select.querySelectorAll('option')].map((o) => o.value)
    expect(options).toContain('Macronutrients')
    expect(options).toContain('Micronutrients')
  })

  it('does not show subtopics from other topics', () => {
    renderForm({ topicData: { topic: 'Nutrition', subtopic: '', subtopicRow: null } })
    const select = screen.getByRole('combobox', { name: /subtopic/i })
    const options = [...select.querySelectorAll('option')].map((o) => o.value)
    expect(options).not.toContain('Hygiene')
    expect(options).not.toContain('Storage')
  })
})

// ── onChange callbacks ─────────────────────────────────────────────────────────

describe('TopicSubtopicForm — onChange callbacks', () => {
  it('calls onTopicChange when topic select changes', () => {
    const onTopicChange = vi.fn()
    const onSubtopicChange = vi.fn()
    renderForm({ onTopicChange, onSubtopicChange })
    fireEvent.change(screen.getByRole('combobox', { name: /^topic$/i }), {
      target: { value: 'Nutrition' },
    })
    expect(onTopicChange).toHaveBeenCalledWith('Nutrition')
  })

  it('clears subtopic (calls onSubtopicChange with "") when topic changes', () => {
    const onTopicChange = vi.fn()
    const onSubtopicChange = vi.fn()
    renderForm({ onTopicChange, onSubtopicChange })
    fireEvent.change(screen.getByRole('combobox', { name: /^topic$/i }), {
      target: { value: 'Nutrition' },
    })
    expect(onSubtopicChange).toHaveBeenCalledWith('')
  })

  it('calls onSubtopicChange when subtopic select changes', () => {
    const onSubtopicChange = vi.fn()
    renderForm({
      topicData: { topic: 'Nutrition', subtopic: '', subtopicRow: null },
      onSubtopicChange,
    })
    fireEvent.change(screen.getByRole('combobox', { name: /subtopic/i }), {
      target: { value: 'Macronutrients' },
    })
    expect(onSubtopicChange).toHaveBeenCalledWith('Macronutrients')
  })
})

// ── Disabled state ─────────────────────────────────────────────────────────────

describe('TopicSubtopicForm — disabled state', () => {
  it('applies pointer-events-none and opacity-50 when disabled', () => {
    const { container } = renderForm({ disabled: true })
    const root = container.firstChild
    expect(root.className).toMatch(/pointer-events-none/)
    expect(root.className).toMatch(/opacity-50/)
  })

  it('does NOT apply disabled classes when enabled', () => {
    const { container } = renderForm({ disabled: false })
    const root = container.firstChild
    expect(root.className).not.toMatch(/pointer-events-none/)
    expect(root.className).not.toMatch(/opacity-50/)
  })

  it('toggle button is disabled when disabled prop is true', () => {
    renderForm({ disabled: true })
    expect(screen.getByRole('button', { name: /topic & subtopic/i })).toBeDisabled()
  })
})
