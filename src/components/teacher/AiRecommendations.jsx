/**
 * AiRecommendations — actionable recommendation cards (redesign §8).
 *
 * Replaces the passive "AI insights" section. Purely presentational:
 * TeacherDashboard derives the list with buildRecommendations()
 * (src/utils/teacherRecommendations.js) from data it already fetched.
 * Shows at most three cards; "View all" expands the rest in place.
 * Renders nothing when no recommendation's condition is true — an empty
 * section would just be noise.
 */

import { useState } from 'react'
import { Link } from 'react-router-dom'
import Icon from '../../shared/components/Icon'
import { ArrowRight, ChevronDown } from '../../shared/components/icons'
import { capture } from '../../utils/analytics'

const VISIBLE = 3
// Hard ceiling on rendered cards even when expanded — keeps a very long
// list from stretching the dashboard. The engine emits ~5 today; if it
// ever grows past this, a dedicated page becomes the right home.
const MAX_RENDERED = 9

export default function AiRecommendations({ recommendations = [] }) {
  const [showAll, setShowAll] = useState(false)
  if (!recommendations.length) return null

  const capped = recommendations.slice(0, MAX_RENDERED)
  const visible = showAll ? capped : capped.slice(0, VISIBLE)
  const hiddenCount = capped.length - VISIBLE

  return (
    <section className="teacher-reco teacher-defer" aria-label="AI recommendations">
      <div className="teacher-section-head">
        <div className="teacher-dashboard-eyebrow">AI Recommendations</div>
        {hiddenCount > 0 && (
          <button
            type="button"
            className="teacher-section-head__link teacher-section-head__link--button"
            aria-expanded={showAll}
            aria-controls="teacher-reco-grid"
            onClick={() => {
              setShowAll((v) => {
                if (!v) capture('ai_recommendations_expanded', { hidden: hiddenCount })
                return !v
              })
            }}
          >
            {showAll ? 'Show fewer recommendations' : 'View all recommendations'}
            <Icon
              as={ChevronDown}
              size="xs"
              className={showAll ? 'teacher-usage-card__chevron is-open' : 'teacher-usage-card__chevron'}
            />
          </button>
        )}
      </div>
      <div id="teacher-reco-grid" className="teacher-reco__grid">
        {visible.map((r) => (
          <div key={r.id} className="teacher-reco-card">
            <span className="teacher-reco-card__icon" aria-hidden="true">{r.icon}</span>
            {r.scope && (
              <span
                className="teacher-reco-card__scope"
                style={{ display: 'inline-block', fontSize: '0.72rem', fontWeight: 700, letterSpacing: '0.02em', textTransform: 'uppercase', opacity: 0.72 }}
              >
                {r.scope}
              </span>
            )}
            <p className="teacher-reco-card__title">{r.title}</p>
            <p className="teacher-reco-card__text">{r.text}</p>
            <Link
              to={r.to}
              className="teacher-reco-card__action"
              onClick={() => capture('ai_recommendation_selected', { id: r.id })}
            >
              {r.actionLabel}
              <Icon as={ArrowRight} size="xs" />
            </Link>
          </div>
        ))}
      </div>
    </section>
  )
}
