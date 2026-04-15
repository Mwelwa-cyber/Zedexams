import { getFunctions, httpsCallable } from 'firebase/functions'
import app, { auth } from '../firebase/config'

const functions = getFunctions(app, 'us-central1')

const aiChatCallable = httpsCallable(functions, 'aiChat')
const explainAnswerCallable = httpsCallable(functions, 'explainAnswer')
const generateQuizCallable = httpsCallable(functions, 'generateQuizQuestions')
const AI_CHAT_TIMEOUT_MS = 12000
const AI_EXPLAIN_TIMEOUT_MS = 8000
const AI_QUIZ_TIMEOUT_MS = 7500

function messageFromError(error) {
  const code = error?.code || ''
  if (code.includes('resource-exhausted')) {
    return 'Daily AI limit reached. Please try again tomorrow.'
  }
  if (code.includes('permission-denied')) {
    return 'This AI tool is only available for teachers and admins.'
  }
  if (code.includes('unauthenticated')) {
    return 'Please sign in before using Zed.'
  }
  return error?.message || 'Zed is unavailable right now. Please try again.'
}

function isHardAIError(error) {
  const code = error?.code || ''
  return ['resource-exhausted', 'permission-denied', 'unauthenticated', 'invalid-argument']
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
  return Math.min(Math.max(Number(value) || 5, 1), 10)
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

  return Array.from({ length: count }, (_, index) => {
    const template = templates[index % templates.length]
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

export async function sendAIChat({ message, context, history = [] }) {
  try {
    const token = await auth.currentUser?.getIdToken()
    if (!token) throw new Error('Please sign in before using Zed.')

    const response = await withTimeout(
      fetch('/api/ai/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ message, context, history }),
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
          aiChatCallable({ message, context, history }),
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

export async function generateAIQuizQuestions(payload) {
  try {
    const response = await withTimeout(
      generateQuizCallable(payload),
      AI_QUIZ_TIMEOUT_MS,
      'Zed is taking too long, so a quick editable draft was created.',
    )
    return Array.isArray(response.data?.questions) ? response.data.questions : []
  } catch (error) {
    if (!isHardAIError(error)) {
      return makeLocalQuizQuestions(payload)
    }
    throw new Error(messageFromError(error))
  }
}
