// Learning preferences panel — study setup, quiz behaviour, reading/audio, and
// app language. All learning prefs live on the flat `learningPrefs` field and
// commit the whole normalized object on change; grade persists as a flat Number.

import { useAuth } from '../../../contexts/AuthContext'
import { useSettingsSave } from '../components/SaveContext'
import { Panel, Section, SelectField, Toggle, Note } from '../components/ui'
import LanguageToggle from '../../../shared/components/LanguageToggle'
import {
  normalizeLearningPrefs,
  QUIZ_DIFFICULTY_OPTIONS,
  QUIZ_MODE_OPTIONS,
  READING_SPEED_OPTIONS,
  PLAYBACK_SPEED_OPTIONS,
  GRADE_NUMBERS,
} from '../lib/learnerPrefs'

const CURRICULUM_OPTIONS = [{ value: 'cbc', label: 'Zambian CBC' }]

export default function LearningPanel({ section }) {
  const { userProfile } = useAuth()
  const { commit } = useSettingsSave()

  const lp = normalizeLearningPrefs(userProfile?.learningPrefs)
  const set = (key, value) => commit({ learningPrefs: { ...lp, [key]: value } })

  return (
    <Panel section={section}>
      <Note tone="accent">These preferences sync across all your devices.</Note>

      <Section title="Study setup" hint="Where you learn and how quizzes are pitched.">
        <div className="lset-grid">
          <SelectField
            label="Grade"
            value={String(userProfile?.grade ?? 4)}
            onChange={(v) => commit({ grade: Number(v) })}
            options={GRADE_NUMBERS.map((g) => ({ value: String(g), label: `Grade ${g}` }))}
          />
          <SelectField
            label="Preferred curriculum"
            value={lp.curriculum}
            onChange={(v) => set('curriculum', v)}
            options={CURRICULUM_OPTIONS}
          />
          <SelectField
            label="Quiz difficulty"
            value={lp.quizDifficulty}
            onChange={(v) => set('quizDifficulty', v)}
            options={QUIZ_DIFFICULTY_OPTIONS}
          />
          <SelectField
            label="Default quiz mode"
            value={lp.defaultQuizMode}
            onChange={(v) => set('defaultQuizMode', v)}
            options={QUIZ_MODE_OPTIONS}
          />
        </div>
      </Section>

      <Section title="Quizzes" hint="How quizzes feel while you practise.">
        <Toggle
          title="Timed quizzes"
          hint="Add a countdown to your practice quizzes."
          checked={lp.timedQuizzes}
          onChange={(v) => set('timedQuizzes', v)}
        />
        <Toggle
          title="Auto-submit when timer ends"
          hint="Hand in automatically the moment time runs out."
          checked={lp.autoSubmitTimer}
          onChange={(v) => set('autoSubmitTimer', v)}
        />
        <Toggle
          title="Sound effects"
          hint="Play little chimes for correct and wrong answers."
          checked={lp.soundEffects}
          onChange={(v) => set('soundEffects', v)}
        />
        <Toggle
          title="Show hints during practice"
          hint="Offer a nudge when you're stuck on a question."
          checked={lp.showHints}
          onChange={(v) => set('showHints', v)}
        />
      </Section>

      <Section title="Reading & audio" hint="Read-aloud and playback comfort.">
        <Toggle
          title="Text-to-speech"
          hint="Read questions and notes aloud."
          checked={lp.textToSpeech}
          onChange={(v) => set('textToSpeech', v)}
        />
        <div className="lset-grid">
          <SelectField
            label="Reading speed"
            value={lp.readingSpeed}
            onChange={(v) => set('readingSpeed', v)}
            options={READING_SPEED_OPTIONS}
          />
          <SelectField
            label="Audio playback speed"
            value={lp.audioSpeed}
            onChange={(v) => set('audioSpeed', v)}
            options={PLAYBACK_SPEED_OPTIONS}
          />
        </div>
        <Toggle
          title="Auto-advance lessons"
          hint="Play the next lesson slide automatically."
          checked={lp.autoplayLessons}
          onChange={(v) => set('autoplayLessons', v)}
        />
      </Section>

      <Section title="App language" hint="The language of buttons, labels and menus.">
        <div className="lset-toggle">
          <div className="lset-toggle__text">
            <p className="lset-toggle__title">Interface language</p>
            <p className="lset-toggle__hint">Applies instantly across the app.</p>
          </div>
          <LanguageToggle compact />
        </div>
      </Section>
    </Panel>
  )
}
