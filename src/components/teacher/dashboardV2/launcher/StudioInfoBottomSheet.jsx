import { useEffect, useRef } from 'react'
import { ArrowRight, Clock, FolderOpen, Star, X } from 'lucide-react'

/**
 * Mobile / touch information sheet, shown on press-and-hold of a studio icon
 * (tap still opens the studio directly — the sheet is never on the critical
 * path into a studio). Keyboard users reach it via Shift+F10 / the
 * ContextMenu key on a focused icon, so it is also the keyboard route to
 * favourites and saved work. Slides up from the bottom, dims the page, and
 * closes on the close button, backdrop tap, Escape or selecting an action.
 *
 * Focus management: focus moves into the sheet on open, Tab cycles within
 * it (simple first/last trap — the sheet is aria-modal), and the launcher
 * restores focus to the triggering icon on close.
 */
export default function StudioInfoBottomSheet({
  studio,
  badge = null,
  savedCount = null,
  lastOpened = null,
  isFavourite = false,
  onOpenStudio,
  onViewSaved,
  onToggleFavourite,
  onClose,
}) {
  const sheetRef = useRef(null)

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') {
        onClose?.()
        return
      }
      if (e.key !== 'Tab') return
      // Keep Tab inside the sheet while it is open.
      const focusables = sheetRef.current?.querySelectorAll('button, [href]')
      if (!focusables?.length) return
      const first = focusables[0]
      const last = focusables[focusables.length - 1]
      const active = document.activeElement
      if (e.shiftKey && (active === first || active === sheetRef.current)) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && active === last) {
        e.preventDefault()
        first.focus()
      } else if (!sheetRef.current?.contains(active)) {
        e.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    // Move focus into the sheet for keyboard/AT users.
    sheetRef.current?.focus()
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prev
    }
  }, [onClose])

  if (!studio) return null
  const Icon = studio.icon
  const savedText = typeof savedCount === 'number' ? `${savedCount} saved` : null

  return (
    <div className="tsl-sheet-root" role="presentation">
      <div className="tsl-sheet-backdrop" onPointerDown={onClose} />
      <div
        className="tsl-sheet"
        role="dialog"
        aria-modal="true"
        aria-label={`${studio.title} — details`}
        tabIndex={-1}
        ref={sheetRef}
      >
        <div className="tsl-sheet-grip" aria-hidden="true" />
        <button type="button" className="tsl-sheet-close" aria-label="Close" onClick={onClose}>
          <X size={20} strokeWidth={2} aria-hidden="true" />
        </button>

        <div className="tsl-sheet-head">
          <span
            className={`tsl-app-tile ${studio.image ? 'is-img' : `tint-${studio.tint || 'teal'}`}`}
            aria-hidden="true"
          >
            {studio.image ? (
              <img className="tsl-app-img" src={studio.image} alt="" loading="lazy" />
            ) : (
              <Icon size={26} strokeWidth={1.9} />
            )}
          </span>
          <div className="tsl-sheet-heading">
            <span className="tsl-sheet-title">{studio.title}</span>
            <div className="tsl-sheet-meta">
              {savedText ? (
                <span className="tsl-pop-metaitem">
                  <FolderOpen size={13} strokeWidth={2} aria-hidden="true" />
                  {savedText}
                </span>
              ) : null}
              {lastOpened ? (
                <span className="tsl-pop-metaitem">
                  <Clock size={13} strokeWidth={2} aria-hidden="true" />
                  {lastOpened}
                </span>
              ) : null}
              {badge?.type === 'new' && !savedText ? <span className="tsl-pop-tag">New</span> : null}
            </div>
          </div>
        </div>

        <p className="tsl-sheet-desc">{studio.description}</p>

        <button type="button" className="tsl-pop-primary tsl-sheet-primary" onClick={() => onOpenStudio?.(studio)}>
          Open Studio
          <ArrowRight size={16} strokeWidth={2.2} aria-hidden="true" />
        </button>

        {studio.savedWorkTo ? (
          <button type="button" className="tsl-sheet-row" onClick={() => onViewSaved?.(studio)}>
            <FolderOpen size={18} strokeWidth={1.9} aria-hidden="true" />
            View saved work
            <ArrowRight size={15} strokeWidth={2} className="tsl-sheet-row-arrow" aria-hidden="true" />
          </button>
        ) : null}

        <button
          type="button"
          className="tsl-sheet-row"
          aria-pressed={isFavourite}
          onClick={() => onToggleFavourite?.(studio)}
        >
          <Star size={18} strokeWidth={1.9} fill={isFavourite ? 'currentColor' : 'none'} aria-hidden="true" />
          {isFavourite ? 'Remove from favourites' : 'Add to favourites'}
        </button>
      </div>
    </div>
  )
}
