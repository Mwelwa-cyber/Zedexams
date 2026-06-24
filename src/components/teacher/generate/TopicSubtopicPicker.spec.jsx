import { describe, it, expect, vi } from 'vitest'
import { useState } from 'react'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import TopicSubtopicPicker from './TopicSubtopicPicker.jsx'

// The picker draws its drop-down options from the merged syllabi
// (getMergedSyllabi → syllabiToKbTopics). Mock both so the lookup resolves to a
// known, grade/subject-scoped set: a Grade 4 Mathematics topic and a Grade 1
// Numeracy topic that do NOT overlap.
vi.mock('../../../utils/syllabusKbService', () => ({
  getMergedSyllabi: () => Promise.resolve({}),
}))
vi.mock('../../../utils/syllabusMapping', () => ({
  syllabiToKbTopics: () => [
    { grade: 'G4', subject: 'mathematics', topic: 'Fractions', subtopics: [] },
    { grade: 'G1', subject: 'numeracy', topic: 'Exploring Materials', subtopics: [] },
  ],
}))

// A controlled host that mirrors how a studio wires the picker into its form
// state, with a button to switch grade+subject the way a teacher would.
function Host() {
  const [form, setForm] = useState({ grade: 'G4', subject: 'mathematics', topic: 'Fractions', subtopic: '' })
  return (
    <>
      <span data-testid="topic">{form.topic}</span>
      <button onClick={() => setForm((f) => ({ ...f, grade: 'G1', subject: 'numeracy' }))}>
        switch to G1 numeracy
      </button>
      <TopicSubtopicPicker
        grade={form.grade}
        subject={form.subject}
        topic={form.topic}
        subtopic={form.subtopic}
        onChangeTopic={(v) => setForm((f) => ({ ...f, topic: v }))}
        onChangeSubtopic={(v) => setForm((f) => ({ ...f, subtopic: v }))}
      />
    </>
  )
}

describe('TopicSubtopicPicker — off-grade topic guard', () => {
  it('clears a topic chosen for the old grade/subject when grade/subject changes', async () => {
    render(<Host />)
    // The deep-linked / preset topic survives the initial mount.
    expect(screen.getByTestId('topic')).toHaveTextContent('Fractions')
    // Wait for the syllabus lookup to resolve so the effect has the new
    // grade/subject's options to evaluate against.
    await waitFor(() =>
      expect(screen.getByRole('option', { name: 'Fractions' })).toBeInTheDocument())

    // Teacher switches the paper to Grade 1 Numeracy — the leftover Grade 4
    // Mathematics topic must not ride along.
    fireEvent.click(screen.getByText('switch to G1 numeracy'))

    await waitFor(() => expect(screen.getByTestId('topic')).toHaveTextContent(''))
    expect(screen.getByTestId('topic').textContent).toBe('')
  })
})
