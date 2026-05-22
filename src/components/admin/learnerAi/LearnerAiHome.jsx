import { Link } from 'react-router-dom'
import SeoHelmet from '../../seo/SeoHelmet'
import TaskQueue from './TaskQueue'
import LiveAgentStates from './LiveAgentStates'

// Top-level admin page for the learner-AI pipeline.
// Shows the same shape as /admin/agents but on the parallel
// `aiAgentTasks` collection.
export function LearnerAiHome() {
  return (
    <div className="p-4 md:p-6 max-w-7xl mx-auto">
      <SeoHelmet title="Learner AI — Admin" />
      <header className="mb-6">
        <h1 className="text-2xl font-bold text-slate-900">Learner AI pipeline</h1>
        <p className="text-sm text-slate-600 mt-1">
          Parallel agent pipeline for learner-facing artifacts (practice quizzes,
          exam drafts, notes, study tips, weakness reports, learner feedback).
          Every artifact must be approved here before learners see it. Existing
          teacher quizzes and the public learner publishing flow are untouched.
        </p>
      </header>

      <nav className="flex gap-3 mb-6 text-sm">
        <Link to="/admin/learner-ai/tasks" className="px-3 py-1.5 rounded bg-slate-100 hover:bg-slate-200">All tasks</Link>
        <Link to="/admin/learner-ai/logs" className="px-3 py-1.5 rounded bg-slate-100 hover:bg-slate-200">Logs</Link>
        <Link to="/admin/learner-ai/curriculum-updates" className="px-3 py-1.5 rounded bg-slate-100 hover:bg-slate-200">Curriculum updates</Link>
        <Link to="/admin/learner-ai/standards" className="px-3 py-1.5 rounded bg-slate-100 hover:bg-slate-200">Assessment standards</Link>
      </nav>

      <section className="mb-8">
        <h2 className="text-lg font-semibold mb-3">Tasks awaiting your approval</h2>
        <TaskQueue statusFilter="awaiting_approval" />
      </section>

      <section className="mb-8">
        <h2 className="text-lg font-semibold mb-3">Active tasks</h2>
        <TaskQueue statusFilter="active" />
      </section>

      <section className="mb-8">
        <h2 className="text-lg font-semibold mb-3">Live agent states</h2>
        <LiveAgentStates />
      </section>
    </div>
  )
}

export default LearnerAiHome
