import { titleForGeneration } from './teacherLibraryService'

export const SEEN_REMINDERS_KEY = (uid) => `teacher:bellSeen:${uid}`

export function toMs(t) {
  if (!t) return 0
  if (typeof t.toDate === 'function') return t.toDate().getTime()
  return new Date(t).getTime() || 0
}

export function buildReminders({ generations = [], quizzes = [] }) {
  const now = Date.now()
  const DAY = 24 * 60 * 60 * 1000
  const out = []

  const lastGen = generations[0]
  const daysSinceLastGen = lastGen ? Math.floor((now - toMs(lastGen.createdAt)) / DAY) : null

  if (lastGen && daysSinceLastGen >= 7) {
    out.push({
      id: 'inactive',
      tone: 'warn',
      title: 'It has been a while',
      body: `Your last plan was ${daysSinceLastGen} day${daysSinceLastGen === 1 ? '' : 's'} ago. Block 10 minutes today to draft the next one.`,
      to: '/teacher/generate/lesson-plan',
      cta: 'Plan a lesson',
    })
  }

  if (!lastGen && (quizzes?.length ?? 0) === 0) {
    out.push({
      id: 'getting-started',
      tone: 'info',
      title: 'Get started',
      body: 'Generate your first CBC-aligned lesson plan in under a minute.',
      to: '/teacher/generate/lesson-plan',
      cta: 'Start',
    })
  }

  const lessonPlans = generations.filter(g => g.tool === 'lesson_plan')
  const notesByLesson = new Set(
    generations
      .filter(g => g.tool === 'notes')
      .map(g => g.inputs?.lessonPlanId || g.inputs?.sourceLessonId)
      .filter(Boolean),
  )
  const planWithoutNotes = lessonPlans.find(g => !notesByLesson.has(g.id))
  if (planWithoutNotes) {
    out.push({
      id: `notes-${planWithoutNotes.id}`,
      tone: 'info',
      title: 'Generate matching notes',
      body: `Turn “${titleForGeneration(planWithoutNotes)}” into delivery notes for class.`,
      to: `/teacher/library/${planWithoutNotes.id}`,
      cta: 'Open plan',
    })
  }

  const draftQuiz = (quizzes || []).find(q => q.status === 'draft' || q.published === false)
  if (draftQuiz) {
    out.push({
      id: `draft-${draftQuiz.id}`,
      tone: 'warn',
      title: 'Draft assessment ready to publish',
      body: `“${draftQuiz.title || draftQuiz.topic || 'Untitled assessment'}” is still a draft.`,
      to: `/teacher/assessments/${draftQuiz.id}/edit`,
      cta: 'Finish it',
    })
  }

  const recent = generations.filter(g => (now - toMs(g.createdAt)) <= 3 * DAY)
  if (recent.length >= 3) {
    out.push({
      id: 'streak',
      tone: 'good',
      title: `${recent.length} items in 3 days — nice streak!`,
      body: 'Open the library to review and share with your class.',
      to: '/teacher/library',
      cta: 'View library',
    })
  }

  return out.slice(0, 5)
}
