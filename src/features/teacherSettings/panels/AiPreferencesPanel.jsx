import { useMemo, useState } from 'react'
import { useAuth } from '../../../contexts/AuthContext'
import { normalizeTeacherPreferences } from '../../../utils/teacherSettingsCore'
import { TEACHING_LANGUAGES } from '../../../config/zambia'
import SettingsDetailShell from '../components/SettingsDetailShell'
import FieldRow from '../components/fields/FieldRow'
import SelectField from '../components/fields/SelectField'
import OptionCards from '../components/fields/OptionCards'
import ToggleRow from '../components/fields/ToggleRow'
import { useSettingsSave } from '../lib/useSettingsSave'

const INCLUDE_META = [
  { key: 'competencies', title: 'Competencies', hint: 'List the key competencies each lesson builds.' },
  { key: 'specificOutcomes', title: 'Specific outcomes', hint: 'State the specific learning outcomes.' },
  { key: 'teachingAids', title: 'Teaching aids', hint: 'Suggest teaching and learning aids.' },
  { key: 'homework', title: 'Homework', hint: 'End lessons with a homework task.' },
  { key: 'exercises', title: 'Exercises', hint: 'Include practice exercises for learners.' },
  { key: 'reflection', title: 'Reflection', hint: 'Add a lesson evaluation / reflection section.' },
]

function editable(prefs) {
  const { planDetail, teachingLanguage, preferredEnglish, include } = prefs.ai
  return { planDetail, teachingLanguage, preferredEnglish, include }
}

// How generated content is written: plan detail level, language of
// instruction, English variant and which sections to include. Applied by the
// studios via src/utils/teacherDefaults (seeding + prompt lines) — set once,
// every generation follows.
export default function AiPreferencesPanel() {
  const { userProfile, updateProfileFields } = useAuth()
  const source = normalizeTeacherPreferences(userProfile?.teacherPreferences)
  const [form, setForm] = useState(() => editable(source))
  const { run, saving, saved, error } = useSettingsSave()

  const dirty = useMemo(
    () => JSON.stringify(form) !== JSON.stringify(editable(source)),
    [form, source],
  )

  const onSave = () =>
    run(async () => {
      const latest = normalizeTeacherPreferences(userProfile?.teacherPreferences)
      await updateProfileFields({
        teacherPreferences: {
          ...latest,
          ai: { ...latest.ai, ...form, include: { ...latest.ai.include, ...form.include } },
        },
      })
    })

  return (
    <SettingsDetailShell
      rowId="ai"
      saveBar={{ onSave, saving, saved, error, dirty, disabled: !dirty }}
    >
      <section className="tset-section">
        <h2 className="tset-section__title">Lesson plan style</h2>
        <OptionCards
          label="Lesson plan style"
          value={form.planDetail}
          onChange={(planDetail) => setForm((f) => ({ ...f, planDetail }))}
          options={[
            { value: 'simplified', title: 'Simple', hint: 'Short and to the point — the essentials only.' },
            { value: 'standard', title: 'Standard', hint: 'The balanced, everyday level of detail.' },
            { value: 'detailed', title: 'Detailed', hint: 'Fully elaborated stages, questions and examples.' },
          ]}
        />
      </section>

      <section className="tset-section">
        <h2 className="tset-section__title">Language</h2>
        <div className="tset-grid">
          <FieldRow label="Teaching language" htmlFor="ai-lang" help="The default medium of instruction for generated lessons.">
            <SelectField
              id="ai-lang"
              value={form.teachingLanguage}
              onChange={(teachingLanguage) => setForm((f) => ({ ...f, teachingLanguage }))}
              options={TEACHING_LANGUAGES}
            />
          </FieldRow>
          <FieldRow label="Preferred English" htmlFor="ai-english" help="Spelling and vocabulary used in generated text.">
            <SelectField
              id="ai-english"
              value={form.preferredEnglish}
              onChange={(preferredEnglish) => setForm((f) => ({ ...f, preferredEnglish }))}
              options={[
                { value: 'british', label: 'British English (Zambian standard)' },
                { value: 'american', label: 'American English' },
              ]}
            />
          </FieldRow>
        </div>
      </section>

      <section className="tset-section">
        <h2 className="tset-section__title">Include in generated content</h2>
        {INCLUDE_META.map((item) => (
          <ToggleRow
            key={item.key}
            title={item.title}
            hint={item.hint}
            checked={form.include[item.key]}
            onChange={(on) =>
              setForm((f) => ({ ...f, include: { ...f.include, [item.key]: on } }))
            }
          />
        ))}
      </section>
    </SettingsDetailShell>
  )
}
