import { buildDocTitle } from './docTitleParts'
import useViewportTier from './useViewportTier'

/**
 * The name of the paper being edited, in the studio's top bar.
 *
 * See docTitleParts.js for why this is composed per width instead of being one
 * string under a CSS ellipsis: an ellipsis truncates by position, and the facts
 * that identify one paper among a teacher's others (its type, its term, its
 * year) all sit at the END of the string, so they are the first thing a
 * right-hand ellipsis eats. At 360px the old bar said "Grade 4 Integrated
 * Science…" for every Science paper the teacher owned.
 *
 * On a phone the whole title is a button: the two-line form is necessarily
 * terser than the wide one, so the details sheet is where the full title and
 * the header fields behind it stay reachable.
 */
export default function DocTitle({ paper, status = '', onOpenDetails }) {
  const tier = useViewportTier()
  const built = buildDocTitle(paper || {}, { status })
  const narrow = tier === 'narrow'
  const text = narrow ? built.narrow.line1 : (tier === 'medium' ? built.medium : built.wide)

  const body = (
    <>
      <span className="sv-doc-title-line1">{text}</span>
      {narrow && built.narrow.line2 && (
        <span className="sv-doc-title-line2">{built.narrow.line2}</span>
      )}
    </>
  )

  if (narrow && onOpenDetails) {
    return (
      <button
        type="button"
        className="sv-doc-title is-narrow"
        onClick={onOpenDetails}
        title={built.full}
        aria-label={`Paper details — ${built.full}`}
      >
        {body}
      </button>
    )
  }

  return (
    <span className={`sv-doc-title${narrow ? ' is-narrow' : ''}`} title={built.full}>
      {body}
    </span>
  )
}
