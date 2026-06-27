import { renderHook, act, waitFor } from '@testing-library/react'
import { useImportReview } from './useImportReview.js'
import { DIAGRAM_CHOICES, DiagramChoiceStatus } from '../../../utils/diagramChoiceStateMachine.js'

// Mock generateDiagram so tests don't make real API calls
vi.mock('../../../utils/generateDiagram.js', () => ({
  generateDiagram: vi.fn().mockResolvedValue({ url: 'https://mock.example.com/diagram.png' }),
}))

// Mock importReviewStore so tests don't need IndexedDB
vi.mock('./importReviewStore.js', () => ({
  saveReviewSession: vi.fn().mockResolvedValue(undefined),
}))

test('KEEP_ORIGINAL choice resolves immediately to READY with crop URL', async () => {
  const { result } = renderHook(() => useImportReview({}))
  act(() => {
    result.current.selectDiagramChoice('d1', DIAGRAM_CHOICES.KEEP_ORIGINAL, { cropUrl: 'blob:crop1' })
  })
  const choice = result.current.diagramChoices.get('d1')
  expect(choice.status).toBe(DiagramChoiceStatus.READY)
  expect(choice.previewUrl).toBe('blob:crop1')
})

test('REMOVE choice resolves immediately to CONFIRMED', async () => {
  const { result } = renderHook(() => useImportReview({}))
  act(() => {
    result.current.selectDiagramChoice('d2', DIAGRAM_CHOICES.REMOVE)
  })
  const choice = result.current.diagramChoices.get('d2')
  expect(choice.status).toBe(DiagramChoiceStatus.CONFIRMED)
  expect(choice.previewUrl).toBeNull()
})

test('REDRAW_AI dispatches PREVIEWING then READY after generateDiagram resolves', async () => {
  const { result } = renderHook(() => useImportReview({}))

  await act(async () => {
    await result.current.selectDiagramChoice('d3', DIAGRAM_CHOICES.REDRAW_AI, {
      diagramMeta: { kind: 'plant', caption: 'Plant' },
    })
  })

  await waitFor(() => {
    const choice = result.current.diagramChoices.get('d3')
    expect(choice.status).toBe(DiagramChoiceStatus.READY)
    expect(choice.previewUrl).toBe('https://mock.example.com/diagram.png')
  })
})

test('approvePage sets page to approved', () => {
  const { result } = renderHook(() => useImportReview({}))
  act(() => { result.current.approvePage(1) })
  expect(result.current.pageApprovalState[1]).toBe('approved')
})

test('skipPage sets page to skipped', () => {
  const { result } = renderHook(() => useImportReview({}))
  act(() => { result.current.skipPage(2) })
  expect(result.current.pageApprovalState[2]).toBe('skipped')
})
