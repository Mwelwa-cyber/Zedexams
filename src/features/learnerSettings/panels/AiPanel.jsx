// AI Learning Assistant — the detail view. Personalisation the assistant learns
// from (learning goal, subjects to improve, whether AI may pick practice / focus
// weak topics) persisted under learnerSettings.aiAssistant, then entry-point
// cards that launch the real Zed surfaces. Generators we haven't built yet
// (revision plan, study timetable) are honest "Coming soon" — nothing here
// fabricates a result. The Zed voice/personality/memory controls follow below.

import { useNavigate } from 'react-router-dom'
import { useAuth } from '../../../contexts/AuthContext'
import { useSettingsSave } from '../components/SaveContext'
import { Panel, Section, Toggle, Chips, Btn, Note } from '../components/ui'
import {
  normalizeAiAssistantPrefs,
  AI_GOAL_OPTIONS,
  IMPROVE_SUBJECT_OPTIONS,
} from '../lib/learnerPrefs'
import { ZedAiBody } from './ZedAiPanel'

// Entry-point cards. `to` navigates to an existing surface; `soon` marks the
// generators we haven't shipped yet.
const AI_ACTIONS = [
  { emoji: '🔥', label: 'Daily Challenge', hint: "Today's mixed practice set", to: '/daily' },
  { emoji: '🏆', label: 'Weekly Challenge', hint: 'Climb the weekly leaderboard', to: '/games/leaderboard' },
  { emoji: '🤖', label: 'AI Homework Helper', hint: 'Ask Zed to work through a problem', to: '/ask-zed' },
  { emoji: '💬', label: 'AI Chat Tutor', hint: 'Chat with your study assistant', to: '/ask-zed' },
  { emoji: '💡', label: 'AI Revision Plan', hint: 'A plan built around your weak spots', soon: true },
  { emoji: '📅', label: 'AI Study Timetable', hint: 'A weekly schedule that fits your goals', soon: true },
]

export default function AiPanel({ section, pushToast }) {
  const { userProfile } = useAuth()
  const { commit } = useSettingsSave()
  const navigate = useNavigate()

  const ai = normalizeAiAssistantPrefs(userProfile?.learnerSettings?.aiAssistant)
  const set = (key, value) => commit({ 'learnerSettings.aiAssistant': { ...ai, [key]: value } })

  return (
    <Panel section={section}>
      <Note tone="accent">
        Tell your assistant what you're aiming for and it will personalise your practice.
        These preferences steer the tools below.
      </Note>

      <Section title="My learning goal" hint="What matters most to you right now.">
        <Chips
          options={AI_GOAL_OPTIONS}
          value={ai.learningGoal}
          onChange={(v) => set('learningGoal', v)}
        />
      </Section>

      <Section title="Subjects I want to improve" hint="Pick any — the assistant will lean practice toward these.">
        <Chips
          multi
          options={IMPROVE_SUBJECT_OPTIONS}
          value={ai.improveSubjects}
          onChange={(v) => set('improveSubjects', v)}
        />
      </Section>

      <Section title="How AI helps" hint="Let the assistant take the wheel — or keep control.">
        <Toggle
          title="Let AI choose today's practice"
          hint="Zed picks a smart mix for you each day."
          checked={ai.autoPickPractice}
          onChange={(v) => set('autoPickPractice', v)}
        />
        <Toggle
          title="Focus on my weak topics"
          hint="Weight practice toward where you score lowest."
          checked={ai.focusWeakTopics}
          onChange={(v) => set('focusWeakTopics', v)}
        />
      </Section>

      <Section title="Quick actions" hint="Jump straight into an AI study tool.">
        <div className="lset-ailist">
          {AI_ACTIONS.map((a) => (
            <button
              key={a.label}
              type="button"
              className="lset-airow"
              disabled={a.soon}
              onClick={a.soon ? undefined : () => navigate(a.to)}
            >
              <span className="lset-airow__emoji" aria-hidden="true">{a.emoji}</span>
              <span className="lset-airow__label">
                {a.label}
                <span style={{ display: 'block', fontSize: 11.5, fontWeight: 500, color: 'var(--text-muted)' }}>{a.hint}</span>
              </span>
              {a.soon && <span className="lset-soon">Coming soon</span>}
            </button>
          ))}
        </div>
        <div style={{ marginTop: 14 }}>
          <Btn full onClick={() => navigate('/ask-zed')}>✨ Open AI Assistant</Btn>
        </div>
      </Section>

      {/* Zed voice / personality / memory */}
      <ZedAiBody pushToast={pushToast} />
    </Panel>
  )
}
