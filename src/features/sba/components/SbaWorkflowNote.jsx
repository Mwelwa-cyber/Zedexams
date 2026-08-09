/**
 * SbaWorkflowNote — a brief, dismissible explainer shown at the top of the
 * three SBA surfaces (Studio, Mark Tracker, Year Planner). It orients a teacher
 * new to School Based Assessment: the ECZ essentials and the three-step
 * workflow, with the current step highlighted ("You're here").
 *
 * Dismissal is remembered in localStorage so it shows once, not on every visit.
 *
 * @param {{ current?: 'studio' | 'tracker' | 'planner' }} props
 */

import { useState } from 'react'
import { Link } from 'react-router-dom'

const STORAGE_KEY = 'examprep:sba:workflow-note-dismissed'

export const SBA_WORKFLOW_STEPS = [
  {
    id: 'studio',
    emoji: '🏫',
    title: 'Create tasks',
    tool: 'SBA Studio',
    to: '/teacher/generate/sba',
    desc: 'Generate ECZ-compliant SBA tasks — the right task type, Bloom level and marking scheme per subject. Never multiple-choice.',
    how: [
      'Pick the grade, subject and task type — the form only offers ECZ-valid SBA task types (never multiple-choice).',
      'Optionally set a Bloom level, term and syllabus topic, then tap “Generate SBA task”.',
      'Check the task and its marking scheme, then download a learner copy and a teacher (marking) copy as PDF or Word.',
    ],
  },
  {
    id: 'tracker',
    emoji: '🧮',
    title: 'Record marks',
    tool: 'SBA Mark Tracker',
    to: '/teacher/generate/sba-tracker',
    desc: 'Enter each pupil’s task marks; the 10%-per-grade SBA mark is converted for you, ready for the ECZ OMES portal.',
    how: [
      'Choose the grade and subject — the official ECZ task blueprint loads automatically as the mark columns.',
      'Type each pupil’s raw mark per task; the running total converts to the mark out of 10 (their 10% for the grade) as you go.',
      'Export the mark sheet to Excel or Word for your records and the ECZ OMES portal.',
    ],
  },
  {
    id: 'planner',
    emoji: '🗂️',
    title: 'Track coverage',
    tool: 'SBA Year Planner',
    to: '/teacher/generate/sba-planner',
    desc: 'Tick every required task from Planned → Administered → Marked, so nothing is missed or over-assessed.',
    how: [
      'Pick the grade and subject to see every task the ECZ requires across the year.',
      'Move each task through Planned → Administered → Marked so nothing is missed or double-counted.',
      'Download the plan to share with your HOD or keep as evidence of coverage.',
    ],
  },
]

function readDismissed() {
  try { return localStorage.getItem(STORAGE_KEY) === '1' } catch { return false }
}

export default function SbaWorkflowNote({ current }) {
  const [dismissed, setDismissed] = useState(readDismissed)
  if (dismissed) return null

  function dismiss() {
    try { localStorage.setItem(STORAGE_KEY, '1') } catch { /* private mode — just hide for this view */ }
    setDismissed(true)
  }

  return (
    <section
      aria-label="How School Based Assessment works"
      className="studio-card p-4 sm:p-5 mb-4 border-l-4"
      style={{ borderLeftColor: '#0e7490' }}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-black theme-text">New to SBA? Here’s the workflow</h2>
          <p className="text-xs mt-1" style={{ color: 'var(--zt-text-muted)' }}>
            School Based Assessment runs across <strong>Grades 5–7</strong> and is <strong>30% of the final Grade 7 mark</strong>
            {' '}— 10% banked per grade. Tasks come from the syllabus, are <strong>never multiple-choice</strong>, and the marked
            evidence must be kept for ECZ verification.
          </p>
        </div>
        <button
          type="button"
          onClick={dismiss}
          className="studio-btn-ghost text-xs whitespace-nowrap"
          aria-label="Dismiss the SBA workflow note"
        >
          Got it
        </button>
      </div>

      <ol className="grid sm:grid-cols-3 gap-2 mt-3">
        {SBA_WORKFLOW_STEPS.map((step, i) => {
          const isCurrent = step.id === current
          return (
            <li key={step.id}>
              <Link
                to={step.to}
                aria-current={isCurrent ? 'page' : undefined}
                className={`block h-full rounded-xl border p-3 transition-colors ${
                  isCurrent
                    ? 'border-cyan-400 bg-cyan-50/70'
                    : 'theme-border bg-white/60 hover:bg-white'
                }`}
              >
                <div className="flex items-center gap-2">
                  <span aria-hidden="true">{step.emoji}</span>
                  <span className="text-xs font-black theme-text">{i + 1}. {step.title}</span>
                  {isCurrent && (
                    <span className="ml-auto text-[10px] font-black uppercase tracking-wide text-cyan-700">You’re here</span>
                  )}
                </div>
                <p className="text-[11px] mt-1 leading-snug" style={{ color: 'var(--zt-text-muted)' }}>{step.desc}</p>
              </Link>
            </li>
          )
        })}
      </ol>
    </section>
  )
}
