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
import Icon from '../ui/Icon'
import { ArrowRight, ChevronDown } from '../ui/icons'
import { capture } from '../../utils/analytics'

const VISIBLE = 3

export default function AiRecommendations({ recommendations = [] }) {
  const [showAll, setShowAll] = useState(false)
  if (!recommendations.length) return null

  const visible = showAll ? recommendations : recommendations.slice(0, VISIBLE)
  const hiddenCount = recommendations.length - VISIBLE

  return (
    <section className="teacher-reco teacher-defer" aria-label="AI recommendations">
      <div className="teacher-section-head">
        <div className="teacher-dashboard-eyebrow">AI Recommendations</div>
        {hiddenCount > 0 && !showAll && (
          <button
            type="button"
            className="teacher-section-head__link teacher-section-head__link--button"
            onClick={() => {
              setShowAll(true)
              capture('ai_recommendations_expanded', { hidden: hiddenCount })
            }}
          >
            View all recommendations
            <Icon as={ChevronDown} size="xs" />
          </button>
        )}
      </div>
      <div className="teacher-reco__grid">
        {visible.map((r) => (
          <div key={r.id} className="teacher-reco-card">
            <span className="teacher-reco-card__icon" aria-hidden="true">{r.icon}</span>
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
