/**
 * useLessonResume — records slide-lesson progress into the existing
 * `noteProgress` collection (docId {uid}_{lessonId}) with
 * `resourceType: 'lesson'`, so the dashboard's Continue Learning card
 * can offer a true "Continue Lesson" (resume priority 1) without a new
 * collection or rules change (the noteProgress validator constrains
 * only its known fields; extra fields like resourceType pass).
 *
 * Write budget per viewing session (never per slide tap):
 *   • mount    — one "opened / in-progress" write
 *   • complete — one "completed" write
 *   • leave    — one final-position write (unmount / tab hidden)
 */
import { useEffect, useRef } from 'react'
import { doc, setDoc, serverTimestamp } from 'firebase/firestore'
import { db } from '../../../firebase/config'

const idFor = (uid, lessonId) => `${uid}_${lessonId}`

function write(uid, lesson, patch) {
  if (!uid || !lesson?.id) return
  try {
    setDoc(
      doc(db, 'noteProgress', idFor(uid, lesson.id)),
      {
        uid,
        noteId: lesson.id,
        resourceType: 'lesson',
        grade: lesson.grade != null ? String(lesson.grade) : null,
        subject: lesson.subject || null,
        title: lesson.title || null,
        ...patch,
        updatedAt: serverTimestamp(),
      },
      { merge: true },
    ).catch((err) => {
      console.warn('[lessons] progress write skipped:', err?.code || err?.message || err)
    })
  } catch (err) {
    console.warn('[lessons] progress write skipped:', err?.code || err?.message || err)
  }
}

export default function useLessonResume({ uid, lesson, index, slideCount, complete }) {
  // Latest position in a ref so leave-writes never re-run the effect.
  const posRef = useRef({ index: 0, slideCount: 0, complete: false })
  posRef.current = { index, slideCount, complete }

  useEffect(() => {
    if (!uid || !lesson?.id) return undefined

    const percentNow = () => {
      const { index: i, slideCount: n, complete: done } = posRef.current
      if (done) return 100
      if (!n) return 0
      // Cap below 100 — only the explicit completion screen counts as done.
      return Math.min(99, Math.round(((i + 1) / n) * 100))
    }

    write(uid, lesson, { lastOpenedAt: serverTimestamp(), status: 'in-progress' })

    const flush = () => {
      const done = posRef.current.complete
      write(uid, lesson, {
        percent: percentNow(),
        status: done ? 'completed' : 'in-progress',
        ...(done ? { completedAt: serverTimestamp() } : {}),
      })
    }
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') flush()
    }
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      document.removeEventListener('visibilitychange', onVisibility)
      flush()
    }
  }, [uid, lesson])

  // One extra write at the moment of completion (don't wait for leave).
  const wasComplete = useRef(false)
  useEffect(() => {
    if (complete && !wasComplete.current && uid && lesson?.id) {
      wasComplete.current = true
      write(uid, lesson, { percent: 100, status: 'completed', completedAt: serverTimestamp() })
    }
  }, [complete, uid, lesson])
}
