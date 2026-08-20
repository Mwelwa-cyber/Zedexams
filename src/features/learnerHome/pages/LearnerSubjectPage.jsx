/**
 * LearnerSubjectPage — one subject organised by Term 1/2/3, in the
 * mockup's shape: a back row carrying the subject and "Grade N · Term T
 * · X of Y topics done", the Term 1/2/3 segment, a one-line note about
 * the term, and the topic list. A topic row is an icon tile, the topic
 * name, and a status pill (\u2713 done / \u25b6 current / \u25cb to do); tapping
 * it opens that topic's note.
 *
 * What is deliberately NOT here, because the mockup has none of it: the
 * per-topic Lessons / Quiz / Past Qs action buttons, the bookmark
 * control, the term-overview card and the "Term N Resources" list. An
 * earlier pass carried those over from the pre-redesign screen; two of
 * them were the last learner entry points into /lessons and /quizzes,
 * which the mockup does not contain at all.
 *
 * TERM ASSIGNMENT comes from one of three places, in this order:
 *
 *   1. A published term plan for the grade+subject (`config/gradeTermPlan`).
 *      Grade 7 English and Integrated Science have one — the owner's own
 *      allocation, transcribed from the prototype. Rows carry an icon and a
 *      curriculum strand, and the row IS the sub-topic (Science's strands
 *      are its five parent topics).
 *   2. Otherwise the catalogue divided across the three terms
 *      (`config/termDivision`): the published sub-topic order cut into three
 *      consecutive slices, each roughly a third of the year's sub-topics, so
 *      a wide topic takes a proportionally wider share. Labelled on screen as
 *      a suggested split, because it is pacing rather than the syllabus's own
 *      word — the ECZ 2013 syllabus has no term column, and allocating it is a
 *      school's scheme of work. Nothing is invented: every row is a title
 *      already in the catalogue, in the order the catalogue publishes it.
 *   3. Otherwise the topic's quizzes' term tags, as before.
 *
 * With none of the three — a catalogue too small to divide and no tagged
 * quizzes — the full syllabus shows on every tab and the screen SAYS SO,
 * because three identical tabs with no explanation is indistinguishable from
 * a broken switcher.
 *
 * A topic with no note published yet says so rather than leading nowhere.
 */
import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { collection, getDocs, limit as fsLimit, query, where } from 'firebase/firestore'
import { db } from '../../../firebase/config'
import { useAuth } from '../../../contexts/AuthContext'
import { useLearnerFirestore } from '../../../hooks/useLearnerFirestore'
import { SUBJECT_MAP, normalizeSubject } from '../../../config/curriculum'
import { resolveLearnerCalendar, whenPhrase } from '../../../utils/learnerCalendar'
import useDayKey, { dayKeyDate } from '../../../hooks/useDayKey'
import LearnerIcon, { subjectIconName } from '../components/LearnerIcon'
import { EmptyState, ErrorState, ProgressBar, SectionSkeleton } from '../components/LearnerPrimitives'
import {
  resolveActiveTerm, calendarTermInputs, normalizeTerm, deriveTopicTerms,
  termNoteFor, topicOpenTarget,
} from '../lib/learnerHomeCore'
import { computeSubjectProgress, subjectRowMeta, TOPIC_PASS_MARK } from '../lib/subjectProgressCore'
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
  const { getQuizzes, getUserResults } = useLearnerFirestore()

  const uid = currentUser?.uid || null
  const grade = userProfile?.grade ? String(userProfile.grade) : null
  const subject = SUBJECT_MAP[subjectId] || null
  const subjectLabel = subject?.label || normalizeSubject(subjectId)

  const [state, setState] = useState({ loading: true, error: null, materials: [], quizzes: [], results: [], noteProgress: [] })

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
  //
  // ONE resolution for the page. There used to be two — this one, and a
  // second further down feeding the note under the tabs that did NOT pass
  // `savedTerm` — so on the one date they can disagree (a calendar with no
  // answer plus a stored preference) the page told the learner their tab was
  // finished while showing them a different tab's default.
  const dayKey = useDayKey()
  const calendar = useMemo(() => resolveLearnerCalendar(dayKeyDate(dayKey)), [dayKey])
  const active = useMemo(() => resolveActiveTerm({
    ...calendarTermInputs(calendar.recent),
    savedTerm: normalizeTerm(readJson(preferredTermKey(uid))),
  }), [uid, calendar])
  const defaultTerm = active.term
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
    const termNotes = subjectNotes.filter((n) => {
      const t = normalizeTerm(n.term)
      return t == null || t === term
    })
    const subjectResults = results.filter((r) => subjectMatches(r.subject, subjectId, subjectLabel))

    // The rows, their statuses and the term verdict all come from
    // `subjectProgressCore` — the same function the home row calls with the
    // same inputs. Two formulas over one question is how the row and the
    // screen came to print different numbers about the same term.
    const { topics, summary, planSource, hasPlan, unplacedCount } = computeSubjectProgress({
      subjectId,
      grade,
      term,
      subjectNotes,
      termNotes,
      subjectQuizzes,
      results: subjectResults,
      noteProgress,
    })

    const hasTermData = hasPlan
      || deriveTopicTerms(subjectQuizzes).size > 0
      || subjectNotes.some((n) => normalizeTerm(n.term) != null)

    // The mockup marks exactly one topic as "current": the first one not
    // finished. A DISPLAY flag, never a status — the earlier pass overwrote
    // `status` to do this, which erased the evidence the counts are made of.
    const currentIdx = topics.findIndex((t) => t.status !== 'completed')
    const rows = topics.map((t, i) => ({ ...t, current: i === currentIdx }))

    const revisionQuizzes = subjectQuizzes.filter((q) => normalizeTerm(q.term) === term && !q.topic)

    return {
      subjectNotes, subjectLessons, subjectQuizzes, topics: rows, termNotes,
      hasTermData, summary, revisionQuizzes,
      doneCount: summary.done,
      hasPlan, planSource,
      unplacedCount,
      lessonCount: subjectLessons.length,
    }
  }, [state, subjectId, subjectLabel, grade, term])

  if (!subject) {
    return (
      <div className="lhx-card">
          <EmptyState icon="learn">This subject isn’t available for your grade.</EmptyState>
          <button type="button" className="lhx-btn lhx-btn-soft lhx-btn-block" onClick={() => navigate('/dashboard')}>Back to Home</button>
      </div>
    )
  }

  // A topic row opens that topic's note (the mockup's only tap target).
  // A row with no destination is not a button, so this cannot be reached
  // without one — the guard stays as the belt to that braces.
  const openTopic = (topic) => {
    const target = topicOpenTarget(topic)
    if (!target) return
    capture('note_opened', { from: 'subject_topic', noteId: target.id })
    navigate(target.path)
  }

  const termNote = termNoteFor({
    term,
    activeTerm: active.term,
    source: active.source,
    // "Term 3 opens in 18 days" beats "Term 3 starts later" on every day of
    // the holiday, and the calendar already knows which day it is.
    opensIn: calendar.status === 'ok' && calendar.nextTerm
      ? { termNumber: calendar.nextTerm.termNumber, phrase: whenPhrase(calendar.nextTerm.daysUntilOpen) }
      : null,
  })

  return (
    <>
      <div className="lhx-back-row">
        <button type="button" className="lhx-back-btn" aria-label="Go back" onClick={() => navigate(-1)}>‹</button>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="lhx-back-title">{subjectLabel}</div>
          <div className="lhx-back-sub">
            {[
              grade ? `Grade ${grade}` : null,
              // The tab the learner is ON, always — this line names the
              // content below it. The calendar's own reading (holiday and
              // all) is on the chip that opens the School Calendar, and
              // repeating it here would label the wrong thing.
              `Term ${term}`,
              state.loading ? null : subjectRowMeta({ summary: model.summary }),
            ].filter(Boolean).join(' · ')}
          </div>
        </div>
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
          <p className="lhx-back-sub" style={{ textAlign: 'center', marginTop: -6 }}>{termNote}</p>

          {/* The row on Home and this screen are one measurement, so this is
              the number the learner just tapped — not a second opinion. It is
              drawn only once there is something to draw: a bar at 0% and a bar
              over material that does not exist read identically, and the line
              above already says which case this is. */}
          {model.summary.measurable && model.summary.started && (
            <div className="lhx-card" style={{ padding: '12px 14px' }}>
              <ProgressBar
                percent={model.summary.percent}
                label={`${subjectLabel} Term ${term}: ${model.summary.percent}% complete`}
              />
            </div>
          )}

          {/* Three identical tabs with no explanation reads as a broken
              switcher. Say which case this is instead. */}
          {!model.hasTermData && model.topics.length > 0 && (
            <p className="lhx-back-sub" style={{ textAlign: 'center' }}>
              Showing the full {subjectLabel} syllabus — the term plan for this subject
              isn’t published yet.
            </p>
          )}
          {/* A divided catalogue is pacing, not the syllabus's own word.
              Saying so is the difference between a plan and a claim. */}
          {model.planSource === 'derived' && model.topics.length > 0 && (
            <p className="lhx-back-sub" style={{ textAlign: 'center' }}>
              Suggested split — the {subjectLabel} syllabus shared across the three
              terms, in order. Your school may reach these at a different time.
            </p>
          )}
          {model.hasPlan && model.unplacedCount > 0 && (
            <p className="lhx-back-sub" style={{ textAlign: 'center' }}>
              Plus {model.unplacedCount} {model.unplacedCount === 1 ? 'topic' : 'topics'} not
              yet placed in a term — {model.unplacedCount === 1 ? 'it shows' : 'they show'} on
              every tab.
            </p>
          )}

          <section className="lhx-section" aria-label={`Topics in Term ${term}`}>
            {model.topics.length === 0 ? (
              <div className="lhx-card">
                <EmptyState icon="learn">
                  Materials for Term {term} are being prepared. Try another term.
                </EmptyState>
              </div>
            ) : (
              <div style={{ display: 'grid', gap: 10 }}>
                {model.topics.map((topic) => {
                  const target = topicOpenTarget(topic)
                  const openable = Boolean(target)
                  // Started and current are both ▶, and they are different
                  // facts: one is evidence, one is the mockup's "you are
                  // here". The accessible name says which, so the two are not
                  // collapsed for a screen reader the way they are visually.
                  const st = topic.status === 'completed'
                    ? { cls: 'lhx-st-done', mark: '✓', label: 'done' }
                    : (topic.status === 'in-progress' || topic.current)
                      ? {
                          cls: 'lhx-st-now',
                          mark: '▶',
                          label: topic.status === 'in-progress' ? 'started' : 'current topic',
                        }
                      : { cls: 'lhx-st-todo', mark: '○', label: 'not started' }
                  // A row with nothing to open is not a button. It was one,
                  // marked `aria-disabled` and wired to a handler that
                  // returned silently — so it took focus, invited a tap, and
                  // answered with nothing. Rendered as plain content it still
                  // shows the topic, its strand, its sub-topics and why it is
                  // not ready; it simply stops claiming to be a way in.
                  // `aria-disabled` goes with the button: it describes a
                  // control, and this is no longer one.
                  const Row = openable ? 'button' : 'div'
                  const rowProps = openable
                    ? {
                        type: 'button',
                        onClick: () => openTopic(topic),
                        // The strand is part of the accessible name, not
                        // decoration: "Multiplication" alone names two
                        // different rows on the Grade 7 Mathematics tab.
                        'aria-label': [topic.name, topic.strand, st.label].filter(Boolean).join(' — '),
                      }
                    : {}
                  return (
                    <Row
                      key={topic.key}
                      className={`lhx-topic-row${openable ? '' : ' lhx-topic-row--soon'}`}
                      {...rowProps}
                    >
                      <span className="lhx-topic-ic" aria-hidden="true">
                        {topic.icon
                          ? <span style={{ fontSize: 18 }}>{topic.icon}</span>
                          : <LearnerIcon name={subjectIconName(subjectId)} size={20} />}
                      </span>
                      <span style={{ flex: 1, minWidth: 0 }}>
                        <span className="lhx-topic-name" style={{ display: 'block' }}>{topic.name}</span>
                        {topic.strand && (
                          <span className={`lhx-strand-tag lhx-sd-${topic.tone}`}>{topic.strand}</span>
                        )}
                        {topic.subtopics.length > 0 && (
                          <span className="lhx-topic-sub" style={{ display: 'block' }}>
                            {topic.subtopics.slice(0, 3).join(' · ')}
                            {topic.subtopics.length > 3 ? ` · +${topic.subtopics.length - 3} more` : ''}
                          </span>
                        )}
                        {/* The mark behind the status. A topic sitting at
                            "started" with a 40% beside it explains itself; the
                            pill alone leaves the learner guessing what would
                            finish it. */}
                        {topic.bestScore != null && (
                          <span className="lhx-topic-sub" style={{ display: 'block' }}>
                            {topic.status === 'completed'
                              ? `Best score ${topic.bestScore}%`
                              : `Best score ${topic.bestScore}% — ${TOPIC_PASS_MARK}% finishes this topic`}
                          </span>
                        )}
                        {!openable && (
                          <span className="lhx-topic-sub" style={{ display: 'block' }}>Note coming soon</span>
                        )}
                      </span>
                      <span className={`lhx-topic-st ${st.cls}`} aria-hidden="true">{st.mark}</span>
                    </Row>
                  )
                })}
              </div>
            )}
          </section>
        </>
      )}
    </>
  )
}
