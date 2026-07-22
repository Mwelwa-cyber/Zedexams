import { Link } from 'react-router-dom'
import { ArrowRight, BookOpen, Sparkles } from 'lucide-react'
import { AI_RECOMMENDATION } from './mockData'

export default function AiRecommendationsCard() {
  return (
    <section className="tdv2-card tdv2-ai-card" aria-labelledby="tdv2-ai-h">
      <div className="tdv2-card-head">
        <h2 className="tdv2-eyebrow" id="tdv2-ai-h">
          <Sparkles size={17} strokeWidth={2} aria-hidden="true" />
          AI Recommendations
        </h2>
        <Link className="tdv2-link-action" to="/teacher/library" style={{ color: 'var(--blue)' }}>
          View all
          <ArrowRight size={15} strokeWidth={2} aria-hidden="true" />
        </Link>
      </div>
      <div className="tdv2-ai-body">
        <span className="tdv2-ai-icon" aria-hidden="true">
          <BookOpen size={22} strokeWidth={1.75} />
        </span>
        <h3 className="tdv2-ai-title">{AI_RECOMMENDATION.heading}</h3>
        <p className="tdv2-ai-text">{AI_RECOMMENDATION.body}</p>
        <Link to={AI_RECOMMENDATION.to} className="tdv2-btn-outline" style={{ marginTop: 'auto' }}>
          {AI_RECOMMENDATION.cta}
          <ArrowRight size={16} strokeWidth={2} aria-hidden="true" />
        </Link>
      </div>
    </section>
  )
}
