/**
 * useLearnerDashboard — the single normalised view model behind the
 * learner home. One hook, one batched load; no per-card Firestore
 * listeners (spec §18).
 *
 * Reads per dashboard visit (bounded, mostly cached):
 *   1. results (last 50)                    — one query
 *   2. noteProgress for the learner         — one query
 *   3. published notes+lessons for grade    — one query (shared cache)
 *   4. today's daily exams + locks          — one query + batched gets (always fresh)
 *   5. learnerStats doc (streak/xp)         — one doc read
 *   6. published-papers index               — one doc read (own cache)
 *   7. learner_profiles doc (cross-device resume) — one doc read
 *   8. today's game challenge               — one/two small reads
 * The exam timetable arrives via useExamTimetables (one query + bundled
 * fallback). Everything else is derived in learnerHomeCore pure logic.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  collection, doc, getDoc, getDocs, limit as fsLimit, query, where,
} from 'firebase/firestore'
import { db } from '../../../firebase/config'
import { useAuth } from '../../../contexts/AuthContext'
import { useFirestore } from '../../../hooks/useFirestore'
import useExamTimetables from '../../../hooks/useExamTimetables'
import { getTodaysExamsBySubject, checkTodaysLocks } from '../../../utils/examService'
import { loadPublishedPapers } from '../../../utils/pastPapers'
import { getTodaysChallenge } from '../../../utils/dailyChallengeService'
import { getActiveTerm } from '../../../utils/moeCalendar'
import { SUBJECTS, SUBJECT_MAP, getTopics, normalizeSubject } from '../../../config/curriculum'
import {
  resolveActiveTerm, normalizeTerm, pickLearningResume, buildRecentActivity,
  buildRecommendations, extractWeakTopics, computeSubjectCompletion,
} from '../lib/learnerHomeCore'
import {
  PAPER_RESUME_KEY, preferredTermKey, readJson, writeJson,
  readRecentPaperIds, readPaperPage, readQuizSessions,
} from '../lib/learnerLocal'

const tsToMs = (v) => {
  if (!v) return 0
  if (typeof v.toMillis === 'function') return v.toMillis()
  if (typeof v.seconds === 'number') return v.seconds * 1000
  const parsed = Date.parse(v)
  return Number.isFinite(parsed) ? parsed : Number(v) || 0
}

/** Slug a stored subject value back to a curriculum subject id. */
function subjectIdOf(value) {
  if (!value) return null
  if (SUBJECT_MAP[value]) return value
  const label = normalizeSubject(value)
  const hit = SUBJECTS.find((s) => s.label === label || s.id === value)
  return hit ? hit.id : null
}

export default function useLearnerDashboard() {
  const { currentUser, userProfile } = useAuth()
  const { getUserResults, getQuizById } = useFirestore()
  const uid = currentUser?.uid || null
  const grade = userProfile?.grade ? String(userProfile.grade) : null

  const timetables = useExamTimetables(grade ? Number(grade) : null)

  const [state, setState] = useState({ loading: true, error: null, data: null })
  const [reloadNonce, setReloadNonce] = useState(0)
  const refresh = useCallback(() => setReloadNonce((n) => n + 1), [])

  // Learner-chosen preferred term (advisory; calendar wins when active).
  const [savedTerm, setSavedTerm] = useState(() => normalizeTerm(readJson(preferredTermKey(uid))))
  const setPreferredTerm = useCallback((term) => {
    const t = normalizeTerm(term)
    if (!t) return
    writeJson(preferredTermKey(uid), t)
    setSavedTerm(t)
  }, [uid])

  const aliveRef = useRef(true)
  useEffect(() => () => { aliveRef.current = false }, [])

  useEffect(() => {
    if (!uid || !grade) {
      setState({ loading: false, error: null, data: null })
      return undefined
    }
    let stale = false
    setState((s) => ({ ...s, loading: true, error: null }))

    const safe = (p, fallback) => p.catch(() => fallback)

    const run = async () => {
      const [
        results,
        noteProgressSnap,
        materialsSnap,
        todaysExams,
        locks,
        statsSnap,
        papers,
        profileSnap,
        challenge,
      ] = await Promise.all([
        safe(getUserResults(uid, 50), []),
        safe(getDocs(query(collection(db, 'noteProgress'), where('uid', '==', uid), fsLimit(100))), null),
        safe(getDocs(query(
          collection(db, 'lessons'),
          where('isPublished', '==', true),
          where('grade', '==', grade),
          fsLimit(300),
        )), null),
        safe(getTodaysExamsBySubject(grade), []),
        safe(checkTodaysLocks(uid), {}),
        safe(getDoc(doc(db, 'learnerStats', uid)), null),
        safe(loadPublishedPapers(), []),
        safe(getDoc(doc(db, 'learner_profiles', uid)), null),
        safe(getTodaysChallenge(), null),
      ])
      if (stale || !aliveRef.current) return

      const noteProgress = noteProgressSnap
        ? noteProgressSnap.docs.map((d) => ({ id: d.id, ...d.data() }))
        : []
      const materials = materialsSnap
        ? materialsSnap.docs.map((d) => ({ id: d.id, ...d.data() }))
        : []
      const notes = materials.filter((m) => m.noteFormat)
      const slideLessons = materials.filter((m) => !m.noteFormat && Array.isArray(m.slides) && m.slides.length > 0)
      const stats = statsSnap && statsSnap.exists() ? statsSnap.data() : null
      const remoteProfile = profileSnap && profileSnap.exists() ? profileSnap.data() : null

      // ── Active term (school → calendar → saved → 1) ────────────
      const calendarActive = getActiveTerm()
      const activeTerm = resolveActiveTerm({
        schoolTerm: null, // no school-level term config exists yet
        calendarTerm: calendarActive?.term?.number ?? null,
        savedTerm,
      })

      // ── Past-paper resume ──────────────────────────────────────
      const gradePapers = papers.filter((p) => String(p.grade) === grade)
      const localResume = readJson(PAPER_RESUME_KEY)
      const remoteResume = remoteProfile?.lastSession?.paperResume || null
      let paperResume = null
      const pick = [localResume, remoteResume]
        .filter((r) => r && r.paperId)
        .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))[0] || null
      if (pick) {
        const meta = papers.find((p) => p.id === pick.paperId)
        if (meta || pick.title) {
          paperResume = {
            paperId: pick.paperId,
            title: pick.title || meta?.title || 'Past paper',
            year: pick.year ?? meta?.year ?? null,
            subject: pick.subject ?? meta?.subject ?? null,
            page: readPaperPage(pick.paperId) || pick.page || null,
            totalPages: pick.totalPages || null,
          }
        }
      }
      if (!paperResume) {
        // Fall back to the papers-hub recents list (ids only).
        const recentId = readRecentPaperIds()[0]
        const meta = recentId ? papers.find((p) => p.id === recentId) : null
        if (meta) {
          paperResume = {
            paperId: meta.id,
            title: meta.title,
            year: meta.year ?? null,
            subject: meta.subject ?? null,
            page: readPaperPage(meta.id),
            totalPages: null,
          }
        }
      }
      const paperYears = gradePapers.map((p) => Number(p.year)).filter(Number.isFinite)
      const papersMeta = {
        count: gradePapers.length,
        yearMin: paperYears.length ? Math.min(...paperYears) : null,
        yearMax: paperYears.length ? Math.max(...paperYears) : null,
      }

      // ── Learning resume candidates ─────────────────────────────
      const candidates = []
      const quizSession = readQuizSessions(uid)[0] || null
      if (quizSession) {
        const quiz = await safe(getQuizById(quizSession.quizId), null)
        if (!stale && quiz && quiz.isPublished !== false) {
          const questionCount = Number(quiz.questionCount) || 0
          candidates.push({
            kind: 'quiz',
            id: quizSession.quizId,
            title: quiz.title || 'Practice quiz',
            subject: subjectIdOf(quiz.subject),
            subjectLabel: normalizeSubject(quiz.subject),
            grade: quiz.grade != null ? String(quiz.grade) : grade,
            term: normalizeTerm(quiz.term),
            topic: quiz.topic || null,
            percent: questionCount ? Math.min(99, Math.round((quizSession.answeredCount / questionCount) * 100)) : 10,
            openedAt: quizSession.savedAt,
            detail: questionCount
              ? `Question ${Math.min(quizSession.answeredCount + 1, questionCount)} of ${questionCount}`
              : null,
          })
        }
      }
      // noteProgress carries both notes and slide lessons (the lesson
      // player writes resourceType: 'lesson' into the same collection).
      const materialById = new Map(materials.map((m) => [m.id, m]))
      for (const np of noteProgress) {
        if (!np.noteId) continue
        const material = materialById.get(np.noteId)
        const isLesson = np.resourceType === 'lesson'
        candidates.push({
          kind: isLesson ? 'lesson' : 'note',
          id: np.noteId,
          title: np.title || material?.title || (isLesson ? 'Lesson' : 'Notes'),
          subject: subjectIdOf(np.subject || material?.subject),
          subjectLabel: normalizeSubject(np.subject || material?.subject),
          grade: np.grade != null ? String(np.grade) : grade,
          term: normalizeTerm(material?.term),
          percent: Number(np.percent) || 0,
          status: np.status === 'completed' ? 'completed' : 'in-progress',
          openedAt: tsToMs(np.lastOpenedAt || np.updatedAt),
          // If the grade's materials loaded and this doc isn't among
          // them, it was unpublished/removed — never resume into it.
          unpublished: materialsSnap != null && !material,
        })
      }
      const learningResume = pickLearningResume(candidates, { grade })

      // ── Subjects + progress (current-term scoped) ──────────────
      const completedNoteIds = new Set(
        noteProgress.filter((np) => np.status === 'completed').map((np) => np.noteId),
      )
      const attemptedTopicsBySubject = new Map()
      for (const r of results) {
        const sid = subjectIdOf(r.subject)
        if (!sid || !r.topicScores) continue
        const set = attemptedTopicsBySubject.get(sid) || new Set()
        Object.keys(r.topicScores).forEach((t) => set.add(t))
        attemptedTopicsBySubject.set(sid, set)
      }
      const subjects = SUBJECTS.map((s) => {
        const topics = getTopics(s.id, Number(grade)) || []
        const subjectNotes = notes.filter((n) => subjectIdOf(n.subject) === s.id)
        const termNotes = subjectNotes.filter((n) => {
          const t = normalizeTerm(n.term)
          return t == null || t === activeTerm.term
        })
        const notesRead = termNotes.filter((n) => completedNoteIds.has(n.id)).length
        const attempted = Math.min(
          (attemptedTopicsBySubject.get(s.id) || new Set()).size,
          topics.length,
        )
        const percent = computeSubjectCompletion({
          notesRead,
          notesTotal: termNotes.length,
          topicsAttempted: attempted,
          topicsTotal: topics.length,
        })
        const hasMaterial = termNotes.length > 0
          || slideLessons.some((l) => subjectIdOf(l.subject) === s.id)
          || attempted > 0
        return {
          id: s.id,
          label: s.label,
          topicCount: topics.length,
          percent,
          hasMaterial,
        }
      })

      // ── Recent activity (deduped) ──────────────────────────────
      const activityItems = []
      for (const r of results) {
        const completedAt = tsToMs(r.completedAt || r.createdAt)
        activityItems.push({
          type: r.quizType === 'daily_exam' ? 'daily_exam_completed' : 'quiz_completed',
          sourceId: r.quizId || r.id,
          attemptId: r.id,
          completedAt,
          title: r.quizTitle || 'Quiz',
          subjectLabel: normalizeSubject(r.subject),
          score: Number.isFinite(Number(r.percentage)) ? Math.round(Number(r.percentage)) : null,
          href: `/results/${r.id}`,
          icon: r.quizType === 'daily_exam' ? 'daily-exam' : 'quiz',
        })
      }
      for (const np of noteProgress) {
        const when = tsToMs(np.completedAt || np.lastOpenedAt || np.updatedAt)
        if (!when) continue
        const isLesson = np.resourceType === 'lesson'
        const done = np.status === 'completed'
        activityItems.push({
          type: isLesson
            ? (done ? 'lesson_completed' : 'lesson_opened')
            : (done ? 'notes_completed' : 'notes_opened'),
          sourceId: np.noteId,
          completedAt: when,
          title: np.title || (isLesson ? 'Lesson' : 'Notes'),
          subjectLabel: normalizeSubject(np.subject),
          score: null,
          href: isLesson ? `/lessons/${np.noteId}` : `/notes/${np.noteId}`,
          icon: isLesson ? 'lessons' : 'notes',
        })
      }
      if (paperResume && (localResume?.updatedAt || remoteResume?.updatedAt)) {
        activityItems.push({
          type: 'paper_opened',
          sourceId: paperResume.paperId,
          completedAt: Math.max(localResume?.updatedAt || 0, remoteResume?.updatedAt || 0),
          title: paperResume.title,
          subjectLabel: normalizeSubject(paperResume.subject),
          score: null,
          href: `/papers/${paperResume.paperId}`,
          icon: 'papers',
        })
      }
      const recentActivity = buildRecentActivity(activityItems, { limit: 3 })

      // ── Recommendations ────────────────────────────────────────
      const weakTopics = extractWeakTopics(results).map((w) => ({
        ...w,
        subject: subjectIdOf(w.subject) || w.subject,
        subjectLabel: normalizeSubject(w.subject),
        topicLabel: w.topic,
        grade,
      }))
      const nextTermItems = notes
        .filter((n) => {
          const t = normalizeTerm(n.term)
          return (t == null || t === activeTerm.term) && !completedNoteIds.has(n.id)
        })
        .slice(0, 5)
        .map((n) => ({
          kind: 'note',
          id: n.id,
          title: n.title,
          subject: subjectIdOf(n.subject),
          subjectLabel: normalizeSubject(n.subject),
          grade,
        }))
      const recommendations = buildRecommendations(
        { weakTopics, resumeCandidates: candidates, nextTermItems, grade },
        { limit: 3 },
      )

      setState({
        loading: false,
        error: null,
        data: {
          activeTerm,
          paperResume,
          papersMeta,
          learningResume,
          todaysExams: { exams: todaysExams, locks },
          subjects,
          recentActivity,
          recommendations,
          // Already derived above for the recommendations; returned in its own
          // right because the Guardian Zone shows "needs a little help" as a
          // list rather than as a suggested next action. Same data, one
          // derivation — a second pass over the same results would be free to
          // disagree with the one the child sees.
          weakTopics,
          streak: Number(stats?.currentStreak) || 0,
          xp: Number(stats?.xp) || 0,
          gameChallenge: challenge || null,
          notesCount: notes.length,
          lessonsCount: slideLessons.length,
        },
      })
    }

    run().catch((err) => {
      if (stale || !aliveRef.current) return
      setState({ loading: false, error: err, data: null })
    })
    return () => { stale = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uid, grade, savedTerm, reloadNonce])

  return useMemo(() => ({
    ...state,
    grade,
    learner: userProfile,
    timetables,
    setPreferredTerm,
    refresh,
  }), [state, grade, userProfile, timetables, setPreferredTerm, refresh])
}
