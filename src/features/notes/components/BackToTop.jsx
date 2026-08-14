// src/features/notes/components/BackToTop.jsx
//
// Floating "scroll to top" control for long notes. Appears once the learner
// has scrolled past ~600px. Sits above the Contents pill on small screens.

import { useEffect, useState } from 'react'
import { ChevronUp } from '../../../shared/components/icons'

export function BackToTop() {
  const [show, setShow] = useState(false)

  useEffect(() => {
    const onScroll = () => setShow((window.scrollY || 0) > 600)
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  if (!show) return null

  return (
    <button
      type="button"
      onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
      aria-label="Back to top"
      className="fixed bottom-20 right-4 xl:bottom-5 z-30 w-11 h-11 grid place-items-center rounded-full border-2 border-[#0F1B2D] bg-white text-[#0F1B2D] notes-chip-shadow hover:-translate-y-px transition"
    >
      <ChevronUp size={18} />
    </button>
  )
}

export default BackToTop
