/**
 * Learner-side: "Share my progress with my parent" panel.
 * Audit A3 PR 1.
 *
 * Mounted on /profile. The learner:
 *   - Optionally adds a parent email + phone + display name (all
 *     optional — they're hints for the future weekly digest job;
 *     a parent who only has the link doesn't need any of this).
 *   - Hits "Create share link" → server mints a 12-char token and
 *     returns a URL like https://zedexams.com/parent/{token}.
 *   - Sees their existing live + revoked shares and can revoke any
 *     active one.
 *
 * UX notes:
 *   - "Copy link" + "Send via WhatsApp" are the two parent-friendly
 *     hand-off paths (matches the rest of the app's WhatsApp deep-link
 *     pattern). No QR code in v1 — most parents already use WhatsApp.
 *   - Revoking is one-click (no separate "are you sure" — the link
 *     can always be re-issued).
 */

import { useCallback, useEffect, useState } from 'react'
import { useAuth } from '../../contexts/AuthContext'
import {
  createProgressShare,
  listMyProgressShares,
  revokeProgressShare,
} from '../../utils/parentShares'

const SITE = typeof window !== 'undefined' && window.location?.origin
  ? window.location.origin
  : 'https://zedexams.com'

function formatDate(ts) {
  if (!ts) return '—'
  const d = ts?.toDate?.() ?? new Date(ts)
  if (Number.isNaN(d?.getTime?.())) return '—'
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
}

function ShareRow({ share, onRevoke, busy }) {
  const url = `${SITE}/parent/${share.id}`
  const [copied, setCopied] = useState(false)
  const isRevoked = !!share.revokedAt
  const isExpired = share.expiresAt
    && (share.expiresAt.toDate?.() ?? new Date(share.expiresAt)).getTime() < Date.now()
  const status = isRevoked ? 'Revoked' : isExpired ? 'Expired' : 'Active'

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // Older browsers / iOS quirks — fall back to a manual prompt.
      window.prompt('Copy this link:', url)
    }
  }

  const whatsappHref = `https://wa.me/?text=${encodeURIComponent(
    `Here's a private link to my ZedExams progress: ${url}`,
  )}`

  return (
    <li className="theme-card border theme-border rounded-radius-md p-3 space-y-2">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <p className="theme-text font-bold text-sm truncate">
            {share.parentDisplayName || 'Progress link'}
          </p>
          <p className="theme-text-muted text-xs mt-0.5 break-all">
            {share.parentEmail || share.parentPhone || 'No parent contact saved'}
          </p>
          <p className="theme-text-muted text-[11px] mt-1">
            Created {formatDate(share.createdAt)} · expires {formatDate(share.expiresAt)}
            {typeof share.viewCount === 'number' ? ` · ${share.viewCount} view${share.viewCount === 1 ? '' : 's'}` : ''}
          </p>
        </div>
        <span className={`text-[10px] font-black uppercase tracking-wider px-2 py-0.5 rounded-full flex-shrink-0 ${
          isRevoked
            ? 'bg-slate-200 text-slate-700'
            : isExpired
              ? 'bg-amber-100 text-amber-800'
              : 'bg-emerald-100 text-emerald-800'
        }`}>{status}</span>
      </div>

      {!isRevoked && !isExpired && (
        <>
          <input
            type="text"
            readOnly
            value={url}
            onFocus={(e) => e.target.select()}
            className="w-full text-xs theme-bg-subtle theme-text font-mono rounded-lg px-2 py-1.5"
            aria-label="Progress share URL"
          />
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={handleCopy}
              className="theme-card border theme-border rounded-full px-3 py-1.5 text-xs font-bold hover:theme-bg-subtle"
            >
              {copied ? 'Copied!' : 'Copy link'}
            </button>
            <a
              href={whatsappHref}
              target="_blank"
              rel="noopener noreferrer"
              className="theme-card border theme-border rounded-full px-3 py-1.5 text-xs font-bold hover:theme-bg-subtle inline-flex items-center gap-1"
            >
              📲 WhatsApp
            </a>
            <button
              type="button"
              onClick={() => onRevoke(share.id)}
              disabled={busy}
              className="ml-auto text-xs font-bold text-rose-700 hover:underline disabled:opacity-50"
            >
              Revoke
            </button>
          </div>
        </>
      )}
    </li>
  )
}

export default function ParentShareManager() {
  const { currentUser } = useAuth()
  const [shares, setShares] = useState([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [feedback, setFeedback] = useState(null)
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState({
    parentDisplayName: '',
    parentEmail: '',
    parentPhone: '',
  })

  const refresh = useCallback(async () => {
    if (!currentUser) return
    try {
      const rows = await listMyProgressShares(currentUser.uid)
      setShares(rows)
    } catch (err) {
      console.warn('[ParentShareManager] list failed', err)
    } finally {
      setLoading(false)
    }
  }, [currentUser])

  useEffect(() => { refresh() }, [refresh])

  async function handleCreate() {
    setBusy(true)
    setFeedback(null)
    try {
      await createProgressShare({
        parentDisplayName: form.parentDisplayName.trim() || null,
        parentEmail: form.parentEmail.trim() || null,
        parentPhone: form.parentPhone.trim() || null,
      })
      setForm({ parentDisplayName: '', parentEmail: '', parentPhone: '' })
      setShowForm(false)
      setFeedback({ kind: 'ok', text: 'Share link ready — copy it below to send to your parent.' })
      await refresh()
    } catch (err) {
      console.error('[ParentShareManager] create failed', err)
      setFeedback({ kind: 'err', text: err?.message || 'Could not create the share link. Please try again.' })
    } finally {
      setBusy(false)
    }
  }

  async function handleRevoke(token) {
    setBusy(true)
    setFeedback(null)
    try {
      await revokeProgressShare(token)
      setFeedback({ kind: 'ok', text: 'Share link revoked — your parent will see "this link has been revoked".' })
      await refresh()
    } catch (err) {
      console.error('[ParentShareManager] revoke failed', err)
      setFeedback({ kind: 'err', text: err?.message || 'Could not revoke the link.' })
    } finally {
      setBusy(false)
    }
  }

  const activeShares = shares.filter((s) => !s.revokedAt)

  return (
    <section className="theme-card border theme-border rounded-radius-md p-4 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="theme-text font-black text-sm flex items-center gap-2">
            <span aria-hidden="true">👨‍👩‍👧</span>
            Share progress with a parent
          </p>
          <p className="theme-text-muted text-xs mt-1 max-w-prose">
            Create a private link your parent or guardian can open — they&apos;ll see
            your recent quiz scores and which subjects need more work. No account
            needed for them.
          </p>
        </div>
        {!showForm && activeShares.length === 0 && (
          <button
            type="button"
            onClick={() => setShowForm(true)}
            className="theme-accent-fill theme-on-accent rounded-full px-3 py-1.5 text-xs font-black hover:opacity-90 flex-shrink-0"
          >
            Create link
          </button>
        )}
      </div>

      {feedback && (
        <p
          role="status"
          className={`text-xs font-bold ${feedback.kind === 'ok' ? 'text-emerald-700' : 'text-rose-700'}`}
        >
          {feedback.text}
        </p>
      )}

      {showForm && (
        <div className="theme-bg-subtle rounded-radius-md p-3 space-y-2">
          <p className="text-xs font-bold theme-text">Optional details for the future weekly digest email/SMS:</p>
          <input
            type="text"
            placeholder="Parent name (e.g. Mum, Dad, Mr. Phiri)"
            value={form.parentDisplayName}
            onChange={(e) => setForm({ ...form, parentDisplayName: e.target.value })}
            className="w-full rounded-lg border-2 theme-border theme-input px-3 py-2 text-sm"
          />
          <input
            type="email"
            placeholder="Parent email (optional)"
            value={form.parentEmail}
            onChange={(e) => setForm({ ...form, parentEmail: e.target.value })}
            className="w-full rounded-lg border-2 theme-border theme-input px-3 py-2 text-sm"
          />
          <input
            type="tel"
            placeholder="Parent phone (optional)"
            value={form.parentPhone}
            onChange={(e) => setForm({ ...form, parentPhone: e.target.value })}
            className="w-full rounded-lg border-2 theme-border theme-input px-3 py-2 text-sm"
          />
          <div className="flex gap-2 justify-end pt-1">
            <button
              type="button"
              onClick={() => setShowForm(false)}
              disabled={busy}
              className="text-xs font-bold theme-text-muted hover:theme-text"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleCreate}
              disabled={busy}
              className="theme-accent-fill theme-on-accent rounded-full px-4 py-1.5 text-xs font-black hover:opacity-90 disabled:opacity-50"
            >
              {busy ? 'Creating…' : 'Create share link'}
            </button>
          </div>
        </div>
      )}

      {!loading && (
        <ul className="space-y-2">
          {shares.map((s) => (
            <ShareRow key={s.id} share={s} onRevoke={handleRevoke} busy={busy} />
          ))}
        </ul>
      )}

      {!loading && shares.length > 0 && !showForm && (
        <div className="text-right">
          <button
            type="button"
            onClick={() => setShowForm(true)}
            className="text-xs font-bold theme-accent-text hover:underline"
          >
            + Create another link
          </button>
        </div>
      )}
    </section>
  )
}
