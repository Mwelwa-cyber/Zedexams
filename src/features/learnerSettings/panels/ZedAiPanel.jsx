// Zed AI Assistant panel — tunes how the learner's study assistant talks with
// them. All prefs persist under learnerSettings.zedAi via the SaveContext
// autosave; discrete controls read the normalized object and commit the whole
// object back on change. The "Reset Zed conversations" action clears the local
// chat cache on this device (its own button, not an autosaved field).

import { useState } from 'react'
import { useAuth } from '../../../contexts/AuthContext'
import { useSettingsSave } from '../components/SaveContext'
import { Panel, Section, SelectField, Toggle, Chips, OptionCards, Btn, Note } from '../components/ui'
import {
  normalizeZedAiPrefs,
  ZED_VOICE_OPTIONS,
  ZED_PERSONALITY_OPTIONS,
  ZED_STYLE_OPTIONS,
  ZED_SPEED_OPTIONS,
  ZED_AVATARS,
  LANGUAGE_OPTIONS,
} from '../lib/learnerPrefs'

export default function ZedAiPanel({ section, pushToast }) {
  const { userProfile } = useAuth()
  const { commit } = useSettingsSave()
  const [resetting, setResetting] = useState(false)

  const z = normalizeZedAiPrefs(userProfile?.learnerSettings?.zedAi)
  const set = (key, value) => commit({ 'learnerSettings.zedAi': { ...z, [key]: value } })

  const resetConversations = () => {
    setResetting(true)
    try {
      Object.keys(localStorage)
        .filter((k) => k.toLowerCase().includes('zed') && k.toLowerCase().includes('chat'))
        .forEach((k) => localStorage.removeItem(k))
    } catch { /* private mode / quota — non-fatal */ }
    setResetting(false)
    pushToast('success', 'Zed conversations reset.')
  }

  return (
    <Panel section={section}>
      <Note tone="accent">These settings tune how Zed, your study assistant, talks with you.</Note>

      <Section title="Personality & style" hint="Pick the vibe and how much detail Zed gives.">
        <OptionCards
          options={ZED_PERSONALITY_OPTIONS}
          value={z.personality}
          onChange={(v) => set('personality', v)}
        />
        <SelectField
          label="Conversation style"
          value={z.conversationStyle}
          onChange={(v) => set('conversationStyle', v)}
          options={ZED_STYLE_OPTIONS}
        />
      </Section>

      <Section title="Voice" hint="How Zed sounds when reading aloud.">
        <SelectField
          label="AI voice"
          value={z.voice}
          onChange={(v) => set('voice', v)}
          options={ZED_VOICE_OPTIONS}
        />
        <SelectField
          label="Speaking speed"
          value={z.speakingSpeed}
          onChange={(v) => set('speakingSpeed', v)}
          options={ZED_SPEED_OPTIONS}
        />
        <SelectField
          label="Language"
          value={z.language}
          onChange={(v) => set('language', v)}
          options={LANGUAGE_OPTIONS}
        />
      </Section>

      <Section title="Avatar" hint="Choose how Zed shows up in chat.">
        <Chips
          options={ZED_AVATARS.map((a) => ({ value: a.id, label: a.label, emoji: a.emoji }))}
          value={z.avatar}
          onChange={(v) => commit({ 'learnerSettings.zedAi': { ...z, avatar: v } })}
        />
      </Section>

      <Section title="Memory" hint="Control what Zed keeps between chats.">
        <Toggle
          title="Let Zed remember our conversations"
          hint="Zed can reference earlier chats to give more relevant help."
          checked={z.rememberContext}
          onChange={(v) => set('rememberContext', v)}
        />
        <Btn variant="ghost" loading={resetting} onClick={resetConversations}>
          Reset Zed conversations
        </Btn>
        <Note>Resetting clears Zed's chat history stored on this device. It won't affect your other settings.</Note>
      </Section>
    </Panel>
  )
}
