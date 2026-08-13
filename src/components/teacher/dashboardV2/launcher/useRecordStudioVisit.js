import { useEffect } from 'react'
import { useLocation } from 'react-router-dom'
import useRecentStudios from '../../../../hooks/useRecentStudios'
import { studioIdForPath } from '../../../../shared/utils/teacherLauncherCore'
import { TEACHER_STUDIOS } from '../../../../shared/constants/teacherStudios'

/**
 * Records the current route as a studio visit for "Recently used".
 *
 * Mounted in TeacherLayout so EVERY way into a studio counts — sidebar,
 * bottom nav, deep links, redirects — not just taps on the launcher (which
 * also records, idempotently: pushRecent de-dupes to the front). Non-studio
 * pages (library, drafts, help, …) resolve to null and record nothing.
 */
export default function useRecordStudioVisit() {
  const { pathname } = useLocation()
  const { record } = useRecentStudios()
  const id = studioIdForPath(pathname, TEACHER_STUDIOS)
  useEffect(() => {
    if (id) record(id)
  }, [id, record])
}
