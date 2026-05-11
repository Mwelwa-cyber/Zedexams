/**
 * /classes/join — paste an invite code to join a teacher's class.
 * Audit A10 (PR 2 — learner side).
 *
 * UX:
 *   - Single big input, paper-mascot style, accepts the 8-char code
 *     in any case. We uppercase + strip whitespace before submitting.
 *   - Auto-submit when the input reaches the expected length so a
 *     learner who types or pastes correctly doesn't have to hunt for
 *     a "Submit" button. The button is still there for slow typists.
 *   - On success, route to /classes/:classId so the learner sees the
 *     teacher's name + class info immediately.
 *   - On error, surface the Cloud Function's user-facing message
 *     ("That invite code isn't valid", "This invite code has expired",
 *     "This class is full") rather than a generic "something went wrong".
 */

import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useAuth } from '../../contexts/AuthContext'
import { joinClassByCode } from '../../utils/classes'
import SeoHelmet from '../seo/SeoHelmet'
import ProfessorPako from '../ui/ProfessorPako'

const CODE_LENGTH = 8

function normalise(raw) {
  return String(raw || '').replace(/\s+/g, '').toUpperCase()
}

export default function LearnerClassJoin() {
  const { currentUser } = useAuth()
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const inputRef = useRef(null)
  const autoSubmittedRef = useRef(false)

  const [code, setCode] = useState(() => normalise(params.get('code') || ''))
  const [busy, setBusy] = useState(false)
  const [feedback, setFeedback] = useState(null) // {kind, text}

  // Focus the input on mount so a learner who lands here from a
  // shared link can paste straight in.
  useEffect(() => {
    if (!params.get('code')) inputRef.current?.focus()
  }, [params])

  async function submit(value) {
    const cleaned = normalise(value)
    if (cleaned.length < 6 || cleaned.length > 16) {
      setFeedback({ kind: 'err', text: 'Invite codes are 8 letters and numbers.' })
      return
    }
    setBusy(true)
    setFeedback(null)
    try {
      const result = await joinClassByCode(cleaned)
      const teacherLabel = result?.teacherDisplayName || 'your teacher'
      let message
      if (result?.status === 'approved') {
        message = result.alreadyMember
          ? `You were already in ${result.name}.`
          : `Welcome to ${result.name}! ${teacherLabel} can now share class quizzes with you.`
      } else {
        // status === 'pending' (the default for a fresh join)
        message = result?.alreadyMember
          ? `Your request to join ${result.name} is still waiting on ${teacherLabel}.`
          : `Request sent! ${teacherLabel} will approve you for ${result.name} shortly.`
      }
      setFeedback({ kind: 'ok', text: message })
      // Brief delay so the success toast is readable before the route change.
      setTimeout(() => navigate(`/classes/${result.classId}`), 1100)
    } catch (err) {
      console.warn('[LearnerClassJoin] join failed', err)
      setFeedback({ kind: 'err', text: err?.message || 'We couldn\'t join you to that class. Check the code and try again.' })
    } finally {
      setBusy(false)
    }
  }

  function handleSubmit(e) {
    e.preventDefault()
    if (!busy) submit(code)
  }

  function handleChange(e) {
    const v = normalise(e.target.value).slice(0, 16)
    setCode(v)
    // Auto-submit when the typed code reaches the canonical length —
    // saves a tap on phones. Doesn't trigger when the field was
    // pre-populated from the ?code= query string (handled below).
    if (v.length === CODE_LENGTH && !busy) submit(v)
  }

  // Auto-submit pre-filled code (e.g. a teacher shares a "join my class"
  // link with ?code=... in the URL). Fires at most once per mount —
  // without the ref, a flip in `currentUser` or `params` after the
  // join completes could fire a second submission.
  useEffect(() => {
    if (autoSubmittedRef.current) return
    const seeded = normalise(params.get('code') || '')
    if (seeded && seeded.length === CODE_LENGTH && currentUser) {
      autoSubmittedRef.current = true
      submit(seeded)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUser, params])

  return (
    <div className="min-h-screen theme-bg flex flex-col items-center justify-center px-4 py-12">
      <SeoHelmet title="Join a class" path="/classes/join" noIndex />

      <div className="w-full max-w-md text-center">
        <ProfessorPako size={88} mood="happy" />
        <h1 className="theme-text font-display font-black text-2xl sm:text-3xl mt-3">Join a class</h1>
        <p className="theme-text-muted text-sm mt-2 max-w-sm mx-auto">
          Your teacher should have sent you an 8-letter code. Type or paste it
          below to join.
        </p>

        <form onSubmit={handleSubmit} className="mt-6 space-y-3">
          <label htmlFor="class-code" className="sr-only">Invite code</label>
          <input
            id="class-code"
            ref={inputRef}
            type="text"
            inputMode="text"
            autoComplete="off"
            spellCheck="false"
            value={code}
            onChange={handleChange}
            disabled={busy}
            maxLength={16}
            className="w-full text-center font-mono font-black text-2xl sm:text-3xl tracking-widest theme-input rounded-2xl border-2 theme-border px-4 py-4 focus:outline-none disabled:opacity-50 uppercase"
            placeholder="ABCD2345"
            aria-label="Invite code"
          />
          <button
            type="submit"
            disabled={busy || code.length < 6}
            className="w-full theme-accent-fill theme-on-accent rounded-full px-5 py-3 text-sm font-black hover:opacity-90 disabled:opacity-50"
          >
            {busy ? 'Joining…' : 'Join class'}
          </button>
        </form>

        {feedback && (
          <p
            role="status"
            className={`text-sm mt-4 font-bold ${
              feedback.kind === 'ok' ? 'text-emerald-700' : 'text-rose-700'
            }`}
          >
            {feedback.text}
          </p>
        )}

        <div className="mt-8 text-xs theme-text-muted">
          <Link to="/classes" className="theme-accent-text font-bold hover:underline">
            See my classes
          </Link>
          {' · '}
          <Link to="/dashboard" className="hover:theme-text">
            Back to dashboard
          </Link>
        </div>
      </div>
    </div>
  )
}
