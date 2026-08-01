import { Link } from 'react-router-dom'
import { ArrowRight, BookOpen, CircleCheck, Sparkles } from 'lucide-react'
import useGlassTile from '../../../hooks/useGlassTile'
import './glassSurface.css'

/* Compact recommendation row — a glass tile with hover/press but NO sheen:
   AI content changes between visits, and motion here would read as the
   panel nagging for attention. */
function AiMoreRow({ rec }) {
  const rowRef = useGlassTile({ sheen: false })
  return (
    <Link ref={rowRef} to={rec.to} className="tdv2-ai-more glass-tile">
      <span style={{ minWidth: 0 }}>
        <span className="tdv2-ai-more-title">{rec.title}</span>
        <span className="tdv2-ai-more-text">{rec.text}</span>
      </span>
      <ArrowRight size={15} strokeWidth={2} aria-hidden="true" />
    </Link>
  )
}

/**
 * recommendations: [{ id?, title, text, actionLabel, to }] — the real output
 * of buildProfileRecommendations (top 3 shown). Empty renders a positive
 * all-planned state instead of an empty card.
 */
export default function AiRecommendationsCard({ recommendations = [] }) {
  const items = recommendations.slice(0, 3)
  const [primary, ...rest] = items

  return (
    <section
      className="tdv2-card tdv2-ai-card glass-panel glass-panel--ai"
      aria-labelledby="tdv2-ai-h"
      data-tour="ai-recs"
    >
      <div className="tdv2-card-head">
        <h2 className="tdv2-eyebrow" id="tdv2-ai-h">
          <Sparkles size={17} strokeWidth={2} aria-hidden="true" />
          AI Recommendations
        </h2>
      </div>
      {primary ? (
        <>
          {/* The primary card is not itself clickable (its button is), so it
              takes the static glass surface — no hover motion it can't honour. */}
          <div className="tdv2-ai-body glass-surface">
            <span className="tdv2-ai-icon" aria-hidden="true">
              <BookOpen size={22} strokeWidth={1.75} />
            </span>
            <h3 className="tdv2-ai-title">{primary.title}</h3>
            {primary.context ? (
              <div className="tdv2-ai-context">
                {primary.context.grade ? <span className="tdv2-ai-chip">{primary.context.grade}</span> : null}
                {primary.context.subject ? <span className="tdv2-ai-chip">{primary.context.subject}</span> : null}
              </div>
            ) : null}
            <p className="tdv2-ai-text">{primary.text}</p>
            <Link to={primary.to} className="tdv2-btn-outline" style={{ marginTop: 4 }}>
              {primary.actionLabel || 'Open'}
              <ArrowRight size={16} strokeWidth={2} aria-hidden="true" />
            </Link>
          </div>
          {rest.map((rec, i) => (
            <AiMoreRow key={rec.id || i} rec={rec} />
          ))}
        </>
      ) : (
        <div className="tdv2-ai-body glass-surface">
          <span className="tdv2-ai-icon" aria-hidden="true">
            <CircleCheck size={22} strokeWidth={1.75} />
          </span>
          <h3 className="tdv2-ai-title">You’re all caught up</h3>
          <p className="tdv2-ai-text">
            Nothing needs planning right now. New recommendations appear here as
            your term progresses.
          </p>
          <Link to="/teacher/library" className="tdv2-btn-outline" style={{ marginTop: 4 }}>
            Open My Library
            <ArrowRight size={16} strokeWidth={2} aria-hidden="true" />
          </Link>
        </div>
      )}
    </section>
  )
}
