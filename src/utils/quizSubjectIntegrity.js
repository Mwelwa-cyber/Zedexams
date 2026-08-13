/**
 * quizSubjectIntegrity — canonical subject-identity binding for the public,
 * featured past-paper quiz path.
 *
 * WHY THIS EXISTS
 * A featured "Social Studies" paper was observed rendering a Mathematics
 * question. Root cause: the public runner derives the SUBJECT LABEL from the
 * `pastPapers/{id}` doc (`paper.subject`) but renders the QUESTIONS from a
 * separately-linked `quizzes/{quizId}`, and NOTHING reconciled the two. Editing
 * a paper's subject (or pointing it at the wrong quiz) desynchronises the label
 * from the content, and the app "failed open" — it happily showed whatever the
 * `quizId` pointer resolved to under the paper's subject heading.
 *
 * THE FIX
 * A single canonical-identity check that compares the paper and its linked quiz
 * (and, where the data carries it, each question) on a NORMALISED subject /
 * grade / curriculum identity — not human-readable labels. `quiz.subject` is
 * stamped inconsistently across the codebase (a slug from PastPaperStudio, a
 * display label from paperToQuizConverter), so every comparison folds both
 * sides through the catalogue's `normalizeSubjectId` first. The public app must
 * FAIL CLOSED: if the identities don't line up, refuse to render rather than
 * silently substitute a quiz from another subject.
 *
 * This module is pure (no Firebase, no DOM) so it is shared by:
 *   • the public runner render gate (src/features/papers/pages/PublicQuizRunner.jsx)
 *   • the featured-list filter (src/utils/pastPapers.js)
 *   • the repair/migration script (scripts/repair-quiz-subject-integrity.mjs)
 *   • its own node test (scripts/test-quiz-subject-integrity.mjs)
 */

import {
  normalizeSubjectId,
  normalizeGradeId,
  normalizeCurriculumId,
} from '../config/curriculumCatalog.js'

/** Stable violation codes — surfaced in the repair report + audit log. */
export const INTEGRITY_CODES = {
  MISSING_INPUT: 'missing_input',
  MISSING_PAPER_SUBJECT: 'missing_paper_subject',
  MISSING_QUIZ_SUBJECT: 'missing_quiz_subject',
  SUBJECT_MISMATCH: 'subject_mismatch',
  QUESTION_SUBJECT_MISMATCH: 'question_subject_mismatch',
  GRADE_MISMATCH: 'grade_mismatch',
  CURRICULUM_MISMATCH: 'curriculum_mismatch',
  WRONG_QUIZ: 'wrong_quiz',
  QUIZ_UNPUBLISHED: 'quiz_unpublished',
}

/**
 * The quiz's back-pointer to its originating paper, under any of the field
 * names the two creation paths use (PastPaperStudio → `linkedPaperId`;
 * paperToQuizConverter → `sourcePastPaperId`). Returns '' when absent.
 */
export function quizBackLink(quiz) {
  if (!quiz) return ''
  return String(quiz.linkedPaperId || quiz.sourcePastPaperId || '').trim()
}

/**
 * Validate that a linked quiz (and, where present, its questions) genuinely
 * belongs to the paper's subject / grade / curriculum identity.
 *
 * @param {object} input
 * @param {object} input.paper     pastPapers/{id} doc (needs id, subject; grade/curriculum optional)
 * @param {object} input.quiz      quizzes/{id} doc (needs subject; grade/curriculum/link/flags optional)
 * @param {object[]} [input.questions] the quiz's questions (only `subject` is inspected, when present)
 * @param {object} [opts]
 * @param {boolean} [opts.requirePublished=true]  in the public/featured context the quiz must be
 *        isPublished + publicAccess; the admin repair pass sets this false to audit drafts too.
 * @returns {{ok: boolean, violations: Array<{code:string,message:string,detail?:object}>,
 *            canonical: {subjectId:string,gradeId:string,curriculumId:string}}}
 */
export function validateQuizSubjectIntegrity(input = {}, opts = {}) {
  const { paper, quiz, questions } = input
  const { requirePublished = true } = opts
  const violations = []
  const add = (code, message, detail) => violations.push(detail ? { code, message, detail } : { code, message })

  if (!paper || !quiz) {
    add(INTEGRITY_CODES.MISSING_INPUT, 'Paper or quiz record is missing.')
    return { ok: false, violations, canonical: { subjectId: '', gradeId: '', curriculumId: '' } }
  }

  const paperSubject = normalizeSubjectId(paper.subject)
  const quizSubject = normalizeSubjectId(quiz.subject)

  if (!paperSubject) add(INTEGRITY_CODES.MISSING_PAPER_SUBJECT, 'Paper has no recognisable subject.', { raw: paper.subject ?? null })
  if (!quizSubject) add(INTEGRITY_CODES.MISSING_QUIZ_SUBJECT, 'Linked quiz has no recognisable subject.', { raw: quiz.subject ?? null })

  if (paperSubject && quizSubject && paperSubject !== quizSubject) {
    add(
      INTEGRITY_CODES.SUBJECT_MISMATCH,
      `Paper subject "${paper.subject}" (${paperSubject}) does not match linked quiz subject "${quiz.subject}" (${quizSubject}).`,
      { paperSubject, quizSubject },
    )
  }

  // Grade + curriculum are only compared when BOTH sides carry them (past-paper
  // quizzes intentionally omit grade for non-G4-7 papers), so a legitimately
  // absent field is never a violation — only a genuine conflict is.
  const paperGrade = normalizeGradeId(paper.grade)
  const quizGrade = normalizeGradeId(quiz.grade)
  if (paperGrade && quizGrade && paperGrade !== quizGrade) {
    add(
      INTEGRITY_CODES.GRADE_MISMATCH,
      `Paper grade "${paper.grade}" (${paperGrade}) does not match linked quiz grade "${quiz.grade}" (${quizGrade}).`,
      { paperGrade, quizGrade },
    )
  }

  const paperCurr = normalizeCurriculumId(paper.curriculum)
  const quizCurr = normalizeCurriculumId(quiz.curriculum)
  if (paperCurr && quizCurr && paperCurr !== quizCurr) {
    add(
      INTEGRITY_CODES.CURRICULUM_MISMATCH,
      `Paper curriculum "${paper.curriculum}" (${paperCurr}) does not match linked quiz curriculum "${quiz.curriculum}" (${quizCurr}).`,
      { paperCurr, quizCurr },
    )
  }

  // The quiz must back-link to THIS paper. A back-link to a different paper id
  // means the paper points at a quiz built for another paper — the clearest
  // "questions belong to another quiz" signal.
  const backLink = quizBackLink(quiz)
  if (backLink && paper.id && backLink !== paper.id) {
    add(
      INTEGRITY_CODES.WRONG_QUIZ,
      `Linked quiz belongs to paper "${backLink}", not "${paper.id}".`,
      { backLink, paperId: paper.id },
    )
  }

  // Question-level subject: only checked for questions that actually carry a
  // subject field (many past-paper questions don't). One mismatched question is
  // enough to fail closed — that IS the "Maths question in a Social Studies
  // quiz" symptom.
  const expected = quizSubject || paperSubject
  if (expected && Array.isArray(questions)) {
    for (let i = 0; i < questions.length; i += 1) {
      const raw = questions[i] && questions[i].subject
      if (raw == null || raw === '') continue
      const qSub = normalizeSubjectId(raw)
      if (qSub && qSub !== expected) {
        add(
          INTEGRITY_CODES.QUESTION_SUBJECT_MISMATCH,
          `Question ${i + 1} subject "${raw}" (${qSub}) does not match the quiz subject (${expected}).`,
          { index: i, questionSubject: qSub, expected },
        )
        break
      }
    }
  }

  if (requirePublished) {
    const published = Boolean(quiz.isPublished) && Boolean(quiz.publicAccess)
    if (!published) {
      add(
        INTEGRITY_CODES.QUIZ_UNPUBLISHED,
        'Featured/public quiz is not published + public-access.',
        { isPublished: Boolean(quiz.isPublished), publicAccess: Boolean(quiz.publicAccess) },
      )
    }
  }

  return {
    ok: violations.length === 0,
    violations,
    canonical: {
      subjectId: quizSubject || paperSubject || '',
      gradeId: paperGrade || quizGrade || '',
      curriculumId: paperCurr || quizCurr || '',
    },
  }
}

/**
 * Lightweight subject-only check for the featured list, where only the paper +
 * the linked quiz's cheap metadata (`getLinkedQuizMeta`, which returns
 * `subject`) are in hand — no questions loaded. Returns true only when both
 * subjects are present AND normalise equal. Fail closed: an unknown/missing
 * quiz subject returns false so the card is dropped from the featured strip.
 */
export function paperQuizSubjectMatches(paper, quizMeta) {
  if (!paper || !quizMeta) return false
  const ps = normalizeSubjectId(paper.subject)
  const qs = normalizeSubjectId(quizMeta.subject)
  return Boolean(ps) && Boolean(qs) && ps === qs
}
