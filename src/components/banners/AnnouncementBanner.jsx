import { useEffect, useState } from 'react'
import { collection, onSnapshot, query, where } from 'firebase/firestore'
import { db } from '../../firebase/config'
import { useAuth } from '../../contexts/AuthContext'

const SEVERITY_STYLE = {
  info:    { background: '#dbeafe', color: '#1e3a8a' },
  warn:    { background: '#fde68a', color: '#78350f' },
  success: { background: '#d1fae5', color: '#065f46' },
}

const AUDIENCE_BY_ROLE = {
  admin: ['all', 'admins'],
  teacher: ['all', 'teachers'],
  learner: ['all', 'learners'],
  student: ['all', 'learners'],
}

export default function AnnouncementBanner() {
  const { userProfile } = useAuth()
  const [items, setItems] = useState([])
  const [dismissed, setDismissed] = useState(() => {
    try { return JSON.parse(sessionStorage.getItem('zedAnnouncementsDismissed') || '{}') } catch { return {} }
  })

  useEffect(() => {
    // Listen to all active announcements — Firestore rules allow public reads
    // (or for any signed-in user). We filter audience client-side because
    // the matching audience depends on the viewer's role which may change.
    const unsub = onSnapshot(
      query(collection(db, 'announcements'), where('active', '==', true)),
      snap => setItems(snap.docs.map(d => ({ id: d.id, ...d.data() }))),
      err => { console.warn('announcement subscribe:', err) },
    )
    return () => unsub()
  }, [])

  function dismiss(id) {
    const next = { ...dismissed, [id]: true }
    setDismissed(next)
    try { sessionStorage.setItem('zedAnnouncementsDismissed', JSON.stringify(next)) } catch { /* noop */ }
  }

  const audience = userProfile?.role ? AUDIENCE_BY_ROLE[userProfile.role] || ['all'] : ['all']
  const visible = items
    .filter(it => audience.includes(it.audience || 'all'))
    .filter(it => !dismissed[it.id])

  if (visible.length === 0) return null

  return (
    <div className="w-full">
      {visible.slice(0, 2).map(it => {
        const style = SEVERITY_STYLE[it.severity] || SEVERITY_STYLE.info
        return (
          <div key={it.id} className="w-full px-4 py-2 text-sm font-bold flex items-center justify-between gap-3" style={style}>
            <div className="flex-1 min-w-0">
              <span className="font-black">{it.title}</span>
              {it.body && <span className="ml-2 opacity-90">{it.body}</span>}
            </div>
            <button
              type="button"
              onClick={() => dismiss(it.id)}
              className="text-xs underline opacity-70 hover:opacity-100"
              aria-label="Dismiss announcement"
            >
              Dismiss
            </button>
          </div>
        )
      })}
    </div>
  )
}
