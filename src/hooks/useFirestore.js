/**
 * useFirestore — the Firestore data surface, composed from role-scoped modules.
 *
 * ## What this file used to be
 *
 * One 1,144-line module holding ~60 functions: the learner's quiz library sat
 * beside the admin's `grantAccessByEmail`, and the teacher's question-write
 * normaliser sat beside `getUserResults`. Nothing enforced which of them a
 * given screen was entitled to reach, so every new helper landed wherever its
 * nearest neighbour happened to be, and the file grew in the one direction a
 * file that big can grow.
 *
 * ## What it is now
 *
 * A facade. The bodies moved VERBATIM into four modules split by capability:
 *
 *   ./firestore/learnerData.js    published content + own results + own payments
 *   ./firestore/authoringData.js  quiz/question/assessment writes (heavy deps)
 *   ./firestore/adminData.js      admin listings, payments, approvals
 *   ./firestore/attemptLimiter.js the free-plan daily attempt counter
 *
 * `useFirestore()` returns the SAME object with the SAME keys it always
 * returned, so all 54 existing call sites are untouched and no behaviour
 * changed. `useFirestoreSurface.test.js` pins the key set against a recorded
 * snapshot, which is what makes "no functionality change" a checked claim
 * rather than a promise.
 *
 * ## Prefer the scoped hook in new code
 *
 * `useLearnerFirestore()` (in ./useLearnerFirestore.js) returns only the
 * learner read path. A learner screen that uses it cannot reach the authoring
 * writes or the admin grant tools by accident, and does not have to read a
 * 60-method surface to find the two functions it wants.
 *
 * It is NOT re-exported from here, and that is the whole point: this module
 * statically imports all four data modules to compose the facade, so any
 * import from this path pulls the authoring and admin graphs with it. A
 * convenience re-export would be an import that works and silently costs the
 * bytes the scoped hook exists to avoid.
 */
import { useMemo } from 'react'

import * as learner from './firestore/learnerData.js'
import * as authoring from './firestore/authoringData.js'
import * as admin from './firestore/adminData.js'
import { checkAndConsumeAttempt } from './firestore/attemptLimiter.js'

// Re-exported so the three admin pages that import ADMIN_QUERY_LIMIT from this
// path keep working; the caps themselves are declared once, in ./firestore/internal.js.
export {
  ADMIN_QUERY_LIMIT,
  LEARNER_QUIZ_LIMIT,
  LEARNER_LESSON_LIMIT,
  TEACHER_QUERY_LIMIT,
} from './firestore/internal.js'

/**
 * The whole surface, unchanged.
 *
 * The functions are module-scope bindings now rather than per-render closures,
 * so the empty dependency list that used to need an eslint-disable is simply
 * correct: there is nothing to depend on.
 */
export function useFirestore() {
  return useMemo(() => ({
    // Quizzes — learner reads
    getQuizzes: learner.getQuizzes,
    getQuizById: learner.getQuizById,
    // Quizzes — authoring + admin
    getAllQuizzes: admin.getAllQuizzes,
    getQuizzesByTeacher: admin.getQuizzesByTeacher,
    createQuiz: authoring.createQuiz,
    updateQuiz: authoring.updateQuiz,
    deleteQuiz: authoring.deleteQuiz,
    getQuestions: authoring.getQuestions,
    saveQuestions: authoring.saveQuestions,

    // Results
    saveResult: learner.saveResult,
    getResultById: learner.getResultById,
    getUserResults: learner.getUserResults,
    getResultsForQuiz: admin.getResultsForQuiz,
    getAllResults: admin.getAllResults,
    getResultsInWindow: admin.getResultsInWindow,
    getRecentResults: admin.getRecentResults,
    getDashboardCounts: admin.getDashboardCounts,
    getWeaknessAnalysis: learner.getWeaknessAnalysis,

    // Users
    getAllUsers: admin.getAllUsers,
    getAllLearners: admin.getAllLearners,
    updateUserRole: admin.updateUserRole,

    // Subscription / daily limit
    checkAndConsumeAttempt,

    // Payments
    submitPaymentRequest: admin.submitPaymentRequest,
    getPendingPayments: admin.getPendingPayments,
    getAllPayments: admin.getAllPayments,
    confirmPayment: admin.confirmPayment,
    rejectPayment: admin.rejectPayment,
    grantPremium: admin.grantPremium,
    revokePremium: admin.revokePremium,
    grantAccessByEmail: admin.grantAccessByEmail,
    getTodayPaymentStats: admin.getTodayPaymentStats,
    getActivePremiumCount: admin.getActivePremiumCount,
    getRecentConfirmedPayments: admin.getRecentConfirmedPayments,
    getMyPayments: learner.getMyPayments,
    findUserByEmail: admin.findUserByEmail,
    getRevenueByDay: admin.getRevenueByDay,

    // Lessons
    getLessons: learner.getLessons,
    getAllLessons: admin.getAllLessons,
    getLessonById: learner.getLessonById,
    createLesson: admin.createLesson,
    updateLesson: admin.updateLesson,
    deleteLesson: admin.deleteLesson,

    // Teacher / content-workflow
    getMyQuizzes: authoring.getMyQuizzes,
    getMyLessons: authoring.getMyLessons,
    getPendingApprovals: admin.getPendingApprovals,
    submitForApproval: admin.submitForApproval,
    withdrawFromApproval: admin.withdrawFromApproval,
    approveContent: admin.approveContent,
    rejectContent: admin.rejectContent,

    // Quiz editing
    deleteQuestion: authoring.deleteQuestion,
    updateQuizWithQuestions: authoring.updateQuizWithQuestions,

    // Assessments (teacher-private)
    getMyAssessments: authoring.getMyAssessments,
    getAssessmentById: authoring.getAssessmentById,
    createAssessment: authoring.createAssessment,
    updateAssessment: authoring.updateAssessment,
    deleteAssessment: authoring.deleteAssessment,
    getAssessmentQuestions: authoring.getAssessmentQuestions,
    saveAssessmentQuestions: authoring.saveAssessmentQuestions,
    updateAssessmentWithQuestions: authoring.updateAssessmentWithQuestions,
  }), [])
}
