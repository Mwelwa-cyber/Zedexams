/**
 * SBA Hub — /teacher/sba
 *
 * A single landing page that groups the three School Based Assessment tools
 * (Create tasks → Record marks → Track coverage) behind one dashboard entry.
 * The individual tools still live at their own routes
 * (/teacher/generate/sba, /sba-tracker, /sba-planner); this hub just gives
 * teachers one place to start and orients them on the ECZ workflow.
 *
 * The workflow steps are sourced from SbaWorkflowNote's SBA_WORKFLOW_STEPS so
 * the order and copy stay in sync with the in-tool "You're here" banner.
 */

import { Link } from 'react-router-dom'
import StudioPageHeader from './StudioPageHeader'
import SeoHelmet from '../seo/SeoHelmet'
import { SBA_WORKFLOW_STEPS } from './SbaWorkflowNote'

export default function SbaHub() {
  return (
    <div className="studio-page">
      <SeoHelmet title="SBA Studio" noIndex />
      <StudioPageHeader
        eyebrow="Grades 5–7"
        title="SBA Studio"
        subtitle="ECZ School Based Assessment, end to end — create tasks, record marks, and track coverage from one place."
        emoji="🎓"
      />

      <section
        aria-label="How School Based Assessment works"
        className="studio-card p-4 sm:p-5 mb-5 border-l-4"
        style={{ borderLeftColor: '#0e7490' }}
      >
        <h2 className="text-sm font-black theme-text">How SBA works</h2>
        <p className="text-xs mt-1" style={{ color: '#566f76' }}>
          School Based Assessment runs across <strong>Grades 5–7</strong> and is{' '}
          <strong>30% of the final Grade 7 mark</strong> — 10% banked per grade. Tasks come from the
          syllabus, are <strong>never multiple-choice</strong>, and the marked evidence must be kept
          for ECZ verification.
        </p>
      </section>

      <ol className="grid sm:grid-cols-3 gap-3">
        {SBA_WORKFLOW_STEPS.map((step, i) => (
          <li key={step.id}>
            <Link
              to={step.to}
              className="block h-full rounded-2xl border theme-border bg-white/60 p-4 transition-colors hover:bg-white no-underline"
            >
              <div className="flex items-center gap-2">
                <span aria-hidden="true" style={{ fontSize: 20 }}>{step.emoji}</span>
                <span className="text-sm font-black theme-text">{i + 1}. {step.title}</span>
              </div>
              <p className="text-xs mt-2 leading-snug" style={{ color: '#566f76' }}>{step.desc}</p>
            </Link>
          </li>
        ))}
      </ol>
    </div>
  )
}
