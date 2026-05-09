/**
 * /teacher/classes/:classId — class detail + member management.
 * Audit A10.
 *
 * What lives here:
 *   - Header with the class name, grade, subject, school
 *   - Invite-code card: shows the live code + "Generate new code"
 *     button that calls the Cloud Function (also used to mint the
 *     first code immediately after class creation)
 *   - Member roster: each row shows learner displayName + email,
 *     with a "Remove" button that fires removeLearnerFromClass
 *   - Soft-delete (Archive) at the bottom — preserves historical
 *     references (assignments, results) without showing the class
 *     to learners
 *
 * What ships in a follow-up PR:
 *   - "Assign a quiz to this class" button
 *   - Class-level analytics (avg score, weak topics, etc.)
 */

import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { collection, getDocs, query, where } from 'firebase/firestore'
import { db } from '../../../firebase/config'
import { useAuth } from '../../../contexts/AuthContext'
import {
  archiveClass,
  generateClassInvite,
  getClass,
  hardDeleteClass,
  removeLearnerFromClassFallback,
  unarchiveClass,
} from '../../../utils/classes'
import {
  listAssignmentsForClass,
  removeClassAssignment,
} from '../../../utils/assignments'
import { SUBJECTS } from '../../../config/curriculum'
import SeoHelmet from '../../seo/SeoHelmet'
import Skeleton from '../../ui/Skeleton'
import AssignWorkModal from './AssignWorkModal'

function fmtExpiry(ts) {
  if (!ts) return ''
  const d = ts?.toDate?.() ?? new Date(ts)
  if (Number.isNaN(d?.getTime?.())) return ''
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
}

// Lookup learner display info by uid in a single batched query.
// users/{uid} reads are admin/self-only per rules, but the class
// owner is implicitly trusted to see member identities for their own
// class — and the Firestore rules already allow that read because
// they read the calling teacher's own user doc inside callerRole().
// For learners that the rules block, we degrade gracefully to "uid".
async function fetchMemberSummaries(uids) {
  if (!uids || uids.length === 0) return []
  const out = []
  // Use the `in` operator in chunks of 10 — that's the Firestore cap.
  for (let i = 0; i < uids.length; i += 10) {
    const chunk = uids.slice(i, i + 10)
    try {
      const snap = await getDocs(query(collection(db, 'users'), where('__name__', 'in', chunk)))
      const got = new Map()
      snap.docs.forEach((d) => {
        const data = d.data() || {}
        got.set(d.id, {
          uid: d.id,
          displayName: data.displayName || '',
          email: data.email || '',
        })
      })
      // Preserve original order even when Firestore returns rows in a
      // different sequence (and surface a placeholder for any uid the
      // read couldn't resolve).
      for (const uid of chunk) out.push(got.get(uid) || { uid, displayName: '', email: '' })
    } catch (err) {
      console.warn('[TeacherClassDetail] member summary fetch failed', err)
      for (const uid of chunk) out.push({ uid, displayName: '', email: '' })
    }
  }
  return out
}

export default function TeacherClassDetail() {
  const { classId } = useParams()
  const { currentUser } = useAuth()
  const navigate = useNavigate()

  const [klass, setKlass] = useState(null)
  const [members, setMembers] = useState([])
  const [assignments, setAssignments] = useState([])
  const [showAssignModal, setShowAssignModal] = useState(false)
  const [loading, setLoading] = useState(true)
  const [errored, setErrored] = useState(false)
  const [busy, setBusy] = useState(false)
  const [feedback, setFeedback] = useState(null) // {kind, text}

  const refresh = useCallback(async () => {
    try {
      const row = await getClass(classId)
      if (!row) { setErrored(true); return }
      setKlass(row)
      const [summaries, classAssignments] = await Promise.all([
        fetchMemberSummaries(row.learners || []),
        listAssignmentsForClass(classId).catch((err) => {
          // Index might not be deployed yet — degrade quietly to no
          // assignments so the rest of the page still renders.
          console.warn('[TeacherClassDetail] assignments load failed', err)
          return []
        }),
      ])
      setMembers(summaries)
      setAssignments(classAssignments)
    } catch (err) {
      console.warn('[TeacherClassDetail] load failed', err)
      setErrored(true)
    } finally {
      setLoading(false)
    }
  }, [classId])

  async function handleRemoveAssignment(assignmentId) {
    if (!window.confirm('Remove this assignment from the class? Learners will no longer see it.')) return
    setBusy(true); setFeedback(null)
    try {
      await removeClassAssignment(assignmentId)
      setFeedback({ kind: 'ok', text: 'Assignment removed.' })
      await refresh()
    } catch (err) {
      console.error('[TeacherClassDetail] remove assignment failed', err)
      setFeedback({ kind: 'err', text: err?.message || 'Could not remove the assignment.' })
    } finally {
      setBusy(false)
    }
  }

  useEffect(() => { refresh() }, [refresh])

  async function handleGenerateCode() {
    setBusy(true); setFeedback(null)
    try {
      const result = await generateClassInvite(classId)
      setFeedback({ kind: 'ok', text: `New invite code ${result.inviteCode} is ready. The previous one (if any) was rotated.` })
      await refresh()
    } catch (err) {
      console.error('[TeacherClassDetail] generate code failed', err)
      setFeedback({ kind: 'err', text: err?.message || 'Could not generate a new invite code.' })
    } finally {
      setBusy(false)
    }
  }

  async function handleRemoveLearner(learnerUid) {
    if (!window.confirm('Remove this learner from the class?')) return
    setBusy(true); setFeedback(null)
    try {
      await removeLearnerFromClassFallback({ classId, learnerUid })
      setFeedback({ kind: 'ok', text: 'Learner removed.' })
      await refresh()
    } catch (err) {
      console.error('[TeacherClassDetail] remove learner failed', err)
      setFeedback({ kind: 'err', text: err?.message || 'Could not remove the learner.' })
    } finally {
      setBusy(false)
    }
  }

  async function handleArchiveToggle() {
    setBusy(true); setFeedback(null)
    try {
      if (klass.active === false) await unarchiveClass(classId)
      else                        await archiveClass(classId)
      setFeedback({ kind: 'ok', text: klass.active === false ? 'Class restored.' : 'Class archived. It will no longer appear in learner dashboards.' })
      await refresh()
    } catch (err) {
      setFeedback({ kind: 'err', text: 'Could not change archive state.' })
    } finally {
      setBusy(false)
    }
  }

  async function handleHardDelete() {
    if (!window.confirm('Permanently delete this class? Member assignments and history references will lose their link. This cannot be undone.')) return
    setBusy(true)
    try {
      await hardDeleteClass(classId)
      navigate('/teacher/classes')
    } catch (err) {
      setFeedback({ kind: 'err', text: 'Could not delete the class.' })
      setBusy(false)
    }
  }

  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-10 w-2/3 rounded-md" />
        <Skeleton className="h-32 rounded-radius-md" />
        <Skeleton className="h-48 rounded-radius-md" />
      </div>
    )
  }

  if (errored || !klass) {
    return (
      <div className="theme-card border theme-border rounded-radius-md p-6 text-center text-sm theme-text-muted">
        We couldn&apos;t load this class.{' '}
        <Link to="/teacher/classes" className="theme-accent-text font-bold underline">Back to all classes</Link>
      </div>
    )
  }

  // Defence-in-depth — the route is teacher-only via TeacherRoute, but
  // a teacher visiting another teacher's class id directly should land
  // on a clean "permission denied" instead of a half-rendered page.
  if (klass.teacherUid !== currentUser?.uid) {
    return (
      <div className="theme-card border theme-border rounded-radius-md p-6 text-center text-sm theme-text-muted">
        This class belongs to another teacher.{' '}
        <Link to="/teacher/classes" className="theme-accent-text font-bold underline">Back to my classes</Link>
      </div>
    )
  }

  const subjectMeta = SUBJECTS.find((s) => s.id === klass.subject)
  const archived = klass.active === false

  return (
    <div className="space-y-6 max-w-3xl">
      <SeoHelmet title={klass.name} path={`/teacher/classes/${classId}`} noIndex />

      <div>
        <Link to="/teacher/classes" className="text-xs font-bold theme-text-muted hover:theme-text">
          ← All classes
        </Link>
        <h1 className="theme-text font-display font-black text-2xl sm:text-3xl mt-1 flex flex-wrap items-center gap-2">
          {klass.name}
          {archived && (
            <span className="text-[10px] font-black uppercase tracking-wider bg-slate-200 text-slate-700 px-2 py-0.5 rounded-full align-middle">
              Archived
            </span>
          )}
        </h1>
        <p className="theme-text-muted text-sm mt-1">
          Grade {klass.grade}
          {subjectMeta ? ` · ${subjectMeta.label}` : ''}
          {klass.school ? ` · ${klass.school}` : ''}
        </p>
        {klass.description && (
          <p className="theme-text text-sm mt-3 leading-relaxed max-w-prose">{klass.description}</p>
        )}
      </div>

      {feedback && (
        <div role="status" className={`border-l-4 text-sm rounded-r-lg p-3 font-bold ${
          feedback.kind === 'ok'
            ? 'border-emerald-500 bg-emerald-50 text-emerald-900'
            : 'border-rose-500 bg-rose-50 text-rose-900'
        }`}>{feedback.text}</div>
      )}

      {/* Invite code card */}
      <section className="theme-card border theme-border rounded-radius-md p-5 space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="theme-text font-black text-sm">Invite code</p>
            <p className="theme-text-muted text-xs mt-1 max-w-prose">
              Share this with learners — they paste it into <code className="text-xs">/classes/join</code> from
              their dashboard to enrol. Codes rotate when you generate a new one.
            </p>
          </div>
          <button
            type="button"
            onClick={handleGenerateCode}
            disabled={busy || archived}
            className="theme-accent-fill theme-on-accent rounded-full px-3 py-1.5 text-xs font-black hover:opacity-90 disabled:opacity-50 flex-shrink-0"
          >
            {klass.inviteCode ? 'Regenerate' : 'Generate code'}
          </button>
        </div>
        {klass.inviteCode ? (
          <div className="flex flex-wrap items-center gap-3">
            <span className="theme-bg-subtle font-mono font-black text-xl tracking-widest theme-text px-4 py-2 rounded-xl">
              {klass.inviteCode}
            </span>
            {klass.inviteExpiresAt && (
              <span className="theme-text-muted text-xs">expires {fmtExpiry(klass.inviteExpiresAt)}</span>
            )}
          </div>
        ) : (
          <p className="theme-text-muted text-sm">No active code yet. Click <span className="theme-text font-bold">Generate code</span> to mint one.</p>
        )}
      </section>

      {/* Assignments */}
      <section className="theme-card border theme-border rounded-radius-md overflow-hidden">
        <div className="p-4 border-b theme-border flex items-center justify-between gap-3">
          <div>
            <p className="theme-text font-black text-sm">Assigned work ({assignments.length})</p>
            <p className="theme-text-muted text-xs mt-0.5">Active quizzes shared with this class.</p>
          </div>
          <button
            type="button"
            onClick={() => setShowAssignModal(true)}
            disabled={busy || archived}
            className="theme-accent-fill theme-on-accent rounded-full px-3 py-1.5 text-xs font-black hover:opacity-90 disabled:opacity-50 flex-shrink-0"
          >
            + Assign quiz
          </button>
        </div>
        {assignments.length === 0 ? (
          <div className="p-6 text-center text-sm theme-text-muted">
            No work assigned yet. Click <span className="theme-text font-bold">Assign quiz</span> to share a published quiz with this class.
          </div>
        ) : (
          <ul className="divide-y divide-current/10">
            {assignments.map((a) => {
              const subjectMeta = SUBJECTS.find((s) => s.id === a.subject)
              const dueLabel = a.dueAt
                ? `due ${(a.dueAt.toDate?.() || new Date(a.dueAt)).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })}`
                : null
              return (
                <li key={a.id} className="flex items-start gap-3 p-4">
                  <div className="flex-shrink-0 w-9 h-9 rounded-lg theme-bg-subtle flex items-center justify-center text-base">
                    <span aria-hidden="true">{subjectMeta?.icon || '📝'}</span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="theme-text font-bold text-sm truncate">{a.resourceTitle}</p>
                    <p className="theme-text-muted text-xs mt-0.5">
                      {a.resourceType === 'exam' ? 'Daily exam' : 'Quiz'}
                      {subjectMeta ? ` · ${subjectMeta.label}` : ''}
                      {dueLabel ? ` · ${dueLabel}` : ''}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleRemoveAssignment(a.id)}
                    disabled={busy}
                    className="text-xs font-bold text-rose-700 hover:underline disabled:opacity-50"
                  >
                    Remove
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </section>

      {/* Roster */}
      <section className="theme-card border theme-border rounded-radius-md overflow-hidden">
        <div className="p-4 border-b theme-border flex items-center justify-between">
          <p className="theme-text font-black text-sm">Learners ({members.length})</p>
          <p className="theme-text-muted text-xs">Cap: 200</p>
        </div>
        {members.length === 0 ? (
          <div className="p-6 text-center text-sm theme-text-muted">
            No learners yet. Share the invite code above and they&apos;ll appear here as they join.
          </div>
        ) : (
          <ul className="divide-y divide-current/10">
            {members.map((m) => (
              <li key={m.uid} className="flex items-center gap-3 p-4">
                <div className="flex-shrink-0 w-9 h-9 rounded-full theme-bg-subtle flex items-center justify-center text-sm font-black theme-text">
                  {(m.displayName || m.email || '?').slice(0, 1).toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="theme-text font-bold text-sm truncate">
                    {m.displayName || <span className="theme-text-muted italic">Pending profile</span>}
                  </p>
                  <p className="theme-text-muted text-xs truncate">{m.email || m.uid}</p>
                </div>
                <button
                  type="button"
                  onClick={() => handleRemoveLearner(m.uid)}
                  disabled={busy}
                  className="text-xs font-bold text-rose-700 hover:underline disabled:opacity-50"
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Danger zone */}
      <section className="border-t theme-border pt-4 flex flex-wrap gap-3 items-center">
        <button
          type="button"
          onClick={handleArchiveToggle}
          disabled={busy}
          className="theme-card border theme-border rounded-full px-4 py-2 text-xs font-black hover:theme-bg-subtle disabled:opacity-50"
        >
          {archived ? 'Restore class' : 'Archive class'}
        </button>
        <button
          type="button"
          onClick={handleHardDelete}
          disabled={busy}
          className="ml-auto text-xs font-bold text-rose-700 hover:underline disabled:opacity-50"
        >
          Permanently delete
        </button>
      </section>

      {/* Assign-quiz modal — lazy renders only while open. */}
      <AssignWorkModal
        open={showAssignModal}
        classId={classId}
        classGrade={klass.grade}
        classSubject={klass.subject}
        onClose={() => setShowAssignModal(false)}
        onAssigned={() => {
          setFeedback({ kind: 'ok', text: 'Assignment shared with the class.' })
          refresh()
        }}
      />
    </div>
  )
}
