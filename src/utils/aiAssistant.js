import { getFunctions, httpsCallable } from 'firebase/functions'
import app, { auth, getAppCheckToken } from '../firebase/config'
import { apiUrl, isNativePlatform } from './runtime'
import { newRequestId } from './requestId'
import { toFriendlyError } from './friendlyErrors'

const functions = getFunctions(app, 'us-central1')

const aiChatCallable = httpsCallable(functions, 'aiChat')
const explainAnswerCallable = httpsCallable(functions, 'explainAnswer')
const generateQuizCallable = httpsCallable(functions, 'generateQuizQuestions')
const structureImportedQuizCallable = httpsCallable(functions, 'structureImportedQuiz')
const generateStudyPlanCallable = httpsCallable(functions, 'generateStudyPlan')
const structureScannedQuizCallable = httpsCallable(functions, 'structureScannedQuiz')
const structureImportedNoteCallable = httpsCallable(functions, 'structureImportedNote')
const ocrNotePagesCallable = httpsCallable(functions, 'ocrNotePages')
const suggestQuizAnswersCallable = httpsCallable(functions, 'suggestQuizAnswers')
const editQuizQuestionCallable = httpsCallable(functions, 'editQuizQuestion')
// Client timeouts are intentionally a bit longer than the matching Cloud
// Function timeoutSeconds — so the server's own error surfaces rather than
// the client giving up first. Claude Sonnet can easily take 15–25s on a
// cold start with a long CBC system prompt and ~1000-token output.
const AI_CHAT_TIMEOUT_MS = 35000       // server: 30s
// Watchdog for the streaming read loop: if the SSE connection goes quiet for
// this long (no token, no [DONE], no close — common on flaky mobile / Android
// WebView where a dropped connection just hangs), abort and surface an error
// instead of leaving Zed's chat input disabled forever on "thinking…".
const AI_CHAT_STREAM_STALL_MS = 30000
const AI_EXPLAIN_TIMEOUT_MS = 35000    // server: 30s
const AI_QUIZ_TIMEOUT_MS = 50000       // server: 45s
const AI_IMPORT_TIMEOUT_MS = 370000    // server: 360s (Gemini → Claude pipeline over a full past paper)
const AI_STUDY_PLAN_TIMEOUT_MS = 50000 // server: 45s
const AI_SCANNED_IMPORT_TIMEOUT_MS = 310000 // server: 300s (vision OCR over a page batch)
const AI_SUGGEST_ANSWERS_TIMEOUT_MS = 125000 // server: 120s (batch of MCQs in one call)
const AI_EDIT_TIMEOUT_MS = 50000       // server: 45s (single-question edit)

function messageFromError(error) {
  const code = error?.code || ''
  const rawMessage = String(error?.message || '')
  // App Check enforcement surfaces as permission-denied ("App Check
  // verification failed.") on the HTTP soft-verify path, and as
  // unauthenticated ("Firebase App Check token is invalid.") when a callable
  // has enforceAppCheck on. Both carry App-Check / attestation wording. Detect
  // it FIRST so a security-attestation failure gets a clear, actionable message
  // instead of the misleading "only available for teachers and admins" — a
  // teacher whose reCAPTCHA token hasn't propagated is NOT a role problem, and
  // that copy sends them chasing the wrong fix.
  if (/app[\s-]?check|attestation/i.test(rawMessage)) {
    return 'Security check failed — please refresh the page and try again. If it keeps happening, clear your cache or try a different browser.'
  }
  // Domain-specific copy that beats the generic templates — keep it.
  if (code.includes('resource-exhausted')) {
    return 'Daily AI limit reached. Please try again tomorrow.'
  }
  if (code.includes('permission-denied')) {
    return 'This AI tool is only available for teachers and admins.'
  }
  if (code.includes('unauthenticated')) {
    return 'Please sign in before using Zed.'
  }
  // Real infrastructure failures (Firebase/HTTP codes, offline, 5xx) get calm
  // mapped copy instead of a raw technical string. We deliberately pass NO
  // category bias: our own thrown errors (withTimeout messages, SSE [ERROR]
  // fallbacks) resolve to category 'unknown' and keep their already-friendly
  // `.message`, while only genuinely-technical failures get remapped.
  const online = typeof navigator !== 'undefined' ? navigator.onLine : undefined
  const friendly = toFriendlyError(error, { online })
  if (friendly.category !== 'unknown') {
    return friendly.message
  }
  return error?.message || 'Zed is unavailable right now. Please try again.'
}

function isHardAIError(error) {
  const code = error?.code || ''
  // permission-denied falls back to local template questions rather than
  // blocking generation entirely (role mismatches shouldn't silence the feature)
  return ['resource-exhausted', 'unauthenticated', 'invalid-argument']
    .some(item => code.includes(item))
}

function withTimeout(promise, timeoutMs, message) {
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      setTimeout(() => reject(Object.assign(new Error(message), { code: 'timeout' })), timeoutMs)
    }),
  ])
}

function clampQuestionCount(value) {
  // Server-side cap is 25 (generateQuiz.js clamps 3-25); match it here so
  // the studio's count dropdown isn't silently truncated to 10.
  return Math.min(Math.max(Number(value) || 5, 1), 25)
}

function rotateQuestionOptions(options, correctAnswer, offset) {
  const items = options.map((text, index) => ({ text, correct: index === correctAnswer }))
  const shift = offset % items.length
  const rotated = [...items.slice(shift), ...items.slice(0, shift)]
  return {
    options: rotated.map(item => item.text),
    correctAnswer: rotated.findIndex(item => item.correct),
  }
}

function topicFacts(topic, subject, grade) {
  const t = String(topic || '').toLowerCase()
  if (/(respir|breath|lung|air sac|alveoli)/.test(t)) {
    return {
      idea: 'The respiratory system helps the body take in oxygen and remove carbon dioxide.',
      example: 'The lungs, windpipe, and nose work together during breathing.',
      importance: 'Body cells need oxygen to release energy from food.',
      misconception: 'Food does not travel through the windpipe into the lungs.',
      keyWord: 'lungs',
    }
  }
  if (/(fraction|decimal|numerator|denominator)/.test(t)) {
    return {
      idea: 'A fraction shows equal parts of a whole.',
      example: 'In 3/4, the denominator 4 shows four equal parts.',
      importance: 'Fractions help compare parts, shares, and measurements.',
      misconception: 'The denominator is not the number of shaded parts.',
      keyWord: 'denominator',
    }
  }
  if (/(photosynthesis|plant|leaf|flower)/.test(t)) {
    return {
      idea: 'Plants use sunlight, water, and carbon dioxide to make food.',
      example: 'Leaves help plants make food using sunlight.',
      importance: 'Plants provide food and oxygen for living things.',
      misconception: 'Plants do not get all their food from soil.',
      keyWord: 'leaf',
    }
  }
  if (/(verb|noun|grammar|sentence|adjective)/.test(t)) {
    return {
      idea: 'Grammar helps words work clearly in a sentence.',
      example: 'A verb tells what someone or something does.',
      importance: 'Good grammar makes writing easier to understand.',
      misconception: 'A noun names a person, place, thing, or idea.',
      keyWord: 'verb',
    }
  }
  return {
    idea: `${topic} is an important idea in ${subject || 'this subject'}.`,
    example: `A good example can help a Grade ${grade || '4 to 6'} learner understand ${topic}.`,
    importance: `Learning ${topic} helps learners answer questions in ${subject || 'class'}.`,
    misconception: `Do not guess: read each ${topic} question carefully before answering.`,
    keyWord: String(topic || subject || 'topic'),
  }
}

function makeLocalQuizQuestions(payload) {
  const subject = String(payload.subject || 'General Studies').trim()
  const grade = String(payload.grade || '4').trim()
  const topic = String(payload.topic || 'the topic').trim()
  const count = clampQuestionCount(payload.count)
  const facts = topicFacts(topic, subject, grade)
  const templates = [
    {
      text: `What is the best description of ${topic}?`,
      correct: facts.idea,
      distractors: [
        `${topic} is not connected to ${subject}.`,
        `${topic} is only used outside school.`,
        `${topic} has no examples.`,
      ],
      explanation: facts.idea,
    },
    {
      text: `Which example is most closely related to ${topic}?`,
      correct: facts.example,
      distractors: [
        'Ignoring all details in a question.',
        'Choosing an answer before reading.',
        'Writing without checking the topic.',
      ],
      explanation: `This example connects directly to ${topic}.`,
    },
    {
      text: `Why is ${topic} important in ${subject}?`,
      correct: facts.importance,
      distractors: [
        'It makes learners skip explanations.',
        'It means every answer is correct.',
        'It is only useful for spelling names.',
      ],
      explanation: facts.importance,
    },
    {
      text: `Which statement about ${topic} should learners remember?`,
      correct: facts.misconception,
      distractors: [
        `${topic} never appears in schoolwork.`,
        `All ${subject} questions have the same answer.`,
        'Pictures and examples should always be ignored.',
      ],
      explanation: facts.misconception,
    },
    {
      text: `What is a useful key word for ${topic}?`,
      correct: facts.keyWord,
      distractors: ['unrelated', 'random', 'none'],
      explanation: `A key word helps learners remember ${topic}.`,
    },
  ]

  // The fast local draft honours the requested question type so a network
  // hiccup never silently swaps short-answer/true-false requests for MCQs.
  const requestedType = String(payload.type || 'mcq').toLowerCase()

  return Array.from({ length: count }, (_, index) => {
    const template = templates[index % templates.length]
    const effectiveType = requestedType === 'mixed'
      ? ['mcq', 'true_false', 'short_answer'][index % 3]
      : requestedType

    if (effectiveType === 'short_answer') {
      return {
        text: `${template.text} Write your answer in one word or phrase.`,
        options: [],
        correctAnswer: template.correct,
        explanation: `${template.explanation} Review this quick draft before publishing.`,
        topic,
        marks: 1,
        type: 'short_answer',
        generatedBy: 'fast_draft',
      }
    }
    if (effectiveType === 'true_false') {
      const statementIsTrue = index % 2 === 0
      return {
        text: statementIsTrue
          ? `True or false: ${template.correct}`
          : `True or false: ${template.distractors[0]}`,
        options: ['True', 'False'],
        correctAnswer: statementIsTrue ? 0 : 1,
        explanation: `${template.explanation} Review this quick draft before publishing.`,
        topic,
        marks: 1,
        type: 'mcq',
        generatedBy: 'fast_draft',
      }
    }
    const { options, correctAnswer } = rotateQuestionOptions(
      [template.correct, ...template.distractors],
      0,
      index,
    )
    return {
      text: template.text,
      options,
      correctAnswer,
      explanation: `${template.explanation} Review this quick draft before publishing.`,
      topic,
      marks: 1,
      type: 'mcq',
      generatedBy: 'fast_draft',
    }
  })
}

/**
 * Streaming version of sendAIChat. Connects to the SSE endpoint and calls
 * onToken(text) for each text chunk as it arrives. Calls onDone(fullText)
 * when the stream completes, or onError(err) on failure.
 *
 * Falls back to the buffered callable path in DEV so the dev server works
 * without needing a running Cloud Functions emulator.
 */
export function sendAIChatStream({
  message,
  context,
  history = [],
  systemPrompt,
  onToken,
  onDone,
  onError,
}) {
  const payload = { message, context, history }
  if (systemPrompt) payload.systemPrompt = systemPrompt

  let cancelled = false
  // Hoisted so the returned cancel() can abort an in-flight fetch — otherwise
  // a cancel while reader.read() is blocked wouldn't take effect until the
  // next chunk (which may never come on a stalled connection).
  let activeController = null

  async function run() {
    let token
    try {
      token = await auth.currentUser?.getIdToken()
      if (!token) throw new Error('Please sign in before using Zed.')
    } catch (err) {
      onError?.(new Error(messageFromError(err)))
      return
    }

    // DEV + Capacitor wrapper: callable doesn't stream so we get the full
    // reply and pass it through onToken in one shot, then onDone. On Android
    // WebView the SSE ReadableStream is unreliable (some versions buffer
    // until the connection closes, which kills "live typing"), so the
    // wrapper takes the same path as DEV — no streaming, but Zed actually
    // replies.
    if (import.meta.env.DEV || isNativePlatform()) {
      try {
        const response = await withTimeout(
          aiChatCallable(payload),
          AI_CHAT_TIMEOUT_MS,
          'Zed is taking too long to reply. Please try again in a moment.',
        )
        const reply = String(response.data?.reply || '').trim()
        if (!cancelled) {
          onToken?.(reply)
          onDone?.(reply)
        }
        return
      } catch (err) {
        if (!cancelled) onError?.(new Error(messageFromError(err)))
        return
      }
    }

    let fullText = ''
    // AbortController lets the stall watchdog (and the caller's cancel) tear
    // the connection down even while it's blocked inside reader.read().
    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null
    activeController = controller
    let stalled = false
    let stallTimer = null
    const armStallTimer = () => {
      if (!controller) return
      if (stallTimer) clearTimeout(stallTimer)
      stallTimer = setTimeout(() => {
        stalled = true
        controller.abort()
      }, AI_CHAT_STREAM_STALL_MS)
    }
    try {
      const appCheckToken = await getAppCheckToken()
      const response = await withTimeout(
        fetch(apiUrl('/api/ai/chat'), {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-request-id': newRequestId(),
            Authorization: `Bearer ${token}`,
            ...(appCheckToken ? { 'X-Firebase-AppCheck': appCheckToken } : {}),
          },
          body: JSON.stringify(payload),
          signal: controller?.signal,
        }),
        AI_CHAT_TIMEOUT_MS,
        'Zed is taking too long to reply. Please try again in a moment.',
      )

      if (!response.ok || !response.body) {
        const data = await response.json().catch(() => ({}))
        throw new Error(data.error || 'Zed is unavailable right now. Please try again.')
      }

      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      armStallTimer()
      while (true) {
        const { done, value } = await reader.read()
        // Each chunk (or close) is a sign of life — reset the watchdog.
        armStallTimer()
        if (done || cancelled) break
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          const raw = line.slice(6).trim()
          if (raw === '[DONE]') {
            if (!cancelled) onDone?.(fullText)
            return
          }
          if (raw.startsWith('[ERROR]')) {
            try {
              const { error } = JSON.parse(raw.slice(7).trim())
              throw new Error(error || 'Zed is unavailable right now.')
            } catch (parseErr) {
              throw new Error('Zed is unavailable right now. Please try again.')
            }
          }
          try {
            const { text } = JSON.parse(raw)
            if (typeof text === 'string') {
              fullText += text
              if (!cancelled) onToken?.(text)
            }
          } catch {
            // ignore malformed SSE lines
          }
        }
      }

      // Stream ended without [DONE] — treat accumulated text as complete.
      if (!cancelled) onDone?.(fullText)
    } catch (err) {
      if (cancelled) return
      // A stall-triggered abort surfaces as an AbortError — translate it into
      // a friendly timeout message rather than the raw "aborted" string. All
      // other failures go through messageFromError so a raw network error
      // (e.g. "Failed to fetch") is mapped to calm copy, not echoed verbatim.
      const message = stalled
        ? 'Zed lost connection mid-reply. Please try again.'
        : messageFromError(err)
      onError?.(new Error(message))
    } finally {
      if (stallTimer) clearTimeout(stallTimer)
    }
  }

  run()

  // Return a cancel function so the component can stop the stream on unmount.
  return () => {
    cancelled = true
    try { activeController?.abort() } catch { /* already settled */ }
  }
}

export async function sendAIChat({
  message,
  context,
  history = [],
  systemPrompt,
}) {
  const payload = { message, context, history }
  if (systemPrompt) payload.systemPrompt = systemPrompt

  try {
    const token = await auth.currentUser?.getIdToken()
    if (!token) throw new Error('Please sign in before using Zed.')
    const appCheckToken = await getAppCheckToken()

    const response = await withTimeout(
      fetch(apiUrl('/api/ai/chat'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
          ...(appCheckToken ? { 'X-Firebase-AppCheck': appCheckToken } : {}),
        },
        body: JSON.stringify(payload),
      }),
      AI_CHAT_TIMEOUT_MS,
      'Zed is taking too long to reply. Please try again in a moment.',
    )
    const data = await response.json().catch(() => ({}))
    if (!response.ok) {
      throw new Error(data.error || 'Zed is unavailable right now. Please try again.')
    }
    return String(data.reply || '').trim()
  } catch (error) {
    if (import.meta.env.DEV && !error?.message?.includes('sign in')) {
      try {
        const response = await withTimeout(
          aiChatCallable(payload),
          AI_CHAT_TIMEOUT_MS,
          'Zed is taking too long to reply. Please try again in a moment.',
        )
        return String(response.data?.reply || '').trim()
      } catch (fallbackError) {
        throw new Error(messageFromError(fallbackError))
      }
    }
    throw new Error(messageFromError(error))
  }
}

export async function explainQuizAnswer(payload) {
  try {
    const response = await withTimeout(
      explainAnswerCallable(payload),
      AI_EXPLAIN_TIMEOUT_MS,
      'Answer explanation is taking too long. Please try again.',
    )
    return String(response.data?.explanation || '').trim()
  } catch (error) {
    throw new Error(messageFromError(error))
  }
}

// Returns { questions, warning } where warning is a human-readable note
// from the CBC knowledge-base resolver (e.g. "topic not verified — nearest
// topics for this grade+subject: X, Y, Z") or null when the topic matched
// a verified KB entry. The UI can surface the warning so teachers know
// when Zed fell back to general CBC knowledge.
//
// Local-fallback path (network/timeout/soft errors) always returns
// warning: null because we can't surface a KB miss from the client.
export async function generateAIQuizQuestions(payload) {
  try {
    const response = await withTimeout(
      generateQuizCallable(payload),
      AI_QUIZ_TIMEOUT_MS,
      'Zed is taking too long, so a quick editable draft was created.',
    )
    const questions = Array.isArray(response.data?.questions) ? response.data.questions : []
    const warning = typeof response.data?.warning === 'string' ? response.data.warning : null
    return { questions, warning }
  } catch (error) {
    if (!isHardAIError(error)) {
      return { questions: makeLocalQuizQuestions(payload), warning: null }
    }
    throw new Error(messageFromError(error))
  }
}

// Per-question AI edit. `payload` = { action, question, options, correctAnswer,
// subject, grade, topic }. Returns { action, patch } where patch only contains
// the fields the model changed (text / options / correctAnswer / explanation /
// note). Maths in the patch comes back as import markup — the caller runs it
// through importRichText before applying so fractions/sums/tables render.
export async function aiEditQuizQuestion(payload) {
  try {
    const response = await withTimeout(
      editQuizQuestionCallable(payload),
      AI_EDIT_TIMEOUT_MS,
      'The AI editor is taking too long. Please try again.',
    )
    const data = response.data || {}
    return {
      action: data.action || payload.action,
      patch: data.patch && typeof data.patch === 'object' ? data.patch : {},
    }
  } catch (error) {
    throw new Error(messageFromError(error))
  }
}

export async function structureImportedQuiz(payload) {
  try {
    const response = await withTimeout(
      structureImportedQuizCallable(payload),
      AI_IMPORT_TIMEOUT_MS,
      'Smart import is taking too long. Using the standard import instead.',
    )
    return {
      sections: Array.isArray(response.data?.sections) ? response.data.sections : [],
      warnings: Array.isArray(response.data?.warnings) ? response.data.warnings : [],
    }
  } catch (error) {
    throw new Error(messageFromError(error))
  }
}

export async function generateAIStudyPlan(payload = {}) {
  try {
    const response = await withTimeout(
      generateStudyPlanCallable(payload),
      AI_STUDY_PLAN_TIMEOUT_MS,
      'Study planner is taking too long. Please try again.',
    )
    return {
      plan: response.data?.plan || null,
      warning: response.data?.warning || '',
    }
  } catch (error) {
    throw new Error(messageFromError(error))
  }
}

// Bulk "suggest answers" for the editor's answer-key tools. `payload.questions`
// is [{ id, text, options }]; returns { answers: { id: index }, count, asked }.
// The answers are AI suggestions the admin still verifies.
export async function suggestQuizAnswers(payload) {
  try {
    const response = await withTimeout(
      suggestQuizAnswersCallable(payload),
      AI_SUGGEST_ANSWERS_TIMEOUT_MS,
      'Suggesting answers is taking too long. Please try again.',
    )
    const data = response.data || {}
    return {
      answers: data.answers && typeof data.answers === 'object' ? data.answers : {},
      count: Number(data.count) || 0,
      asked: Number(data.asked) || 0,
    }
  } catch (error) {
    throw new Error(messageFromError(error))
  }
}

// Scanned past-paper OCR import. `payload.pages` is one batch of rendered PDF
// page images ({ pageNumber, dataUrl }); the caller paginates a long paper and
// calls this once per batch. Returns blank-answer MCQs flagged for review.
export async function structureScannedQuiz(payload) {
  try {
    const response = await withTimeout(
      structureScannedQuizCallable(payload),
      AI_SCANNED_IMPORT_TIMEOUT_MS,
      'Reading the scanned pages is taking too long. Please try a smaller file or try again.',
    )
    const data = response.data || {}
    return {
      sections: Array.isArray(data.sections) ? data.sections : [],
      // Declared Part structure (printed ranges + shared instructions) the
      // client reconciler uses as ground truth — drop phantom over-counts,
      // repair mis-read numbers, and fill stem-less spelling/punctuation items.
      parts: Array.isArray(data.parts) ? data.parts : [],
      warnings: Array.isArray(data.warnings) ? data.warnings : [],
      detectedCount: Number(data.detectedCount) || 0,
      extractedCount: Number(data.extractedCount) || 0,
      // The deployed function's engine-version stamp. Surfaced in the editor
      // so a stale Cloud Function deploy is observable rather than silent.
      engineVersion: typeof data.engineVersion === 'string' ? data.engineVersion : '',
    }
  } catch (error) {
    // Keep the original error code alongside the friendly message — the
    // importer's retry ladder needs it to tell a retryable timeout apart from
    // a hard failure like the daily AI limit (which must NOT be retried).
    throw Object.assign(new Error(messageFromError(error)), { code: error?.code || '' })
  }
}

// Note document import — text-based (pasted text, DOCX, text-PDF). `payload`
// contains { documentText, fileName }. Returns { blocks, warnings } where
// blocks is the AI-structured study note content (validated by the caller via
// coerceStudyBlocks) and warnings is a human-readable list of caveats.
export async function structureImportedNote(payload) {
  try {
    const response = await withTimeout(
      structureImportedNoteCallable(payload),
      AI_IMPORT_TIMEOUT_MS,
      'Note import is taking too long. Please try again.',
    )
    return {
      blocks: Array.isArray(response.data?.blocks) ? response.data.blocks : [],
      warnings: Array.isArray(response.data?.warnings) ? response.data.warnings : [],
    }
  } catch (error) {
    throw new Error(messageFromError(error))
  }
}

// Note OCR — one batch of scanned PDF page snapshots ({ pageNumber, dataUrl }).
// The caller batches a long document and calls this once per batch, then
// concatenates the returned text before passing it to structureImportedNote.
// Returns { text } — the raw OCR transcript for this batch.
export async function ocrNotePages(payload) {
  try {
    const response = await withTimeout(
      ocrNotePagesCallable(payload),
      AI_SCANNED_IMPORT_TIMEOUT_MS,
      'OCR is taking too long. Please try a smaller file or try again.',
    )
    return { text: String(response.data?.text || '') }
  } catch (error) {
    throw new Error(messageFromError(error))
  }
}
