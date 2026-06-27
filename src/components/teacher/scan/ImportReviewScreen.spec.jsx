// src/components/teacher/scan/ImportReviewScreen.spec.jsx
import { render, screen, fireEvent } from '@testing-library/react'
import { vi } from 'vitest'
import ImportReviewScreen from './ImportReviewScreen.jsx'

// Mock generateDiagram so tests don't make real API calls
vi.mock('../../../utils/generateDiagram.js', () => ({
  generateDiagram: vi.fn().mockResolvedValue({ url: 'https://mock.example.com/diagram.png' }),
}))

// Mock importReviewStore so tests don't need IndexedDB
vi.mock('./importReviewStore.js', () => ({
  saveReviewSession: vi.fn().mockResolvedValue(undefined),
}))

const mockSections = [{
  kind: 'standalone', id: 's1',
  question: { type: 'mcq', text: 'What is 2+2?', options: ['2','4','6','8'], hasDiagram: false, diagrams: [], requiresReview: false, importWarnings: [], sourcePage: 1, marks: 1 }
}]
const mockPageAssets = { 1: { objectUrl: 'blob:page1' } }

test('renders original photo and reconstructed question side by side', () => {
  render(
    <ImportReviewScreen
      open={true}
      pageAssets={mockPageAssets}
      rawSections={mockSections}
      warnings={[]}
      fileName="test-paper.jpg"
      onApprove={vi.fn()}
      onCancel={vi.fn()}
    />
  )
  expect(screen.getByAltText(/original page/i)).toBeInTheDocument()
  expect(screen.getByText(/What is 2\+2\?/)).toBeInTheDocument()
})

test('calls onApprove with sections when Import button clicked', () => {
  const onApprove = vi.fn()
  render(
    <ImportReviewScreen
      open={true}
      pageAssets={mockPageAssets}
      rawSections={mockSections}
      warnings={[]}
      fileName="test.jpg"
      onApprove={onApprove}
      onCancel={vi.fn()}
    />
  )
  fireEvent.click(screen.getByRole('button', { name: /import 1 question/i }))
  expect(onApprove).toHaveBeenCalledWith(expect.arrayContaining([expect.objectContaining({ kind: 'standalone' })]))
})
