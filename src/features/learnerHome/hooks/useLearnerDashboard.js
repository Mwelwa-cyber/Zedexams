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
 * The exam timetable arrives via useExamTimetables (one query + bundled
 * fallback). Everything else is derived in learnerHomeCore pure logic.
 *
 * Three reads left with prototype v7's Home: the published-papers index
 * and the learner_profiles doc (both only fed the Past Papers hero's
 * cross-device resume) and today's game challenge (the Daily Game
 * Challenge card). v7's Home carries none of those cards, and a read
 * nothing renders is a read nobody should pay for on every visit — the
 * papers hub and the games hub each load their own.
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
import { getActiveTerm } from '../../../utils/moeCalendar'
import { SUBJECTS, SUBJECT_MAP, getTopics, normalizeSubject } from '../../../config/curriculum'
import {
  resolveActiveTerm, normalizeTerm, pickLearningResume, computeSubjectCompletion,
} from '../lib/learnerHomeCore'
import {
  preferredTermKey, readJson, writeJson, readQuizSessions,
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

      // ── Active term (school → calendar → saved → 1) ────────────
      const calendarActive = getActiveTerm()
      const activeTerm = resolveActiveTerm({
        schoolTerm: null, // no school-level term config exists yet
        calendarTerm: calendarActive?.term?.number ?? null,
        savedTerm,
      })

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

      setState({
        loading: false,
        error: null,
        data: {
          activeTerm,
          learningResume,
          todaysExams: { exams: todaysExams, locks },
          subjects,
          streak: Number(stats?.currentStreak) || 0,
          xp: Number(stats?.xp) || 0,
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
