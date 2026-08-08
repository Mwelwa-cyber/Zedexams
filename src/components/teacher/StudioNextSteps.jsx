/**
 * StudioNextSteps — the post-save "What would you like to do next?" panel
 * (redesign §14, connected teacher workflow).
 *
 * Rendered by a studio after a successful generation/save with the concrete
 * next actions for that document type. Each action is a plain route (usually
 * carrying a context query string built with buildGeneratorQueryString) so
 * the destination studio opens pre-filled — the metadata passing itself is
 * the studios' existing URL-seeding, not new state. Facts (things that
 * already happened automatically, like Question Bank capture) render as
 * checkmarked notes, not buttons — the panel never offers an action for
 * something that is already done.
 */

import { Link } from 'react-router-dom'
import Icon from '../ui/Icon'
import { ArrowRight } from '../ui/icons'
import { capture } from '../../utils/analytics'
import useStudioAvailability from '../../hooks/useStudioAvailability'

export default function StudioNextSteps({ context, actions = [], facts = [] }) {
  // A next step into a studio that is no longer offered is a dead end dressed
  // as a workflow — filtered here, once, rather than in each studio that
  // offers one.
  const { filterEntries } = useStudioAvailability()
  const visible = filterEntries(actions)
  if (!visible.length && !facts.length) return null
  return (
    <div className="studio-next-steps" role="note" aria-label="What would you like to do next?">
      <p className="studio-next-steps__title">What would you like to do next?</p>
      {facts.length > 0 && (
        <ul className="studio-next-steps__facts">
          {facts.map((f) => (
            <li key={f}>
              <span aria-hidden="true">✓</span> {f}
            </li>
          ))}
        </ul>
      )}
      <div className="studio-next-steps__actions">
        {visible.map((a, i) => (
          <Link
            key={a.label}
            to={a.to}
            className={`studio-next-steps__btn ${i === 0 ? 'studio-next-steps__btn--primary' : ''}`}
            onClick={() => capture('studio_next_step_selected', { context, action: a.key || a.label })}
          >
            {a.label}
            {i === 0 && <Icon as={ArrowRight} size="xs" />}
          </Link>
        ))}
      </div>
    </div>
  )
}
