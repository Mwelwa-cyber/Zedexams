import { useState } from 'react'
import ControlCentreLayout from './ControlCentreLayout'
import TaskQueue from './TaskQueue'
import LiveSummaryCards from './LiveSummaryCards'
import LiveAgentStatusCards from './LiveAgentStatusCards'
import LiveActivityTimeline from './LiveActivityTimeline'
import RunningTaskDetailDrawer from './RunningTaskDetailDrawer'

// AI Control Centre — Monitor tab (section 1 of the spec).
//
// Shipped in PR #551 as the only page at /admin/learner-ai. With the
// Phase A multi-tab Control Centre, this file now lives inside the
// new ControlCentreLayout so the tab strip is shared across every
// section.
//
// 5 monitor sub-sections from the spec:
//   1. Live Summary Cards          → <LiveSummaryCards />
//   2. Live Agent Status Cards     → <LiveAgentStatusCards onViewTask={...} />
//   3. Live Activity Timeline      → <LiveActivityTimeline />
//   4. Running Task Detail Drawer  → <RunningTaskDetailDrawer taskId=...>
//   5. Control Actions             → buttons inside the drawer + the
//                                    Pause/Resume/Cancel on each agent
//                                    card.
export function LearnerAiHome() {
  const [drawerTaskId, setDrawerTaskId] = useState(null)
  const openTask = (id) => setDrawerTaskId(id || null)
  const closeDrawer = () => setDrawerTaskId(null)

  return (
    <ControlCentreLayout
      title="Monitor"
      helmetTitle="AI Control Centre — Live Monitor"
    >
      <p className="text-sm text-slate-600 mb-4 leading-snug">
        Live view of the 11 learner-AI agents producing practice quizzes,
        exam drafts, notes, study tips, weakness profiles, learner feedback,
        and curriculum-update reports. Every section updates in real time
        via Firestore listeners.
      </p>

      <LiveSummaryCards />

      <section className="mb-8">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-semibold text-slate-900">Agent status</h2>
          <span className="text-xs text-slate-500">live · onSnapshot</span>
        </div>
        <LiveAgentStatusCards onViewTask={openTask} />
      </section>

      <section className="mb-8">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-semibold text-slate-900">Activity timeline</h2>
          <span className="text-xs text-slate-500">last 100 events</span>
        </div>
        <LiveActivityTimeline />
      </section>

      <section className="mb-8">
        <h2 className="text-lg font-semibold text-slate-900 mb-3">
          Tasks awaiting your approval
        </h2>
        <TaskQueue statusFilter="needs_review" onRowClick={openTask} />
      </section>

      <section className="mb-8">
        <h2 className="text-lg font-semibold text-slate-900 mb-3">Active tasks</h2>
        <TaskQueue statusFilter="active" onRowClick={openTask} />
      </section>

      {drawerTaskId && (
        <RunningTaskDetailDrawer taskId={drawerTaskId} onClose={closeDrawer} />
      )}
    </ControlCentreLayout>
  )
}

export default LearnerAiHome
