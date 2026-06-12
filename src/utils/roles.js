const ADMIN_ALIASES = new Set([
  'admin',
  'administrator',
  'superadmin',
  'super_admin',
  'super-admin',
])

const TEACHER_ALIASES = new Set([
  'teacher',
  'educator',
])

const LEARNER_ALIASES = new Set([
  'learner',
  'student',
  'pupil',
])

export function normalizeRole(role) {
  const value = String(role || '').trim().toLowerCase()
  if (ADMIN_ALIASES.has(value)) return 'admin'
  if (TEACHER_ALIASES.has(value)) return 'teacher'
  if (LEARNER_ALIASES.has(value)) return 'learner'
  return value || null
}

export function normalizeUserProfile(uid, data) {
  if (!data) return null
  const role = normalizeRole(data.role)
  return {
    id: uid,
    ...data,
    role,
    grade: role === 'learner' ? (data.grade ?? null) : null,
  }
}
