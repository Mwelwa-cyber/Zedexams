/**
 * The scroll-to-top button, which appears once the reader is far enough down
 * that returning by scrolling is a chore.
 */
import { useEffect, useState } from 'react'

/**
 * Floating "back to top" button — appears after the learner scrolls
 * past one viewport so reaching the tab bar / Take-the-quiz CTA from
 * the bottom of a long paper is one tap, not 14 swipes.
 */
function BackToTopFab() {
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    const onScroll = () => {
      setVisible(window.scrollY > window.innerHeight * 0.75)
    }
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  if (!visible) return null

  return (
    <button
      type="button"
      aria-label="Back to top"
      onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
      className="fixed bottom-5 right-5 z-20 w-12 h-12 rounded-full bg-black/75 text-white text-xl font-black shadow-elev-lg hover:bg-black/90 flex items-center justify-center"
    >
      ↑
    </button>
  )
}

export default BackToTopFab
