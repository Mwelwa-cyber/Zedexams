/**
 * TemplateBankDetail — the preview panel and the Use Template hand-off.
 *
 * The bug this pins: the panel called `renderPlanHtml` itself and dropped the
 * result into a bare <div>, so the template was drawn with no stylesheet, no
 * pagination and the wrong layout — the plain-node
 * `templatePlanPreview.test.js` covers what that document must contain, and
 * these tests cover that the panel actually goes through the shared studio
 * renderer to get it. They also pin the surrounding page (title, quality score,
 * recommendations, rating), because the fix was not allowed to disturb it.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'

const navigate = vi.hoisted(() => vi.fn())
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom')
  return { ...actual, useNavigate: () => navigate }
})

vi.mock('../../../contexts/AuthContext', () => ({
  useAuth: () => ({ currentUser: { uid: 'teacher-1' } }),
}))
vi.mock('../../../components/seo/SeoHelmet', () => ({ default: () => null }))
vi.mock('../../../utils/teacherLibraryService', () => ({ formatDate: () => '1 Aug 2026' }))

const service = vi.hoisted(() => ({
  getTemplate: vi.fn(),
  rateTemplate: vi.fn().mockResolvedValue(true),
  createLessonPlanFromTemplate: vi.fn().mockResolvedValue('new-plan-id'),
}))
vi.mock('../services/templateBankService', () => service)

// The shared studio renderer, stubbed so the test can assert on WHAT it was
// handed. Its own output is covered by templatePlanPreview.test.js.
const preview = vi.hoisted(() => ({ calls: [] }))
vi.mock('../../../components/teacher/studio/LessonPlanDocumentPreview', () => ({
  default: (props) => {
    preview.calls.push(props)
    return <div data-testid="studio-document-preview" />
  },
}))

import TemplateBankDetail from './TemplateBankDetail'

const TEMPLATE = {
  id: 'tpl_1',
  title: 'Fractions — Equivalent fractions',
  grade: 'Grade 4',
  subject: 'Mathematics',
  topic: 'Fractions',
  subtopic: 'Equivalent fractions',
  curriculum: 'CBC',
  version: 2,
  usageCount: 7,
  ratingAvg: 4.5,
  ratingCount: 2,
  qualityScore: 82,
  qualityBreakdown: { curriculumAlignment: 90, completeness: 80 },
  aiRecommendations: ['Add a homework task'],
  status: 'active',
  content: {
    header: { subject: 'Mathematics', grade: 'Grade 4', topic: '4.5 Fractions' },
    lessonGoal: 'Identify equivalent fractions',
    stages: [{ name: 'INTRODUCTION', duration: '5 min', teacher: ['Revise'], pupils: ['Answer'] }],
  },
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/teacher/templates/tpl_1']}>
      <Routes>
        <Route path="/teacher/templates/:id" element={<TemplateBankDetail />} />
      </Routes>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  preview.calls.length = 0
  navigate.mockClear()
  service.getTemplate.mockResolvedValue(TEMPLATE)
  service.createLessonPlanFromTemplate.mockClear().mockResolvedValue('new-plan-id')
})

describe('TemplateBankDetail — preview', () => {
  it('draws the template through the shared studio document renderer', async () => {
    renderPage()
    expect(await screen.findByTestId('studio-document-preview')).toBeInTheDocument()
    expect(preview.calls.length).toBeGreaterThan(0)
  })

  it('hands the renderer the structured plan, not preview text', async () => {
    renderPage()
    await screen.findByTestId('studio-document-preview')
    const props = preview.calls[preview.calls.length - 1]
    expect(props.planJson).toBe(TEMPLATE.content)
    expect(props.planJson.stages).toHaveLength(1)
  })

  it('renders the classic bordered-table layout with a Ministry masthead', async () => {
    renderPage()
    await screen.findByTestId('studio-document-preview')
    const { meta } = preview.calls[preview.calls.length - 1]
    expect(meta.format).toBe('classic')
    expect(meta.lessonFormat.headerStyle).toBe('ministry')
  })

  it('leaves the teacher fields as blanks and names no school', async () => {
    renderPage()
    await screen.findByTestId('studio-document-preview')
    const { meta } = preview.calls[preview.calls.length - 1]
    expect(meta.teacherName).toBe('______')
    expect(meta.date).toBe('______')
    expect(meta.time).toBe('______')
    expect(meta.school).toBe('')
  })

  it('renders an OBC template in the previous curriculum', async () => {
    service.getTemplate.mockResolvedValue({ ...TEMPLATE, curriculum: 'OBC' })
    renderPage()
    await screen.findByTestId('studio-document-preview')
    expect(preview.calls[preview.calls.length - 1].curriculumMode).toBe('previous')
  })

  it('shows the measured page count the renderer reports, never an estimate', async () => {
    renderPage()
    await screen.findByTestId('studio-document-preview')
    // Nothing measured yet — no count is claimed.
    expect(screen.queryByText(/A4/)).not.toBeInTheDocument()

    await act(async () => {
      preview.calls[preview.calls.length - 1].onPageCount(4)
    })
    expect(screen.getByText('4 pages · A4')).toBeInTheDocument()

    // A measurement that comes back empty withdraws the claim rather than
    // leaving a stale count on screen.
    await act(async () => {
      preview.calls[preview.calls.length - 1].onPageCount(null)
    })
    expect(screen.queryByText(/A4/)).not.toBeInTheDocument()
  })

  it('falls back to the text summary only when a template has no content', async () => {
    service.getTemplate.mockResolvedValue({ ...TEMPLATE, content: null, preview: 'A short summary.' })
    renderPage()
    expect(await screen.findByText('A short summary.')).toBeInTheDocument()
    expect(screen.queryByTestId('studio-document-preview')).not.toBeInTheDocument()
  })
})

describe('TemplateBankDetail — Use Template', () => {
  it('opens the new plan in Lesson Plan Studio, pre-filled', async () => {
    renderPage()
    await screen.findByTestId('studio-document-preview')
    fireEvent.click(screen.getByRole('button', { name: 'Use Template' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Create lesson plan' }))
    await waitFor(() => {
      expect(navigate).toHaveBeenCalledWith('/teacher/lesson-plans/new-plan-id/edit')
    })
    expect(service.createLessonPlanFromTemplate).toHaveBeenCalledWith(
      expect.objectContaining({ uid: 'teacher-1', template: TEMPLATE }),
    )
  })
})

describe('TemplateBankDetail — the rest of the page is untouched', () => {
  it('keeps the title, tags, quality score, recommendations and rating', async () => {
    renderPage()
    expect(await screen.findByText('Fractions — Equivalent fractions')).toBeInTheDocument()
    expect(screen.getByText('Mathematics')).toBeInTheDocument()
    expect(screen.getByText('AI Quality Score')).toBeInTheDocument()
    expect(screen.getByText('82')).toBeInTheDocument()
    expect(screen.getByText('Add a homework task')).toBeInTheDocument()
    expect(screen.getByText('Rate this template')).toBeInTheDocument()
  })
})
