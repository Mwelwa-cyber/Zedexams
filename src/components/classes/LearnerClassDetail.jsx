/**
 * /classes/:classId — learner-side class detail. Audit A10 (PR 2).
 *
 * Differs from the teacher view in three ways:
 *   - No invite-code controls (codes belong to the teacher).
 *   - No "Remove learner" controls; the only roster action a learner
 *     can take is "Leave this class" (calls leaveClass Cloud Function).
 *   - Roster is read-only and only renders names — no per-learner
 *     emails, since classmate emails leaking across schools is a
 *     privacy concern.
 *
 * Defence-in-depth: a learner who isn't in the class lands on a
 * polite "you're not in this class" panel rather than a blank read.
 * Firestore rules already block the read but the page handles both
 * cases for clean UX.
 */

import { useCallback, useEffect, useState } from 'react'
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom'
import { collection, getDocs, query, where } from 'firebase/firestore'
import { db } from '../../firebase/config'
import { useAuth } from '../../contexts/AuthContext'
import { getClass, leaveClass } from '../../utils/classes'
import { SUBJECTS } from '../../config/curriculum'
import SeoHelmet from '../seo/SeoHelmet'
import Skeleton from '../ui/Skeleton'

async function fetchMemberDisplayNames(uids) {
  if (!uids || uids.length === 0) return []
  const out = []
  // Firestore `in` cap = 10. Chunk through.
  for (let i = 0; i < uids.length; i += 10) {
    const chunk = uids.slice(i, i + 10)
    try {
      const snap = await getDocs(query(collection(db, 'users'), where('__name__', 'in', chunk)))
      const got = new Map()
      snap.docs.forEach((d) => {
        const data = d.data() || {}
        got.set(d.id, { uid: d.id, displayName: data.displayName || '' })
      })
      for (const uid of chunk) out.push(got.get(uid) || { uid, displayName: '' })
    } catch (err) {
      // Rules forbid a learner reading another learner's user doc, so
      // the read here will fail outside the user's own row. We
      // gracefully fall back to a placeholder. The classmate count is
      // still accurate because we know the array length.
      console.warn('[LearnerClassDetail] members read partially blocked', err)
      for (const uid of chunk) out.push({ uid, displayName: '' })
    }
  }
  return out
}

export default function LearnerClassDetail() {
  const { classId } = useParams()
  const { currentUser } = useAuth()
  const navigate = useNavigate()

  const [klass, setKlass] = useState(null)
  const [members, setMembers] = useState([])
  const [teacher, setTeacher] = useState(null)
  const [loading, setLoading] = useState(true)
  const [errored, setErrored] = useState(false)
  const [busy, setBusy] = useState(false)
  const [feedback, setFeedback] = useState(null)
  const [redirectAway, setRedirectAway] = useState(false)

  const refresh = useCallback(async () => {
    try {
      const row = await getClass(classId)
      if (!row) { setErrored(true); return }
      setKlass(row)
      const summaries = await fetchMemberDisplayNames(row.learners || [])
      setMembers(summaries)
      // Best-effort teacher displayName lookup. Fails silently if
      // rules block (which they will for non-admin learners reading
      // a teacher's user doc).
      try {
        const tSnap = await getDocs(query(
          collection(db, 'users'),
          where('__name__', '==', row.teacherUid),
        ))
        const t = tSnap.docs[0]?.data()
        if (t?.displayName) setTeacher({ displayName: t.displayName })
      } catch { /* expected for non-admin */ }
    } catch (err) {
      console.warn('[LearnerClassDetail] load failed', err)
      setErrored(true)
    } finally {
      setLoading(false)
    }
  }, [classId])

  useEffect(() => { refresh() }, [refresh])

  async function handleLeave() {
    if (!window.confirm('Leave this class? Your teacher can re-add you, but your class assignments will disappear from your dashboard.')) return
    setBusy(true)
    setFeedback(null)
    try {
      await leaveClass(classId)
      // Navigate first so the user sees their list update; the toast
      // shows briefly there too.
      navigate('/classes', { replace: true })
    } catch (err) {
      console.error('[LearnerClassDetail] leave failed', err)
      setFeedback({ kind: 'err', text: err?.message || 'Could not leave the class.' })
    } finally {
      setBusy(false)
    }
  }

  if (redirectAway) return <Navigate to="/classes" replace />

  if (loading) {
    return (
      <div className="min-h-screen theme-bg p-6 max-w-3xl mx-auto space-y-4">
        <Skeleton className="h-10 w-2/3 rounded-md" />
        <Skeleton className="h-32 rounded-radius-md" />
        <Skeleton className="h-48 rounded-radius-md" />
      </div>
    )
  }

  if (errored || !klass) {
    return (
      <div className="min-h-screen theme-bg flex flex-col items-center justify-center px-4 text-center">
        <div className="text-5xl mb-3">🎒</div>
        <h1 className="theme-text font-black text-xl">We can&apos;t open this class</h1>
        <p className="theme-text-muted text-sm mt-2 max-w-sm">
          Either the link is wrong, or you&apos;re not a member. Ask your
          teacher for a fresh invite code.
        </p>
        <div className="mt-4 flex gap-2">
          <Link to="/classes" className="theme-card border theme-border rounded-full px-4 py-2 text-xs font-black">
            My classes
          </Link>
          <Link to="/classes/join" className="theme-accent-fill theme-on-accent rounded-full px-4 py-2 text-xs font-black">
            Join a class
          </Link>
        </div>
      </div>
    )
  }

  // Not a member (defence-in-depth — rules already block but a teacher
  // visiting their own class via this learner route should bounce too).
  const isMember = Array.isArray(klass.learners) && klass.learners.includes(currentUser?.uid)
  if (!isMember) {
    setTimeout(() => setRedirectAway(true), 0)
    return null
  }

  const subjectMeta = SUBJECTS.find((s) => s.id === klass.subject)

  return (
    <div className="min-h-screen theme-bg pb-20">
      <SeoHelmet title={klass.name} path={`/classes/${classId}`} noIndex />

      <header className="theme-hero px-4 pt-6 pb-12" data-bg-gradient="true">
        <div className="max-w-3xl mx-auto">
          <Link to="/classes" className="text-white/80 hover:text-white text-xs font-bold inline-flex items-center gap-1.5 mb-3">
            ← My classes
          </Link>
          <h1 className="text-white text-2xl sm:text-3xl font-black">{klass.name}</h1>
          <p className="text-white/80 text-sm mt-2">
            Grade {klass.grade}
            {subjectMeta ? ` · ${subjectMeta.label}` : ''}
            {klass.school ? ` · ${klass.school}` : ''}
          </p>
          {teacher?.displayName && (
            <p className="text-white/70 text-xs mt-1">Taught by {teacher.displayName}</p>
          )}
        </div>
      </header>

      <div className="max-w-3xl mx-auto px-4 -mt-6 space-y-4">
        {feedback?.kind === 'err' && (
          <div role="alert" className="border-l-4 border-rose-500 bg-rose-50 text-rose-900 text-sm rounded-r-lg p-3 font-bold">
            {feedback.text}
          </div>
        )}

        {klass.description && (
          <section className="theme-card border theme-border rounded-radius-md p-4">
            <p className="theme-text-muted text-xs font-black uppercase tracking-widest mb-1.5">From your teacher</p>
            <p className="theme-text text-sm leading-relaxed">{klass.description}</p>
          </section>
        )}

        {/* Classmates — names only, no emails (privacy). */}
        <section className="theme-card border theme-border rounded-radius-md overflow-hidden">
          <div className="p-4 border-b theme-border">
            <p className="theme-text font-black text-sm">Classmates ({members.length})</p>
          </div>
          {members.length === 0 ? (
            <div className="p-6 text-center text-sm theme-text-muted">No classmates yet — you&apos;re first in!</div>
          ) : (
            <ul className="divide-y divide-current/10">
              {members.map((m) => (
                <li key={m.uid} className="flex items-center gap-3 p-4">
                  <div className="flex-shrink-0 w-9 h-9 rounded-full theme-bg-subtle flex items-center justify-center text-sm font-black theme-text">
                    {(m.displayName || '?').slice(0, 1).toUpperCase()}
                  </div>
                  <p className="theme-text font-bold text-sm">
                    {m.displayName || (
                      m.uid === currentUser?.uid ? 'You' : <span className="theme-text-muted italic">Classmate</span>
                    )}
                    {m.uid === currentUser?.uid && m.displayName && (
                      <span className="ml-2 text-[10px] font-black uppercase tracking-wider theme-bg-subtle theme-text-muted px-2 py-0.5 rounded-full">
                        You
                      </span>
                    )}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* Leave action */}
        <section className="border-t theme-border pt-4 flex justify-end">
          <button
            type="button"
            onClick={handleLeave}
            disabled={busy}
            className="text-xs font-bold text-rose-700 hover:underline disabled:opacity-50"
          >
            {busy ? 'Leaving…' : 'Leave this class'}
          </button>
        </section>
      </div>
    </div>
  )
}
