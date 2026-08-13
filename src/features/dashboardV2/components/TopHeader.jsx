import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import {
  Bell,
  CalendarDays,
  ChevronDown,
  MessageSquare,
  Search,
} from 'lucide-react'
import { useNotifications } from '../../../contexts/NotificationContext'
import { NotificationCenter } from '../../notifications'

export default function TopHeader({ termChip }) {
  // Real notification feed (notifications/{uid}/feed) — same source as the
  // learner/admin shells; unread count is 0 when signed out (preview route).
  const { unreadCount, open: notifOpen, setOpen: setNotifOpen } = useNotifications()
  const [isMac, setIsMac] = useState(false)
  const [query, setQuery] = useState('')
  const navigate = useNavigate()

  useEffect(() => {
    setIsMac(/Mac|iP(hone|ad|od)/.test(navigator.platform || ''))
  }, [])

  // Ctrl/⌘+K focuses the dashboard search from anywhere on the page.
  useEffect(() => {
    const onKey = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        document.getElementById('tdv2-search-input')?.focus()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])

  const submitSearch = (e) => {
    e.preventDefault()
    const q = query.trim()
    navigate(q ? `/teacher/library?q=${encodeURIComponent(q)}` : '/teacher/library')
  }

  return (
    <header className="tdv2-header">
      <form className="tdv2-search" onSubmit={submitSearch}>
        <Search size={18} strokeWidth={2} aria-hidden="true" />
        <input
          id="tdv2-search-input"
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search lessons, notes, tests, worksheets..."
          aria-label="Search your library"
        />
        <span className="tdv2-kbd" aria-hidden="true">{isMac ? '⌘ K' : 'Ctrl K'}</span>
      </form>

      <div className="tdv2-header-right">
        <button
          type="button"
          className="tdv2-iconbtn"
          aria-haspopup="dialog"
          aria-label={unreadCount > 0 ? `Notifications, ${unreadCount} unread` : 'Notifications'}
          onClick={() => setNotifOpen(true)}
        >
          <Bell size={19} strokeWidth={1.75} aria-hidden="true" />
          {unreadCount > 0 ? (
            <span className="tdv2-badge-dot" aria-hidden="true">
              {unreadCount > 99 ? '99+' : unreadCount}
            </span>
          ) : null}
        </button>
        {notifOpen ? <NotificationCenter /> : null}
        <Link to="/teacher/help" className="tdv2-iconbtn" aria-label="Help and support">
          <MessageSquare size={19} strokeWidth={1.75} aria-hidden="true" />
        </Link>
        {/* No user chip here — the teacher's name already appears in the
            hero greeting and on the sidebar profile card (the account
            control); a third copy was pure noise. */}
        {termChip ? (
          <Link to="/teacher/calendar" className="tdv2-datechip" aria-label={`School calendar: ${termChip}`}>
            <CalendarDays size={17} strokeWidth={1.75} aria-hidden="true" />
            {termChip}
            <ChevronDown size={15} strokeWidth={2} aria-hidden="true" />
          </Link>
        ) : null}
      </div>
    </header>
  )
}
