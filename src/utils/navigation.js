export function getRoleLandingPath(profileOrFlags, fallback = '/dashboard') {
  const role = typeof profileOrFlags === 'string'
    ? profileOrFlags
    : profileOrFlags?.role

  if (profileOrFlags?.isAdmin || role === 'admin' || role === 'superAdmin') return '/admin'
  if (profileOrFlags?.isTeacher || role === 'teacher') return '/teacher'
  if (role === 'learner' || role === 'student') return '/dashboard'
  return fallback
}
