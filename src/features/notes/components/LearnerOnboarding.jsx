// src/features/notes/components/LearnerOnboarding.jsx
//
// Shown the first time a signed-in user lands on /notes without a grade
// on their Firestore profile. Captures the grade and writes it via
// AuthContext's `updateLearnerGrade` (which also updates the local profile
// state, flipping the gate to 'ready' on the next render).
//
// Inactive grades (7-12) are visible but disabled — they signal the roadmap.

import { useState } from 'react'
import { GraduationCap, Lock, BookOpen } from '../../../shared/components/icons'
import { useAuth } from '../../../contexts/AuthContext'
import { ALL_GRADES, BAND_LABELS } from '../../../config/curriculum'
import { friendlyMessage } from '../../../utils/friendlyErrors'
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
      setError(friendlyMessage(err, 'Could not save your grade. Try again.'))
      setBusy(false)
    }
  }

  return (
    <div className="notes-studio note-page-cream min-h-screen flex items-center justify-center px-5 py-10">
      <div className="max-w-md w-full">
        <div className="text-center mb-8">
          <div className="w-12 h-12 rounded-2xl mx-auto mb-4 flex items-center justify-center border-2 border-[#0F1B2D]" style={{ backgroundColor: '#D97757', boxShadow: '0 2px 0 #0F1B2D' }}>
            <BookOpen size={20} className="text-white" strokeWidth={2.5} />
          </div>
          <div className="text-[10.5px] font-extrabold tracking-[0.16em] uppercase text-[#053541] mb-2">Welcome to ZedExams Notes</div>
          <h1 className="font-display text-4xl tracking-tight text-[#0F1B2D] mb-3">
            Hi {firstName(user)}, <span className="font-display-italic">pick your grade</span>
          </h1>
          <p className="text-sm text-[#4A5A6E] max-w-sm mx-auto">
            We'll show you only the notes for your grade. You can change this later from your profile.
          </p>
        </div>

        <div className="notes-card p-5">
          <div className="text-[10px] tracking-[0.15em] uppercase text-[#4A5A6E] mb-3 inline-flex items-center gap-1.5">
            <GraduationCap size={12} /> Active grades · {BAND_LABELS.primary}
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

          <div className="text-[10px] tracking-[0.15em] uppercase text-[#4A5A6E] mb-3 inline-flex items-center gap-1.5">
            <Lock size={12} /> Coming soon · {BAND_LABELS.junior_secondary} & {BAND_LABELS.senior_secondary}
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
          className="notes-chip notes-chip-shadow w-full mt-5 py-3 rounded-xl text-white text-sm font-bold transition enabled:hover:-translate-y-px disabled:opacity-40 disabled:cursor-not-allowed inline-flex items-center justify-center gap-2"
          style={{ backgroundColor: '#0F1B2D' }}
        >
          {busy ? (
            <><span className="zx-spin" aria-hidden="true" /> Saving…</>
          ) : (
            <>Continue to my notes</>
          )}
        </button>

        <p className="text-xs text-[#4A5A6E] text-center mt-4">
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
        className="text-center py-3 rounded-xl border-2 border-dashed border-[#D8D0BC] text-[#4A5A6E]/70 cursor-not-allowed"
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
      className={`notes-chip text-center py-3 rounded-xl ${
        selected
          ? 'bg-[#0F1B2D] text-white notes-chip-shadow'
          : 'bg-white text-[#0F1B2D] hover:-translate-y-px hover:notes-chip-shadow'
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
