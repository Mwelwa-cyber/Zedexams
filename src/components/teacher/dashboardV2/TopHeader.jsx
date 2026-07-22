import { useEffect, useState } from 'react'
import {
  Bell,
  CalendarDays,
  ChevronDown,
  MessageSquare,
  Search,
} from 'lucide-react'
import { TEACHER, TERM_CHIP } from './mockData'

export default function TopHeader() {
  const [isMac, setIsMac] = useState(false)
  useEffect(() => {
    setIsMac(/Mac|iP(hone|ad|od)/.test(navigator.platform || ''))
  }, [])

  return (
    <header className="tdv2-header">
      <label className="tdv2-search">
        <Search size={18} strokeWidth={2} aria-hidden="true" />
        <input
          type="search"
          placeholder="Search lessons, notes, tests, worksheets..."
          aria-label="Search lessons, notes, tests and worksheets"
        />
        <span className="tdv2-kbd" aria-hidden="true">{isMac ? '⌘ K' : 'Ctrl K'}</span>
      </label>

      <div className="tdv2-header-right">
        <button type="button" className="tdv2-iconbtn" aria-label="Notifications (3 unread)">
          <Bell size={19} strokeWidth={1.75} aria-hidden="true" />
          <span className="tdv2-badge-dot" aria-hidden="true">3</span>
        </button>
        <button type="button" className="tdv2-iconbtn" aria-label="Messages">
          <MessageSquare size={19} strokeWidth={1.75} aria-hidden="true" />
        </button>
        <button type="button" className="tdv2-userchip" aria-label={`Account: ${TEACHER.shortName}`}>
          <span className="tdv2-avatar" aria-hidden="true">{TEACHER.initials}</span>
          <span className="tdv2-user-name">{TEACHER.shortName}</span>
          <ChevronDown size={16} strokeWidth={2} aria-hidden="true" />
        </button>
        <button type="button" className="tdv2-datechip" aria-label={`School calendar: ${TERM_CHIP}`}>
          <CalendarDays size={17} strokeWidth={1.75} aria-hidden="true" />
          {TERM_CHIP}
          <ChevronDown size={15} strokeWidth={2} aria-hidden="true" />
        </button>
      </div>
    </header>
  )
}
