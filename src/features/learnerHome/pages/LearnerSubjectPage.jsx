/**
 * LearnerSubjectPage — one subject organised by Term 1/2/3 (spec §9).
 * Topics come from the CBC catalogue; lessons, notes, quizzes and past
 * questions connect to each topic through the same subject/grade/term/
 * topic identifiers. Term assignment for a topic derives from its
 * quizzes' term tags; with no term-tagged material the full syllabus
 * shows on every tab (never invented into one term). Actions with no
 * material render disabled with a Coming Soon badge — nothing fake.
 */
import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import { collection, getDocs, limit as fsLimit, query, where } from 'firebase/firestore'
import { db } from '../../../firebase/config'
import { useAuth } from '../../../contexts/AuthContext'
import { useFirestore } from '../../../hooks/useFirestore'
import { SUBJECT_MAP, getTopics, normalizeSubject } from '../../../config/curriculum'
import { getActiveTerm } from '../../../utils/moeCalendar'
import LearnerIcon, { subjectIconName } from '../components/LearnerIcon'
import { ProgressBar, ProgressRing, EmptyState, ErrorState, SectionSkeleton } from '../components/LearnerPrimitives'
import {
  resolveActiveTerm, normalizeTerm, deriveTopicTerms, topicsForTerm,
} from '../lib/learnerHomeCore'
import { readJson, writeJson, preferredTermKey } from '../lib/learnerLocal'
import { capture } from '../../../utils/analytics'

const TERMS = [1, 2, 3]

function subjectMatches(value, subjectId, subjectLabel) {
  if (!value) return false
  return value === subjectId || normalizeSubject(value) === subjectLabel
}

export default function LearnerSubjectPage() {
  const { subjectId } = useParams()
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const { currentUser, userProfile } = useAuth()
  const { getQuizzes, getUserResults } = useFirestore()

  const uid = currentUser?.uid || null
  const grade = userProfile?.grade ? String(userProfile.grade) : null
  const subject = SUBJECT_MAP[subjectId] || null
  const subjectLabel = subject?.label || normalizeSubject(subjectId)

  const [state, setState] = useState({ loading: true, error: null, materials: [], quizzes: [], results: [], noteProgress: [] })
  const [bookmarked, setBookmarked] = useState(() => (readJson('lhx:subject-bookmarks', []) || []).includes(subjectId))

  useEffect(() => {
    if (!uid || !grade || !subject) { setState((s) => ({ ...s, loading: false })); return undefined }
    let stale = false
    const safe = (p, fb) => p.catch(() => fb)
    Promise.all([
      safe(getDocs(query(
        collection(db, 'lessons'),
        where('isPublished', '==', true),
        where('grade', '==', grade),
        fsLimit(300),
      )), null),
      safe(getQuizzes({ grade }), []),
      safe(getUserResults(uid, 50), []),
      safe(getDocs(query(collection(db, 'noteProgress'), where('uid', '==', uid), fsLimit(100))), null),
    ]).then(([materialsSnap, quizzes, results, npSnap]) => {
      if (stale) return
      setState({
        loading: false,
        error: null,
        materials: materialsSnap ? materialsSnap.docs.map((d) => ({ id: d.id, ...d.data() })) : [],
        quizzes: quizzes || [],
        results: results || [],
        noteProgress: npSnap ? npSnap.docs.map((d) => ({ id: d.id, ...d.data() })) : [],
      })
    }).catch((error) => {
      if (!stale) setState((s) => ({ ...s, loading: false, error }))
    })
    return () => { stale = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uid, grade, subjectId])

  // Active term: URL ?term wins (deep link), else calendar/saved default.
  const defaultTerm = useMemo(() => resolveActiveTerm({
    calendarTerm: getActiveTerm()?.term?.number ?? null,
    savedTerm: normalizeTerm(readJson(preferredTermKey(uid))),
  }).term, [uid])
  const urlTerm = normalizeTerm(params.get('term'))
  const term = urlTerm || defaultTerm
  const selectTerm = (t) => {
    setParams({ term: String(t) }, { replace: true })
    writeJson(preferredTermKey(uid), t)
  }

  const model = useMemo(() => {
    const { materials, quizzes, results, noteProgress } = state
    const subjectNotes = materials.filter((m) => m.noteFormat && subjectMatches(m.subject, subjectId, subjectLabel))
    const subjectLessons = materials.filter((m) => !m.noteFormat && Array.isArray(m.slides) && m.slides.length > 0 && subjectMatches(m.subject, subjectId, subjectLabel))
    const subjectQuizzes = quizzes.filter((q) => subjectMatches(q.subject, subjectId, subjectLabel))

    const topicNames = getTopics(subjectId, Number(grade)) || []
    const topicTerms = deriveTopicTerms(subjectQuizzes)
    const termTopics = topicsForTerm(topicNames, topicTerms, term)
    const hasTermData = topicTerms.size > 0
      || subjectNotes.some((n) => normalizeTerm(n.term) != null)

    const termNotes = subjectNotes.filter((n) => {
      const t = normalizeTerm(n.term)
      return t == null || t === term
    })
    const completedQuizIds = new Set(results.map((r) => r.quizId).filter(Boolean))
    const readNoteIds = new Set(noteProgress.filter((np) => np.status === 'completed').map((np) => np.noteId))

    const topics = termTopics.map((name, i) => {
      const topicQuizzes = subjectQuizzes.filter((q) => q.topic === name)
      const doneQuizzes = topicQuizzes.filter((q) => completedQuizIds.has(q.id))
      const percent = topicQuizzes.length
        ? Math.round((doneQuizzes.length / topicQuizzes.length) * 100)
        : 0
      const quizTarget = topicQuizzes.find((q) => !completedQuizIds.has(q.id)) || topicQuizzes[0] || null
      return {
        name,
        position: i + 1,
        quizCount: topicQuizzes.length,
        percent,
        hasQuiz: topicQuizzes.length > 0,
        quizTarget,
        hasLessons: subjectLessons.length > 0,
        hasNotes: termNotes.length > 0,
        status: percent >= 100 ? 'completed' : (doneQuizzes.length > 0 ? 'in-progress' : 'available'),
      }
    })

    const readTermNotes = termNotes.filter((n) => readNoteIds.has(n.id)).length
    const overall = topics.length || termNotes.length
      ? Math.round(
          ((topics.reduce((s, t) => s + t.percent, 0) / Math.max(1, topics.length * 100)) * 0.5
            + (termNotes.length ? readTermNotes / termNotes.length : 0) * 0.5) * 100,
        )
      : 0

    const revisionQuizzes = subjectQuizzes.filter((q) => normalizeTerm(q.term) === term && !q.topic)

    return {
      subjectNotes, subjectLessons, subjectQuizzes, topics, termNotes,
      hasTermData, overall, revisionQuizzes,
      lessonCount: subjectLessons.length,
    }
  }, [state, subjectId, subjectLabel, grade, term])

  const toggleBookmark = () => {
    const list = readJson('lhx:subject-bookmarks', []) || []
    const next = bookmarked ? list.filter((id) => id !== subjectId) : [...new Set([...list, subjectId])]
    writeJson('lhx:subject-bookmarks', next)
    setBookmarked(!bookmarked)
  }

  if (!subject) {
    return (
      <div className="lhx-card">
          <EmptyState icon="learn">This subject isn’t available for your grade.</EmptyState>
          <button type="button" className="lhx-btn lhx-btn-soft lhx-btn-block" onClick={() => navigate('/learn')}>Back to Learn</button>
      </div>
    )
  }

  const action = (topic, kind) => {
    if (kind === 'lessons') return navigate('/lessons')
    if (kind === 'notes') return navigate('/notes')
    if (kind === 'quiz' && topic.quizTarget) return navigate(`/quiz/${topic.quizTarget.id}`)
    if (kind === 'pastqs') {
      capture('past_papers_opened', { from: 'subject_topic' })
      return navigate(`/papers?grade=${grade}`)
    }
    return null
  }

  const TOPIC_ACTIONS = [
    { key: 'lessons', label: 'Lessons', icon: 'lessons', tone: 'tone-purple', enabled: (t) => t.hasLessons },
    { key: 'notes', label: 'Notes', icon: 'notes', tone: 'tone-green', enabled: (t) => t.hasNotes },
    { key: 'quiz', label: 'Quiz', icon: 'quiz', tone: 'tone-blue', enabled: (t) => t.hasQuiz },
    { key: 'pastqs', label: 'Past Qs', icon: 'marking-scheme', tone: 'tone-orange', enabled: () => true },
  ]

  return (
    <>
      <div className="lhx-subject-header">
        <button type="button" className="lhx-iconbtn" aria-label="Go back" onClick={() => navigate(-1)}>
          <ArrowLeft size={22} aria-hidden="true" />
        </button>
        <h1>{subjectLabel}</h1>
        <button
          type="button"
          className="lhx-iconbtn"
          aria-label={bookmarked ? 'Remove subject bookmark' : 'Bookmark this subject'}
          aria-pressed={bookmarked}
          style={bookmarked ? { color: 'var(--lhx-purple)' } : undefined}
          onClick={toggleBookmark}
        >
          <LearnerIcon name="bookmark" size={22} />
        </button>
      </div>

      <div className="lhx-terms" role="tablist" aria-label="School terms">
        {TERMS.map((t) => (
          <button
            key={t}
            type="button"
            role="tab"
            aria-selected={term === t}
            className="lhx-term-tab"
            onClick={() => selectTerm(t)}
          >
            Term {t}
          </button>
        ))}
      </div>

      {state.loading ? (
        <div className="lhx-card"><SectionSkeleton lines={5} /></div>
      ) : state.error ? (
        <div className="lhx-card"><ErrorState /></div>
      ) : (
        <>
          <section className="lhx-card lhx-term-overview" aria-label={`Term ${term} overview`}>
            <span className="lhx-subject-icon lhx-tint-green" aria-hidden="true">
              <LearnerIcon name={subjectIconName(subjectId)} size={24} />
            </span>
            <div className="lhx-term-overview-main">
              <p className="lhx-term-overview-title">Term {term}</p>
              <p className="lhx-term-overview-meta">
                {[
                  `${model.topics.length} topic${model.topics.length === 1 ? '' : 's'}`,
                  model.lessonCount ? `${model.lessonCount} lesson${model.lessonCount === 1 ? '' : 's'}` : null,
                  model.termNotes.length ? `${model.termNotes.length} notes` : null,
                ].filter(Boolean).join(' · ')}
              </p>
              <ProgressBar percent={model.overall} label={`Term ${term} completion: ${model.overall}%`} />
              {!model.hasTermData && model.topics.length > 0 && (
                <p className="lhx-term-overview-note">
                  Showing the full {subjectLabel} syllabus — materials haven’t been split by term yet.
                </p>
              )}
            </div>
          </section>

          <section className="lhx-section" aria-label={`Topics in Term ${term}`}>
            <div className="lhx-section-head">
              <h2 className="lhx-section-title">Topics in Term {term}</h2>
            </div>
            {model.topics.length === 0 ? (
              <div className="lhx-card">
                <EmptyState icon="learn">
                  Materials for Term {term} are being prepared. Check the other terms or the libraries below.
                </EmptyState>
              </div>
            ) : (
              model.topics.map((topic) => (
                <article key={topic.name} className="lhx-card lhx-topic">
                  <div className="lhx-topic-head">
                    <span className="lhx-topic-num" aria-hidden="true">{topic.position}</span>
                    <div className="lhx-topic-body">
                      <h3 className="lhx-topic-title">{topic.name}</h3>
                      <p className="lhx-topic-meta">
                        {topic.hasQuiz
                          ? `${topic.quizCount} quiz${topic.quizCount === 1 ? '' : 'zes'} available`
                          : 'Practice coming soon'}
                      </p>
                    </div>
                    {topic.hasQuiz && (
                      <ProgressRing percent={topic.percent} size={52} label={`${topic.name}: ${topic.percent}% complete`} />
                    )}
                  </div>
                  <div className="lhx-topic-actions">
                    {TOPIC_ACTIONS.map((a) => {
                      const enabled = a.enabled(topic)
                      return (
                        <button
                          key={a.key}
                          type="button"
                          className={`lhx-topic-action ${enabled ? a.tone : ''}`}
                          aria-disabled={!enabled}
                          disabled={!enabled}
                          aria-label={enabled ? `${a.label} for ${topic.name}` : `${a.label} for ${topic.name} — coming soon`}
                          onClick={() => enabled && action(topic, a.key)}
                        >
                          <LearnerIcon name={a.icon} size={18} />
                          {enabled ? a.label : <span className="lhx-soon-badge">Coming soon</span>}
                        </button>
                      )
                    })}
                  </div>
                </article>
              ))
            )}
          </section>

          <section className="lhx-section" aria-label={`Term ${term} resources`}>
            <div className="lhx-section-head">
              <h2 className="lhx-section-title">Term {term} Resources</h2>
            </div>
            <div className="lhx-card lhx-resources">
              <button type="button" className="lhx-resource-row" onClick={() => navigate('/notes')}>
                <span className="lhx-quick-icon lhx-tint-green" aria-hidden="true"><LearnerIcon name="notes" size={20} /></span>
                <span className="lhx-activity-main">
                  <span className="lhx-resource-title" style={{ display: 'block' }}>Term {term} Notes</span>
                  <span className="lhx-resource-sub" style={{ display: 'block' }}>
                    {model.termNotes.length ? `${model.termNotes.length} notes for ${subjectLabel}` : 'Notes for this term are being prepared'}
                  </span>
                </span>
              </button>
              {model.revisionQuizzes.length > 0 && (
                <button type="button" className="lhx-resource-row" onClick={() => navigate(`/quiz/${model.revisionQuizzes[0].id}`)}>
                  <span className="lhx-quick-icon lhx-tint-blue" aria-hidden="true"><LearnerIcon name="quiz" size={20} /></span>
                  <span className="lhx-activity-main">
                    <span className="lhx-resource-title" style={{ display: 'block' }}>Term {term} Revision Quiz</span>
                    <span className="lhx-resource-sub" style={{ display: 'block' }}>Test your understanding</span>
                  </span>
                </button>
              )}
              <button
                type="button"
                className="lhx-resource-row"
                onClick={() => {
                  capture('past_papers_opened', { from: 'subject_resources' })
                  navigate(`/papers?grade=${grade}`)
                }}
              >
                <span className="lhx-quick-icon lhx-tint-orange" aria-hidden="true"><LearnerIcon name="papers" size={20} /></span>
                <span className="lhx-activity-main">
                  <span className="lhx-resource-title" style={{ display: 'block' }}>Past Papers</span>
                  <span className="lhx-resource-sub" style={{ display: 'block' }}>Questions by year for Grade {grade}</span>
                </span>
              </button>
            </div>
          </section>
        </>
      )}
    </>
  )
}
