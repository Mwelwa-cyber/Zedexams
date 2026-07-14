import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import TeachingProfileMigrationCard from './TeachingProfileMigrationCard'
import { assignmentKey } from '../../../../utils/teachingProfileCore'

const SUGGESTIONS = [
  { grade: 'G4', subject: 'mathematics', className: '', curriculumType: 'cbc', count: 3 },
  { grade: 'G5', subject: 'english', className: '4A', curriculumType: 'cbc', count: 1 },
]
const allKeys = () => new Set(SUGGESTIONS.map((s) => assignmentKey(s)))

describe('TeachingProfileMigrationCard', () => {
  it('renders nothing without suggestions', () => {
    const { container } = render(
      <TeachingProfileMigrationCard suggestions={[]} selectedKeys={new Set()} onToggle={() => {}} onApply={() => {}} onSkip={() => {}} />,
    )
    expect(container.firstChild).toBeNull()
  })

  it('lists each suggestion with human labels + document counts', () => {
    render(
      <TeachingProfileMigrationCard suggestions={SUGGESTIONS} selectedKeys={allKeys()} onToggle={() => {}} onApply={() => {}} onSkip={() => {}} />,
    )
    expect(screen.getByText(/we found these possible teaching assignments from your recent work/i)).toBeInTheDocument()
    expect(screen.getByText(/Grade 4 · Mathematics/)).toBeInTheDocument()
    expect(screen.getByText(/from 3 documents/)).toBeInTheDocument()
    expect(screen.getByText(/Grade 5 · English · 4A/)).toBeInTheDocument()
    expect(screen.getByText(/from 1 document$/)).toBeInTheDocument()
    expect(screen.getAllByRole('checkbox')).toHaveLength(2)
  })

  it('the primary button reflects the selected count and confirms', async () => {
    const onApply = vi.fn()
    render(
      <TeachingProfileMigrationCard suggestions={SUGGESTIONS} selectedKeys={allKeys()} onToggle={() => {}} onApply={onApply} onSkip={() => {}} />,
    )
    const btn = screen.getByRole('button', { name: /add 2 & continue/i })
    await userEvent.click(btn)
    expect(onApply).toHaveBeenCalled()
  })

  it('disables the add button when nothing is selected', () => {
    render(
      <TeachingProfileMigrationCard suggestions={SUGGESTIONS} selectedKeys={new Set()} onToggle={() => {}} onApply={() => {}} onSkip={() => {}} />,
    )
    expect(screen.getByRole('button', { name: /add 0 & continue/i })).toBeDisabled()
  })

  it('toggles a suggestion and offers start-from-scratch', async () => {
    const onToggle = vi.fn()
    const onSkip = vi.fn()
    render(
      <TeachingProfileMigrationCard suggestions={SUGGESTIONS} selectedKeys={allKeys()} onToggle={onToggle} onApply={() => {}} onSkip={onSkip} />,
    )
    await userEvent.click(screen.getAllByRole('checkbox')[0])
    expect(onToggle).toHaveBeenCalledWith(assignmentKey(SUGGESTIONS[0]))
    await userEvent.click(screen.getByRole('button', { name: /start from scratch/i }))
    expect(onSkip).toHaveBeenCalled()
  })
})
