import { useEffect, useRef, useState } from 'react'
import { addDoc, collection, serverTimestamp } from 'firebase/firestore'
import { db } from '../../../firebase/config'
import { useAuth } from '../../../contexts/AuthContext'
import Button from '../../../shared/components/Button'
import Icon from '../../../shared/components/Icon'
import { XMarkIcon, CheckCircleIcon, AlertTriangle } from '../../../shared/components/icons'
import { FEEDBACK_TYPES, normalizeFeedbackRole } from '../lib/feedbackOptions'

// Suggestion & request box for signed-in learners and teachers. Submissions
// land in the `feedback` collection and are read by admins at
// /admin/feedback (private inbox — submitters don't see each other's
// requests). The form is intentionally tiny: we already know who the user
// is, so we only ask for a type + a message. A11y patterns (focus trap,
// Escape to close, focus restore) mirror marketing/ContactDialog.
export default function FeedbackDialog({ open, onClose, source = 'dashboard' }) {
  const { currentUser, userProfile } = useAuth()

  const firstFieldRef = useRef(null)
  const previouslyFocused = useRef(null)

  const [type, setType] = useState('suggestion')
  const [message, setMessage] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [done, setDone] = useState(false)
  const [error, setError] = useState('')

  // Reset on open, restore focus on close.
  useEffect(() => {
    if (open) {
      previouslyFocused.current = document.activeElement
      requestAnimationFrame(() => firstFieldRef.current?.focus())
      setError('')
      setDone(false)
    } else if (previouslyFocused.current instanceof HTMLElement) {
      previouslyFocused.current.focus()
    }
  }, [open])

  // Escape closes (unless mid-submit).
  useEffect(() => {
    if (!open) return
    function onKey(e) {
      if (e.key === 'Escape' && !submitting) onClose?.()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, submitting, onClose])

  if (!open) return null

  function validate() {
    if (!currentUser?.uid) return 'Please sign in first.'
    const trimmed = message.trim()
    if (!trimmed) return 'Please write what you would like.'
    if (trimmed.length > 2000) return 'That is a bit long — please keep it under 2000 characters.'
    return ''
  }

  async function handleSubmit(e) {
    e.preventDefault()
    if (submitting) return
    const v = validate()
    if (v) { setError(v); return }
    setError('')
    setSubmitting(true)
    try {
      // Snapshot name/email so an admin can follow up without a second
      // lookup. Keys + sizes are mirrored by the firestore.rules validator.
      const name  = (userProfile?.displayName || currentUser?.displayName || '').slice(0, 100)
      const email = (currentUser?.email || userProfile?.email || '').slice(0, 200)
      const payload = {
        uid: currentUser.uid,
        role: normalizeFeedbackRole(userProfile?.role),
        type,
        message: message.trim().slice(0, 2000),
        status: 'new',
        source: String(source).slice(0, 60),
        context: (typeof window !== 'undefined' ? window.location.pathname : '').slice(0, 200),
        createdAt: serverTimestamp(),
      }
      if (name)  payload.name = name
      if (email) payload.email = email
      await addDoc(collection(db, 'feedback'), payload)
      setDone(true)
      setMessage('')
      setType('suggestion')
    } catch (err) {
      console.error('Feedback submit failed', err)
      setError("Sorry, we couldn't send that just now. Please try again in a moment.")
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="feedback-dialog-title"
    >
      <button
        type="button"
        aria-label="Close suggestion box"
        onClick={() => !submitting && onClose?.()}
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
      />

      <div className="relative theme-card border theme-border rounded-t-3xl sm:rounded-3xl shadow-elev-xl w-full sm:max-w-lg max-h-[92vh] overflow-y-auto">
        <div className="flex items-start justify-between px-6 pt-6 pb-2">
          <div>
            <h2 id="feedback-dialog-title" className="font-display font-black text-2xl theme-text">
              Suggestions &amp; requests
            </h2>
            <p className="text-sm theme-text-muted mt-1">
              Tell us what you'd like to see — a subject, a past paper, a new feature, or anything else.
            </p>
          </div>
          <button
            type="button"
            onClick={() => !submitting && onClose?.()}
            disabled={submitting}
            aria-label="Close"
            className="rounded-full p-2 theme-text-muted hover:theme-bg-subtle hover:theme-text disabled:opacity-50"
          >
            <Icon as={XMarkIcon} size="md" />
          </button>
        </div>

        {done ? (
          <div className="px-6 pb-8 pt-2 text-center">
            <div
              className="mx-auto inline-flex h-14 w-14 items-center justify-center rounded-full mb-4"
              style={{ backgroundColor: 'var(--accent-bg)', color: 'var(--accent-fg)' }}
            >
              <Icon as={CheckCircleIcon} size="xl" />
            </div>
            <h3 className="font-display font-black text-xl theme-text mb-1">Thanks — we've got it</h3>
            <p className="theme-text-muted text-sm mb-6">
              Your suggestion is with the team. We read every one and use them to decide what to build next.
            </p>
            <div className="flex flex-col sm:flex-row gap-2 sm:justify-center">
              <Button variant="secondary" onClick={() => setDone(false)}>
                Send another
              </Button>
              <Button variant="primary" onClick={() => onClose?.()}>
                Done
              </Button>
            </div>
          </div>
        ) : (
          <form className="px-6 pb-6 pt-2 space-y-4" onSubmit={handleSubmit} noValidate>
            <div>
              <label htmlFor="feedback-type" className="block text-sm font-black theme-text mb-1.5">
                What kind of request is this?
              </label>
              <select
                ref={firstFieldRef}
                id="feedback-type"
                value={type}
                onChange={(e) => setType(e.target.value)}
                className="w-full rounded-xl border theme-border theme-card px-4 py-2.5 text-sm theme-text outline-none focus:border-[color:var(--accent)]"
              >
                {FEEDBACK_TYPES.map((t) => (
                  <option key={t.value} value={t.value}>{t.label}</option>
                ))}
              </select>
              {FEEDBACK_TYPES.find((t) => t.value === type)?.hint && (
                <p className="mt-1 text-xs theme-text-muted">
                  {FEEDBACK_TYPES.find((t) => t.value === type).hint}
                </p>
              )}
            </div>

            <div>
              <label htmlFor="feedback-message" className="block text-sm font-black theme-text mb-1.5">
                Your message
              </label>
              <textarea
                id="feedback-message"
                rows={5}
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                maxLength={2000}
                required
                className="w-full rounded-xl border theme-border theme-card px-4 py-2.5 text-sm theme-text outline-none focus:border-[color:var(--accent)] resize-y"
                placeholder="e.g. Please add Grade 9 Chemistry past papers, or a dark theme for night study."
              />
              <div className="mt-1 text-xs theme-text-muted text-right">
                {message.length} / 2000
              </div>
            </div>

            {error && (
              <div className="flex items-start gap-2 rounded-xl bg-danger-subtle text-danger px-3 py-2 text-sm border" style={{ borderColor: 'var(--danger-fg)' }}>
                <Icon as={AlertTriangle} size="sm" className="mt-0.5 shrink-0" />
                <span>{error}</span>
              </div>
            )}

            <div className="flex flex-col-reverse sm:flex-row gap-2 sm:justify-end pt-2">
              <Button
                type="button"
                variant="secondary"
                onClick={() => !submitting && onClose?.()}
                disabled={submitting}
              >
                Cancel
              </Button>
              <Button type="submit" variant="primary" loading={submitting}>
                Send request
              </Button>
            </div>
          </form>
        )}
      </div>
    </div>
  )
}
