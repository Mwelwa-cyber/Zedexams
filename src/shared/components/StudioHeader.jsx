import { Link } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import './studioHeader.css'

/**
 * StudioHeader — the shared identity band for the teacher studios.
 *
 * Replaces the per-studio "small icon tile + eyebrow + title + description on
 * the page background" header. Two parts, in this order:
 *
 *   1. a slim UTILITY row — the back link plus any quiet secondary navigation
 *      on the left, the autosave chip on the right. One row: a studio must not
 *      grow a second navigation cluster further down the page.
 *   2. the BAND — eyebrow pill (the Teacher Workspace *category*, e.g.
 *      PLANNING — not "Teacher Studio", which names the surface you are
 *      already looking at), the studio name as the page's only serif line, a
 *      one-line description, and the studio's Lucide mark in a white circle.
 *
 * Everything visual lives in studioHeader.css so the band can be re-themed by
 * an ancestor `[data-theme]` — see the comment at the top of that file.
 *
 * Props:
 *   eyebrow     : string            workspace category, rendered uppercase
 *   title       : string            studio name (the one serif line)
 *   description : string            one line, no wrapping paragraph
 *   icon        : Lucide component  drawn at 27px inside the white circle
 *   backTo      : string|null       route for the back link
 *   backLabel   : string            back link text
 *   actions     : ReactNode         quiet secondary navigation, beside Back
 *   status      : ReactNode         right-hand chip (e.g. DraftStatusIndicator)
 */
export default function StudioHeader({
  eyebrow = '',
  title,
  description = '',
  icon: Icon = null,
  backTo = null,
  backLabel = 'Back',
  actions = null,
  status = null,
}) {
  const hasUtility = Boolean(backTo || actions || status)

  return (
    <div className="studio-header" data-print="hide">
      {hasUtility && (
        <div className="studio-header__utility">
          <div className="studio-header__utility-left">
            {backTo && (
              <Link to={backTo} className="studio-header__back">
                <ArrowLeft size={15} aria-hidden="true" />
                {backLabel}
              </Link>
            )}
            {actions}
          </div>
          {status && <div className="studio-header__utility-right">{status}</div>}
        </div>
      )}

      <div className="studio-header__band">
        <div className="studio-header__text">
          {eyebrow && <span className="studio-header__eyebrow">{eyebrow}</span>}
          <h1 className="studio-header__title">{title}</h1>
          {description && <p className="studio-header__desc">{description}</p>}
        </div>
        {Icon && (
          <span className="studio-header__icon" aria-hidden="true">
            <Icon size={27} strokeWidth={2} />
          </span>
        )}
      </div>
    </div>
  )
}
