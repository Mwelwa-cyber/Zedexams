/**
 * GenerateFromTopicMenu — inline action that turns a KB topic into a
 * queued agent brief. Mounted on each row of the CBC KB admin so an
 * admin can one-click ask Aria/Cala/Reva to draft a lesson plan,
 * worksheet, flashcards, rubric, scheme of work, or notes against the
 * topic's verified grade/subject/topic/subtopic fields — without
 * leaving the KB page or retyping anything.
 *
 * The created agentJobs doc lands in the same pipeline the dashboard
 * tracks at /admin/agents. After Aria → Cala → Reva run the doc lands
 * at awaiting_approval; the admin reviews and approves in
 * /admin/agents/jobs/{id}.
 */

import { useEffect, useRef, useState } from 'react'
import { addDoc, collection, serverTimestamp } from 'firebase/firestore'
import { useNavigate } from 'react-router-dom'
import { db } from '../../firebase/config'
import { useAuth } from '../../contexts/AuthContext'

// Tools the Aria → Cala → Reva pipeline supports (see
// functions/agents/runners/aria.js RUNNERS map). Quiz is intentionally
// not in this list — it's a synchronous studio (no agent pipeline) and
// gets its own button at the bottom of the popover that opens the
// QuizStudio with the topic pre-filled via URL params.
const TOOLS = [
  { key: 'lesson_plan',    label: 'Lesson Plan',    icon: '🦊', hint: 'Single-period CBC lesson plan' },
  { key: 'worksheet',      label: 'Worksheet',      icon: '🐢', hint: 'Pupil practice activities' },
  { key: 'flashcards',     label: 'Flashcards',     icon: '🎴', hint: 'Revision cards for the topic' },
  { key: 'notes',          label: 'Teacher Notes',  icon: '🦉', hint: 'Delivery notes from the plan' },
  { key: 'rubric',         label: 'Rubric',         icon: '📋', hint: 'Marking guide with levels' },
  { key: 'scheme_of_work', label: 'Scheme of Work', icon: '🦁', hint: 'Term pacing (whole subject)' },
]

function firstSubtopicName(subtopics) {
  if (!Array.isArray(subtopics) || subtopics.length === 0) return ''
  const first = subtopics[0]
  if (typeof first === 'string') return first
  if (first && typeof first === 'object') return first.name || ''
  return ''
}

export default function GenerateFromTopicMenu({ topic }) {
  const { currentUser } = useAuth()
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const popoverRef = useRef(null)

  useEffect(() => {
    if (!open) return undefined
    function onClick(e) {
      if (popoverRef.current && !popoverRef.current.contains(e.target)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [open])

  async function fire(toolKey) {
    if (!currentUser?.uid) {
      setError('Sign in to queue an agent job.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const subtopic = firstSubtopicName(topic.subtopics)
      const payload = {
        agentId: 'aria',
        department: 'content',
        status: 'queued',
        input: {
          tool: toolKey,
          grade: topic.grade,
          subject: topic.subject,
          topic: topic.topic,
          ...(subtopic ? { subtopic } : {}),
          term: Number.isInteger(topic.term) ? topic.term : 1,
          ...(toolKey === 'lesson_plan' ? { duration: 40 } : {}),
          brief: `Generate from the verified KB entry for ${topic.grade} ${topic.subject} — ${topic.topic}.`,
        },
        createdBy: currentUser.uid,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        origin: 'cbcKbAdmin',
      }
      const ref = await addDoc(collection(db, 'agentJobs'), payload)
      setOpen(false)
      navigate(`/admin/agents/jobs/${ref.id}`)
    } catch (e) {
      setError(e?.message || 'Failed to queue job.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="relative inline-block" ref={popoverRef}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="text-violet-700 hover:underline font-bold disabled:opacity-50"
        disabled={busy}
      >
        ✨ generate
      </button>
      {open && (
        <div className="absolute z-30 mt-2 w-64 rounded-2xl border-2 border-violet-200 bg-white p-2 shadow-xl">
          <p className="px-2 pt-1 pb-2 text-[10px] font-black uppercase tracking-wider text-violet-700">
            Draft via agents (Aria → Cala → Reva)
          </p>
          <ul className="space-y-0.5">
            {TOOLS.map((t) => (
              <li key={t.key}>
                <button
                  type="button"
                  onClick={() => fire(t.key)}
                  disabled={busy}
                  className="flex w-full items-start gap-2 rounded-xl px-2.5 py-2 text-left text-xs hover:bg-violet-50 disabled:opacity-50"
                >
                  <span className="text-lg leading-none mt-0.5" aria-hidden>{t.icon}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block font-black text-slate-800">{t.label}</span>
                    <span className="block text-[11px] text-slate-500">{t.hint}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
          {error && (
            <p className="mt-2 rounded-lg bg-rose-50 px-2 py-1.5 text-[11px] text-rose-700">
              {error}
            </p>
          )}
          <p className="mt-2 px-2 pt-1 text-[10px] text-slate-400">
            Lands in <code>/admin/agents</code> for review.
          </p>

          <div className="mt-2 border-t-2 border-dashed border-slate-200 pt-2">
            <p className="px-2 pb-1 text-[10px] font-black uppercase tracking-wider text-sky-700">
              Or use the synchronous studios
            </p>
            <button
              type="button"
              onClick={() => {
                const params = new URLSearchParams({
                  grade: topic.grade,
                  subject: topic.subject,
                  topic: topic.topic,
                })
                const sub = firstSubtopicName(topic.subtopics)
                if (sub) params.set('subtopic', sub)
                if (Number.isInteger(topic.term)) params.set('term', String(topic.term))
                navigate(`/teacher/generate/quiz?${params.toString()}`)
              }}
              className="flex w-full items-start gap-2 rounded-xl px-2.5 py-2 text-left text-xs hover:bg-sky-50"
            >
              <span className="text-lg leading-none mt-0.5" aria-hidden>✏️</span>
              <span className="min-w-0 flex-1">
                <span className="block font-black text-slate-800">Quiz</span>
                <span className="block text-[11px] text-slate-500">
                  Opens Quiz Studio with the topic pre-filled — instant draft, edit, then publish
                </span>
              </span>
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
