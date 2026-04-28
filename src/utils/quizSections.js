// Rich-text format handling is now dual (HTML + Tiptap JSON) and lives in
// the serializeRichField / hydrateRichField / richFieldEmpty helpers below.
// ensureRichTextHtml from the legacy module is intentionally no longer used.

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
  const nextQuestion = {
    localId: nextLocalId('question'),
    _id: null,
    sharedInstruction: '',
    text: '',
    options: ['', '', '', ''],
    correctAnswer: 0,
    explanation: '',
    topic: '',
    marks: 1,
    type: 'mcq',
    detectedType: 'mcq',
    subtype: null,
    partId: null,
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

  // hydrateRichField is dual-format: it passes Tiptap JSON objects through,
  // parses JSON strings, and leaves HTML strings untouched. This lets
  // documentQuizImporter keep shipping HTML while the new editor ships JSON —
  // both flow through this constructor without being destroyed.
  return {
    ...nextQuestion,
    sharedInstruction: hydrateRichField(nextQuestion.sharedInstruction),
    text: hydrateRichField(nextQuestion.text),
    explanation: hydrateRichField(nextQuestion.explanation),
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

// A "Part" is a numbered grouping (e.g. "QUESTIONS 1-15") that wraps any
// number of standalone or passage sections. Parts live in a parallel array
// alongside `sections[]`; section membership is tracked via `question.partId`,
// not by nesting. This mirrors how `passages[]` is stored and keeps the
// section list flat for existing reorder/render code.
export function createPartGroup(overrides = {}) {
  const partId = overrides.id || nextLocalId('part')
  return {
    id: partId,
    title: overrides.title ?? '',
    instructions: hydrateRichField(overrides.instructions ?? ''),
    example: hydrateRichField(overrides.example ?? ''),
    order: overrides.order ?? 0,
  }
}

export function createPassageSection(passageOverrides = {}) {
  const passageId = passageOverrides.id || nextLocalId('passage')
  const questionOverrides = Array.isArray(passageOverrides.questions)
    ? passageOverrides.questions
    : [emptyPassageQuestion()]
  const nextPassage = {
    id: passageId,
    title: '',
    instructions: '',
    passageText: '',
    imageUrl: '',
    imageUploading: false,
    imageUploadStep: '',
    collapsed: false,
    ...passageOverrides,
    mapLocation: hydrateMapLocation(passageOverrides.mapLocation),
  }

  return {
    id: passageId,
    kind: 'passage',
    passage: {
      ...nextPassage,
      id: passageId,
      instructions: hydrateRichField(nextPassage.instructions),
      passageText: hydrateRichField(nextPassage.passageText),
      questions: questionOverrides.map(question =>
        emptyPassageQuestion({
          ...question,
          passageId,
        })),
    },
  }
}

// Map location helpers — passages can attach a Google Static Maps image with
// labelled markers (e.g. "Name the province at X."). Stored as a plain object
// so it round-trips through Firestore without conversion.
const MAP_TYPES = new Set(['roadmap', 'satellite', 'terrain', 'hybrid'])

export function hydrateMapLocation(value) {
  if (!value || typeof value !== 'object') return null
  const lat = Number(value.lat)
  const lng = Number(value.lng)
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null
  const zoom = Number.isFinite(Number(value.zoom)) ? Number(value.zoom) : 6
  const mapType = MAP_TYPES.has(value.mapType) ? value.mapType : 'roadmap'
  const rawMarkers = Array.isArray(value.markers) ? value.markers : []
  const markers = rawMarkers
    .map(marker => {
      if (!marker || typeof marker !== 'object') return null
      const mLat = Number(marker.lat)
      const mLng = Number(marker.lng)
      if (!Number.isFinite(mLat) || !Number.isFinite(mLng)) return null
      const label = String(marker.label ?? '').trim().slice(0, 1).toUpperCase()
      const color = String(marker.color ?? '').trim() || 'red'
      return { label, lat: mLat, lng: mLng, color }
    })
    .filter(Boolean)
  return { lat, lng, zoom, mapType, markers }
}

export function serializeMapLocation(value) {
  const hydrated = hydrateMapLocation(value)
  return hydrated // already a plain object or null — Firestore-safe
}

export function isMapLocationEmpty(value) {
  return !hydrateMapLocation(value)
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

  // For text-answer types (short_answer, fill) a non-empty correctAnswer
  // alone is enough to consider the question started, even if every other
  // field is empty. Otherwise the existing heuristic applies.
  const type = question.type ?? 'mcq'
  const isTextAnswerType = type === 'short_answer' || type === 'fill' || type === 'short' || type === 'diagram'
  if (isTextAnswerType && typeof correctAnswer === 'string' && correctAnswer.length > 0) {
    return false
  }

  // richFieldEmpty is format-aware (HTML string OR Tiptap JSON); the legacy
  // richTextHasContent only recognises HTML, so it would mark every Tiptap
  // JSON field as "blank" — which would make every new quiz fail validation.
  return richFieldEmpty(question.sharedInstruction) &&
    richFieldEmpty(question.text) &&
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

// Fisher-Yates shuffle of the order of an array. Returns a new array; does
// not mutate the input. Exported for tests.
export function shuffleArray(items = []) {
  const next = [...items]
  for (let index = next.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(Math.random() * (index + 1))
    ;[next[index], next[swap]] = [next[swap], next[index]]
  }
  return next
}

// Randomise the order of quiz questions while keeping structure intact:
//   • Ungrouped sections are shuffled among themselves.
//   • Each Part's member sections are shuffled within that Part.
//   • Each comprehension passage's sub-questions are shuffled within the passage.
// Sections never move across Parts; Parts themselves keep their order.
export function shuffleQuizSections(sections = []) {
  const ungrouped = []
  const groupedByPart = new Map()

  sections.forEach(section => {
    const partId = section.kind === 'passage'
      ? section.partId ?? null
      : section.question?.partId ?? null
    if (partId) {
      if (!groupedByPart.has(partId)) groupedByPart.set(partId, [])
      groupedByPart.get(partId).push(section)
    } else {
      ungrouped.push(section)
    }
  })

  const shuffleSubQuestions = section => {
    if (section.kind !== 'passage') return section
    const questions = section.passage?.questions || []
    if (questions.length < 2) return section
    return {
      ...section,
      passage: {
        ...section.passage,
        questions: shuffleArray(questions),
      },
    }
  }

  const shuffledUngrouped = shuffleArray(ungrouped).map(shuffleSubQuestions)
  const shuffledGroups = new Map(
    [...groupedByPart.entries()].map(([partId, members]) => (
      [partId, shuffleArray(members).map(shuffleSubQuestions)]
    )),
  )

  // Reassemble preserving the original "ungrouped first, then by Part order
  // discovered in the input" pattern that the editor already uses.
  const seenParts = new Set()
  const partOrderInOriginal = []
  sections.forEach(section => {
    const partId = section.kind === 'passage'
      ? section.partId ?? null
      : section.question?.partId ?? null
    if (partId && !seenParts.has(partId)) {
      seenParts.add(partId)
      partOrderInOriginal.push(partId)
    }
  })

  return [
    ...shuffledUngrouped,
    ...partOrderInOriginal.flatMap(partId => shuffledGroups.get(partId) || []),
  ]
}

export function serializeQuizSections(sections = [], parts = []) {
  // Dual-format safe: serializeRichField writes Tiptap JSON as a JSON string
  // (keeps objects out of Firestore document fields) and passes HTML strings
  // through untouched. Legacy quizzes still save as HTML until a teacher
  // edits them; new quizzes save as stringified Tiptap JSON from day one.
  const passages = []
  const questions = []
  let questionOrder = 1

  // Allow-list of valid Part IDs. Any partId on a question that doesn't match
  // gets dropped — defensive against stale references after a Part deletion.
  const validPartIds = new Set((parts || []).map(part => part.id).filter(Boolean))
  const resolvePartId = candidate => (candidate && validPartIds.has(candidate) ? candidate : null)

  sections.forEach(section => {
    if (section.kind === 'passage') {
      const passage = section.passage || {}
      const passageId = passage.id || nextLocalId('passage')
      const startOrder = questionOrder
      // All children of a passage share the same Part membership. Read it
      // off the passage section itself (set by assignSectionToPart) and fall
      // back to the first child's stored partId for round-trip compatibility.
      const passagePartId = resolvePartId(
        section.partId ?? passage.partId ?? (passage.questions?.[0]?.partId)
      )

      passages.push({
        id: passageId,
        title: String(passage.title ?? '').trim(),
        instructions: serializeRichField(passage.instructions),
        passageText: serializeRichField(passage.passageText),
        imageUrl: passage.imageUrl || null,
        mapLocation: serializeMapLocation(passage.mapLocation),
        order: startOrder,
        partId: passagePartId,
      })

      ;(passage.questions || []).forEach(question => {
        questions.push({
          ...question,
          sharedInstruction: serializeRichField(question.sharedInstruction),
          text: serializeRichField(question.text),
          explanation: serializeRichField(question.explanation),
          passageId,
          type: 'mcq',
          detectedType: 'mcq',
          subtype: question.subtype ?? null,
          partId: passagePartId,
          order: questionOrder,
        })
        questionOrder += 1
      })
      return
    }

    const question = section.question || emptyQuestion()
    questions.push({
      ...question,
      sharedInstruction: serializeRichField(question.sharedInstruction),
      text: serializeRichField(question.text),
      explanation: serializeRichField(question.explanation),
      passageId: null,
      subtype: question.subtype ?? null,
      partId: resolvePartId(question.partId),
      order: questionOrder,
    })
    questionOrder += 1
  })

  const serializedParts = (parts || []).map((part, index) => ({
    id: part.id,
    title: String(part.title ?? '').trim(),
    instructions: serializeRichField(part.instructions),
    example: serializeRichField(part.example),
    order: typeof part.order === 'number' ? part.order : index,
  }))

  return {
    passages,
    parts: serializedParts,
    questions,
    questionCount: questions.length,
    totalMarks: questions.reduce((sum, question) => sum + (question.marks || 1), 0),
  }
}

function hydrateStandaloneQuestion(question = {}) {
  const type = question.type ?? 'mcq'
  // `fill` answers are stored as a comma-separated string and behave like
  // short_answer/diagram for the purpose of options/correctAnswer shape.
  const isTextAnswer = type === 'short_answer' || type === 'diagram' || type === 'fill' || type === 'short'

  return emptyQuestion({
    localId: question.id || question._id || question.localId || nextLocalId('question'),
    _id: question.id || question._id || null,
    sharedInstruction: question.sharedInstruction ?? '',
    text: question.text ?? '',
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
    subtype: question.subtype ?? null,
    partId: question.partId ?? null,
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

function hydratePassageQuestion(question = {}, passageId, partId = null) {
  return emptyPassageQuestion({
    localId: question.id || question._id || question.localId || nextLocalId('question'),
    _id: question.id || question._id || null,
    sharedInstruction: question.sharedInstruction ?? '',
    text: question.text ?? '',
    options: Array.isArray(question.options) && question.options.length
      ? question.options
      : ['', '', '', ''],
    correctAnswer: question.correctAnswer ?? 0,
    explanation: hydrateRichField(question.explanation ?? ''),
    topic: question.topic ?? '',
    marks: question.marks ?? 1,
    subtype: question.subtype ?? null,
    partId: partId ?? question.partId ?? null,
    requiresReview: Boolean(question.requiresReview),
    reviewNotes: question.reviewNotes ?? [],
    importWarnings: question.importWarnings ?? [],
    sourcePage: question.sourcePage ?? null,
    passageId,
    imageUploading: false,
    imageUploadStep: '',
  })
}

export function hydrateQuizSections(questions = [], passages = [], parts = []) {
  // Returns `{ sections, parts }`. Pre-PRISCA-format callers passed only
  // questions+passages; the new return shape is a breaking change consumed by
  // EditQuizV2/CreateQuizV2 which both treat `parts` as opt-in state. Empty
  // `parts[]` keeps legacy quizzes behaving identically.
  const sortedQuestions = [...questions].sort((left, right) => (left.order ?? 0) - (right.order ?? 0))
  const passageSections = new Map()
  // Look up Part membership by passage id when we hydrate child questions.
  const passagePartIdById = new Map(
    (passages || []).map(passage => [passage.id, passage.partId ?? null])
  )

  passages.forEach(passage => {
    const section = createPassageSection({
      id: passage.id,
      title: passage.title ?? '',
      instructions: hydrateRichField(passage.instructions ?? ''),
      passageText: hydrateRichField(passage.passageText ?? ''),
      imageUrl: passage.imageUrl ?? '',
      mapLocation: passage.mapLocation ?? null,
      questions: [],
    })
    section.partId = passage.partId ?? null
    passageSections.set(passage.id, {
      order: passage.order ?? Number.MAX_SAFE_INTEGER,
      section,
    })
  })

  const standaloneSections = []

  sortedQuestions.forEach(question => {
    if (question.passageId) {
      const existing = passageSections.get(question.passageId)
      const inheritedPartId = passagePartIdById.has(question.passageId)
        ? passagePartIdById.get(question.passageId)
        : (question.partId ?? null)
      const container = existing || {
        order: question.order ?? Number.MAX_SAFE_INTEGER,
        section: (() => {
          const created = createPassageSection({
            id: question.passageId,
            questions: [],
          })
          created.partId = inheritedPartId
          return created
        })(),
      }

      container.section.passage.questions.push(
        hydratePassageQuestion(question, question.passageId, inheritedPartId)
      )
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
        entry.section.passage.questions = [
          emptyPassageQuestion({ passageId: entry.section.passage.id, partId: entry.section.partId ?? null }),
        ]
      }
      return entry
    }),
  ]
    .sort((left, right) => left.order - right.order)
    .map(entry => entry.section)

  const sections = combined.length ? combined : [createStandaloneSection()]

  const hydratedParts = (parts || [])
    .map((part, index) => createPartGroup({
      id: part.id,
      title: part.title ?? '',
      instructions: part.instructions ?? '',
      example: part.example ?? '',
      order: typeof part.order === 'number' ? part.order : index,
    }))
    .sort((left, right) => (left.order ?? 0) - (right.order ?? 0))

  return { sections, parts: hydratedParts }
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
        mapLocation: hydrateMapLocation(passage.mapLocation),
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
          mapLocation: null,
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
