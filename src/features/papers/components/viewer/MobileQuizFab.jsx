/**
 * The floating "take the quiz" button on narrow screens. Renders nothing when
 * the paper has no quiz attached — a button that leads nowhere is worse than
 * no button.
 */
import { Link } from 'react-router-dom'
import { PencilLine } from '../../../../shared/components/icons'
import useHideOnScroll from '../../../../hooks/useHideOnScroll'

/**
 * Floating "Take Quiz" action on phones (desktop uses the sticky bar +
 * rail). Sits on the left, above the glass dock in PDF mode, and never
 * over the Zed chat bubble (which docks right). While the learner scrolls
 * down it collapses to a small circular icon so it doesn't sit over exam
 * content; scrolling up expands it back to the full label.
 */
function MobileQuizFab({ paperId, available, aboveDock = false }) {
  const collapsed = useHideOnScroll({ threshold: 120 })
  if (!available) return null
  return (
    <Link
      to={`/papers/${paperId}/quiz`}
      aria-label="Take the quiz for this paper"
      style={{
        bottom: aboveDock
          ? 'calc(100px + env(safe-area-inset-bottom))'
          : 'calc(20px + env(safe-area-inset-bottom))',
      }}
      className={`lg:hidden fixed left-4 z-30 inline-flex items-center justify-center gap-2 rounded-full theme-accent-fill theme-on-accent min-h-[52px] text-sm font-black shadow-elev-lg active:scale-95 transition-all duration-300 ease-out ${
        collapsed ? 'w-[52px] px-0' : 'px-5 py-3'
      }`}
    >
      <PencilLine size={collapsed ? 22 : 17} strokeWidth={2.4} />
      {!collapsed && 'Take Quiz'}
    </Link>
  )
}

export default MobileQuizFab
