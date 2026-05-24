import { useEffect, useMemo, useState } from 'react'
import { Link, Navigate } from 'react-router-dom'
import { useAuth } from '../../contexts/AuthContext'
import { usePlatformSettings } from '../../contexts/PlatformSettingsContext'
import SeoHelmet from '../seo/SeoHelmet'
import {
  listPublishedNotesForLearner,
  estimatedReadingMinutesForNotes,
} from '../../utils/aiNotesService'

// /ai-notes — learner-facing list of PUBLISHED AI notes for the
// learner's registered grade. Mirrors AiPracticeQuizList exactly,
// but reads `type == 'notes'` artifacts from aiGeneratedContent and
// hides the difficulty pill / question count (notes don't have those).
//
// Safe-by-default:
//   - Feature flag `settings/global.learnerAi.showAiNotesToLearners`
//     must be true. Otherwise renders a silent redirect to /dashboard
//     (no leak of the feature's existence).
//   - Firestore rule on aiGeneratedContent enforces
//     `status == 'published'` for non-admin reads.

function NotesCard({ artifact }) {
  const c = artifact.content || {}
  const title = c.title || `${artifact.subject || 'Subject'} — ${artifact.topic || 'Topic'}`
  const mins = estimatedReadingMinutesForNotes(artifact)
  const vocabCount = Array.isArray(c.keyVocabulary) ? c.keyVocabulary.length : 0
  const exampleCount = Array.isArray(c.examples) ? c.examples.length : 0
  return (
    <article className="rounded-2xl border theme-border theme-card p-4 flex flex-col gap-2">
      <div className="flex items-start justify-between gap-2">
        <h3 className="text-sm font-bold theme-text leading-tight line-clamp-2 flex-1">{title}</h3>
        <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-blue-100 text-blue-700 shrink-0">
          Notes
        </span>
      </div>
      <div className="text-[11px] theme-text-muted leading-snug">
        {artifact.subject ? `${artifact.subject} · ` : ''}
        Topic: {artifact.topic || '—'}
        {artifact.subtopic ? ` · ${artifact.subtopic}` : ''}
      </div>
      {c.shortExplanation && (
        <p className="text-[12px] theme-text-muted leading-snug line-clamp-2">
          {c.shortExplanation}
        </p>
      )}
      <div className="flex items-center justify-between text-[11px] theme-text-muted mt-1">
        <span>
          {vocabCount} term{vocabCount === 1 ? '' : 's'} · {exampleCount} example{exampleCount === 1 ? '' : 's'}
        </span>
        <span>~{mins} min read</span>
      </div>
      <Link
        to={`/ai-notes/${artifact.id}`}
        className="block mt-2 text-center text-sm font-bold px-3 py-2 rounded-xl bg-blue-600 text-white hover:bg-blue-700"
      >
        Read
      </Link>
    </article>
  )
}

export default function AiNotesList() {
  const { currentUser, userProfile, loading: authLoading } = useAuth()
  const { settings: platform, loaded: platformLoaded } = usePlatformSettings()
  const [artifacts, setArtifacts] = useState([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState(null)
  const [subjectFilter, setSubjectFilter] = useState('all')

  const flagOn = !!(platform && platform.learnerAi && platform.learnerAi.showAiNotesToLearners)
  const learnerGrade = userProfile && userProfile.grade

  useEffect(() => {
    if (!flagOn || !learnerGrade) {
      setArtifacts([])
      setLoading(false)
      return
    }
    setLoading(true)
    const unsub = listPublishedNotesForLearner({
      grade: learnerGrade,
      onChange: list => {
        setArtifacts(list)
        setLoading(false)
        setErr(null)
      },
      onError: e => {
        setErr(e.message)
        setLoading(false)
      },
    })
    return () => unsub()
  }, [flagOn, learnerGrade])

  const subjects = useMemo(() => {
    const set = new Set()
    for (const a of artifacts) {
      if (typeof a.subject === 'string' && a.subject.length) set.add(a.subject)
    }
    return [...set].sort()
  }, [artifacts])

  const filtered = useMemo(() => {
    if (subjectFilter === 'all') return artifacts
    return artifacts.filter(a => a.subject === subjectFilter)
  }, [artifacts, subjectFilter])

  if (authLoading || !platformLoaded) {
    return (
      <div className="max-w-2xl mx-auto p-6 text-center theme-text-muted">
        Loading…
      </div>
    )
  }

  if (!currentUser) return <Navigate to="/login" replace />
  if (!flagOn) return <Navigate to="/dashboard" replace />

  if (!learnerGrade) {
    return (
      <div className="max-w-2xl mx-auto p-6 text-center">
        <SeoHelmet title="AI notes" />
        <p className="theme-text mb-3">
          Set your grade in your profile to see AI notes.
        </p>
        <Link to="/profile" className="theme-btn">Open profile</Link>
      </div>
    )
  }

  return (
    <div className="max-w-3xl mx-auto px-4 py-5 space-y-4">
      <SeoHelmet title="AI notes" />
      <header>
        <h1 className="text-2xl font-bold theme-text">AI notes</h1>
        <p className="text-sm theme-text-muted mt-1">
          Grade {learnerGrade} study notes — admin-approved, learner-only.
          Built from the CBC curriculum with vocabulary, examples, and
          a quick-revision summary at the end.
        </p>
      </header>

      {subjects.length > 1 && (
        <div className="flex flex-wrap gap-1.5">
          <button
            type="button"
            onClick={() => setSubjectFilter('all')}
            className={`text-xs font-semibold px-3 py-1.5 rounded-full ${
              subjectFilter === 'all' ?
                'bg-blue-600 text-white' :
                'theme-card border theme-border theme-text hover:theme-bg-subtle'
            }`}
          >
            All subjects
          </button>
          {subjects.map(s => (
            <button
              key={s}
              type="button"
              onClick={() => setSubjectFilter(s)}
              className={`text-xs font-semibold px-3 py-1.5 rounded-full ${
                subjectFilter === s ?
                  'bg-blue-600 text-white' :
                  'theme-card border theme-border theme-text hover:theme-bg-subtle'
              }`}
            >
              {s}
            </button>
          ))}
        </div>
      )}

      {err && (
        <div className="rounded-xl border border-rose-200 bg-rose-50 text-rose-700 text-sm p-3">
          Failed to load: {err}
        </div>
      )}

      {loading ? (
        <div className="theme-text-muted text-center py-8">Loading notes…</div>
      ) : filtered.length === 0 ? (
        <div className="theme-text-muted text-center py-12 rounded-2xl border border-dashed theme-border">
          {artifacts.length === 0 ?
            `No AI notes for Grade ${learnerGrade} yet. Check back soon.` :
            'No notes match the current subject filter.'}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {filtered.map(a => <NotesCard key={a.id} artifact={a} />)}
        </div>
      )}
    </div>
  )
}
