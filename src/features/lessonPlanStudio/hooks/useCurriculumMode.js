import { useState, useCallback } from 'react'

/**
 * Manages curriculum mode selection.
 * Returns { curriculumMode, setCurriculumMode, isCBC, isPrevious }
 *
 * curriculumMode: 'cbc' | 'previous' | null
 * isCBC: boolean — true when curriculumMode === 'cbc'
 * isPrevious: boolean — true when curriculumMode === 'previous'
 */
export function useCurriculumMode() {
  const [curriculumMode, setCurriculumModeRaw] = useState(null)

  const setCurriculumMode = useCallback((mode) => {
    setCurriculumModeRaw(mode)
  }, [])

  return {
    curriculumMode,
    setCurriculumMode,
    isCBC: curriculumMode === 'cbc',
    isPrevious: curriculumMode === 'previous',
  }
}
