import { SCHOOL_RESOURCE_LEVELS, DEFAULT_SCHOOL_RESOURCES } from '../../../config/schoolResources'
import { useSchoolProfileForm } from '../lib/useSchoolProfileForm'
import SettingsDetailShell from '../components/SettingsDetailShell'
import OptionCards from '../components/fields/OptionCards'
import { useSettingsSave } from '../lib/useSettingsSave'

const LEVEL_HINTS = {
  low: 'Chalkboard and local materials only — every activity stays doable without electricity, printing or bought apparatus.',
  basic: 'Chalkboard plus a few shared textbooks. Bought items always come with a free local alternative.',
  full: 'Printing, electricity and standard aids available; digital aids used where they genuinely help.',
}
const LEVEL_TITLES = {
  low: 'Low-resource / rural',
  basic: 'Basic',
  full: 'Well-resourced',
}

// How well-equipped the school is. Saved on schoolProfiles/{uid} and used to
// seed the studios' resource-level selects, so generated activities match
// what the school actually has (born from rural-teacher feedback).
export default function ResourcesPanel() {
  const school = useSchoolProfileForm()
  const { run, saving, saved, error } = useSettingsSave()

  const value = school.form.resourceLevel || DEFAULT_SCHOOL_RESOURCES
  const onSave = () => run(() => school.save())

  return (
    <SettingsDetailShell
      rowId="resources"
      saveBar={{ onSave, saving, saved, error, dirty: school.dirty, disabled: !school.dirty || school.loading }}
    >
      <section className="tset-section">
        <h2 className="tset-section__title">School resource level</h2>
        <p className="tset-section__hint">
          Every generated lesson, worksheet and homework respects this — no more
          activities that assume a projector your school doesn't have.
        </p>
        <OptionCards
          label="School resource level"
          columns={3}
          value={value}
          onChange={(resourceLevel) => school.patch({ resourceLevel })}
          options={SCHOOL_RESOURCE_LEVELS.map((l) => ({
            value: l.value,
            title: LEVEL_TITLES[l.value] || l.label,
            hint: LEVEL_HINTS[l.value] || '',
          }))}
        />
      </section>
    </SettingsDetailShell>
  )
}
