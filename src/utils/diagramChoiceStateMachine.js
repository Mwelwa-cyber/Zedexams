// src/utils/diagramChoiceStateMachine.js

export const DIAGRAM_CHOICES = {
  KEEP_ORIGINAL:  'keep_original',
  CLEAN_ORIGINAL: 'clean_original',
  REDRAW_AI:      'redraw_ai',
  REPLACE_BETTER: 'replace_better',
  REMOVE:         'remove',
}

export const DiagramChoiceStatus = {
  PENDING:    'pending',
  PREVIEWING: 'previewing',
  READY:      'ready',
  CONFIRMED:  'confirmed',
  ERROR:      'error',
}

export function initialDiagramChoiceState(diagramId, originalCropUrl) {
  return {
    diagramId,
    choice: null,
    status: DiagramChoiceStatus.PENDING,
    previewUrl: null,
    errorMessage: null,
    originalCropUrl,
  }
}

export function applyDiagramChoiceEvent(state, event) {
  switch (event.type) {
    case 'SELECT': {
      if (event.choice === DIAGRAM_CHOICES.KEEP_ORIGINAL) {
        return { ...state, choice: event.choice, status: DiagramChoiceStatus.READY, previewUrl: state.originalCropUrl }
      }
      if (event.choice === DIAGRAM_CHOICES.REMOVE) {
        return { ...state, choice: event.choice, status: DiagramChoiceStatus.CONFIRMED, previewUrl: null }
      }
      return { ...state, choice: event.choice, status: DiagramChoiceStatus.PREVIEWING }
    }
    case 'PREVIEW_READY':
      return { ...state, status: DiagramChoiceStatus.READY, previewUrl: event.url }
    case 'CONFIRM':
      return { ...state, status: DiagramChoiceStatus.CONFIRMED }
    case 'ERROR':
      return { ...state, status: DiagramChoiceStatus.ERROR, errorMessage: event.message }
    case 'RESET':
      return initialDiagramChoiceState(state.diagramId, state.originalCropUrl)
    default:
      return state
  }
}

const DIAGRAM_KIND_LABELS = {
  plant: 'plant diagram',
  body_part: 'human body diagram',
  animal: 'animal diagram',
  bar_chart: 'bar chart',
  pie_chart: 'pie chart',
  line_graph: 'line graph',
  table: 'table',
  number_line: 'number line',
  shape: 'geometry shape',
  map: 'map',
  circuit: 'electrical circuit diagram',
  venn: 'Venn diagram',
  pictograph: 'pictograph',
  other: 'educational diagram',
}

export function buildDiagramPrompt(diagramMeta, { subject = '', grade = '' } = {}) {
  const { kind = 'other', caption } = diagramMeta
  const label = DIAGRAM_KIND_LABELS[kind] ?? 'educational diagram'
  const capPart = caption ? `, labelled "${caption}"` : ''
  const context = [subject, grade].filter(Boolean).join(' ')
  const contextPart = context ? ` for a Zambian ${context} examination paper` : ''
  return `${label}${capPart}${contextPart}. Black-and-white line art only, no shading, no colour, no gradients. Clean vector-style lines suitable for photocopying. Educational textbook style.`
}
