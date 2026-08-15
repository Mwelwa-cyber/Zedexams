import { describe, it, expect, vi } from 'vitest'
import { useState } from 'react'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import TopicSubtopicPicker from './TopicSubtopicPicker.jsx'

// The picker draws its drop-down options from the merged syllabi
// (getMergedSyllabi → syllabiToKbTopics). Mock both so the lookup resolves to a
// known, grade/subject-scoped set: a Grade 4 Mathematics topic and a Grade 1
// Numeracy topic that do NOT overlap.
vi.mock('../../utils/syllabusKbService', () => ({
  getMergedSyllabi: () => Promise.resolve({}),
}))
vi.mock('../../utils/syllabusMapping', () => ({
  syllabiToKbTopics: () => [
    { grade: 'G4', subject: 'mathematics', topic: 'Fractions', subtopics: [] },
    { grade: 'G1', subject: 'numeracy', topic: 'Exploring Materials', subtopics: [] },
    // zambian_language is the KB-canonical key for the 'cinyanja' teacher-taxonomy value.
    // The picker must normalise 'cinyanja' → 'zambian_language' before looking up
    // topics; without the fix the dropdown was always empty for Cinyanja.
    { grade: 'G4', subject: 'zambian_language', topic: 'Kuwerenga ndi Kumvetsa', subtopics: [] },
    // Bare grade number '4' (not G-prefixed) should also resolve correctly via
    // studioGradeToKbGrade so deep-linked / URL-restored grades work.
    // Grade 4 is used here because G5 is now an OBC grade (2013 syllabus);
    // the 2013 path does a fetch() that jsdom can't resolve with a relative URL.
    { grade: 'G4', subject: 'english', topic: 'Reading Strategies', subtopics: [] },
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

// ── Normalisation regression tests ──────────────────────────────────────────
// These cover the root-cause bug: TopicSubtopicPicker was building its lookup
// key from the raw grade/subject props without calling studioGradeToKbGrade /
// toKbSubjectKey, so teacher-taxonomy values that differ from KB-canonical keys
// (e.g. 'cinyanja' → 'zambian_language') always produced an empty dropdown.

describe('TopicSubtopicPicker — grade/subject normalisation', () => {
  it('shows syllabus topics when subject is "cinyanja" (teacher slug → zambian_language KB key)', async () => {
    // The syllabi lookup stores topics under 'zambian_language'. Studios pass
    // 'cinyanja' as the subject value (from TEACHER_SUBJECTS). Without the
    // normalisation fix the dropdown was always empty for this subject.
    function CinyanjaHost() {
      const [topic, setTopic] = useState('')
      const [subtopic, setSubtopic] = useState('')
      return (
        <TopicSubtopicPicker
          grade="G4"
          subject="cinyanja"
          topic={topic}
          subtopic={subtopic}
          onChangeTopic={setTopic}
          onChangeSubtopic={setSubtopic}
        />
      )
    }

    render(<CinyanjaHost />)

    // The 'zambian_language' topic in the mock should surface in the dropdown.
    await waitFor(() =>
      expect(screen.getByRole('option', { name: 'Kuwerenga ndi Kumvetsa' })).toBeInTheDocument(),
    )
  })

  it('shows syllabus topics when grade is a bare number string ("4" instead of "G4")', async () => {
    // Some surfaces (URL params, legacy form state) pass a bare number grade.
    // studioGradeToKbGrade('4') → 'G4' so the lookup should still hit.
    // (G4 is a CBC grade; G5 is now OBC and would trigger a fetch() in jsdom.)
    function BareGradeHost() {
      const [topic, setTopic] = useState('')
      const [subtopic, setSubtopic] = useState('')
      return (
        <TopicSubtopicPicker
          grade="4"
          subject="english"
          topic={topic}
          subtopic={subtopic}
          onChangeTopic={setTopic}
          onChangeSubtopic={setSubtopic}
        />
      )
    }

    render(<BareGradeHost />)

    // G5 english has 'Reading Strategies' in the mock — it must appear.
    await waitFor(() =>
      expect(screen.getByRole('option', { name: 'Reading Strategies' })).toBeInTheDocument(),
    )
  })
})
