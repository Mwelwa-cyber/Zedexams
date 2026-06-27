import {
  applyDiagramChoiceEvent,
  buildDiagramPrompt,
  DIAGRAM_CHOICES,
  DiagramChoiceStatus,
  initialDiagramChoiceState,
} from './diagramChoiceStateMachine.js'

test('SELECT REDRAW_AI moves to PREVIEWING', () => {
  const state = initialDiagramChoiceState('d1', 'blob:original')
  const next = applyDiagramChoiceEvent(state, { type: 'SELECT', choice: DIAGRAM_CHOICES.REDRAW_AI })
  expect(next.choice).toBe(DIAGRAM_CHOICES.REDRAW_AI)
  expect(next.status).toBe(DiagramChoiceStatus.PREVIEWING)
  expect(next).not.toBe(state) // immutable — new object
})

test('PREVIEW_READY sets previewUrl and READY status', () => {
  const state = { ...initialDiagramChoiceState('d1', 'blob:orig'), status: DiagramChoiceStatus.PREVIEWING }
  const next = applyDiagramChoiceEvent(state, { type: 'PREVIEW_READY', url: 'https://example.com/img.png' })
  expect(next.status).toBe(DiagramChoiceStatus.READY)
  expect(next.previewUrl).toBe('https://example.com/img.png')
})

test('SELECT REMOVE goes directly to CONFIRMED', () => {
  const state = initialDiagramChoiceState('d1', 'blob:orig')
  const next = applyDiagramChoiceEvent(state, { type: 'SELECT', choice: DIAGRAM_CHOICES.REMOVE })
  expect(next.status).toBe(DiagramChoiceStatus.CONFIRMED)
  expect(next.previewUrl).toBeNull()
})

test('SELECT KEEP_ORIGINAL goes directly to READY with originalCropUrl as preview', () => {
  const state = initialDiagramChoiceState('d1', 'blob:orig')
  const next = applyDiagramChoiceEvent(state, { type: 'SELECT', choice: DIAGRAM_CHOICES.KEEP_ORIGINAL })
  expect(next.status).toBe(DiagramChoiceStatus.READY)
  expect(next.previewUrl).toBe('blob:orig')
})

test('buildDiagramPrompt returns B&W line art string', () => {
  const prompt = buildDiagramPrompt(
    { kind: 'plant', caption: 'Parts of a plant', complexity: 'simple' },
    { subject: 'Science', grade: 'Grade 5' }
  )
  expect(prompt).toContain('plant')
  expect(prompt.toLowerCase()).toContain('black-and-white')
  expect(prompt.toLowerCase()).toContain('line art')
  expect(prompt).toContain('Parts of a plant')
  expect(prompt).toContain('Science')
})

test('RESET returns to PENDING state', () => {
  const state = {
    ...initialDiagramChoiceState('d1', 'blob:orig'),
    status: DiagramChoiceStatus.CONFIRMED,
    choice: DIAGRAM_CHOICES.REDRAW_AI,
    previewUrl: 'blob:preview',
  }
  const next = applyDiagramChoiceEvent(state, { type: 'RESET' })
  expect(next.status).toBe(DiagramChoiceStatus.PENDING)
  expect(next.choice).toBeNull()
  expect(next.previewUrl).toBeNull()
})

test('ERROR event sets error status and message', () => {
  const state = { ...initialDiagramChoiceState('d1', 'blob:orig'), status: DiagramChoiceStatus.PREVIEWING }
  const next = applyDiagramChoiceEvent(state, { type: 'ERROR', message: 'Generation failed' })
  expect(next.status).toBe(DiagramChoiceStatus.ERROR)
  expect(next.errorMessage).toBe('Generation failed')
})

test('CONFIRM event sets CONFIRMED status', () => {
  const state = { ...initialDiagramChoiceState('d1', 'blob:orig'), status: DiagramChoiceStatus.READY, previewUrl: 'blob:p' }
  const next = applyDiagramChoiceEvent(state, { type: 'CONFIRM' })
  expect(next.status).toBe(DiagramChoiceStatus.CONFIRMED)
})
