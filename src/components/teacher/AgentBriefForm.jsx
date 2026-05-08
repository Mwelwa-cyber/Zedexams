import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import {
  addDoc, collection, serverTimestamp,
} from 'firebase/firestore'
import { db } from '../../firebase/config'
import { useAuth } from '../../contexts/AuthContext'
import SeoHelmet from '../seo/SeoHelmet'
import Button from '../ui/Button'

// Mirrors functions/agents/runners/aria.js SUPPORTED_TOOLS — keep in sync.
const TOOLS = [
  { id: 'lesson_plan',    label: 'Lesson plan'    },
  { id: 'worksheet',      label: 'Worksheet'      },
  { id: 'flashcards',     label: 'Flashcards'     },
  { id: 'rubric',         label: 'Rubric'         },
  { id: 'scheme_of_work', label: 'Scheme of work' },
  { id: 'notes',          label: 'Lesson notes'   },
]

const GRADES = ['4', '5', '6', '7', '8', '9', '10', '11', '12']
const TERMS  = ['1', '2', '3']

export default function AgentBriefForm() {
  const { currentUser } = useAuth()
  const navigate = useNavigate()
  const [busy, setBusy]   = useState(false)
  const [err, setErr]     = useState(null)

  const [tool, setTool]       = useState('lesson_plan')
  const [grade, setGrade]     = useState('6')
  const [subject, setSubject] = useState('')
  const [topic, setTopic]     = useState('')
  const [subtopic, setSubtopic] = useState('')
  const [term, setTerm]       = useState('2')
  const [duration, setDuration] = useState('40')
  const [brief, setBrief]     = useState('')

  function validate() {
    if (!subject.trim()) return 'Add a subject.'
    if (!topic.trim()) return 'Add a topic.'
    if (subject.length > 80) return 'Subject is too long (80 chars max).'
    if (topic.length > 200) return 'Topic is too long (200 chars max).'
    if (brief.length > 4000) return 'Brief is too long (4000 chars max).'
    return null
  }

  async function handleSubmit(e) {
    e.preventDefault()
    setErr(null)
    const validation = validate()
    if (validation) { setErr(validation); return }
    setBusy(true)
    try {
      const input = {
        tool,
        grade: `G${grade}`,
        subject: subject.trim(),
        topic: topic.trim(),
        ...(subtopic.trim() ? { subtopic: subtopic.trim() } : {}),
        term: Number(term),
        ...(tool === 'lesson_plan'
          ? { durationMinutes: Number(duration) || 40 }
          : {}),
        ...(brief.trim() ? { brief: brief.trim() } : {}),
      }
      const ref = await addDoc(collection(db, 'agentJobs'), {
        agentId: 'aria',
        department: 'content',
        status: 'queued',
        input,
        createdBy: currentUser.uid,
        createdAt: serverTimestamp(),
      })
      navigate(`/teacher/agents/${ref.id}`)
    } catch (e) {
      console.error('Submit brief failed', e)
      setErr(e?.message || 'Something went wrong. Please try again.')
      setBusy(false)
    }
  }

  return (
    <div className="space-y-5 max-w-2xl">
      <SeoHelmet title="Submit brief to agents" noIndex />

      <header>
        <Link to="/teacher/agents" className="text-xs theme-text-muted hover:underline">
          ← Back to my submissions
        </Link>
        <h1 className="mt-1 text-2xl font-black text-gray-800">Submit a brief</h1>
        <p className="text-sm theme-text-muted mt-0.5">
          Aria drafts your CBC-aligned artifact, Cala verifies the syllabus
          alignment, and Reva reviews pedagogy. An admin reviews the draft
          before it's published.
        </p>
      </header>

      <form onSubmit={handleSubmit} className="theme-card theme-border space-y-4 rounded-2xl border p-5">
        {/* Tool */}
        <div>
          <label className="block text-xs font-black uppercase tracking-wide text-gray-500 mb-1">Artifact</label>
          <div className="grid grid-cols-2 gap-2">
            {TOOLS.map(t => (
              <button
                key={t.id}
                type="button"
                onClick={() => setTool(t.id)}
                className={`rounded-xl border px-3 py-2 text-sm font-bold transition-colors ${
                  tool === t.id
                    ? 'theme-accent-bg theme-accent-text border-current'
                    : 'theme-border theme-text-muted hover:theme-bg-subtle'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>

        {/* Grade / Subject / Term */}
        <div className="grid grid-cols-3 gap-3">
          <div>
            <label className="block text-xs font-black uppercase tracking-wide text-gray-500 mb-1">Grade</label>
            <select
              value={grade}
              onChange={e => setGrade(e.target.value)}
              className="w-full theme-border rounded-lg border px-3 py-2 text-sm bg-white"
            >
              {GRADES.map(g => <option key={g} value={g}>Grade {g}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-black uppercase tracking-wide text-gray-500 mb-1">Term</label>
            <select
              value={term}
              onChange={e => setTerm(e.target.value)}
              className="w-full theme-border rounded-lg border px-3 py-2 text-sm bg-white"
            >
              {TERMS.map(t => <option key={t} value={t}>Term {t}</option>)}
            </select>
          </div>
          {tool === 'lesson_plan' && (
            <div>
              <label className="block text-xs font-black uppercase tracking-wide text-gray-500 mb-1">Duration (min)</label>
              <input
                type="number"
                min="10"
                max="120"
                value={duration}
                onChange={e => setDuration(e.target.value)}
                className="w-full theme-border rounded-lg border px-3 py-2 text-sm bg-white"
              />
            </div>
          )}
        </div>

        <div>
          <label className="block text-xs font-black uppercase tracking-wide text-gray-500 mb-1">Subject</label>
          <input
            value={subject}
            onChange={e => setSubject(e.target.value)}
            placeholder="e.g. Mathematics, Integrated Science, English"
            className="w-full theme-border rounded-lg border px-3 py-2 text-sm bg-white"
          />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-black uppercase tracking-wide text-gray-500 mb-1">Topic</label>
            <input
              value={topic}
              onChange={e => setTopic(e.target.value)}
              placeholder="e.g. Adding fractions"
              className="w-full theme-border rounded-lg border px-3 py-2 text-sm bg-white"
            />
          </div>
          <div>
            <label className="block text-xs font-black uppercase tracking-wide text-gray-500 mb-1">
              Subtopic <span className="font-normal lowercase text-gray-400">(optional)</span>
            </label>
            <input
              value={subtopic}
              onChange={e => setSubtopic(e.target.value)}
              placeholder="e.g. Unlike denominators"
              className="w-full theme-border rounded-lg border px-3 py-2 text-sm bg-white"
            />
          </div>
        </div>

        <div>
          <label className="block text-xs font-black uppercase tracking-wide text-gray-500 mb-1">
            Brief <span className="font-normal lowercase text-gray-400">(optional)</span>
          </label>
          <textarea
            value={brief}
            onChange={e => setBrief(e.target.value)}
            placeholder="Anything specific the agents should know — class size, prior knowledge, materials available, learners with EAL needs, etc."
            rows={4}
            className="w-full theme-border rounded-lg border px-3 py-2 text-sm bg-white resize-none"
          />
        </div>

        {err && (
          <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-700">{err}</div>
        )}

        <div className="flex gap-2">
          <Button type="submit" variant="primary" size="md" disabled={busy} className="flex-1">
            {busy ? 'Submitting…' : 'Submit to agents'}
          </Button>
          <Link to="/teacher/agents" className="theme-border theme-text-muted rounded-xl border px-4 py-2 text-sm font-bold hover:theme-bg-subtle">
            Cancel
          </Link>
        </div>
      </form>

      <p className="text-xs theme-text-muted">
        Submissions count toward your monthly tool quota even if rejected.
        See <Link to="/teacher" className="underline">My Dashboard</Link> for current usage.
      </p>
    </div>
  )
}
