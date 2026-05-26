/**
 * BulkGenerateButton — fires one agent brief per topic in the current
 * KB filter, capped at MAX_BATCH so a runaway click can't exhaust the
 * caller's daily AI quota. Each brief lands in agentJobs as a queued
 * Aria → Cala → Reva chain that the admin reviews in /admin/agents.
 *
 * Surfaces in the CBC KB header next to "Add topic". Hidden when the
 * filtered list is empty, so a careless admin can't fire briefs against
 * zero topics.
 */

import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { addDoc, collection, serverTimestamp } from 'firebase/firestore'
import { db } from '../../firebase/config'
import { useAuth } from '../../contexts/AuthContext'

const MAX_BATCH = 20

const TOOLS = [
  { key: 'lesson_plan', label: 'Lesson plans' },
  { key: 'worksheet',   label: 'Worksheets' },
  { key: 'notes',       label: 'Teacher notes' },
  { key: 'flashcards',  label: 'Flashcards' },
  { key: 'rubric',      label: 'Rubrics' },
]

function firstSubtopicName(subtopics) {
  if (!Array.isArray(subtopics) || subtopics.length === 0) return ''
  const first = subtopics[0]
  if (typeof first === 'string') return first
  if (first && typeof first === 'object') return first.name || ''
  return ''
}

export default function BulkGenerateButton({ topics }) {
  const { currentUser } = useAuth()
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const [tool, setTool] = useState('lesson_plan')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [progress, setProgress] = useState({ done: 0, total: 0 })

  const eligible = Array.isArray(topics) ?
    topics.filter((t) => t && t.grade && t.subject && t.topic) : []
  const count = Math.min(eligible.length, MAX_BATCH)

  async function handleRun() {
    if (!currentUser?.uid || count === 0) return
    setBusy(true)
    setError(null)
    setProgress({ done: 0, total: count })
    const slice = eligible.slice(0, count)
    let firstJobId = null
    for (let i = 0; i < slice.length; i++) {
      const t = slice[i]
      try {
        const subtopic = firstSubtopicName(t.subtopics)
        const ref = await addDoc(collection(db, 'agentJobs'), {
          agentId: 'aria',
          department: 'content',
          status: 'queued',
          input: {
            tool,
            grade: t.grade,
            subject: t.subject,
            topic: t.topic,
            ...(subtopic ? { subtopic } : {}),
            term: Number.isInteger(t.term) ? t.term : 1,
            ...(tool === 'lesson_plan' ? { duration: 40 } : {}),
            brief: `Bulk-generate for verified KB entry: ${t.grade} ${t.subject} — ${t.topic}.`,
          },
          createdBy: currentUser.uid,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
          origin: 'cbcKbAdmin.bulk',
        })
        if (!firstJobId) firstJobId = ref.id
        setProgress({ done: i + 1, total: count })
      } catch (e) {
        setError(`Stopped at ${i + 1}/${count}: ${e?.message || 'unknown error'}`)
        setBusy(false)
        return
      }
    }
    setBusy(false)
    setOpen(false)
    navigate(firstJobId ? `/admin/agents/jobs/${firstJobId}` : '/admin/agents/jobs')
  }

  if (eligible.length === 0) return null

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="px-4 py-2 rounded-xl text-sm font-black text-white bg-gradient-to-r from-violet-600 to-fuchsia-600 disabled:opacity-50"
        title="Queue agent briefs against every topic currently visible"
      >
        ✨ Bulk generate ({count})
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md rounded-2xl bg-white p-5 shadow-2xl">
            <h3 className="font-black text-lg text-slate-900">Bulk generate</h3>
            <p className="text-xs text-slate-600 mt-1">
              Queues one agent brief per filtered topic — capped at {MAX_BATCH} to keep within your daily AI quota.
            </p>

            <label className="mt-4 block text-xs font-black uppercase tracking-wider text-slate-500">
              What to draft
            </label>
            <div className="mt-2 grid grid-cols-2 gap-2">
              {TOOLS.map((t) => (
                <button
                  key={t.key}
                  type="button"
                  onClick={() => setTool(t.key)}
                  disabled={busy}
                  className={`rounded-xl border-2 px-3 py-2 text-xs font-black transition-colors ${
                    tool === t.key
                      ? 'border-violet-500 bg-violet-50 text-violet-900'
                      : 'border-slate-200 bg-white text-slate-700 hover:border-violet-300'
                  } disabled:opacity-50`}
                >
                  {t.label}
                </button>
              ))}
            </div>

            <div className="mt-4 rounded-xl bg-violet-50 px-3 py-2 text-xs text-violet-900">
              <p className="font-black">{count} brief{count === 1 ? '' : 's'} will be queued</p>
              <p className="mt-0.5 text-violet-700">
                Each fires Aria → Cala → Reva and stops at <code>awaiting_approval</code>. Nothing publishes until you approve in /admin/agents.
              </p>
            </div>

            {busy && (
              <div className="mt-3 rounded-xl bg-slate-100 px-3 py-2 text-xs text-slate-700">
                Queuing {progress.done} / {progress.total}…
              </div>
            )}
            {error && (
              <p className="mt-3 rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-700">
                {error}
              </p>
            )}

            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => { if (!busy) setOpen(false) }}
                disabled={busy}
                className="px-3 py-2 rounded-xl text-xs font-black text-slate-600 hover:text-slate-800 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleRun}
                disabled={busy || count === 0}
                className="px-4 py-2 rounded-xl text-xs font-black text-white bg-violet-600 hover:bg-violet-700 disabled:opacity-50"
              >
                {busy ? 'Queuing…' : `Queue ${count} brief${count === 1 ? '' : 's'}`}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
