// src/components/teacher/scan/useImportReview.js
import { useReducer, useCallback, useEffect } from 'react'
import {
  initialDiagramChoiceState,
  applyDiagramChoiceEvent,
  buildDiagramPrompt,
  DIAGRAM_CHOICES,
} from '../../../utils/diagramChoiceStateMachine.js'
import { saveReviewSession } from './importReviewStore.js'
import { generateDiagram } from '../../../utils/generateDiagram.js'

// Reducer for the Map<diagramId, DiagramChoiceState>
function diagramChoicesReducer(map, action) {
  const next = new Map(map)
  const existing = next.get(action.id) ?? initialDiagramChoiceState(action.id, action.cropUrl ?? null)
  next.set(action.id, applyDiagramChoiceEvent(existing, action.event))
  return next
}

// Reducer for page approval Record<pageNumber, status>
function pageApprovalReducer(state, { page, status }) {
  return { ...state, [page]: status }
}

export function useImportReview({ rawSections = [], pageAssets = {}, subject = '', grade = '' } = {}) {
  const [diagramChoices, dispatchDiagram] = useReducer(diagramChoicesReducer, new Map())
  const [pageApprovalState, dispatchPage] = useReducer(pageApprovalReducer, {})

  // Persist to IndexedDB whenever state changes
  useEffect(() => {
    saveReviewSession({
      savedAt: Date.now(),
      pageApprovalState,
      diagramChoices: Object.fromEntries(
        [...diagramChoices.entries()].map(([k, v]) => [k, { ...v }])
      ),
    }).catch(() => {})
  }, [diagramChoices, pageApprovalState])

  const selectDiagramChoice = useCallback(async (diagramId, choice, { cropUrl = null, diagramMeta = {} } = {}) => {
    // Immediately dispatch the SELECT event (transitions to PREVIEWING or READY)
    dispatchDiagram({ id: diagramId, cropUrl, event: { type: 'SELECT', choice } })

    // Async side effects
    if (choice === DIAGRAM_CHOICES.REDRAW_AI) {
      try {
        const prompt = buildDiagramPrompt(diagramMeta, { subject, grade })
        const result = await generateDiagram({ prompt, style: 'line_art', provider: 'recraft' })
        dispatchDiagram({ id: diagramId, event: { type: 'PREVIEW_READY', url: result.url } })
      } catch (err) {
        dispatchDiagram({ id: diagramId, event: { type: 'ERROR', message: err?.message ?? 'Generation failed' } })
      }
    }
    // CLEAN_ORIGINAL and REPLACE_BETTER — side effects handled by the UI (file picker, etc.)
    // UI will call dispatchDiagramPreviewReady after getting the result
  }, [subject, grade])

  const dispatchDiagramPreviewReady = useCallback((diagramId, url) => {
    dispatchDiagram({ id: diagramId, event: { type: 'PREVIEW_READY', url } })
  }, [])

  const confirmDiagramChoice = useCallback((diagramId) => {
    dispatchDiagram({ id: diagramId, event: { type: 'CONFIRM' } })
  }, [])

  const resetDiagramChoice = useCallback((diagramId) => {
    dispatchDiagram({ id: diagramId, event: { type: 'RESET' } })
  }, [])

  const approvePage = useCallback((pageNumber) => {
    dispatchPage({ page: pageNumber, status: 'approved' })
  }, [])

  const skipPage = useCallback((pageNumber) => {
    dispatchPage({ page: pageNumber, status: 'skipped' })
  }, [])

  return {
    diagramChoices,
    pageApprovalState,
    selectDiagramChoice,
    dispatchDiagramPreviewReady,
    confirmDiagramChoice,
    resetDiagramChoice,
    approvePage,
    skipPage,
  }
}
