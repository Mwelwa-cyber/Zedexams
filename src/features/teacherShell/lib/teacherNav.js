import { BookOpen, FileText, PencilLine, Sparkles } from '../../../shared/components/icons'

/**
 * Desktop "Create" menu (TeacherTopBar) — quick jumps into the studios a
 * teacher reaches for daily.
 *
 * Travelled from `src/components/teacher/teacherNav.js` in Phase 6, once
 * `TeacherBottomNav` (that file's other consumer) was deleted as dead. The
 * old module's SIDEBAR_NAV/BOTTOM_NAV lists did not travel: the live sidebar
 * and mobile dock read `TEACHER_NAV_GROUPS` in `dashboardV2Config.js`, which
 * is the one nav config for both surfaces.
 */
export const QUICK_CREATE = [
  { to: '/teacher/lesson-plans/new',       icon: BookOpen,   label: 'Lesson Plan',      accent: '#fde2c4' },
  { to: '/teacher/generate/notes',         icon: FileText,   label: 'Teacher Notes',    accent: '#dbe7f4' },
  { to: '/teacher/assessment-papers/new',  icon: PencilLine, label: 'Assessment Paper', accent: '#e8d8f0' },
  { to: '/teacher/generate/flashcards',    icon: Sparkles,   label: 'Flashcards',       accent: '#fde9b8' },
]
