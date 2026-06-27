import { createContext, useContext } from 'react'

export const CurriculumContext = createContext(null)

export function useCurriculumContext() {
  return useContext(CurriculumContext)
}
