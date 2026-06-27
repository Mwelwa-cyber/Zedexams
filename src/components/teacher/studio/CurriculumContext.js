import { createContext, useContext } from 'react'

export const CurriculumContext = createContext(null)
CurriculumContext.displayName = 'CurriculumContext'

export function useCurriculumContext() {
  const ctx = useContext(CurriculumContext)
  if (ctx === null) throw new Error('useCurriculumContext must be used inside CurriculumContext.Provider')
  return ctx
}
