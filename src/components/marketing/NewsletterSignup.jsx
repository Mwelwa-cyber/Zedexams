/**
 * NewsletterSignup — small inline form for the marketing footer.
 *
 * Audit C6: list builder for parent / teacher / school decision-makers
 * who want to keep an eye on ZedExams without creating an account
 * yet. Today the list lives in Firestore (`newsletterSubscribers`);
 * we'll export it into a real sending platform (Buttondown /
 * Mailchimp / Beehiiv) when we're ready to actually send.
 *
 * Anti-spam:
 *   - Honeypot: the `companyWebsite` field is rendered visually
 *     hidden + tabIndex=-1 + autoComplete=off. Real users never see
 *     or fill it; bots filling every field get silently no-op'd.
 *   - The Cloud Function also rate-limits per IP and validates email
 *     format. This component just provides the user-facing surface.
 *
 * UX notes:
 *   - Inline status message replaces the form on success so the user
 *     gets explicit confirmation without a toast.
 *   - "Already subscribed" returns a friendly message, NOT an error.
 *   - Submit-on-Enter works because it's a real <form>.
 *   - Privacy reassurance line under the input — important for a
 *     parent/teacher audience that's wary of school-data harvesters.
 */

import { useState } from 'react'
import { subscribeToNewsletter } from '../../utils/newsletter'

const HONEYPOT_STYLE = {
  position: 'absolute',
  left: '-10000px',
  top: 'auto',
  width: '1px',
  height: '1px',
  overflow: 'hidden',
}

export default function NewsletterSignup({ source = 'marketing-footer' }) {
  const [email, setEmail] = useState('')
  // Honeypot — controlled but never displayed to humans.
  const [companyWebsite, setCompanyWebsite] = useState('')
  const [status, setStatus] = useState('idle')   // idle | submitting | success | already | error
  const [error, setError] = useState('')

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    const trimmed = email.trim()
    if (!trimmed) {
      setError('Please enter an email address.')
      setStatus('error')
      return
    }
    setStatus('submitting')
    try {
      const result = await subscribeToNewsletter({
        email: trimmed,
        source,
        companyWebsite,
      })
      if (result?.alreadySubscribed) {
        setStatus('already')
      } else {
        setStatus('success')
      }
    } catch (err) {
      console.error('[NewsletterSignup] subscribe failed', err)
      setError(err?.message || 'Could not subscribe. Try again in a minute.')
      setStatus('error')
    }
  }

  if (status === 'success') {
    return (
      <p className="text-sm theme-text" role="status">
        ✓ Thanks — you're on the list. We'll send the first update when there's something worth sharing.
      </p>
    )
  }
  if (status === 'already') {
    return (
      <p className="text-sm theme-text-muted" role="status">
        ✓ You're already subscribed. Nothing to do.
      </p>
    )
  }

  const submitting = status === 'submitting'

  return (
    <form onSubmit={handleSubmit} noValidate>
      <p className="font-display font-black text-sm uppercase tracking-wider theme-text mb-3">
        Newsletter
      </p>
      <p className="text-sm theme-text-muted mb-3 max-w-xs">
        Occasional updates on new past papers, CBC features, and Zambian education news. No spam.
      </p>
      <label htmlFor="newsletter-email" className="sr-only">Email address</label>
      <div className="flex flex-col sm:flex-row gap-2">
        <input
          id="newsletter-email"
          type="email"
          inputMode="email"
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@example.com"
          required
          maxLength={254}
          disabled={submitting}
          className="flex-1 min-w-0 rounded-radius-md border theme-border bg-transparent px-3 py-2 text-sm theme-text placeholder:theme-text-muted focus:outline-none focus:ring-2 focus:ring-emerald-500"
        />
        <button
          type="submit"
          disabled={submitting || !email.trim()}
          className="rounded-radius-md theme-accent-fill theme-on-accent px-4 py-2 text-sm font-bold hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed flex-shrink-0"
        >
          {submitting ? 'Subscribing…' : 'Subscribe'}
        </button>
      </div>

      {/* Honeypot — visually hidden, never tabbable, autoComplete off. */}
      <div style={HONEYPOT_STYLE} aria-hidden="true">
        <label htmlFor="newsletter-company-website">Company website</label>
        <input
          id="newsletter-company-website"
          type="text"
          name="companyWebsite"
          tabIndex={-1}
          autoComplete="off"
          value={companyWebsite}
          onChange={(e) => setCompanyWebsite(e.target.value)}
        />
      </div>

      {error && (
        <p className="mt-2 text-xs text-rose-700" role="alert">{error}</p>
      )}
      <p className="mt-2 text-xs theme-text-muted/80">
        We never share your email. Unsubscribe any time by replying to a message.
      </p>
    </form>
  )
}
