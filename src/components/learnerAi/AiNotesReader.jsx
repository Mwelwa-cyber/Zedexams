import { useEffect, useState } from 'react'
import { Link, useParams, Navigate } from 'react-router-dom'
import { useAuth } from '../../contexts/AuthContext'
import { usePlatformSettings } from '../../contexts/PlatformSettingsContext'
import SeoHelmet from '../seo/SeoHelmet'
import {
  loadNotes,
  estimatedReadingMinutesForNotes,
} from '../../utils/aiNotesService'

// /ai-notes/:contentId — learner reads a single AI-generated notes
// artifact. No submission, no scoring; pure read. Renders the eight
// structured sections defined by notesContentSchema:
//   1. shortExplanation
//   2. keyVocabulary
//   3. importantFacts
//   4. examples
//   5. summary
//   6. rememberThis
//   7. diagramSuggestions
//   8. quickRevision
//
// Same feature-flag gate as AiNotesList.

function Section({ title, children }) {
  return (
    <section className="rounded-2xl border theme-border theme-card p-4 space-y-2">
      <h2 className="text-sm font-bold theme-text">{title}</h2>
      {children}
    </section>
  )
}

function BulletList({ items }) {
  if (!Array.isArray(items) || items.length === 0) return null
  return (
    <ul className="list-disc list-outside ml-5 space-y-1 text-sm theme-text">
      {items.map((it, i) => (
        <li key={i} className="leading-snug">{it}</li>
      ))}
    </ul>
  )
}

export default function AiNotesReader() {
  const { contentId } = useParams()
  const { currentUser, userProfile, loading: authLoading } = useAuth()
  const { settings: platform, loaded: platformLoaded } = usePlatformSettings()
  const [artifact, setArtifact] = useState(null)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState(null)

  const flagOn = !!(platform && platform.learnerAi && platform.learnerAi.showAiNotesToLearners)
  const learnerGrade = userProfile && userProfile.grade

  useEffect(() => {
    if (!contentId) return
    if (!flagOn || !learnerGrade) {
      setLoading(false)
      return
    }
    let cancelled = false
    setLoading(true)
    loadNotes({ contentId, learnerGrade })
        .then(a => {
          if (cancelled) return
          setArtifact(a)
          setLoading(false)
        })
        .catch(e => {
          if (cancelled) return
          setErr(e.message)
          setLoading(false)
        })
    return () => { cancelled = true }
  }, [contentId, flagOn, learnerGrade])

  if (authLoading || !platformLoaded) {
    return <div className="max-w-2xl mx-auto p-6 text-center theme-text-muted">Loading…</div>
  }
  if (!currentUser) return <Navigate to="/login" replace />
  if (!flagOn) return <Navigate to="/dashboard" replace />
  if (!learnerGrade) return <Navigate to="/profile" replace />

  if (loading) {
    return <div className="max-w-2xl mx-auto p-6 text-center theme-text-muted">Loading notes…</div>
  }

  if (err) {
    return (
      <div className="max-w-2xl mx-auto p-6 space-y-3 text-center">
        <SeoHelmet title="Notes unavailable" />
        <p className="theme-text">{err}</p>
        <Link to="/ai-notes" className="theme-btn">Back to notes</Link>
      </div>
    )
  }
  if (!artifact) return null

  const c = artifact.content || {}
  const title = c.title || `${artifact.subject || 'Subject'} — ${artifact.topic || 'Topic'}`
  const mins = estimatedReadingMinutesForNotes(artifact)
  const hasVocab = Array.isArray(c.keyVocabulary) && c.keyVocabulary.length > 0
  const hasFacts = Array.isArray(c.importantFacts) && c.importantFacts.length > 0
  const hasExamples = Array.isArray(c.examples) && c.examples.length > 0
  const hasRemember = Array.isArray(c.rememberThis) && c.rememberThis.length > 0
  const hasDiagrams = Array.isArray(c.diagramSuggestions) && c.diagramSuggestions.length > 0
  const hasRevision = Array.isArray(c.quickRevision) && c.quickRevision.length > 0

  return (
    <div className="max-w-3xl mx-auto px-4 py-5 space-y-4">
      <SeoHelmet title={title} />

      <header className="rounded-2xl border theme-border theme-card p-4">
        <div className="flex items-start justify-between gap-2 flex-wrap">
          <h1 className="text-xl font-bold theme-text leading-tight flex-1 min-w-0">{title}</h1>
          <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-blue-100 text-blue-700 shrink-0">
            Notes
          </span>
        </div>
        <p className="text-[12px] theme-text-muted mt-1">
          Grade {artifact.grade}{artifact.subject ? ` · ${artifact.subject}` : ''}
          {artifact.topic ? ` · ${artifact.topic}` : ''}
          {artifact.subtopic ? ` · ${artifact.subtopic}` : ''}
          {mins ? ` · ~${mins} min read` : ''}
        </p>
        {c.shortExplanation && (
          <p className="text-sm theme-text mt-3 leading-relaxed whitespace-pre-wrap">
            {c.shortExplanation}
          </p>
        )}
      </header>

      {hasVocab && (
        <Section title="Key vocabulary">
          <dl className="space-y-2">
            {c.keyVocabulary.map((v, i) => (
              <div key={i} className="text-sm">
                <dt className="font-semibold theme-text">{v.term}</dt>
                <dd className="theme-text-muted leading-snug ml-3">{v.definition}</dd>
              </div>
            ))}
          </dl>
        </Section>
      )}

      {hasFacts && (
        <Section title="Important facts">
          <BulletList items={c.importantFacts} />
        </Section>
      )}

      {hasExamples && (
        <Section title="Examples">
          <ol className="list-decimal list-outside ml-5 space-y-3 text-sm theme-text">
            {c.examples.map((ex, i) => (
              <li key={i} className="leading-snug">
                <div className="font-semibold">{ex.title}</div>
                <div className="theme-text-muted whitespace-pre-wrap">{ex.explanation}</div>
              </li>
            ))}
          </ol>
        </Section>
      )}

      {c.summary && (
        <Section title="Summary">
          <p className="text-sm theme-text leading-relaxed whitespace-pre-wrap">{c.summary}</p>
        </Section>
      )}

      {hasRemember && (
        <Section title="Remember this">
          <BulletList items={c.rememberThis} />
        </Section>
      )}

      {hasDiagrams && (
        <Section title="Diagram ideas">
          <p className="text-[11px] theme-text-muted leading-snug">
            Try sketching these in your notebook while you study.
          </p>
          <BulletList items={c.diagramSuggestions} />
        </Section>
      )}

      {hasRevision && (
        <Section title="Quick revision">
          <BulletList items={c.quickRevision} />
        </Section>
      )}

      <div className="flex flex-col sm:flex-row gap-2 pt-2">
        <Link
          to="/ai-notes"
          className="flex-1 text-center text-sm font-bold px-4 py-2 rounded-xl theme-card border theme-border theme-text hover:theme-bg-subtle"
        >
          Back to notes
        </Link>
        <Link
          to="/dashboard"
          className="flex-1 text-center text-sm font-bold px-4 py-2 rounded-xl bg-blue-600 text-white hover:bg-blue-700"
        >
          Back to dashboard
        </Link>
      </div>
    </div>
  )
}
