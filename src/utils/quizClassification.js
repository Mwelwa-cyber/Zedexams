// Single source of truth for how a quiz is classified when it becomes
// published. Both the admin "publish / make practice" flow
// (components/admin/ManageContent.jsx) and the in-editor Publish button
// (components/quiz/EditQuizV2.jsx) MUST use this so the two paths cannot
// drift apart — the drift produced "orphan" quizzes that were
// isPublished:true but had no quizType, so getQuizzes (which filters on
// quizType == 'practice') silently hid them from every learner.

export const EXAM_ONLY_QUESTION_THRESHOLD = 50

export function isExamOnly(quiz) {
  if (typeof quiz?.examOnly === 'boolean') return quiz.examOnly
  return Number(quiz?.questionCount) >= EXAM_ONLY_QUESTION_THRESHOLD
}

// The patch to merge into a quiz doc when it transitions to published.
// Short quizzes (< threshold) go straight into the practice library;
// long quizzes become exam-only and wait to be pinned as a Daily Exam.
// A quiz already pinned as a daily exam keeps its pin.
export function classifyOnPublish({ currentQuizType, examOnly, questionCount }) {
  if (currentQuizType === 'daily_exam') {
    return { quizType: 'daily_exam' }
  }
  const long = isExamOnly({ examOnly, questionCount })
  return {
    examOnly: long,
    quizType: long ? null : 'practice',
    isDailyExam: false,
    dailyExamDate: null,
  }
}
