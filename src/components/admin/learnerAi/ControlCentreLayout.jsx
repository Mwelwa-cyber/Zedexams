import { NavLink } from 'react-router-dom'
import SeoHelmet from '../../seo/SeoHelmet'

// Sticky tab strip + page-shell for the AI Control Centre. Wraps
// every tab body. The Monitor tab body lives in LearnerAiHome.jsx
// (unchanged from PR #551); all other tab bodies live in this
// folder + are routed under /admin/learner-ai/* in App.jsx.
//
// Mobile: tab strip is horizontally scrollable with snap behaviour
// so admins can flick through tabs on a phone without overflow.

const TABS = [
  { to: '/admin/learner-ai',                   label: 'Monitor',       end: true },
  { to: '/admin/learner-ai/practice-quizzes',  label: 'Practice quizzes' },
  { to: '/admin/learner-ai/exam-quizzes',      label: 'Exam drafts' },
  { to: '/admin/learner-ai/notes-drafts',      label: 'Notes drafts' },
  { to: '/admin/learner-ai/study-tips',        label: 'Study tips' },
  { to: '/admin/learner-ai/feedback',          label: 'Feedback' },
  { to: '/admin/learner-ai/weakness',          label: 'Weakness reports' },
  { to: '/admin/learner-ai/failed-checks',     label: 'Failed checks' },
  { to: '/admin/learner-ai/reports',           label: 'Reports' },
  { to: '/admin/learner-ai/curriculum-updates', label: 'Curriculum updates' },
  { to: '/admin/learner-ai/staged-modules',    label: 'Staged modules' },
  { to: '/admin/learner-ai/standards',         label: 'Standards' },
  { to: '/admin/learner-ai/settings',          label: 'Settings' },
]

export default function ControlCentreLayout({ title, children, helmetTitle }) {
  return (
    <div className="p-4 md:p-6 max-w-7xl mx-auto">
      <SeoHelmet title={helmetTitle || `AI Control Centre — ${title || 'Admin'}`} />

      {title && (
        <header className="mb-4">
          <h1 className="text-2xl font-bold text-slate-900">{title}</h1>
        </header>
      )}

      <nav
        aria-label="AI Control Centre sections"
        className="sticky top-0 z-10 -mx-4 md:mx-0 mb-4 bg-white border-b border-slate-200"
      >
        <div className="overflow-x-auto snap-x snap-mandatory">
          <ul className="flex gap-1 px-4 md:px-0 py-2 min-w-max">
            {TABS.map(t => (
              <li key={t.to} className="snap-start">
                <NavLink
                  to={t.to}
                  end={t.end}
                  className={({ isActive }) =>
                    `inline-block whitespace-nowrap text-xs font-semibold px-3 py-1.5 rounded-full transition-colors ` +
                    (isActive ?
                      'bg-blue-600 text-white shadow-sm' :
                      'bg-slate-100 text-slate-700 hover:bg-slate-200')
                  }
                >
                  {t.label}
                </NavLink>
              </li>
            ))}
          </ul>
        </div>
      </nav>

      <div>{children}</div>
    </div>
  )
}
