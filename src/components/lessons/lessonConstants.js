export const LESSON_SCHEMA_VERSION = 1

export const LESSON_GRADES = ['4', '5', '6', '7']
export const LESSON_TERMS = ['1', '2', '3']

export const LESSON_SUBJECTS = [
  'Mathematics',
  'English',
  'Integrated Science',
  'Social Studies',
  'Technology Studies',
  'Home Economics',
  'Expressive Arts',
]

export const CREATION_MODES = [
  {
    id: 'slide-builder',
    label: 'Slide Builder',
    shortLabel: 'Builder',
    icon: '▦',
    description: 'Create each slide by choosing a layout and filling in the fields.',
  },
  {
    id: 'quick-lesson',
    label: 'Quick Lesson',
    shortLabel: 'Quick',
    icon: '✦',
    description: 'Paste notes and convert them into editable presentation slides.',
  },
  {
    id: 'imported_pptx',
    label: 'Import PowerPoint',
    shortLabel: 'PPTX',
    icon: 'P',
    description: 'Upload a .pptx file and convert its slides into editable lesson slides.',
  },
  {
    id: 'pptx_viewer',
    label: 'PowerPoint Viewer',
    shortLabel: 'Viewer',
    icon: '▣',
    description: 'Preserve the original presentation layout and play it slide by slide.',
  },
]

export const SLIDE_TYPES = [
  {
    id: 'title',
    label: 'Title slide',
    icon: 'T',
    description: 'Lesson opening with title, topic, and short welcome text.',
  },
  {
    id: 'text',
    label: 'Text slide',
    icon: '¶',
    description: 'A clear explanation paragraph for learners.',
  },
  {
    id: 'bullets',
    label: 'Bullet list',
    icon: '•',
    description: 'Key points, facts, or steps.',
  },
  {
    id: 'imageText',
    label: 'Image + text',
    icon: '▧',
    description: 'A diagram, photo, or visual with explanation.',
  },
  {
    id: 'example',
    label: 'Example',
    icon: 'Ex',
    description: 'Worked example or classroom demonstration.',
  },
  {
    id: 'question',
    label: 'Question/activity',
    icon: '?',
    description: 'Learner activity with answer and explanation.',
  },
  {
    id: 'summary',
    label: 'Summary',
    icon: 'Σ',
    description: 'Recap of important lesson ideas.',
  },
  {
    id: 'end',
    label: 'End-of-lesson',
    icon: '✓',
    description: 'Final slide before completion actions.',
  },
]

export const SLIDE_TYPE_MAP = Object.fromEntries(SLIDE_TYPES.map(type => [type.id, type]))

export const LESSON_THEMES = [
  {
    id: 'fresh',
    label: 'Fresh',
    accent: 'emerald',
    bg: 'from-emerald-50 via-white to-sky-50',
    panel: 'bg-emerald-600',
    text: 'text-emerald-700',
    chip: 'bg-emerald-100 text-emerald-800',
    border: 'border-emerald-200',
  },
  {
    id: 'bright',
    label: 'Bright',
    accent: 'sky',
    bg: 'from-sky-50 via-white to-amber-50',
    panel: 'bg-sky-600',
    text: 'text-sky-700',
    chip: 'bg-sky-100 text-sky-800',
    border: 'border-sky-200',
  },
  {
    id: 'sunrise',
    label: 'Sunrise',
    accent: 'amber',
    bg: 'from-amber-50 via-white to-rose-50',
    panel: 'bg-amber-500',
    text: 'text-amber-700',
    chip: 'bg-amber-100 text-amber-800',
    border: 'border-amber-200',
  },
  {
    id: 'focus',
    label: 'Focus',
    accent: 'indigo',
    bg: 'from-indigo-50 via-white to-teal-50',
    panel: 'bg-indigo-600',
    text: 'text-indigo-700',
    chip: 'bg-indigo-100 text-indigo-800',
    border: 'border-indigo-200',
  },
]

export const LESSON_THEME_MAP = Object.fromEntries(LESSON_THEMES.map(theme => [theme.id, theme]))

export function makeLessonId(prefix = 'slide') {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return `${prefix}-${crypto.randomUUID().slice(0, 8)}`
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

export function createBlankSlide(type = 'text', overrides = {}) {
  const base = {
    id: makeLessonId('slide'),
    type,
    title: '',
    subtitle: '',
    body: '',
    bullets: [],
    imageUrl: '',
    imageAlt: '',
    imageStoragePath: '',
    imageSourcePath: '',
    importAssetId: '',
    example: '',
    prompt: '',
    answer: '',
    explanation: '',
    teacherNotes: '',
    requiresReview: false,
    reviewNotes: [],
    importWarnings: [],
    sourceSlidePath: '',
  }

  const defaults = {
    title: {
      title: 'New Lesson',
      subtitle: 'A clear start for learners',
      body: 'By the end of this lesson, you will understand the main idea and practise it.',
    },
    text: {
      title: 'Key Idea',
      body: 'Write one clear explanation here. Keep each slide focused on one idea.',
    },
    bullets: {
      title: 'Important Points',
      bullets: ['First important point', 'Second important point', 'Third important point'],
    },
    imageText: {
      title: 'Look Closely',
      body: 'Add a diagram or image and explain what learners should notice.',
      imageAlt: 'Lesson diagram',
    },
    example: {
      title: 'Example',
      body: 'Show learners how the idea works.',
      example: 'Example: Write a short worked example here.',
      explanation: 'Explain why this example is correct.',
    },
    question: {
      title: 'Try It',
      prompt: 'Write a question or classroom activity here.',
      answer: 'Write the correct answer here.',
      explanation: 'Add a short explanation learners can read after the lesson.',
    },
    summary: {
      title: 'What We Learned',
      bullets: ['One idea to remember', 'One word to know', 'One skill to practise'],
      body: 'Use this slide to connect the lesson back to the topic.',
    },
    end: {
      title: 'Lesson Complete',
      subtitle: 'You are ready to practise.',
      body: 'Choose a quiz, check your answers, or replay the lesson.',
    },
  }

  return { ...base, ...(defaults[type] ?? defaults.text), ...overrides }
}

export function createEmptyPresentation(overrides = {}) {
  return {
    sourceFileName: '',
    sourcePath: '',
    sourceUrl: '',
    sourceContentType: '',
    sourceSize: 0,
    viewerType: '',
    conversionStatus: '',
    slideCount: 0,
    slideImages: [],
    conversionWarnings: [],
    ...overrides,
  }
}

export function createStarterSlides(title = 'New Lesson', topic = 'Lesson Topic') {
  return [
    createBlankSlide('title', {
      title,
      subtitle: topic,
      body: 'Let us learn this step by step.',
    }),
    createBlankSlide('text', {
      title: 'Main Idea',
      body: 'Add the first important explanation for this lesson.',
    }),
    createBlankSlide('question', {
      title: 'Quick Check',
      prompt: 'What is one thing you learned from this lesson?',
      answer: 'Learners should name one correct idea from the lesson.',
      explanation: 'This checks whether learners can recall the main idea in their own words.',
    }),
    createBlankSlide('end', {
      title: 'Lesson Complete',
      subtitle: 'Great work.',
      body: 'Take the quiz or check the answers for the activities.',
    }),
  ]
}

export function createEmptyLesson(mode = 'slide-builder') {
  return {
    schemaVersion: LESSON_SCHEMA_VERSION,
    title: '',
    grade: '4',
    subject: 'Integrated Science',
    term: '1',
    topic: '',
    creationMode: mode,
    theme: 'fresh',
    slides: mode === 'slide-builder' ? createStarterSlides() : [],
    activities: [],
    answers: [],
    linkedQuizId: '',
    linkedActivities: [],
    sourceFileName: '',
    assetBatchId: '',
    presentation: createEmptyPresentation(),
    importStatus: '',
    mode,
    status: 'draft',
    isPublished: false,
  }
}

export function normalizeStringList(value) {
  if (Array.isArray(value)) {
    return value.map(item => String(item ?? '').trim()).filter(Boolean)
  }
  return String(value ?? '')
    .split(/\r?\n|,/)
    .map(item => item.trim())
    .filter(Boolean)
}

export function slideToPlainText(slide) {
  return [
    slide.title,
    slide.subtitle,
    slide.body,
    ...(Array.isArray(slide.bullets) ? slide.bullets : []),
    slide.example,
    slide.prompt,
    slide.answer,
    slide.explanation,
  ].filter(Boolean).join(' ')
}

export function slidesToPlainText(slides = []) {
  return slides.map(slideToPlainText).join('\n\n')
}

export function getSlideActivities(slides = []) {
  return slides
    .filter(slide => slide.type === 'question' && (slide.prompt || slide.title))
    .map((slide, index) => ({
      id: slide.id,
      slideId: slide.id,
      slideTitle: slide.title || `Activity ${index + 1}`,
      prompt: slide.prompt || slide.body || slide.title,
      order: index + 1,
    }))
}

export function getSlideAnswers(slides = []) {
  return slides
    .filter(slide => slide.type === 'question' && (slide.answer || slide.explanation))
    .map((slide, index) => ({
      id: slide.id,
      slideId: slide.id,
      slideTitle: slide.title || `Activity ${index + 1}`,
      prompt: slide.prompt || slide.body || slide.title,
      answer: slide.answer || 'Teacher answer not added yet.',
      explanation: slide.explanation || 'Explanation will be added by the teacher.',
      order: index + 1,
    }))
}

export function normalizeSlideForSave(slide, index) {
  const type = SLIDE_TYPE_MAP[slide.type] ? slide.type : 'text'
  return {
    id: slide.id || makeLessonId('slide'),
    type,
    order: index + 1,
    title: String(slide.title ?? '').trim(),
    subtitle: String(slide.subtitle ?? '').trim(),
    body: String(slide.body ?? '').trim(),
    bullets: normalizeStringList(slide.bullets),
    imageUrl: String(slide.imageUrl ?? '').trim(),
    imageAlt: String(slide.imageAlt ?? '').trim(),
    imageStoragePath: String(slide.imageStoragePath ?? '').trim(),
    imageSourcePath: String(slide.imageSourcePath ?? '').trim(),
    importAssetId: String(slide.importAssetId ?? '').trim(),
    example: String(slide.example ?? '').trim(),
    prompt: String(slide.prompt ?? '').trim(),
    answer: String(slide.answer ?? '').trim(),
    explanation: String(slide.explanation ?? '').trim(),
    teacherNotes: String(slide.teacherNotes ?? '').trim(),
    requiresReview: Boolean(slide.requiresReview),
    reviewNotes: normalizeStringList(slide.reviewNotes),
    importWarnings: normalizeStringList(slide.importWarnings),
    sourceSlidePath: String(slide.sourceSlidePath ?? '').trim(),
  }
}

export function ensureEndSlide(slides = []) {
  const cleanSlides = slides.map((slide, index) => normalizeSlideForSave(slide, index))
  if (cleanSlides.some(slide => slide.type === 'end')) return cleanSlides
  return [
    ...cleanSlides,
    normalizeSlideForSave(createBlankSlide('end', {
      title: 'Lesson Complete',
      subtitle: 'You are ready to practise.',
      body: 'Take the quiz, check answers, or replay the lesson.',
    }), cleanSlides.length),
  ]
}
