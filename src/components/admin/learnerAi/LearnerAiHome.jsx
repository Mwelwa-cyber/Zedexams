import { useState } from 'react'
import { Link } from 'react-router-dom'
import SeoHelmet from '../../seo/SeoHelmet'
import TaskQueue from './TaskQueue'
import LiveSummaryCards from './LiveSummaryCards'
import LiveAgentStatusCards from './LiveAgentStatusCards'
import LiveActivityTimeline from './LiveActivityTimeline'
import RunningTaskDetailDrawer from './RunningTaskDetailDrawer'

// AI Control Centre — Live Monitor.
//
// 5 sections from the spec:
//   1. Live Summary Cards          → <LiveSummaryCards />
//   2. Live Agent Status Cards     → <LiveAgentStatusCards onViewTask={...} />
//   3. Live Activity Timeline      → <LiveActivityTimeline />
//   4. Running Task Detail Drawer  → <RunningTaskDetailDrawer taskId=...> (overlay)
//   5. Control Actions             → buttons inside the drawer + the
//                                    Pause/Resume/Cancel on each agent
//                                    status card.
//
// Every section uses Firestore onSnapshot listeners so the dashboard
// updates in real time as agents progress. Admins can click "View Task"
// on any agent card OR a task row in the queue below to open the
// drawer.
//
// Mobile-friendly: summary cards collapse to 2 columns < md, agent
// cards collapse to 1 column < sm, timeline is its own scroll
// container, drawer is full-width on small screens.
export function LearnerAiHome() {
  const [drawerTaskId, setDrawerTaskId] = useState(null)
  const openTask = (id) => setDrawerTaskId(id || null)
  const closeDrawer = () => setDrawerTaskId(null)

  return (
    <div className="p-4 md:p-6 max-w-7xl mx-auto">
      <SeoHelmet title="AI Control Centre — Live Monitor" />
      <header className="mb-6">
        <h1 className="text-2xl font-bold text-slate-900">AI Control Centre</h1>
        <p className="text-sm text-slate-600 mt-1">
          Live view of the 11 learner-AI agents producing practice quizzes,
          exam drafts, notes, study tips, weakness profiles, learner feedback,
          and curriculum-update reports. Every section below updates in real
          time via Firestore listeners.
        </p>
      </header>

      <nav className="flex flex-wrap gap-2 mb-6 text-xs">
        <Link to="/admin/learner-ai/tasks" className="px-3 py-1.5 rounded bg-slate-100 hover:bg-slate-200 font-semibold">All tasks</Link>
        <Link to="/admin/learner-ai/logs" className="px-3 py-1.5 rounded bg-slate-100 hover:bg-slate-200 font-semibold">Logs (full history)</Link>
        <Link to="/admin/learner-ai/curriculum-updates" className="px-3 py-1.5 rounded bg-slate-100 hover:bg-slate-200 font-semibold">Curriculum updates</Link>
        <Link to="/admin/learner-ai/standards" className="px-3 py-1.5 rounded bg-slate-100 hover:bg-slate-200 font-semibold">Assessment standards</Link>
      </nav>

      {/* 1. Summary KPI cards */}
      <LiveSummaryCards />

      {/* 2. Per-agent status grid */}
      <section className="mb-8">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-semibold text-slate-900">Agent status</h2>
          <span className="text-xs text-slate-500">live · onSnapshot</span>
        </div>
        <LiveAgentStatusCards onViewTask={openTask} />
      </section>

      {/* 3. Activity timeline */}
      <section className="mb-8">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-semibold text-slate-900">Activity timeline</h2>
          <span className="text-xs text-slate-500">last 100 events</span>
        </div>
        <LiveActivityTimeline />
      </section>

      {/* Admin-attention queues */}
      <section className="mb-8">
        <h2 className="text-lg font-semibold text-slate-900 mb-3">Tasks awaiting your approval</h2>
        <TaskQueue statusFilter="needs_review" onRowClick={openTask} />
      </section>

      <section className="mb-8">
        <h2 className="text-lg font-semibold text-slate-900 mb-3">Active tasks</h2>
        <TaskQueue statusFilter="active" onRowClick={openTask} />
      </section>

      {/* 4 + 5. Drawer overlay (only mounts when a taskId is selected) */}
      {drawerTaskId && (
        <RunningTaskDetailDrawer taskId={drawerTaskId} onClose={closeDrawer} />
      )}
    </div>
  )
}

export default LearnerAiHome
