/**
 * Zambia Competency-Based Curriculum (CBC) — Upper Primary
 * Grades 4, 5, 6, and 7  |  Seven Learning Areas
 *
 * SITE MAP
 * ─────────────────────────────────────────────────────────
 * /               → RootRedirect (role-based)
 * /dashboard      → GradeHub   (NEW: CBC hub dashboard)
 * /grade/:grade   → GradeSubjectPage
 * /quizzes        → QuizList   (filtered by grade + subject)
 * /quiz/:id       → QuizRunner
 * /lessons        → LessonsList
 * /lessons/:id    → LessonView
 * /my-results     → MyResults
 * /my-badges      → BadgesPage  (new)
 * /profile        → Profile     (new)
 * /login          → Login
 * /register       → Register
 * /teacher/*      → TeacherLayout subtree
 * /admin/*        → AdminLayout subtree
 * ─────────────────────────────────────────────────────────
 *
 * FIRESTORE SCHEMA (recommended)
 * ─────────────────────────────────────────────────────────
 * quizzes/{id}
 *   grade: '4'|'5'|'6'|'7'
 *   subject: SubjectId
 *   topic: string            ← from TOPICS below
 *   competency: string       ← from COMPETENCIES below
 *   isPublished, status, createdBy, …
 *   questions/{qId}
 *
 * lessons/{id}  — same fields as quizzes
 *
 * users/{uid}
 *   grade: '4'|'5'|'6'|'7'
 *   earnedBadges: [{badgeId, earnedAt}]
 *   currentStreak: number
 *   lastActiveDate: string   ← 'YYYY-MM-DD'
 *
 * results/{id}
 *   userId, quizId, grade, subject, topic, competency
 *   score, totalMarks, percentage
 *   completedAt, timeSpentSeconds
 *   topicScores: { [topic]: { correct: n, total: n } }
 * ─────────────────────────────────────────────────────────
 */

export const GRADES = [4, 5, 6, 7]

/** Learning Areas (subjects) — 7 as per CBC Upper Primary */
export const SUBJECTS = [
  {
    id: 'mathematics',
    label: 'Mathematics',
    shortLabel: 'Maths',
    icon: '📐',
    color: 'blue',
    tailwind: {
      bg:     'bg-blue-600',
      light:  'bg-blue-50',
      text:   'text-blue-700',
      border: 'border-blue-200',
    },
  },
  {
    id: 'english',
    label: 'English',
    shortLabel: 'English',
    icon: '📖',
    color: 'green',
    tailwind: {
      bg:     'bg-green-600',
      light:  'bg-green-50',
      text:   'text-green-700',
      border: 'border-green-200',
    },
  },
  {
    id: 'science',
    label: 'Integrated Science',
    shortLabel: 'Science',
    icon: '🔬',
    color: 'purple',
    tailwind: {
      bg:     'bg-purple-600',
      light:  'bg-purple-50',
      text:   'text-purple-700',
      border: 'border-purple-200',
    },
  },
  {
    id: 'social-studies',
    label: 'Social Studies',
    shortLabel: 'Social',
    icon: '🌍',
    color: 'orange',
    tailwind: {
      bg:     'bg-orange-500',
      light:  'bg-orange-50',
      text:   'text-orange-700',
      border: 'border-orange-200',
    },
  },
  {
    id: 'technology',
    label: 'Technology Studies',
    shortLabel: 'Technology',
    icon: '💻',
    color: 'gray',
    tailwind: {
      bg:     'bg-slate-600',
      light:  'bg-slate-50',
      text:   'text-slate-700',
      border: 'border-slate-200',
    },
  },
  {
    id: 'home-economics',
    label: 'Home Economics',
    shortLabel: 'Home Ec.',
    icon: '🏡',
    color: 'pink',
    tailwind: {
      bg:     'bg-pink-500',
      light:  'bg-pink-50',
      text:   'text-pink-700',
      border: 'border-pink-200',
    },
  },
  {
    id: 'expressive-arts',
    label: 'Expressive Arts',
    shortLabel: 'Arts',
    icon: '🎨',
    color: 'yellow',
    tailwind: {
      bg:     'bg-amber-500',
      light:  'bg-amber-50',
      text:   'text-amber-700',
      border: 'border-amber-200',
    },
  },
]

/** Subject ID → Subject object lookup */
export const SUBJECT_MAP = Object.fromEntries(SUBJECTS.map(s => [s.id, s]))

/** Competencies per subject — CBC strands */
export const COMPETENCIES = {
  mathematics: [
    'Number & Operations',
    'Measurement',
    'Geometry & Spatial Reasoning',
    'Data Handling & Statistics',
    'Patterns & Algebra',
  ],
  english: [
    'Reading & Comprehension',
    'Writing Skills',
    'Speaking & Listening',
    'Grammar & Language Structure',
    'Literature & Creative Expression',
  ],
  science: [
    'Living Things & Biology',
    'Matter & Physical Science',
    'Earth & Environment',
    'Scientific Inquiry',
    'Energy & Forces',
  ],
  'social-studies': [
    'History & Heritage',
    'Civic Education',
    'Geography & Environment',
    'Culture & Society',
    'Economics & Livelihoods',
  ],
  technology: [
    'Digital Literacy',
    'Computer Applications',
    'Problem Solving & Design',
    'Internet Safety',
    'Technology in Society',
  ],
  'home-economics': [
    'Food & Nutrition',
    'Personal & Family Health',
    'Home Management',
    'Clothing & Textiles',
    'Consumer Education',
  ],
  'expressive-arts': [
    'Music & Performance',
    'Visual Arts & Design',
    'Drama & Theatre',
    'Dance & Movement',
    'Creative Expression',
  ],
}

/** Topics per grade per subject */
export const TOPICS = {
  mathematics: {
    4: ['Whole Numbers', 'Addition & Subtraction', 'Multiplication & Division', 'Fractions', 'Measurement', 'Geometry Basics', 'Data Handling'],
    5: ['Large Numbers', 'Fractions & Decimals', 'Ratio & Proportion', 'Measurement & Units', 'Geometry & Area', 'Statistics & Graphs'],
    6: ['Integers', 'Algebra Basics', 'Percentages', 'Advanced Geometry', 'Probability', 'Advanced Statistics'],
    7: ['Algebraic Expressions', 'Linear Equations', 'Rational Numbers', 'Area & Volume', 'Angles & Triangles', 'Data & Probability'],
  },
  english: {
    4: ['Phonics & Word Study', 'Reading Comprehension', 'Creative Writing', 'Parts of Speech', 'Punctuation', 'Oral Communication'],
    5: ['Reading Strategies', 'Essay Writing', 'Advanced Grammar', 'Vocabulary Building', 'Public Speaking', 'Letter Writing'],
    6: ['Critical Reading', 'Argumentative Writing', 'Complex Grammar', 'Literature Study', 'Debate Skills', 'Report Writing'],
    7: ['Comprehension & Analysis', 'Composition & Essay Writing', 'Advanced Grammar & Syntax', 'Vocabulary in Context', 'Literary Devices', 'Formal Letters & Reports'],
  },
  science: {
    4: ['Living & Non-living Things', 'Plants', 'Animals', 'Matter & Materials', 'Forces & Motion', 'Light & Sound'],
    5: ['Plant Life Cycles', 'Animal Adaptations', 'States of Matter', 'Electricity Basics', 'Earth & Soil', 'Weather & Climate'],
    6: ['Human Body Systems', 'Ecosystems & Food Chains', 'Chemical Changes', 'Simple Machines', 'Energy Sources', 'Environmental Issues'],
    7: ['Cells & Tissues', 'Classification of Organisms', 'Heat & Temperature', 'Magnetism & Electricity', 'Earth & Space', 'Environmental Science'],
  },
  'social-studies': {
    4: ['My Community', 'Local Government', 'Zambia — Our Country', 'Natural Environment', 'Traditions & Culture', 'Basic Economics'],
    5: ['Zambia — History & Heritage', 'Provinces of Zambia', 'African Countries', 'Civic Rights & Responsibilities', 'Transport & Communication', 'Economic Activities'],
    6: ['Zambia\'s Independence', 'Regional Geography', 'Democracy & Governance', 'Conflict Resolution', 'Trade & Development', 'Global Citizenship'],
    7: ['Pre-colonial & Colonial History', 'Physical & Human Geography', 'Governance & Constitution', 'Economic Systems', 'Culture & Heritage', 'Regional & Global Affairs'],
  },
  technology: {
    4: ['Parts of a Computer', 'Using a Keyboard', 'Digital Safety', 'Simple Machines', 'Technology Around Us', 'Problem Solving'],
    5: ['Computer Applications', 'Internet Basics', 'Digital Communication', 'Technology Design', 'Coding Introduction', 'Media Literacy'],
    6: ['Spreadsheets & Data', 'Web Research Skills', 'Digital Citizenship', 'Programming Concepts', 'Technology & Society', 'Cybersecurity Basics'],
    7: ['Productivity Software', 'Databases & Information', 'Programming Logic', 'Networks & Internet', 'Digital Ethics', 'Emerging Technology'],
  },
  'home-economics': {
    4: ['Personal Hygiene', 'Balanced Diet', 'Kitchen Safety', 'Cleaning & Tidying', 'Family & Home Care', 'Simple Cooking'],
    5: ['Nutrition & Meal Planning', 'Cooking Methods', 'Laundry & Clothing Care', 'Home Organisation', 'Consumer Skills', 'First Aid Basics'],
    6: ['Advanced Cooking', 'Clothing & Textiles', 'Home Design', 'Entrepreneurship Basics', 'Family Health', 'Budgeting & Finance'],
    7: ['Food Science & Preservation', 'Garment Construction', 'Interior Design', 'Small Business Basics', 'Household Management', 'Consumer Rights'],
  },
  'expressive-arts': {
    4: ['Rhythm & Beats', 'Drawing & Colour', 'Storytelling & Drama', 'Folk Songs & Dance', 'Creative Play', 'Art Materials'],
    5: ['Music Theory Basics', 'Painting Techniques', 'Script & Performance', 'Traditional Dance', 'Sculpture & Craft', 'Cultural Expressions'],
    6: ['Music Composition', 'Advanced Visual Art', 'Theatre Production', 'Contemporary Dance', 'Multimedia Arts', 'Portfolio & Presentation'],
    7: ['Music Notation & Composition', 'Mixed-Media Art', 'Dramatic Production', 'Choreography', 'Digital Creative Tools', 'Art Criticism'],
  },
}

/** Grade meta — colour themes + taglines */
export const GRADE_META = {
  4: {
    label:    'Grade 4',
    tagline:  'Building Foundations',
    color:    'blue',
    emoji:    '🔵',
    tailwind: {
      bg:       'bg-blue-600',
      hover:    'hover:bg-blue-700',
      light:    'bg-blue-50',
      text:     'text-blue-700',
      border:   'border-blue-200',
      ring:     'ring-blue-400',
      gradient: 'from-blue-600 to-blue-800',
    },
  },
  5: {
    label:    'Grade 5',
    tagline:  'Growing Skills',
    color:    'green',
    emoji:    '🟢',
    tailwind: {
      bg:       'bg-green-600',
      hover:    'hover:bg-green-700',
      light:    'bg-green-50',
      text:     'text-green-700',
      border:   'border-green-200',
      ring:     'ring-green-400',
      gradient: 'from-green-600 to-green-800',
    },
  },
  6: {
    label:    'Grade 6',
    tagline:  'Ready for Secondary',
    color:    'orange',
    emoji:    '🟠',
    tailwind: {
      bg:       'bg-orange-500',
      hover:    'hover:bg-orange-600',
      light:    'bg-orange-50',
      text:     'text-orange-700',
      border:   'border-orange-200',
      ring:     'ring-orange-400',
      gradient: 'from-orange-500 to-orange-700',
    },
  },
  7: {
    label:    'Grade 7',
    tagline:  'Exam Year',
    color:    'purple',
    emoji:    '🟣',
    tailwind: {
      bg:       'bg-purple-600',
      hover:    'hover:bg-purple-700',
      light:    'bg-purple-50',
      text:     'text-purple-700',
      border:   'border-purple-200',
      ring:     'ring-purple-400',
      gradient: 'from-purple-600 to-purple-800',
    },
  },
}

/** Helper — return topics for a specific grade + subject */
export function getTopics(subjectId, grade) {
  return TOPICS[subjectId]?.[grade] ?? []
}

/** Helper — return competencies for a subject */
export function getCompetencies(subjectId) {
  return COMPETENCIES[subjectId] ?? []
}

/** Professor Pako teaching tips — indexed by topic keyword */
export const PAKO_TIPS = {
  // Mathematics
  'fractions':          "Remember: the bottom number (denominator) tells you how many equal parts the whole is divided into!",
  'whole numbers':      "Count carefully! Aligning digits in columns helps avoid mistakes when adding large numbers.",
  'multiplication':     "Try breaking big numbers into smaller parts — it makes multiplication much easier!",
  'geometry':           "Shapes are everywhere! Look around your classroom — how many rectangles can you spot?",
  'percentages':        "Per cent means 'out of 100'. So 25% = 25 out of 100 = ¼. See the pattern?",
  'algebra':            "In algebra, letters are just unknown numbers. Work backwards to find what the letter equals!",
  'statistics':         "Always ask: what does this data tell us? Numbers only become useful when we understand their meaning.",
  // English
  'reading':            "Good readers ask questions while reading: What? Why? How? This keeps your brain active!",
  'writing':            "Start with a plan — introduction, three main points, conclusion. Your essay will practically write itself!",
  'grammar':            "Sentences need both a subject (who/what) and a predicate (what they do). Check yours has both!",
  'vocabulary':         "When you find a new word, write it in a sentence of your own. That's how you truly learn it!",
  // Science
  'plants':             "Plants make their own food using sunlight, water, and carbon dioxide — a process called photosynthesis!",
  'animals':            "Animals are grouped by shared characteristics. What features do birds, fish, and mammals have in common?",
  'matter':             "Everything around you is made of matter. Matter can be a solid, liquid, or gas — even air!",
  'electricity':        "Electricity flows in a circuit — like water in a loop. Break the loop and the flow stops!",
  'environment':        "Protecting our environment protects us. Every small action — like planting a tree — makes a real difference.",
  // Social Studies
  'civics':             "Being a good citizen means knowing your rights AND your responsibilities. They go together!",
  'history':            "History helps us understand why Zambia is the way it is today. The past shapes our future!",
  'geography':          "Use compass directions and landmarks to describe location. Can you describe where your school is?",
  // General encouraging tips
  'default_correct':    "Excellent work! You understood that concept really well. Keep it up!",
  'default_wrong':      "Don't worry — making mistakes is how we learn. Read the explanation and try again!",
  'default_tip':        "Tip from Prof. Pako: Review your notes before bed — sleep helps your brain store new information!",
}

/** Get a tip for a given topic (fuzzy match) */
export function getPakoTip(topic = '', isCorrect = null) {
  if (isCorrect === true)  return PAKO_TIPS.default_correct
  if (isCorrect === false) return PAKO_TIPS.default_wrong
  const key = topic.toLowerCase()
  const match = Object.keys(PAKO_TIPS).find(k => key.includes(k) || k.includes(key))
  return match ? PAKO_TIPS[match] : PAKO_TIPS.default_tip
}
