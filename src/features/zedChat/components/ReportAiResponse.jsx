import { useCallback, useState } from 'react'
import { addDoc, collection, serverTimestamp } from 'firebase/firestore'
import { db } from '../../../firebase/config'
import { useAuth } from '../../../contexts/AuthContext'
import Icon from '../../../components/ui/Icon'
import { AlertTriangle } from '../../../components/ui/icons'

/**
 * Report an AI response.
 *
 * Google Play's AI-Generated Content policy requires an in-app way to flag AI
 * output, and requires that we act on what is flagged. This is that mechanism;
 * the triage side is /admin/ai-reports.
 *
 * Three things about it are deliberate:
 *
 *   • It is reachable in TWO taps from any assistant message, and the reasons
 *     are written for a child ("It made me uncomfortable", not "Policy
 *     violation"). A reporting path a nine-year-old cannot find or understand
 *     satisfies the letter of the policy and none of its purpose.
 *
 *   • The comment box is optional. Requiring a child to explain WHY something
 *     upset them before they can report it is the single easiest way to lose
 *     the reports that matter most.
 *
 *   • It is available to a learner in limited mode. Every other gated
 *     capability is withheld until a guardian approves, but a consent gate on
 *     the safety valve would be backwards — the person who saw something wrong
 *     must always be able to say so.
 *
 * The reported text is snapshotted into the report rather than referenced,
 * because the conversation is client-side state that will not exist by the
 * time a human looks.
 */

const REASONS = [
  { value: 'inappropriate', label: 'Not appropriate' },
  { value: 'wrong_or_harmful', label: 'Wrong or harmful information' },
  { value: 'uncomfortable', label: 'It made me uncomfortable' },
  { value: 'other', label: 'Something else' },
]

export default function ReportAiResponse({ message, conversationId, surface = 'zed-chat' }) {
  const { currentUser, userProfile } = useAuth()
  const [open, setOpen] = useState(false)
  const [reason, setReason] = useState('')
  const [comment, setComment] = useState('')
  const [state, setState] = useState('idle') // idle | sending | sent | error

  const submit = useCallback(async (event) => {
    event.preventDefault()
    if (!reason || !currentUser) return
    setState('sending')
    try {
      await addDoc(collection(db, 'aiContentReports'), {
        reporterUid: currentUser.uid,
        role: userProfile?.role || 'unknown',
        reason,
        comment: comment.trim() || null,
        conversationId: conversationId || null,
        messageId: message?.id || null,
        // Snapshot, not a reference — the conversation lives in client state
        // and will be gone by the time a human reviews this.
        modelResponse: String(message?.text || '').slice(0, 5000),
        surface,
        status: 'open',
        createdAt: serverTimestamp(),
      })
      setState('sent')
    } catch {
      setState('error')
    }
  }, [reason, comment, currentUser, userProfile, conversationId, message, surface])

  if (!currentUser) return null

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="self-start mt-1 inline-flex items-center gap-1 text-[11px] font-bold theme-text-muted hover:theme-accent-text"
      >
        <Icon as={AlertTriangle} size="xs" strokeWidth={2.1} />
        Report
      </button>
    )
  }

  if (state === 'sent') {
    return (
      <p
        role="status"
        className="self-start mt-1 text-[11px] font-bold theme-accent-text max-w-[85%]"
      >
        Thanks — a person will look at this.
      </p>
    )
  }

  return (
    <form
      onSubmit={submit}
      className="self-start mt-2 w-full max-w-[85%] theme-card border theme-border rounded-radius-md p-3"
    >
      <p className="text-[12px] font-black theme-text mb-2">What was wrong with this answer?</p>
      <div className="space-y-1.5">
        {REASONS.map((r) => (
          <label key={r.value} className="flex items-center gap-2 text-[12px] theme-text-muted">
            <input
              type="radio"
              name={`report-${message?.id || 'msg'}`}
              value={r.value}
              checked={reason === r.value}
              onChange={() => setReason(r.value)}
            />
            {r.label}
          </label>
        ))}
      </div>

      <textarea
        value={comment}
        onChange={(e) => setComment(e.target.value)}
        rows={2}
        maxLength={1000}
        placeholder="Tell us more (you don't have to)"
        className="mt-2 w-full rounded-radius-md border theme-border theme-card theme-text px-2 py-1.5 text-[12px]"
      />

      {state === 'error' && (
        <p role="alert" className="text-[11px] text-rose-700 mt-1">
          We couldn&apos;t send that. Please try again.
        </p>
      )}

      <div className="flex gap-2 mt-2">
        <button
          type="submit"
          disabled={!reason || state === 'sending'}
          className="text-[12px] font-black theme-accent-fill theme-on-accent rounded-radius-md px-3 py-1.5 disabled:opacity-50"
        >
          {state === 'sending' ? 'Sending…' : 'Send report'}
        </button>
        <button
          type="button"
          onClick={() => { setOpen(false); setState('idle') }}
          className="text-[12px] font-bold theme-text-muted px-2"
        >
          Cancel
        </button>
      </div>
    </form>
  )
}
