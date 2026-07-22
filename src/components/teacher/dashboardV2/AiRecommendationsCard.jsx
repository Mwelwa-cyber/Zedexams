import { Link } from 'react-router-dom'
import { ArrowRight, BookOpen, CircleCheck, Sparkles } from 'lucide-react'

/**
 * recommendations: [{ id?, title, text, actionLabel, to }] — the real output
 * of buildProfileRecommendations (top 3 shown). Empty renders a positive
 * all-planned state instead of an empty card.
 */
export default function AiRecommendationsCard({ recommendations = [] }) {
  const items = recommendations.slice(0, 3)
  const [primary, ...rest] = items

  return (
    <section className="tdv2-card tdv2-ai-card" aria-labelledby="tdv2-ai-h">
      <div className="tdv2-card-head">
        <h2 className="tdv2-eyebrow" id="tdv2-ai-h">
          <Sparkles size={17} strokeWidth={2} aria-hidden="true" />
          AI Recommendations
        </h2>
      </div>
      {primary ? (
        <>
          <div className="tdv2-ai-body">
            <span className="tdv2-ai-icon" aria-hidden="true">
              <BookOpen size={22} strokeWidth={1.75} />
            </span>
            <h3 className="tdv2-ai-title">{primary.title}</h3>
            <p className="tdv2-ai-text">{primary.text}</p>
            <Link to={primary.to} className="tdv2-btn-outline" style={{ marginTop: 'auto' }}>
              {primary.actionLabel || 'Open'}
              <ArrowRight size={16} strokeWidth={2} aria-hidden="true" />
            </Link>
          </div>
          {rest.map((rec, i) => (
            <Link key={rec.id || i} to={rec.to} className="tdv2-ai-more">
              <span style={{ minWidth: 0 }}>
                <span className="tdv2-ai-more-title">{rec.title}</span>
                <span className="tdv2-ai-more-text">{rec.text}</span>
              </span>
              <ArrowRight size={15} strokeWidth={2} aria-hidden="true" />
            </Link>
          ))}
        </>
      ) : (
        <div className="tdv2-ai-body">
          <span className="tdv2-ai-icon" aria-hidden="true">
            <CircleCheck size={22} strokeWidth={1.75} />
          </span>
          <h3 className="tdv2-ai-title">You’re all caught up</h3>
          <p className="tdv2-ai-text">
            Nothing needs planning right now. New recommendations appear here as
            your term progresses.
          </p>
          <Link to="/teacher/library" className="tdv2-btn-outline" style={{ marginTop: 'auto' }}>
            Open My Library
            <ArrowRight size={16} strokeWidth={2} aria-hidden="true" />
          </Link>
        </div>
      )}
    </section>
  )
}
