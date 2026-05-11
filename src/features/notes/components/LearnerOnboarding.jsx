// src/features/notes/components/LearnerOnboarding.jsx
//
// Shown the first time a signed-in user lands on /notes without a grade
// on their Firestore profile. Captures the grade and writes it via
// AuthContext's `updateLearnerGrade` (which also updates the local profile
// state, flipping the gate to 'ready' on the next render).
//
// Inactive grades (7-12) are visible but disabled — they signal the roadmap.

import { useState } from 'react'
import { GraduationCap, Lock, Loader2, BookOpen } from '../../../components/ui/icons'
import { useAuth } from '../../../contexts/AuthContext'
import { ALL_GRADES } from '../../../config/curriculum'
import '../styles/notes.css'

export function LearnerOnboarding({ user, onDone }) {
  const { updateLearnerGrade } = useAuth()
  const [grade, setGrade] = useState(null)
  const [busy, setBusy]   = useState(false)
  const [error, setError] = useState(null)

  const handleSubmit = async () => {
    if (!grade || busy) return
    setBusy(true)
    setError(null)
    try {
      await updateLearnerGrade(grade)
      onDone?.()
    } catch (err) {
      console.error(err)
      setError(err.message || 'Could not save your grade. Try again.')
      setBusy(false)
    }
  }

  return (
    <div className="notes-studio min-h-screen flex items-center justify-center px-5 py-10" style={{ backgroundColor: '#FAFAF7' }}>
      <div className="max-w-md w-full">
        <div className="text-center mb-8">
          <div className="w-12 h-12 rounded-2xl mx-auto mb-4 flex items-center justify-center" style={{ backgroundColor: '#059669' }}>
            <BookOpen size={20} className="text-white" strokeWidth={2.5} />
          </div>
          <div className="text-xs tracking-[0.2em] uppercase text-neutral-500 mb-2">Welcome to ZedExams Notes</div>
          <h1 className="font-display text-4xl tracking-tight text-neutral-900 mb-3">
            Hi {firstName(user)}, <span className="font-display-italic">pick your grade</span>
          </h1>
          <p className="text-sm text-neutral-600 max-w-sm mx-auto">
            We'll show you only the notes for your grade. You can change this later from your profile.
          </p>
        </div>

        <div className="bg-white rounded-2xl border border-neutral-200 p-5">
          <div className="text-[10px] tracking-[0.15em] uppercase text-neutral-500 mb-3 inline-flex items-center gap-1.5">
            <GraduationCap size={12} /> Active grades
          </div>
          <div className="grid grid-cols-2 gap-2 mb-5">
            {ALL_GRADES.filter(g => g.active).map(g => (
              <GradeButton
                key={g.value}
                grade={g.value}
                selected={grade === g.value}
                onClick={() => setGrade(g.value)}
              />
            ))}
          </div>

          <div className="text-[10px] tracking-[0.15em] uppercase text-neutral-500 mb-3 inline-flex items-center gap-1.5">
            <Lock size={12} /> Coming soon
          </div>
          <div className="grid grid-cols-3 gap-2 mb-2">
            {ALL_GRADES.filter(g => !g.active).map(g => (
              <GradeButton
                key={g.value}
                grade={g.value}
                disabled
              />
            ))}
          </div>
        </div>

        {error && (
          <div className="mt-4 p-3 rounded-lg bg-red-50 text-red-700 text-sm">
            {error}
          </div>
        )}

        <button
          onClick={handleSubmit}
          disabled={!grade || busy}
          className="w-full mt-5 py-3 rounded-full text-white text-sm font-medium transition hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed inline-flex items-center justify-center gap-2"
          style={{ backgroundColor: '#0a0a0a' }}
        >
          {busy ? (
            <><Loader2 size={15} className="animate-spin" /> Saving…</>
          ) : (
            <>Continue to my notes</>
          )}
        </button>

        <p className="text-xs text-neutral-400 text-center mt-4">
          Signed in as {user?.email}
        </p>
      </div>
    </div>
  )
}

function GradeButton({ grade, selected, disabled, onClick }) {
  if (disabled) {
    return (
      <button
        type="button"
        disabled
        aria-disabled="true"
        aria-label={`Grade ${grade} — coming soon`}
        title="Coming soon"
        className="text-center py-3 rounded-lg border border-dashed border-neutral-200 text-neutral-400 cursor-not-allowed"
      >
        <div className="text-[10px] uppercase tracking-wider">Grade</div>
        <div className="font-display text-2xl">{grade}</div>
      </button>
    )
  }
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      className={`text-center py-3 rounded-lg border transition ${
        selected
          ? 'border-neutral-900 bg-neutral-900 text-white shadow-sm'
          : 'border-neutral-200 text-neutral-700 hover:border-neutral-400'
      }`}
    >
      <div className={`text-[10px] uppercase tracking-wider ${selected ? 'opacity-80' : 'opacity-60'}`}>Grade</div>
      <div className="font-display text-2xl">{grade}</div>
    </button>
  )
}

function firstName(user) {
  if (user?.displayName) return user.displayName.split(' ')[0]
  if (user?.email)       return user.email.split('@')[0]
  return 'there'
}
