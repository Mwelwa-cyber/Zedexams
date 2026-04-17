let localIdCounter = 0

function nextLocalId(prefix) {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `${prefix}-${crypto.randomUUID()}`
  }
  localIdCounter += 1
  return `${prefix}-${Date.now()}-${localIdCounter}`
}

export const QUESTION_LETTERS = ['A', 'B', 'C', 'D']

export function getQuestionKey(question = {}) {
  return question.localId || question._id || question.id || question.order || ''
}

export function emptyQuestion(overrides = {}) {
  return {
    localId: nextLocalId('question'),
    _id: null,
    text: '',
    options: ['', '', '', ''],
    correctAnswer: 0,
    explanation: '',
    topic: '',
    marks: 1,
    type: 'mcq',
    detectedType: 'mcq',
    imageUrl: '',
    imageUploading: false,
    imageUploadStep: '',
    imageAssetId: '',
    diagramText: '',
    requiresReview: false,
    reviewNotes: [],
    importWarnings: [],
    sourcePage: null,
    passageId: null,
    ...overrides,
  }
}

export function emptyPassageQuestion(overrides = {}) {
  return emptyQuestion({
    type: 'mcq',
    detectedType: 'mcq',
    options: ['', '', '', ''],
    correctAnswer: 0,
    imageUrl: '',
    imageUploading: false,
    imageUploadStep: '',
    imageAssetId: '',
    diagramText: '',
    ...overrides,
  })
}

export function createStandaloneSection(questionOverrides = {}) {
  return {
    id: nextLocalId('section'),
    kind: 'standalone',
    question: emptyQuestion(questionOverrides),
  }
}

export function createPassageSection(passageOverrides = {}) {
  const passageId = passageOverrides.id || nextLocalId('passage')
  const questionOverrides = Array.isArray(passageOverrides.questions)
    ? passageOverrides.questions
    : [emptyPassageQuestion()]

  return {
    id: passageId,
    kind: 'passage',
    passage: {
      id: passageId,
      title: '',
      instructions: '',
      passageText: '',
      imageUrl: '',
      imageUploading: false,
      imageUploadStep: '',
      collapsed: false,
      questions: questionOverrides.map(question =>
        emptyPassageQuestion({
          ...question,
          passageId,
        })),
      ...passageOverrides,
      id: passageId,
    },
  }
}

function richFieldEmpty(value) {
  if (!value) return true
  if (typeof value === 'string') return !value.trim()
  // Tiptap JSON object
  if (typeof value === 'object' && value.type === 'doc') {
    const content = value.content || []
    if (content.length === 0) return true
    if (content.length === 1 && content[0].type === 'paragraph') {
      const inner = content[0].content || []
      return inner.length === 0 || (inner.length === 1 && !inner[0].text?.trim())
    }
    return false
  }
  return true
}

function serializeRichField(value) {
  if (!value) return ''
  if (typeof value === 'string') return value
  // Tiptap JSON object → store as JSON string
  if (typeof value === 'object' && value.type === 'doc') return JSON.stringify(value)
  return String(value)
}

function hydrateRichField(value) {
  if (!value) return ''
  if (typeof value === 'object') return value  // already Tiptap JSON
  if (typeof value === 'string') {
    // Try parsing as Tiptap JSON
    try {
      const parsed = JSON.parse(value)
      if (parsed && parsed.type === 'doc') return parsed
    } catch {
      // plain string
    }
    return value
  }
  return value
}

export function isQuestionBlank(question = {}) {
  const options = Array.isArray(question.options) ? question.options : []
  const correctAnswer = typeof question.correctAnswer === 'string'
    ? question.correctAnswer.trim()
    : question.correctAnswer

  return richFieldEmpty(question.text) &&
    richFieldEmpty(question.explanation) &&
    !String(question.topic ?? '').trim() &&
    !String(question.diagramText ?? '').trim() &&
    !String(question.imageUrl ?? '').trim() &&
    options.every(option => !String(option ?? '').trim()) &&
    (correctAnswer === '' || correctAnswer === 0)
}

export function hasOnlyEmptyStarterSection(sections = []) {
  return sections.length === 1 &&
    sections[0]?.kind === 'standalone' &&
    isQuestionBlank(sections[0]?.question)
}

export function countQuizQuestions(sections = []) {
  return sections.reduce((total, section) => {
    if (section.kind === 'passage') {
      return total + (section.passage?.questions?.length || 0)
    }
    return total + 1
  }, 0)
}

export function countQuizMarks(sections = []) {
  return sections.reduce((total, section) => {
    if (section.kind === 'passage') {
      return total + (section.passage?.questions || []).reduce((sum, question) => sum + (question.marks || 1), 0)
    }
    return total + (section.question?.marks || 1)
  }, 0)
}

export function serializeQuizSections(sections = []) {
  const passages = []
  const questions = []
  let questionOrder = 1

  sections.forEach(section => {
    if (section.kind === 'passage') {
      const passage = section.passage || {}
      const passageId = passage.id || nextLocalId('passage')
      const startOrder = questionOrder

      passages.push({
        id: passageId,
        title: String(passage.title ?? '').trim(),
        instructions: serializeRichField(passage.instructions),
        passageText: serializeRichField(passage.passageText),
        imageUrl: passage.imageUrl || null,
        order: startOrder,
      })

      ;(passage.questions || []).forEach(question => {
        questions.push({
          ...question,
          passageId,
          type: 'mcq',
          detectedType: 'mcq',
          order: questionOrder,
        })
        questionOrder += 1
      })
      return
    }

    questions.push({
      ...(section.question || emptyQuestion()),
      passageId: null,
      order: questionOrder,
    })
    questionOrder += 1
  })

  return {
    passages,
    questions,
    questionCount: questions.length,
    totalMarks: questions.reduce((sum, question) => sum + (question.marks || 1), 0),
  }
}

function hydrateStandaloneQuestion(question = {}) {
  const type = question.type ?? 'mcq'
  const isTextAnswer = type === 'short_answer' || type === 'diagram'

  return emptyQuestion({
    localId: question.id || question._id || question.localId || nextLocalId('question'),
    _id: question.id || question._id || null,
    text: hydrateRichField(question.text ?? ''),
    options: isTextAnswer
      ? []
      : Array.isArray(question.options) && question.options.length
        ? question.options
        : ['', '', '', ''],
    correctAnswer: isTextAnswer
      ? String(question.correctAnswer ?? '')
      : question.correctAnswer ?? 0,
    explanation: hydrateRichField(question.explanation ?? ''),
    topic: question.topic ?? '',
    marks: question.marks ?? 1,
    type,
    detectedType: question.detectedType ?? type,
    imageUrl: question.imageUrl ?? '',
    imageAssetId: question.imageAssetId ?? '',
    diagramText: question.diagramText ?? '',
    requiresReview: Boolean(question.requiresReview),
    reviewNotes: question.reviewNotes ?? [],
    importWarnings: question.importWarnings ?? [],
    sourcePage: question.sourcePage ?? null,
    passageId: question.passageId ?? null,
    imageUploading: false,
    imageUploadStep: '',
  })
}

function hydratePassageQuestion(question = {}, passageId) {
  return emptyPassageQuestion({
    localId: question.id || question._id || question.localId || nextLocalId('question'),
    _id: question.id || question._id || null,
    text: hydrateRichField(question.text ?? ''),
    options: Array.isArray(question.options) && question.options.length
      ? question.options
      : ['', '', '', ''],
    correctAnswer: question.correctAnswer ?? 0,
    explanation: hydrateRichField(question.explanation ?? ''),
    topic: question.topic ?? '',
    marks: question.marks ?? 1,
    requiresReview: Boolean(question.requiresReview),
    reviewNotes: question.reviewNotes ?? [],
    importWarnings: question.importWarnings ?? [],
    sourcePage: question.sourcePage ?? null,
    passageId,
    imageUploading: false,
    imageUploadStep: '',
  })
}

export function hydrateQuizSections(questions = [], passages = []) {
  const sortedQuestions = [...questions].sort((left, right) => (left.order ?? 0) - (right.order ?? 0))
  const passageSections = new Map()

  passages.forEach(passage => {
    const section = createPassageSection({
      id: passage.id,
      title: passage.title ?? '',
      instructions: hydrateRichField(passage.instructions ?? ''),
      passageText: hydrateRichField(passage.passageText ?? ''),
      imageUrl: passage.imageUrl ?? '',
      questions: [],
    })
    passageSections.set(passage.id, {
      order: passage.order ?? Number.MAX_SAFE_INTEGER,
      section,
    })
  })

  const standaloneSections = []

  sortedQuestions.forEach(question => {
    if (question.passageId) {
      const existing = passageSections.get(question.passageId)
      const container = existing || {
        order: question.order ?? Number.MAX_SAFE_INTEGER,
        section: createPassageSection({
          id: question.passageId,
          questions: [],
        }),
      }

      container.section.passage.questions.push(hydratePassageQuestion(question, question.passageId))
      if (!existing) {
        passageSections.set(question.passageId, container)
      }
      return
    }

    standaloneSections.push({
      order: question.order ?? Number.MAX_SAFE_INTEGER,
      section: createStandaloneSection(hydrateStandaloneQuestion(question)),
    })
  })

  const combined = [
    ...standaloneSections,
    ...Array.from(passageSections.values()).map(entry => {
      if (!entry.section.passage.questions.length) {
        entry.section.passage.questions = [emptyPassageQuestion({ passageId: entry.section.passage.id })]
      }
      return entry
    }),
  ]
    .sort((left, right) => left.order - right.order)
    .map(entry => entry.section)

  return combined.length ? combined : [createStandaloneSection()]
}

export function buildQuizDisplaySections(questions = [], passages = []) {
  const sortedQuestions = [...questions].sort((left, right) => (left.order ?? 0) - (right.order ?? 0))
  const passageBlocks = new Map()

  passages.forEach(passage => {
    passageBlocks.set(passage.id, {
      id: passage.id,
      kind: 'passage',
      order: passage.order ?? Number.MAX_SAFE_INTEGER,
      passage: {
        id: passage.id,
        title: passage.title ?? '',
        instructions: passage.instructions ?? '',
        passageText: passage.passageText ?? '',
        imageUrl: passage.imageUrl ?? '',
      },
      questions: [],
    })
  })

  const standaloneBlocks = []

  sortedQuestions.forEach(question => {
    const hydratedQuestion = hydrateStandaloneQuestion(question)

    if (question.passageId) {
      const existingBlock = passageBlocks.get(question.passageId)
      const block = existingBlock || {
        id: question.passageId,
        kind: 'passage',
        order: question.order ?? Number.MAX_SAFE_INTEGER,
        passage: {
          id: question.passageId,
          title: '',
          instructions: '',
          passageText: '',
          imageUrl: '',
        },
        questions: [],
      }

      block.questions.push({
        ...hydratePassageQuestion(question, question.passageId),
        id: question.id || question._id,
      })

      if (!existingBlock) {
        passageBlocks.set(question.passageId, block)
      }
      return
    }

    standaloneBlocks.push({
      id: question.id || question._id || question.localId || nextLocalId('standalone'),
      kind: 'standalone',
      order: question.order ?? Number.MAX_SAFE_INTEGER,
      question: {
        ...hydratedQuestion,
        id: question.id || question._id,
      },
    })
  })

  const sections = [
    ...standaloneBlocks,
    ...Array.from(passageBlocks.values()),
  ]
    .sort((left, right) => left.order - right.order)
    .map(section => {
      if (section.kind === 'passage') {
        return {
          ...section,
          questions: [...section.questions].sort((left, right) => (left.order ?? 0) - (right.order ?? 0)),
        }
      }
      return section
    })

  let questionNumber = 1
  const orderedQuestions = []

  const numberedSections = sections.map(section => {
    if (section.kind === 'passage') {
      const numberedQuestions = section.questions.map(question => {
        const nextQuestion = { ...question, questionNumber }
        orderedQuestions.push(nextQuestion)
        questionNumber += 1
        return nextQuestion
      })

      return {
        ...section,
        questions: numberedQuestions,
        startQuestionNumber: numberedQuestions[0]?.questionNumber ?? questionNumber,
      }
    }

    const numberedQuestion = {
      ...section.question,
      questionNumber,
    }
    orderedQuestions.push(numberedQuestion)
    questionNumber += 1

    return {
      ...section,
      question: numberedQuestion,
      startQuestionNumber: numberedQuestion.questionNumber,
    }
  })

  return {
    sections: numberedSections,
    questions: orderedQuestions,
  }
}
