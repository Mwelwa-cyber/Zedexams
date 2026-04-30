import { useEffect, useRef, useState } from 'react'
import { addDoc, collection, serverTimestamp } from 'firebase/firestore'
import { db } from '../../firebase/config'
import Button from '../ui/Button'
import Icon from '../ui/Icon'
import { XMarkIcon, CheckCircleIcon, AlertTriangle } from '../ui/icons'

const ROLES = [
  { value: 'parent',  label: 'Parent / guardian' },
  { value: 'teacher', label: 'Teacher' },
  { value: 'school',  label: 'School / admin' },
  { value: 'learner', label: 'Learner' },
  { value: 'other',   label: 'Other' },
]

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export default function ContactDialog({ open, onClose, source = 'marketing-page' }) {
  const panelRef = useRef(null)
  const firstFieldRef = useRef(null)
  const previouslyFocused = useRef(null)

  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [role, setRole] = useState('parent')
  const [message, setMessage] = useState('')

  const [submitting, setSubmitting] = useState(false)
  const [done, setDone] = useState(false)
  const [error, setError] = useState('')

  // Reset state on open, restore focus on close
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

  // Escape closes
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
    if (!name.trim()) return 'Please enter your name.'
    if (!EMAIL_RE.test(email.trim())) return 'Please enter a valid email address.'
    if (!message.trim()) return 'Please write a short message.'
    if (message.trim().length > 2000) return 'Message is too long (max 2000 characters).'
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
      const payload = {
        name: name.trim().slice(0, 100),
        email: email.trim().slice(0, 200),
        message: message.trim().slice(0, 2000),
        source: source.slice(0, 60),
        createdAt: serverTimestamp(),
      }
      const trimmedPhone = phone.trim().slice(0, 30)
      if (trimmedPhone) payload.phone = trimmedPhone
      if (role) payload.role = role
      await addDoc(collection(db, 'contactMessages'), payload)
      setDone(true)
      // Clear sensitive fields after success
      setName(''); setEmail(''); setPhone(''); setMessage(''); setRole('parent')
    } catch (err) {
      console.error('Contact form submit failed', err)
      setError("Sorry, we couldn't send that just now. Please try again, or message us on WhatsApp.")
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="contact-dialog-title"
    >
      <button
        type="button"
        aria-label="Close contact form"
        onClick={() => !submitting && onClose?.()}
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
      />

      <div
        ref={panelRef}
        className="relative theme-card border theme-border rounded-t-3xl sm:rounded-3xl shadow-elev-xl w-full sm:max-w-lg max-h-[92vh] overflow-y-auto"
      >
        <div className="flex items-start justify-between px-6 pt-6 pb-2">
          <div>
            <h2 id="contact-dialog-title" className="font-display font-black text-2xl theme-text">
              Talk to us
            </h2>
            <p className="text-sm theme-text-muted mt-1">
              We usually reply within one working day.
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
            <h3 className="font-display font-black text-xl theme-text mb-1">Message sent</h3>
            <p className="theme-text-muted text-sm mb-6">
              Thanks for reaching out — we'll get back to you on the email you provided.
            </p>
            <Button variant="primary" onClick={() => onClose?.()} fullWidth>
              Close
            </Button>
          </div>
        ) : (
          <form className="px-6 pb-6 pt-2 space-y-4" onSubmit={handleSubmit} noValidate>
            <div>
              <label htmlFor="contact-name" className="block text-sm font-black theme-text mb-1.5">
                Your name
              </label>
              <input
                ref={firstFieldRef}
                id="contact-name"
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={100}
                required
                className="w-full rounded-xl border theme-border theme-card px-4 py-2.5 text-sm theme-text outline-none focus:border-[color:var(--accent)]"
                placeholder="Mwansa Phiri"
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label htmlFor="contact-email" className="block text-sm font-black theme-text mb-1.5">
                  Email
                </label>
                <input
                  id="contact-email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  maxLength={200}
                  required
                  className="w-full rounded-xl border theme-border theme-card px-4 py-2.5 text-sm theme-text outline-none focus:border-[color:var(--accent)]"
                  placeholder="you@example.com"
                />
              </div>
              <div>
                <label htmlFor="contact-phone" className="block text-sm font-black theme-text mb-1.5">
                  Phone <span className="theme-text-muted font-normal">(optional)</span>
                </label>
                <input
                  id="contact-phone"
                  type="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  maxLength={30}
                  className="w-full rounded-xl border theme-border theme-card px-4 py-2.5 text-sm theme-text outline-none focus:border-[color:var(--accent)]"
                  placeholder="+260 ..."
                />
              </div>
            </div>

            <div>
              <label htmlFor="contact-role" className="block text-sm font-black theme-text mb-1.5">
                I'm a…
              </label>
              <select
                id="contact-role"
                value={role}
                onChange={(e) => setRole(e.target.value)}
                className="w-full rounded-xl border theme-border theme-card px-4 py-2.5 text-sm theme-text outline-none focus:border-[color:var(--accent)]"
              >
                {ROLES.map((r) => (
                  <option key={r.value} value={r.value}>{r.label}</option>
                ))}
              </select>
            </div>

            <div>
              <label htmlFor="contact-message" className="block text-sm font-black theme-text mb-1.5">
                Message
              </label>
              <textarea
                id="contact-message"
                rows={4}
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                maxLength={2000}
                required
                className="w-full rounded-xl border theme-border theme-card px-4 py-2.5 text-sm theme-text outline-none focus:border-[color:var(--accent)] resize-y"
                placeholder="Tell us a bit about what you'd like to do with ZedExams."
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
                Send message
              </Button>
            </div>

            <p className="pt-3 text-center text-xs theme-text-muted">
              Prefer email? Write to{' '}
              <a className="underline theme-accent-text" href="mailto:support@zedexams.com">
                support@zedexams.com
              </a>
              .
            </p>
          </form>
        )}
      </div>
    </div>
  )
}
