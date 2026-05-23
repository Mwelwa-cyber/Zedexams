import { useEffect, useMemo, useState } from 'react'
import { Link, Navigate } from 'react-router-dom'
import { useAuth } from '../../contexts/AuthContext'
import { usePlatformSettings } from '../../contexts/PlatformSettingsContext'
import SeoHelmet from '../seo/SeoHelmet'
import {
  listPublishedPracticeQuizzesForLearner,
  describeDifficulty,
  estimatedMinutesForQuiz,
} from '../../utils/aiPracticeQuizService'

// /ai-practice — learner-facing list of PUBLISHED AI practice quizzes
// for the learner's registered grade.
//
// Safe-by-default:
//   - Feature flag `settings/global.learnerAi.showAiPracticeQuizzesToLearners`
//     must be true. Otherwise the page renders a redirect to the
//     dashboard (no leak of the feature's existence).
//   - Firestore rule on aiGeneratedContent enforces
//     `status == 'published'` for non-admin reads. The query also
//     filters by status + grade explicitly.
//   - Subject availability per grade is enforced by `aiGeneratedContent.subject`
//     matching what the generators emit for that grade. The list
//     surfaces a per-subject filter so learners can narrow further.

function DifficultyPill({ difficulty }) {
  const colour = difficulty === 'easy' ? 'bg-emerald-100 text-emerald-700' :
    difficulty === 'medium' ? 'bg-amber-100 text-amber-700' :
    difficulty === 'hard' ? 'bg-rose-100 text-rose-700' :
    'bg-slate-100 text-slate-700'
  return (
    <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full ${colour}`}>
      {difficulty || 'mixed'}
    </span>
  )
}

function QuizCard({ artifact }) {
  const c = artifact.content || {}
  const title = c.title || `${artifact.subject || 'Subject'} — ${artifact.topic || 'Topic'}`
  const qCount = Array.isArray(c.questions) ? c.questions.length : 0
  const mins = estimatedMinutesForQuiz(artifact)
  return (
    <article className="rounded-2xl border theme-border theme-card p-4 flex flex-col gap-2">
      <div className="flex items-start justify-between gap-2">
        <h3 className="text-sm font-bold theme-text leading-tight line-clamp-2 flex-1">{title}</h3>
        <DifficultyPill difficulty={describeDifficulty(c)} />
      </div>
      <div className="text-[11px] theme-text-muted leading-snug">
        {artifact.subject ? `${artifact.subject} · ` : ''}
        Topic: {artifact.topic || '—'}
        {artifact.subtopic ? ` · ${artifact.subtopic}` : ''}
      </div>
      <div className="flex items-center justify-between text-[11px] theme-text-muted mt-1">
        <span>{qCount} question{qCount === 1 ? '' : 's'}</span>
        <span>~{mins} min</span>
      </div>
      <Link
        to={`/ai-practice/${artifact.id}`}
        className="block mt-2 text-center text-sm font-bold px-3 py-2 rounded-xl bg-blue-600 text-white hover:bg-blue-700"
      >
        Start
      </Link>
    </article>
  )
}

export default function AiPracticeQuizList() {
  const { currentUser, userProfile, loading: authLoading } = useAuth()
  const { settings: platform, loaded: platformLoaded } = usePlatformSettings()
  const [artifacts, setArtifacts] = useState([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState(null)
  const [subjectFilter, setSubjectFilter] = useState('all')

  const flagOn = !!(platform && platform.learnerAi && platform.learnerAi.showAiPracticeQuizzesToLearners)
  const learnerGrade = userProfile && userProfile.grade

  useEffect(() => {
    if (!flagOn || !learnerGrade) {
      setArtifacts([])
      setLoading(false)
      return
    }
    setLoading(true)
    const unsub = listPublishedPracticeQuizzesForLearner({
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

  // Gate 1: must be logged in.
  if (!currentUser) return <Navigate to="/login" replace />

  // Gate 2: feature flag. Silent redirect — don't reveal the feature.
  if (!flagOn) return <Navigate to="/dashboard" replace />

  // Gate 3: must have a grade. Send to profile setup.
  if (!learnerGrade) {
    return (
      <div className="max-w-2xl mx-auto p-6 text-center">
        <SeoHelmet title="AI practice quizzes" />
        <p className="theme-text mb-3">
          Set your grade in your profile to see AI practice quizzes.
        </p>
        <Link to="/profile" className="theme-btn">Open profile</Link>
      </div>
    )
  }

  return (
    <div className="max-w-3xl mx-auto px-4 py-5 space-y-4">
      <SeoHelmet title="AI practice quizzes" />
      <header>
        <h1 className="text-2xl font-bold theme-text">AI practice quizzes</h1>
        <p className="text-sm theme-text-muted mt-1">
          Grade {learnerGrade} practice — admin-approved, learner-only. Try a quiz,
          then your AI study tips refresh automatically.
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
        <div className="theme-text-muted text-center py-8">Loading quizzes…</div>
      ) : filtered.length === 0 ? (
        <div className="theme-text-muted text-center py-12 rounded-2xl border border-dashed theme-border">
          {artifacts.length === 0 ?
            `No AI practice quizzes for Grade ${learnerGrade} yet. Check back soon.` :
            'No quizzes match the current subject filter.'}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {filtered.map(a => <QuizCard key={a.id} artifact={a} />)}
        </div>
      )}
    </div>
  )
}
