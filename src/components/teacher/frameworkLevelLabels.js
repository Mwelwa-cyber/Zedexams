// Framework-specific teacher-facing labels for syllabus-backed education levels.
//
// The stored value stays the shared KB grade code (G8…G12) in both curricula.
// Only the display wording changes:
//   2013 previous curriculum: Grade 8 … Grade 12
//   2023 CBC:                Form 1 … Form 4
//
// Keeping this projection pure means every picker can use the Syllabi Studio's
// grade codes without duplicating curriculum naming rules in React components.

function normalizeFramework(framework) {
  return String(framework) === '2013' ? '2013' : '2023'
}

function secondaryGradeNumber(level) {
  const candidates = [level?.kbGrade, level?.value]
  for (const candidate of candidates) {
    const match = /^G(\d{1,2})$/i.exec(String(candidate || '').trim())
    if (match) {
      const number = Number(match[1])
      if (number >= 8 && number <= 12) return number
    }
  }
  return null
}

/**
 * Return the correct teacher-facing label for one level under one framework.
 * The level's identity/value is never changed.
 */
export function levelLabelForFramework(level, framework = '2023') {
  if (!level) return ''
  const fw = normalizeFramework(framework)
  const gradeNumber = secondaryGradeNumber(level)

  if (fw === '2013' && gradeNumber != null) return `Grade ${gradeNumber}`
  return String(level.label || level.value || '')
}

/** Return a shallow copy with the framework-correct display label. */
export function applyFrameworkLevelLabel(level, framework = '2023') {
  if (!level) return level
  const label = levelLabelForFramework(level, framework)
  return label === level.label ? level : { ...level, label }
}
