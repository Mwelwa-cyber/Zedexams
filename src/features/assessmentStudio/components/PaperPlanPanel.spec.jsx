import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import PaperPlanPanel from './PaperPlanPanel.jsx'

// A plan in the shape planAssessment returns, with enough variety to prove the
// panel reads it rather than printing placeholders.
function plan(over = {}) {
  return {
    version: 'blueprint.v1',
    framework: '2023',
    totalMarks: 10,
    durationMinutes: 30,
    estimatedMinutes: 12,
    itemCount: 3,
    warnings: [],
    sections: [{
      name: '', heading: '', instructions: '', marks: 10, itemCount: 3,
      items: [
        {
          id: 'q1', number: 1, topic: 'Plants', marks: 4, bloomLevel: 'remember',
          difficulty: 'recall', learningOutcome: 'Name the parts of a flower',
          activityType: 'multiple_choice', activityLabel: 'Multiple choice',
          activitySupport: 'native', renderType: 'multiple_choice',
          figureRequired: true,
        },
        {
          id: 'q2', number: 2, topic: 'Weather', marks: 3, bloomLevel: 'understand',
          difficulty: 'understanding', learningOutcome: 'Describe the seasons',
          activityType: 'short_answer', activityLabel: 'Short answer',
          activitySupport: 'native', renderType: 'short_answer',
          figureRequired: false,
        },
        {
          id: 'q3', number: 3, topic: 'Weather', marks: 3, bloomLevel: 'analyse',
          difficulty: 'analysis', learningOutcome: 'Explain rainfall',
          activityType: 'structured', activityLabel: 'Structured (multi-part)',
          activitySupport: 'native', renderType: 'structured',
          figureRequired: false,
        },
      ],
    }],
    ...over,
  }
}

describe('PaperPlanPanel', () => {
  it('states what the paper will be before it is written', () => {
    render(<PaperPlanPanel blueprint={plan()} topicsOnFile={6} />)
    expect(screen.getByText(/Here’s the plan for your paper/i)).toBeInTheDocument()
    expect(screen.getByText(/3 questions · 10 marks · about 12 minutes of work/))
      .toBeInTheDocument()
    // The teacher can see the plan is grounded on real syllabus data.
    expect(screen.getByText(/Planned from 6 topics in the syllabus on file/))
      .toBeInTheDocument()
  })

  it('shows how the marks are spread over the topics', () => {
    render(<PaperPlanPanel blueprint={plan()} />)
    expect(screen.getByText('Plants')).toBeInTheDocument()
    expect(screen.getByText('Weather')).toBeInTheDocument()
    // Weather carries two of the three questions.
    expect(screen.getByText('2 · 6 marks')).toBeInTheDocument()
  })

  it('describes difficulty in words rather than internal tier ids', () => {
    render(<PaperPlanPanel blueprint={plan()} />)
    expect(screen.getByText('Straight recall')).toBeInTheDocument()
    expect(screen.getByText('Working things out')).toBeInTheDocument()
    expect(screen.queryByText(/\bband\b/i)).toBeNull()
    expect(screen.queryByText(/\bblueprint\.v1\b/i)).toBeNull()
  })

  it('lets the teacher choose revised or traditional Bloom wording', () => {
    render(<PaperPlanPanel blueprint={plan()} />)
    const revised = screen.getByRole('button', { name: "Revised Bloom's" })
    const traditional = screen.getByRole('button', { name: "Traditional Bloom's" })

    // CBC papers start with the revised wording, but the teacher remains in control.
    expect(revised).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByText('Remember · Understand · Apply · Analyse · Evaluate · Create'))
      .toBeInTheDocument()

    fireEvent.click(traditional)
    expect(traditional).toHaveAttribute('aria-pressed', 'true')
    expect(revised).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getByText('Knowledge · Comprehension · Application · Analysis · Synthesis · Evaluation'))
      .toBeInTheDocument()
  })

  it('suggests traditional Bloom wording for a 2013 curriculum paper', () => {
    render(<PaperPlanPanel blueprint={plan({ framework: '2013' })} />)
    expect(screen.getByRole('button', { name: "Traditional Bloom's" }))
      .toHaveAttribute('aria-pressed', 'true')
  })

  it('warns when the paper looks longer than the time allowed', () => {
    render(<PaperPlanPanel blueprint={plan({ durationMinutes: 10, estimatedMinutes: 40 })} />)
    expect(screen.getByText(/that looks tight for this many marks/i)).toBeInTheDocument()
  })

  it('says how many questions will need a picture', () => {
    render(<PaperPlanPanel blueprint={plan()} />)
    expect(screen.getByText(/1 question will need a picture or diagram/i)).toBeInTheDocument()
  })

  it('carries the plan’s own warnings through to the teacher', () => {
    render(<PaperPlanPanel blueprint={plan({ warnings: ['There are more topics than questions.'] })} />)
    expect(screen.getByText('There are more topics than questions.')).toBeInTheDocument()
  })

  it('offers plain-language ways to change the difficulty and re-plans on choice', () => {
    const onPresetChange = vi.fn()
    render(<PaperPlanPanel blueprint={plan()} presetId="band" onPresetChange={onPresetChange} />)
    fireEvent.click(screen.getByRole('button', { name: 'More demanding' }))
    expect(onPresetChange).toHaveBeenCalledWith('harder')
  })

  it('writes the paper only when the teacher asks', () => {
    const onGenerate = vi.fn()
    const onBack = vi.fn()
    render(<PaperPlanPanel blueprint={plan()} onGenerate={onGenerate} onBack={onBack} />)
    // Nothing has been generated by rendering the plan.
    expect(onGenerate).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: /Write this paper/i }))
    expect(onGenerate).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole('button', { name: /Change settings/i }))
    expect(onBack).toHaveBeenCalledTimes(1)
  })

  it('locks the controls while it is re-planning or writing', () => {
    const { rerender } = render(
      <PaperPlanPanel blueprint={plan()} replanning presetId="band" />,
    )
    expect(screen.getByRole('button', { name: 'Gentler' })).toBeDisabled()
    expect(screen.getByRole('button', { name: "Revised Bloom's" })).toBeDisabled()
    expect(screen.getByRole('button', { name: /Write this paper/i })).toBeDisabled()
    expect(screen.getByText(/Re-planning…/)).toBeInTheDocument()

    rerender(<PaperPlanPanel blueprint={plan()} generating presetId="band" />)
    expect(screen.getByRole('button', { name: /Writing the paper/i })).toBeDisabled()
  })

  it('never shows section headings for a level that has no sections', () => {
    render(<PaperPlanPanel blueprint={plan()} />)
    expect(screen.queryByText(/Parts of the paper/i)).toBeNull()
  })

  it('lists real sections when the level uses them', () => {
    const withSections = plan({
      sections: [
        { name: 'A', heading: 'SECTION A', marks: 40, items: plan().sections[0].items },
        { name: 'B', heading: 'SECTION B', marks: 60, itemCount: 4, items: [] },
      ],
    })
    render(<PaperPlanPanel blueprint={withSections} />)
    expect(screen.getByText(/Parts of the paper/i)).toBeInTheDocument()
    expect(screen.getByText('SECTION A')).toBeInTheDocument()
    expect(screen.getByText('SECTION B')).toBeInTheDocument()
  })

  it('is honest when no plan could be worked out, and still lets the teacher proceed', () => {
    const onGenerate = vi.fn()
    render(
      <PaperPlanPanel blueprint={null} problems={['blueprint has no items']}
        onGenerate={onGenerate} onBack={vi.fn()} />,
    )
    expect(screen.getByText(/We could not work out a plan for this one/i)).toBeInTheDocument()
    // Not dressed up as a plan: no headline and no fake counts.
    expect(screen.queryByText(/Here’s the plan for your paper/i)).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /Write the paper anyway/i }))
    expect(onGenerate).toHaveBeenCalledTimes(1)
  })
})
