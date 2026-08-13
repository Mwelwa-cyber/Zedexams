import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { LessonBreakdownItem } from './LessonBreakdownItem.jsx'

const DEFAULT_ITEM = {
  lessonNumber: 1,
  title: 'Lesson 1: Addition',
  focus: 'Adding two-digit numbers',
  status: 'pending',
}

function renderItem(props = {}) {
  const defaults = {
    item: { ...DEFAULT_ITEM },
    index: 0,
    total: 3,
    onChange: vi.fn(),
    onMoveUp: vi.fn(),
    onMoveDown: vi.fn(),
    onDelete: vi.fn(),
    ...props,
  }
  return { ...render(<LessonBreakdownItem {...defaults} />), ...defaults }
}

beforeEach(() => {
  vi.clearAllMocks()
})

// ── Rendering ─────────────────────────────────────────────────────────────────

describe('LessonBreakdownItem — rendering', () => {
  it('renders the lesson number badge', () => {
    renderItem()
    expect(screen.getByText('#1')).toBeInTheDocument()
  })

  it('renders the title input with the correct value', () => {
    renderItem()
    const titleInput = screen.getByRole('textbox', { name: /lesson 1 title/i })
    expect(titleInput).toHaveValue('Lesson 1: Addition')
  })

  it('renders the focus input with the correct value', () => {
    renderItem()
    const focusInput = screen.getByRole('textbox', { name: /lesson 1 focus/i })
    expect(focusInput).toHaveValue('Adding two-digit numbers')
  })

  it('renders the move-up button', () => {
    renderItem()
    expect(screen.getByRole('button', { name: /move up/i })).toBeInTheDocument()
  })

  it('renders the move-down button', () => {
    renderItem()
    expect(screen.getByRole('button', { name: /move down/i })).toBeInTheDocument()
  })

  it('renders the delete button', () => {
    renderItem()
    expect(screen.getByRole('button', { name: /delete lesson/i })).toBeInTheDocument()
  })

  it('renders badge with correct number for a non-first item', () => {
    renderItem({ item: { ...DEFAULT_ITEM, lessonNumber: 3 }, index: 2 })
    expect(screen.getByText('#3')).toBeInTheDocument()
  })
})

// ── Up/Down disabled at edges ─────────────────────────────────────────────────

describe('LessonBreakdownItem — edge disabled states', () => {
  it('disables the Move Up button when index is 0', () => {
    renderItem({ index: 0, total: 3 })
    expect(screen.getByRole('button', { name: /move up/i })).toBeDisabled()
  })

  it('enables the Move Up button when index is > 0', () => {
    renderItem({ index: 1, total: 3 })
    expect(screen.getByRole('button', { name: /move up/i })).not.toBeDisabled()
  })

  it('disables the Move Down button when index equals total - 1', () => {
    renderItem({ index: 2, total: 3 })
    expect(screen.getByRole('button', { name: /move down/i })).toBeDisabled()
  })

  it('enables the Move Down button when index is not at the end', () => {
    renderItem({ index: 0, total: 3 })
    expect(screen.getByRole('button', { name: /move down/i })).not.toBeDisabled()
  })

  it('disables both Up and Down when total is 1', () => {
    renderItem({ index: 0, total: 1 })
    expect(screen.getByRole('button', { name: /move up/i })).toBeDisabled()
    expect(screen.getByRole('button', { name: /move down/i })).toBeDisabled()
  })
})

// ── onChange callbacks ────────────────────────────────────────────────────────

describe('LessonBreakdownItem — onChange called on input', () => {
  it('calls onChange with (index, "title", newValue) when title changes', () => {
    const onChange = vi.fn()
    renderItem({ index: 1, onChange })
    fireEvent.change(screen.getByRole('textbox', { name: /lesson 1 title/i }), {
      target: { value: 'Updated Title' },
    })
    expect(onChange).toHaveBeenCalledWith(1, 'title', 'Updated Title')
  })

  it('calls onChange with (index, "focus", newValue) when focus changes', () => {
    const onChange = vi.fn()
    renderItem({ index: 2, onChange })
    fireEvent.change(screen.getByRole('textbox', { name: /lesson 1 focus/i }), {
      target: { value: 'New focus text' },
    })
    expect(onChange).toHaveBeenCalledWith(2, 'focus', 'New focus text')
  })
})

// ── onMoveUp / onMoveDown ─────────────────────────────────────────────────────

describe('LessonBreakdownItem — move callbacks', () => {
  it('calls onMoveUp with the index when Move Up is clicked', () => {
    const onMoveUp = vi.fn()
    renderItem({ index: 1, total: 3, onMoveUp })
    fireEvent.click(screen.getByRole('button', { name: /move up/i }))
    expect(onMoveUp).toHaveBeenCalledWith(1)
  })

  it('calls onMoveDown with the index when Move Down is clicked', () => {
    const onMoveDown = vi.fn()
    renderItem({ index: 0, total: 3, onMoveDown })
    fireEvent.click(screen.getByRole('button', { name: /move down/i }))
    expect(onMoveDown).toHaveBeenCalledWith(0)
  })
})

// ── onDelete ──────────────────────────────────────────────────────────────────

describe('LessonBreakdownItem — onDelete called', () => {
  it('calls onDelete with the index when delete button is clicked', () => {
    const onDelete = vi.fn()
    renderItem({ index: 0, onDelete })
    fireEvent.click(screen.getByRole('button', { name: /delete lesson/i }))
    expect(onDelete).toHaveBeenCalledWith(0)
  })

  it('calls onDelete with the correct index for a non-zero position', () => {
    const onDelete = vi.fn()
    renderItem({ index: 2, onDelete })
    fireEvent.click(screen.getByRole('button', { name: /delete lesson/i }))
    expect(onDelete).toHaveBeenCalledWith(2)
  })
})
