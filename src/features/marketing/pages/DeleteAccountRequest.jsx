import { useCallback, useState } from 'react'
import { Link } from 'react-router-dom'
import LegalLayout from '../components/LegalLayout'
import SeoHelmet from '../../../components/seo/SeoHelmet'

/**
 * Public account-deletion request page (zedexams.com/delete-account).
 *
 * Google Play's Data deletion policy requires a route to deletion that does
 * not involve opening the app — for someone who has forgotten their password,
 * lost the device, or is a parent acting for a child. This is that route, and
 * it is the URL given on the Play Data safety form.
 *
 * Two things about the design are load-bearing rather than cosmetic:
 *
 *   • The in-app path is offered FIRST and prominently. It is authenticated,
 *     it is instant, and it is the only one that deletes without a human in
 *     the loop. Sending someone who could just sign in down the 7-day queue
 *     instead would be worse service, not better compliance.
 *
 *   • The form promises nothing about whether the address has an account. The
 *     endpoint behind it is unauthenticated, so a response that distinguished
 *     "queued" from "no such user" would let anyone test email addresses
 *     against the entire user base. The acknowledgement is deliberately
 *     conditional, and the server sends the same one either way.
 *
 * It is a React route rather than a static file in public/ so it inherits the
 * app's theme, layout and legal cross-links — and so /privacy, /terms and this
 * page cannot drift into looking like three different products.
 */

const ENDPOINT = '/api/account/delete-request'
const CONTACT_EMAIL = 'support@zedexams.com'
const WHATSAPP_HREF =
  'https://wa.me/260977740465?text=Hello%2C%20I%20would%20like%20to%20delete%20my%20ZedExams%20account.'

const ROLE_OPTIONS = [
  { value: '', label: 'Select…' },
  { value: 'learner', label: 'Learner' },
  { value: 'teacher', label: 'Teacher' },
  { value: 'parent_guardian', label: 'Parent/guardian requesting for a learner' },
  { value: 'other', label: 'Other / not sure' },
]

const FIELD_CLASS =
  'w-full rounded-radius-md border theme-border theme-card theme-text px-3 py-2 ' +
  'text-sm focus:outline-none focus:ring-2 focus:ring-[color:var(--accent)]'

function Label({ htmlFor, children }) {
  return (
    <label htmlFor={htmlFor} className="block font-black text-sm theme-text mt-4 mb-1">
      {children}
    </label>
  )
}

export default function DeleteAccountRequest() {
  const [status, setStatus] = useState('idle') // idle | sending | sent | error
  const [message, setMessage] = useState('')

  const handleSubmit = useCallback(async (event) => {
    event.preventDefault()
    const form = event.currentTarget
    const data = new FormData(form)

    setStatus('sending')
    setMessage('')

    try {
      const res = await fetch(ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: String(data.get('email') || '').trim(),
          name: String(data.get('name') || '').trim(),
          role: String(data.get('role') || ''),
          details: String(data.get('details') || '').trim(),
          confirmed: data.get('confirmed') === 'on',
          source: 'web_delete_account_page',
        }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        // The server's message is written for the requester (a validation
        // hint, or the fallback channels on a real failure) — show it rather
        // than replacing it with a generic one.
        setStatus('error')
        setMessage(body.error || 'We could not submit your request. Please try again.')
        return
      }
      setStatus('sent')
      setMessage(body.message || 'Request received.')
    } catch {
      setStatus('error')
      setMessage(
        `We could not reach our servers. Please email ${CONTACT_EMAIL} or WhatsApp ` +
        '+260 977 740 465 instead.',
      )
    }
  }, [])

  return (
    <>
      <SeoHelmet
        title="Delete your account"
        description="Request deletion of your ZedExams account and associated data. Works without signing in."
        path="/delete-account"
      />
      <LegalLayout title="Delete your account">
        <p className="leading-relaxed theme-text-muted">
          You can delete your ZedExams account and its data here without signing in.
          Requests are verified and completed within 7 days.
        </p>

        <section className="theme-card border theme-border rounded-radius-md p-4">
          <h2 className="font-display font-black text-lg mb-2">
            Fastest way: delete inside the app
          </h2>
          <p className="theme-text-muted text-sm mb-3">
            If you can still sign in, this removes your account immediately — no waiting
            and no verification step.
          </p>
          <ol className="list-decimal pl-5 space-y-1 theme-text-muted text-sm">
            <li>Open ZedExams and go to <strong>Settings → Account → Delete account</strong>.</li>
            <li>Type <strong>DELETE</strong> to confirm.</li>
            <li>Choose <strong>Permanently delete</strong>.</li>
          </ol>
        </section>

        <section className="theme-card border theme-border rounded-radius-md p-4">
          <h2 className="font-display font-black text-lg mb-2">Or request deletion here</h2>

          {status === 'sent' ? (
            <p
              role="status"
              className="rounded-radius-md border border-green-600/40 bg-green-600/10 p-3 text-sm theme-text"
            >
              {message}
            </p>
          ) : (
            <form onSubmit={handleSubmit} noValidate>
              <Label htmlFor="email">Account email address</Label>
              <input
                id="email" name="email" type="email" required
                autoComplete="email" placeholder="you@example.com"
                className={FIELD_CLASS}
              />

              <Label htmlFor="name">Full name on the account</Label>
              <input
                id="name" name="name" type="text"
                autoComplete="name" placeholder="As shown in your profile"
                className={FIELD_CLASS}
              />

              <Label htmlFor="role">Account type</Label>
              <select id="role" name="role" className={FIELD_CLASS} defaultValue="">
                {ROLE_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>

              <Label htmlFor="details">Anything we should know? (optional)</Label>
              <textarea
                id="details" name="details" rows={3}
                placeholder="e.g. the learner's school and grade, or a second email on the account"
                className={FIELD_CLASS}
              />

              <div className="flex gap-3 items-start mt-4">
                <input
                  id="confirmed" name="confirmed" type="checkbox" required
                  className="mt-1 shrink-0"
                />
                <label htmlFor="confirmed" className="text-sm theme-text-muted leading-relaxed">
                  I understand this permanently deletes the account, learning progress,
                  created content, class memberships and subscription records. Limited
                  records may be kept where the law requires (for example payment records),
                  no longer linked to me.
                </label>
              </div>

              {status === 'error' && (
                <p
                  role="alert"
                  className="mt-4 rounded-radius-md border border-red-600/40 bg-red-600/10 p-3 text-sm theme-text"
                >
                  {message}
                </p>
              )}

              <button
                type="submit"
                disabled={status === 'sending'}
                className="mt-5 w-full rounded-radius-md bg-[color:var(--accent)] text-white
                           font-black py-3 text-sm disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {status === 'sending' ? 'Submitting…' : 'Submit deletion request'}
              </button>

              <p className="text-xs theme-text-muted mt-3">
                We may contact you to verify your identity before deleting. Parents and
                guardians can request deletion of a learner's account.
              </p>
            </form>
          )}
        </section>

        <section className="theme-card border theme-border rounded-radius-md p-4">
          <h2 className="font-display font-black text-lg mb-2">Prefer to message us?</h2>
          <p className="theme-text-muted text-sm">
            Email{' '}
            <a
              className="underline theme-accent-text font-bold"
              href={`mailto:${CONTACT_EMAIL}?subject=Account%20deletion%20request`}
            >
              {CONTACT_EMAIL}
            </a>{' '}
            or WhatsApp{' '}
            <a
              className="underline theme-accent-text font-bold"
              href={WHATSAPP_HREF} target="_blank" rel="noopener noreferrer"
            >
              +260 977 740 465
            </a>{' '}
            with the subject "Account deletion request".
          </p>
        </section>

        <section>
          <h2 className="font-display font-black text-lg mb-2">What gets deleted</h2>
          <p className="theme-text-muted leading-relaxed">
            Your profile (name, email, role, grade, school), quiz and exam results, created
            content, class memberships, Ask Zed conversation history, uploaded verification
            documents, subscription records, and — if you opted in to analytics — your
            analytics profile and its events. See{' '}
            <Link className="underline theme-accent-text font-bold" to="/privacy">
              our Privacy Policy
            </Link>
            , section 7, for the full detail.
          </p>
        </section>
      </LegalLayout>
    </>
  )
}
