/**
 * PastPapersHero — the main hero card (Past Papers stays the #1
 * feature). All values are real: paper counts + year range come from
 * the published-papers index, the resume block from actual reading
 * history. With no history the card shows a single Browse action.
 */
import { useNavigate } from 'react-router-dom'
import { Check } from 'lucide-react'
import { ProgressBar } from '../components/LearnerPrimitives'
import { normalizeSubject } from '../../../config/curriculum'
import { capture } from '../../../utils/analytics'

export default function PastPapersHero({ grade, papersMeta, paperResume, loading }) {
  const navigate = useNavigate()

  const browse = () => {
    capture('past_papers_opened', { from: 'dashboard_hero' })
    navigate(grade ? `/papers?grade=${grade}` : '/papers')
  }
  const resume = () => {
    if (!paperResume) return
    capture('past_paper_resumed', { paperId: paperResume.paperId })
    const hash = paperResume.page ? `#page=${paperResume.page}` : ''
    navigate(`/papers/${paperResume.paperId}${hash}`)
  }

  const yearRange = papersMeta?.yearMin && papersMeta?.yearMax
    ? (papersMeta.yearMin === papersMeta.yearMax ? String(papersMeta.yearMax) : `${papersMeta.yearMin}–${papersMeta.yearMax}`)
    : null

  const resumeLine = paperResume
    ? [paperResume.title, paperResume.year].filter(Boolean).join(' · ')
    : null
  const pageLine = paperResume?.page
    ? (paperResume.totalPages ? `Page ${paperResume.page} of ${paperResume.totalPages}` : `Page ${paperResume.page}`)
    : null
  const pagePct = paperResume?.page && paperResume?.totalPages
    ? (paperResume.page / paperResume.totalPages) * 100
    : null

  return (
    <section className="lhx-hero" aria-labelledby="lhx-hero-title">
      <div className="lhx-hero-top">
        <div>
          <h2 id="lhx-hero-title" className="lhx-hero-title">Past Papers</h2>
          <p className="lhx-hero-sub">Prepare for your next exams with real exam-style questions.</p>
        </div>
        <img
          className="lhx-hero-art"
          src="/assets/learner/illustrations/past-papers-folder.webp"
          alt=""
          width="96"
          height="96"
          loading="eager"
          fetchPriority="high"
        />
      </div>
      <div className="lhx-hero-points">
        <span className="lhx-hero-point">
          <Check size={18} aria-hidden="true" />
          {yearRange ? `ECZ Papers · ${yearRange}` : 'ECZ examination papers'}
        </span>
        <span className="lhx-hero-point">
          <Check size={18} aria-hidden="true" />
          Questions &amp; marking schemes
        </span>
      </div>
      <div className="lhx-hero-actions">
        <button type="button" className="lhx-btn lhx-btn-white" onClick={browse}>
          Browse Papers
        </button>
        {paperResume && (
          <button type="button" className="lhx-btn lhx-btn-outline-white" onClick={resume}>
            Continue Reading
          </button>
        )}
      </div>
      {paperResume ? (
        <div className="lhx-hero-resume">
          <div style={{ minWidth: 0 }}>
            <span>Last opened{paperResume.subject ? ` · ${normalizeSubject(paperResume.subject)}` : ''}</span>
            <strong>{resumeLine}</strong>
          </div>
          {pageLine && (
            <div className="lhx-hero-resume-track">
              <span style={{ display: 'block', marginBottom: 4, textAlign: 'right' }}>{pageLine}</span>
              {pagePct != null && <ProgressBar percent={pagePct} white label={`Reading progress: ${pageLine}`} />}
            </div>
          )}
        </div>
      ) : (!loading && papersMeta?.count === 0 && (
        <div className="lhx-hero-resume">
          <span>{grade ? `No Grade ${grade} papers are available yet — check back soon.` : 'Papers are being prepared.'}</span>
        </div>
      ))}
    </section>
  )
}
