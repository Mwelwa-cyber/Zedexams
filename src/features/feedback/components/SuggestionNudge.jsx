import { useEffect, useState } from 'react'
import { useAuth } from '../../../contexts/AuthContext'
import Icon from '../../../shared/components/Icon'
import { Lightbulb, XMarkIcon } from '../../../shared/components/icons'
import FeedbackDialog from './FeedbackDialog'

// How long to wait after a dismiss/interaction before nudging again, and how
// long to wait after the page settles before showing it the first time.
const COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000 // 7 days
const SHOW_DELAY_MS = 6000

const STORAGE_KEY = (uid) => `zedexams:suggest-nudge:${uid || 'anon'}`

function lastSeenAt(uid) {
  try {
    const raw = localStorage.getItem(STORAGE_KEY(uid))
    return raw ? Number(raw) || 0 : 0
  } catch {
    return 0
  }
}

function rememberSeen(uid) {
  try {
    localStorage.setItem(STORAGE_KEY(uid), String(Date.now()))
  } catch { /* localStorage unavailable — nudge will reappear next session */ }
}

/**
 * SuggestionNudge — an occasional, dismissible toast that invites the user to
 * suggest a subject, past paper, or feature. It complements the inline
 * <FeedbackButton /> card by surfacing the same FeedbackDialog more visibly so
 * requests actually get made. It's deliberately polite: it waits a few seconds
 * after load, shows once, and stays quiet for a cooldown window after the user
 * dismisses or opens it (remembered per-user in localStorage).
 *
 * Props:
 *   source — recorded on the submission so admins know where it came from.
 */
export default function SuggestionNudge({ source = 'dashboard' }) {
  const { currentUser } = useAuth()
  const uid = currentUser?.uid

  const [visible, setVisible] = useState(false)
  const [dialogOpen, setDialogOpen] = useState(false)

  useEffect(() => {
    if (!uid) return
    if (Date.now() - lastSeenAt(uid) < COOLDOWN_MS) return
    const t = setTimeout(() => setVisible(true), SHOW_DELAY_MS)
    return () => clearTimeout(t)
  }, [uid])

  function dismiss() {
    setVisible(false)
    rememberSeen(uid)
  }

  function openDialog() {
    setDialogOpen(true)
    setVisible(false)
    rememberSeen(uid)
  }

  return (
    <>
      {visible && (
        <div
          role="dialog"
          aria-label="Have an idea or a request?"
          className="fixed bottom-20 right-3 left-3 z-40 sm:left-auto sm:right-6 sm:bottom-6 sm:w-80 lg:bottom-6 animate-scale-in"
        >
          <div className="theme-card theme-border relative overflow-hidden rounded-2xl border-2 shadow-elev-xl">
            <button
              type="button"
              onClick={dismiss}
              aria-label="Dismiss"
              className="theme-text-muted hover:theme-bg-subtle hover:theme-text absolute right-2 top-2 rounded-full p-1.5"
            >
              <Icon as={XMarkIcon} size="sm" />
            </button>
            <div className="flex items-start gap-3 p-4 pr-9">
              <span
                className="grid h-10 w-10 shrink-0 place-items-center rounded-xl"
                style={{ backgroundColor: 'var(--accent-bg)', color: 'var(--accent-fg)' }}
              >
                <Icon as={Lightbulb} size="md" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="theme-text text-sm font-black">Have an idea or a request?</p>
                <p className="theme-text-muted mt-0.5 text-xs" style={{ lineHeight: 1.4 }}>
                  Ask us for a subject, past paper, or feature — anything you'd like to see.
                </p>
                <div className="mt-3 flex items-center gap-3">
                  <button
                    type="button"
                    onClick={openDialog}
                    className="theme-accent-fill theme-on-accent rounded-xl px-3.5 py-2 text-sm font-black shadow-elev-sm transition-opacity hover:opacity-90"
                  >
                    Suggest →
                  </button>
                  <button
                    type="button"
                    onClick={dismiss}
                    className="theme-text-muted hover:theme-text text-xs font-bold"
                  >
                    Not now
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      <FeedbackDialog open={dialogOpen} onClose={() => setDialogOpen(false)} source={source} />
    </>
  )
}
