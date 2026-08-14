import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../../../contexts/AuthContext'
import useClickAway from '../../../hooks/useClickAway'
import useTeacherReminders from '../../../hooks/useTeacherReminders'
import { useTeachingProfile } from '../../teacherSettings'
import { resolveActiveAssignment } from '../../../utils/plannedTeachingMeta.js'
import { buildGeneratorQueryString } from '../../../utils/useFormDefaultsFromUrl'
import ReminderPanel from '../../../components/teacher/ReminderPanel'
import { QUICK_CREATE } from '../../../components/teacher/teacherNav'
import { Bell, Plus, X } from '../../../shared/components/icons'
import Icon from '../../../shared/components/Icon'

export default function TeacherTopBar() {
  const { currentUser } = useAuth()

  const [bellOpen, setBellOpen] = useState(false)
  const [createOpen, setCreateOpen] = useState(false)

  // Seed the Create menu with the ACTIVE Teaching Profile assignment (the same
  // choice the dashboard persists) so each studio opens on the teacher's real
  // grade/subject/term instead of the generic default. Fail-open: with no
  // profile the query string is empty and the links behave exactly as before.
  const tp = useTeachingProfile()
  const createQuery = useMemo(() => {
    const uid = currentUser?.uid || null
    const active = tp.assignments.filter((a) => a.isActive)
    let storedId = ''
    try { storedId = uid ? (localStorage.getItem(`zedexams:prep-assignment:${uid}`) || '') : '' } catch { /* private mode */ }
    const assignment = resolveActiveAssignment(active, tp.effectiveDefaultId, storedId)
    if (!assignment) return ''
    const term = tp.context?.status === 'ok' ? tp.context.termNumber : null
    return buildGeneratorQueryString({ grade: assignment.grade, subject: assignment.subject, term })
  }, [currentUser?.uid, tp.assignments, tp.effectiveDefaultId, tp.context])

  const bellRef = useRef(null)
  const createRef = useRef(null)

  useClickAway(bellRef, () => setBellOpen(false))
  useClickAway(createRef, () => setCreateOpen(false))

  const { reminders, unreadCount } = useTeacherReminders(currentUser, { open: bellOpen })

  useEffect(() => {
    function onKey(e) {
      if (e.key === 'Escape') {
        setBellOpen(false); setCreateOpen(false)
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])

  // color-mix rather than the token straight: the bar is `backdrop-blur`, so it
  // has to stay translucent for the frost to show — but the literal this
  // replaces pinned that tint cream, which is the wrong colour on Night.
  return (
    <div
      className="lg:sticky lg:top-0 z-30 -mx-4 sm:-mx-6 px-4 sm:px-6 py-2.5 mb-4 hidden lg:flex items-center justify-end gap-2 backdrop-blur"
      style={{
        background: 'color-mix(in srgb, var(--zt-surface) 92%, transparent)',
        borderBottom: '1px solid var(--zt-line)',
      }}
    >
      {/* Notifications — desktop only (mobile/tablet use Alerts in TeacherGlassHeader) */}
      <div ref={bellRef} className="relative flex-shrink-0 hidden lg:block">
        <button
          type="button"
          onClick={() => { setBellOpen(o => !o); setCreateOpen(false) }}
          aria-label={`Notifications${unreadCount ? `, ${unreadCount} new` : ''}`}
          aria-expanded={bellOpen}
          className="relative flex items-center justify-center rounded-xl border-2 transition-colors"
          style={{ background: 'var(--zt-card)', borderColor: 'var(--zt-card-border)', width: 40, height: 40 }}
        >
          <Icon as={Bell} size="sm" />
          {unreadCount > 0 && (
            <span
              className="absolute -top-1.5 -right-1.5 flex items-center justify-center rounded-full text-[10px] font-black"
              style={{ background: 'var(--zt-accent)', color: 'var(--zt-on-accent)', minWidth: 18, height: 18, padding: '0 5px', border: '2px solid var(--zt-card)' }}
            >
              {unreadCount}
            </span>
          )}
        </button>
        {bellOpen && (
          <ReminderPanel
            reminders={reminders}
            onNavigate={() => setBellOpen(false)}
            className="absolute right-0 mt-2 w-80 z-50"
          />
        )}
      </div>

      {/* Quick Create */}
      <div ref={createRef} className="relative flex-shrink-0">
        <button
          type="button"
          onClick={() => { setCreateOpen(o => !o); setBellOpen(false) }}
          aria-label="Quick create"
          aria-expanded={createOpen}
          className="flex items-center gap-1.5 rounded-xl font-bold transition-colors"
          style={{ background: 'var(--zt-accent)', color: 'var(--zt-on-accent)', padding: '0 14px', height: 40, fontSize: 13.5 }}
          onMouseEnter={e => { e.currentTarget.style.background = 'var(--zt-accent-deep)' }}
          onMouseLeave={e => { e.currentTarget.style.background = 'var(--zt-accent)' }}
        >
          <Icon as={createOpen ? X : Plus} size="sm" />
          <span className="hidden sm:inline">Create</span>
        </button>
        {createOpen && (
          <div
            className="absolute right-0 mt-2 w-64 rounded-xl border-2 shadow-elev-xl overflow-hidden"
            style={{ background: 'var(--zt-card)', borderColor: 'var(--zt-card-border)' }}
          >
            <div className="px-4 py-3 border-b" style={{ borderColor: 'var(--zt-line)' }}>
              <p className="text-xs font-black uppercase tracking-wider" style={{ color: 'var(--zt-accent-text)' }}>
                Quick create
              </p>
            </div>
            <ul>
              {QUICK_CREATE.map((item) => (
                <li key={item.to}>
                  <Link
                    to={`${item.to}${createQuery}`}
                    onClick={() => setCreateOpen(false)}
                    className="flex items-center gap-3 px-4 py-2.5 no-underline hover:bg-[var(--zt-surface)] transition-colors"
                  >
                    <span
                      style={{ width: 32, height: 32, borderRadius: 9, background: item.accent, display: 'grid', placeItems: 'center', flexShrink: 0 }}
                    >
                      <Icon as={item.icon} size="sm" />
                    </span>
                    <span className="text-sm font-bold" style={{ color: 'var(--zt-text)' }}>{item.label}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  )
}
