/**
 * AI-generated practice quiz — pure scoring + helpers (no Firebase).
 *
 * Extracted from aiPracticeQuizService.js so it's unit-testable
 * without mocking firebase/firestore. Same node-script pattern as
 * the other src/utils/*.js tests (see test-rich-text-sanitize.mjs,
 * test-csv-import.mjs) — pure ESM, no transitive Firebase deps.
 */

/**
 * Mark a single question. Returns { correct, awardedMarks }.
 *
 * Per-question type rules:
 *   - mcq            → exact (case-insensitive) match against correctAnswer
 *   - true_false     → 'True' / 'False' match
 *   - short_answer   → lowercased + trimmed equality (no punctuation strip)
 *   - matching       → all pairs must match the artifact's matchingPairs
 *                       (learner submits JSON array of {left,right})
 */
export function markQuestion(question, learnerAnswer) {
  if (!question || typeof question !== 'object') {
    return { correct: false, awardedMarks: 0 }
  }
  const marks = Number.isInteger(question.marks) ? question.marks : 1
  const correctAnswer = String(question.correctAnswer || '').trim().toLowerCase()
  const given = (learnerAnswer == null ? '' : String(learnerAnswer)).trim().toLowerCase()
  if (!given) return { correct: false, awardedMarks: 0 }

  switch (question.questionType) {
    case 'mcq':
    case 'true_false':
    case 'short_answer':
      return given === correctAnswer ?
        { correct: true, awardedMarks: marks } :
        { correct: false, awardedMarks: 0 }
    case 'matching': {
      let pairs = []
      try {
        pairs = Array.isArray(learnerAnswer) ? learnerAnswer : JSON.parse(learnerAnswer)
      } catch { return { correct: false, awardedMarks: 0 } }
      const expected = Array.isArray(question.matchingPairs) ? question.matchingPairs : []
      if (!Array.isArray(pairs) || pairs.length !== expected.length) {
        return { correct: false, awardedMarks: 0 }
      }
      const ok = expected.every((p, i) =>
        pairs[i] && String(pairs[i].left || '').trim().toLowerCase() === String(p.left || '').trim().toLowerCase() &&
        String(pairs[i].right || '').trim().toLowerCase() === String(p.right || '').trim().toLowerCase(),
      )
      return ok ? { correct: true, awardedMarks: marks } : { correct: false, awardedMarks: 0 }
    }
    default:
      return { correct: false, awardedMarks: 0 }
  }
}

/**
 * Score the whole attempt. Returns:
 *   { totalScore, totalMarks, percentage, perQuestion[], topicScores }
 *
 * `topicScores` is the topic-level pass rate the Weakness Detection
 * agent already consumes (`results.topicScores: {topic: 0..100}` —
 * see analyseAttempts in functions/agents/learnerAi/runners/weakness.js).
 */
export function scoreAttempt({ content, answers }) {
  const questions = Array.isArray(content && content.questions) ? content.questions : []
  if (!questions.length) {
    return { totalScore: 0, totalMarks: 0, percentage: 0, perQuestion: [], topicScores: {} }
  }
  const perQuestion = []
  const topicAgg = new Map()
  let totalScore = 0
  let totalMarks = 0

  for (let i = 0; i < questions.length; i++) {
    const q = questions[i]
    const learnerAnswer = answers && answers[i] != null ? answers[i] :
      (q.id && answers && answers[q.id] != null ? answers[q.id] : null)
    const { correct, awardedMarks } = markQuestion(q, learnerAnswer)
    const max = Number.isInteger(q.marks) ? q.marks : 1
    totalScore += awardedMarks
    totalMarks += max
    perQuestion.push({
      index: i,
      questionType: q.questionType,
      prompt: q.prompt || q.questionText || '',
      correctAnswer: q.correctAnswer,
      learnerAnswer,
      correct,
      awardedMarks,
      maxMarks: max,
      topic: q.topic || null,
    })
    const topic = q.topic
    if (typeof topic === 'string' && topic.length) {
      const entry = topicAgg.get(topic) || { earned: 0, total: 0 }
      entry.earned += awardedMarks
      entry.total += max
      topicAgg.set(topic, entry)
    }
  }

  const percentage = totalMarks > 0 ?
    Math.round((totalScore / totalMarks) * 100) : 0
  const topicScores = {}
  for (const [topic, e] of topicAgg.entries()) {
    topicScores[topic] = e.total > 0 ? Math.round((e.earned / e.total) * 100) : 0
  }
  return { totalScore, totalMarks, percentage, perQuestion, topicScores }
}

/**
 * Build the `results/{id}` payload for this attempt (without the
 * server timestamp — callers add that). Mirrors the shape teacher
 * quizzes already use so existing Reports / Analytics /
 * WeaknessDetection work unchanged.
 */
export function buildResultDocBase({ artifact, scored, learnerId, learnerGrade }) {
  return {
    userId: learnerId,
    quizId: artifact.id,
    aiContentId: artifact.id,
    source: 'ai_practice',
    quizTitle: (artifact.content && artifact.content.title) ||
      `${artifact.subject || 'Subject'} — ${artifact.topic || 'Topic'}`,
    subject: artifact.subject || '',
    grade: artifact.grade != null ? String(artifact.grade) : String(learnerGrade || ''),
    topic: artifact.topic || '',
    subtopic: artifact.subtopic || '',
    score: scored.totalScore,
    totalMarks: scored.totalMarks,
    percentage: scored.percentage,
    topicScores: scored.topicScores,
    perQuestion: scored.perQuestion,
  }
}

/**
 * Build the `aiAgentTasks` weakness_analysis payload (without
 * server timestamps — callers add those).
 */
export function buildWeaknessTaskPayload({ artifact, learnerId, resultId }) {
  return {
    taskType: 'weakness_analysis',
    agentName: 'weakness',
    status: 'queued',
    grade: artifact.grade != null ? String(artifact.grade) : null,
    subject: artifact.subject || null,
    term: artifact.term || null,
    topic: artifact.topic || null,
    subtopic: artifact.subtopic || null,
    lessonNumber: null,
    assessmentType: null,
    parameters: {
      learnerId,
      weakLearnerId: learnerId,     // alias accepted by the runner
      triggerStudyTips: true,
    },
    startedAt: null, completedAt: null,
    resultContentId: null, errorMessage: null,
    triggeredBy: `ai_practice_attempt:${resultId}`,
  }
}

/**
 * Build the `aiAgentTasks` learner_feedback payload (without
 * server timestamps — callers add those).
 */
export function buildFeedbackTaskPayload({ artifact, learnerId, resultId }) {
  return {
    taskType: 'learner_feedback',
    agentName: 'feedback',
    status: 'queued',
    grade: artifact.grade != null ? String(artifact.grade) : null,
    subject: artifact.subject || null,
    term: artifact.term || null,
    topic: artifact.topic || null,
    subtopic: artifact.subtopic || null,
    lessonNumber: null,
    assessmentType: null,
    parameters: {
      learnerId,
      attemptId: resultId,
    },
    startedAt: null, completedAt: null,
    resultContentId: null, errorMessage: null,
    triggeredBy: `ai_practice_attempt:${resultId}`,
  }
}

/**
 * Estimate a sensible reading-time block for the list card. AI
 * practice quizzes don't always carry estimatedMinutes; fall back
 * to a 1.2-min-per-question heuristic so the card always renders
 * a value.
 */
export function estimatedMinutesForQuiz(artifact) {
  const c = artifact && artifact.content
  if (c && Number.isInteger(c.estimatedMinutes) && c.estimatedMinutes > 0) {
    return c.estimatedMinutes
  }
  const n = c && Array.isArray(c.questions) ? c.questions.length : 0
  if (!n) return 5
  return Math.max(3, Math.round(n * 1.2))
}

export function describeDifficulty(content) {
  if (!content || typeof content !== 'object') return 'mixed'
  if (typeof content.difficulty === 'string' && content.difficulty.length) {
    return content.difficulty
  }
  const qs = Array.isArray(content.questions) ? content.questions : []
  if (!qs.length) return 'mixed'
  const allEasy = qs.every(q => q.difficulty === 'easy')
  const allHard = qs.every(q => q.difficulty === 'hard')
  if (allEasy) return 'easy'
  if (allHard) return 'hard'
  return 'mixed'
}
