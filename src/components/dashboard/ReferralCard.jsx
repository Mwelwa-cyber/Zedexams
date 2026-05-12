/**
 * ReferralCard — audit C7 PR 1.
 *
 * Renders the user's referral code, copy / share buttons, and a
 * counter of successful referrals. Mounted on /profile.
 *
 * Self-hides when the user record doesn't have a referralCode yet
 * (covers the rare case where the mint failed at signup; a future
 * Cloud Function backfill can repair these).
 *
 * What's NOT in this PR:
 *   - "X free months earned" label — depends on the redemption flow
 *     in PR 2.
 *   - Inviting via email / contact list — link sharing is enough as
 *     a v0; richer invite UX lands later.
 */

import { useState } from 'react'
import { useAuth } from '../../contexts/AuthContext'
import {
  buildReferralShareUrl,
  buildReferralWhatsAppUrl,
} from '../../utils/referrals'

function WhatsAppIcon({ size = 16 }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M16.04 3C9.4 3 4 8.4 4 15.04c0 2.32.66 4.5 1.82 6.36L4 29l7.84-1.78a12 12 0 0 0 4.2.78c6.64 0 12.04-5.4 12.04-12.04S22.68 3 16.04 3Zm0 21.84a10 10 0 0 1-5.1-1.4l-.36-.22-3.86.88.84-3.78-.24-.4a9.84 9.84 0 0 1-1.5-5.16C5.82 9.42 10.4 4.84 16.04 4.84S26.26 9.42 26.26 15.04c0 5.62-4.58 10.2-10.22 10.2Zm6-7.66c-.32-.16-1.92-.96-2.22-1.06-.3-.12-.52-.16-.74.16-.22.32-.86 1.04-1.06 1.26-.2.22-.4.24-.72.08-.32-.16-1.36-.5-2.6-1.6-.96-.86-1.6-1.92-1.78-2.24-.18-.32-.02-.5.14-.66.14-.14.32-.36.48-.54.16-.18.22-.32.32-.52.1-.22.06-.4-.02-.56-.08-.16-.74-1.78-1.02-2.42-.26-.62-.54-.54-.74-.56-.18-.02-.4-.02-.6-.02s-.56.08-.86.4c-.3.32-1.14 1.12-1.14 2.74s1.16 3.18 1.32 3.4c.16.22 2.3 3.5 5.6 4.92.78.34 1.4.54 1.88.7.78.24 1.5.2 2.06.12.62-.08 1.92-.78 2.2-1.54.28-.76.28-1.4.2-1.54-.08-.14-.3-.22-.62-.38Z" />
    </svg>
  )
}

export default function ReferralCard() {
  const { userProfile } = useAuth()
  const [copied, setCopied] = useState(false)

  if (!userProfile) return null
  const code = userProfile.referralCode
  if (!code) return null

  const shareUrl = buildReferralShareUrl(code)
  const whatsappUrl = buildReferralWhatsAppUrl(code, userProfile.displayName)

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(shareUrl || code)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch (err) {
      console.warn('[ReferralCard] copy failed', err)
    }
  }

  const referralCount = userProfile.referralCount || 0
  // Audit C7 PR 2 — server increments referralCredits on every
  // successful redemption. Today the credits show as "free months
  // earned"; PR 3 will let the user redeem them at next checkout.
  const referralCredits = userProfile.referralCredits || 0

  return (
    <div className="theme-card rounded-2xl border theme-border p-5">
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
        <div className="flex-1 min-w-0">
          <p className="font-display font-black text-sm uppercase tracking-wider theme-text">
            Invite friends · earn free months
          </p>
          <p className="theme-text-muted text-xs mt-1 max-w-md">
            Share your code. When a friend signs up and goes Pro, you both get a free month.
            Word-of-mouth in WhatsApp groups is how most ZedExams accounts find us.
          </p>
        </div>
        {(referralCount > 0 || referralCredits > 0) && (
          <div className="flex gap-4 sm:gap-5 flex-shrink-0">
            {referralCount > 0 && (
              <div className="text-right">
                <p className="theme-text font-black text-2xl leading-none">{referralCount}</p>
                <p className="theme-text-muted text-[10px] uppercase tracking-wider mt-1">
                  friend{referralCount === 1 ? '' : 's'} joined
                </p>
              </div>
            )}
            {referralCredits > 0 && (
              <div className="text-right">
                <p className="theme-text font-black text-2xl leading-none">{referralCredits}</p>
                <p className="theme-text-muted text-[10px] uppercase tracking-wider mt-1">
                  free month{referralCredits === 1 ? '' : 's'} earned
                </p>
              </div>
            )}
          </div>
        )}
      </div>

      <div className="mt-4 flex flex-col gap-2">
        <div className="rounded-radius-md bg-slate-50 dark:bg-slate-900/40 border theme-border px-3 py-2.5 flex items-center justify-between gap-3">
          <span className="font-mono font-bold text-sm tracking-[2px] theme-text">{code}</span>
          <button
            type="button"
            onClick={handleCopy}
            disabled={copied}
            className="text-xs font-bold theme-accent-text hover:underline disabled:opacity-60 disabled:no-underline flex-shrink-0"
            aria-label="Copy referral link to clipboard"
          >
            {copied ? '✓ Copied' : 'Copy link'}
          </button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {whatsappUrl && (
            <a
              href={whatsappUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center justify-center gap-2 rounded-radius-md bg-[#25D366] text-white px-4 py-2 text-sm font-bold hover:opacity-90"
            >
              <WhatsAppIcon size={16} />
              Share on WhatsApp
            </a>
          )}
          {shareUrl && (
            <a
              href={shareUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center justify-center gap-2 rounded-radius-md theme-card border theme-border px-4 py-2 text-sm font-bold theme-text hover:theme-bg-subtle"
            >
              Open invite link
            </a>
          )}
        </div>
      </div>

      <p className="mt-3 text-[11px] theme-text-muted leading-relaxed">
        Free-month credit is awarded once your friend completes their first Pro purchase.
        Self-referrals don't qualify.
      </p>
    </div>
  )
}
