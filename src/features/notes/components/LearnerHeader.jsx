// src/features/notes/components/LearnerHeader.jsx
//
// Shared header shown across /notes pages.
// Displays brand mark, grade + first name, and a sign-out option.
// Sign-out routes through AuthContext so the rest of the app sees it.

import { useNavigate } from 'react-router-dom'
import { BookOpen, LogOut } from '../../../components/ui/icons'
import { useAuth } from '../../../contexts/AuthContext'

export function LearnerHeader({ user, profile }) {
  const navigate = useNavigate()
  const { logout } = useAuth()

  const handleSignOut = async () => {
    try {
      await logout()
      navigate('/login')
    } catch (err) {
      console.error(err)
    }
  }

  const initial = (user?.displayName || user?.email || '?').charAt(0).toUpperCase()
  const first = user?.displayName?.split(' ')[0] || user?.email?.split('@')[0] || 'Learner'

  return (
    <header className="border-b border-neutral-100 bg-white sticky top-0 z-10">
      <div className="max-w-5xl mx-auto px-5 py-3.5 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ backgroundColor: '#059669' }}>
            <BookOpen size={16} className="text-white" strokeWidth={2.5} />
          </div>
          <div>
            <div className="font-display text-[19px] leading-none text-neutral-900">
              ZedExams <span className="font-display-italic text-neutral-500">Notes</span>
            </div>
            <div className="text-[10px] tracking-[0.15em] uppercase text-neutral-400 mt-0.5">
              Grade {profile?.grade} · {first}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleSignOut}
            className="p-2 rounded-lg hover:bg-neutral-100 transition text-neutral-500"
            title="Sign out"
          >
            <LogOut size={16} />
          </button>
          <div
            className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-semibold text-white"
            style={{ backgroundColor: '#7C3AED' }}
          >
            {initial}
          </div>
        </div>
      </div>
    </header>
  )
}
