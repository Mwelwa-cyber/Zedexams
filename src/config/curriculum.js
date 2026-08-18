/**
 * Zambia Competence-Based Curriculum (CBC) — Upper Primary
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

/**
 * LEARNER_GRADES — the grades a LEARNER may currently sign up for and use.
 *
 * This is a ROLLOUT gate, not a curriculum fact. `GRADES` above stays the full
 * CBC upper-primary catalogue (4–7) because that is what the product AUTHORS
 * for: the Assessment Studio, the syllabi, the Question Bank, Notes Studio,
 * class registers and the CBC knowledge base all have to keep offering Grade 4
 * so the content for it can be written BEFORE the grade opens. Narrowing
 * `GRADES` would take the authoring surfaces down with the learner ones and
 * make it impossible to prepare the next grade.
 *
 * It is also deliberately NOT the `active` flag on `ALL_GRADES` further down.
 * That flag answers "which BAND has notes subjects wired up" and its consumers
 * (`NoteMetaPanel`, `NoteFilters`) are admin AUTHORING screens — reusing it
 * here would stop an admin writing the Grade 5 notes that the Grade 5 rollout
 * is waiting on. Two questions, two lists.
 *
 * Rolling out a grade is a one-line change here plus the twin in
 * `functions/dailyExamPickerCore.js` (`DAILY_EXAM_GRADES`), which decides
 * which grades the daily-exam rotation must cover and which grades Vigil pages
 * ops about hourly when a pick is missing. A grade listed there and not here
 * alerts forever about learners who cannot reach it; a grade listed here and
 * not there opens to learners with no daily exam. `test:learner-grades` fails
 * if the two disagree.
 *
 * Learners already holding a grade that is not live are NOT converted and NOT
 * locked out — `resolveLearnerGradeAccess` in features/learnerOnboarding sends
 * them to the waitlist screen with their grade intact.
 */
export const LEARNER_GRADES = Object.freeze([7])

/** Is this a grade the learner side is currently open for? */
export const isLearnerGrade = (grade) => LEARNER_GRADES.includes(Number(grade))

/**
 * A grade that exists in the catalogue but has not opened to learners yet.
 * Drives the waitlist screen's "Grade 5 is coming soon" copy.
 */
export const isPendingLearnerGrade = (grade) =>
  GRADES.includes(Number(grade)) && !isLearnerGrade(grade)

/** Learning Areas (subjects) — 8 as per CBC Upper Primary.
 *
 * This is the LEARNER catalogue: the eight upper-primary subjects the app
 * publishes quizzes and lessons for, with the mascot-and-pastel presentation
 * the learner surfaces are built around. It is NOT the product's subject
 * vocabulary — that is src/config/canonicalEducation.js, which covers all 34
 * subjects across both curricula and takes its names from the Syllabus Studio.
 *
 * Each subject carries:
 *  - canonicalId  FK into CANONICAL_SUBJECTS. This is the identity: it is what
 *                 makes a learner quiz for `integrated_science` the same
 *                 subject as a timetable slot, a scheme of work and a syllabus
 *                 page, none of which spell it "Integrated Science".
 *  - label        the learner-facing display name AND, historically, the value
 *                 stored on quizzes/lessons/results. It is kept as a display
 *                 property rather than reconciled with the canonical name so
 *                 the learner surfaces keep the wording children know; use
 *                 `canonicalId` for anything that must MATCH across studios.
 *  - icon         legacy single-emoji fallback (still consumed by older
 *                 callers that expect a string)
 *  - iconKey      identifier for the SVG renderer in <SubjectIcon>
 *  - pastel       soft pastel background colour matching the friendly
 *                 illustration palette in the design reference */
export const SUBJECTS = [
  {
    id: 'english',
    canonicalId: 'english',
    label: 'English',
    shortLabel: 'English',
    icon: '📖',
    iconKey: 'BookOpen',
    pastel: '#fbe7c8',
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
    canonicalId: 'integrated_science',
    label: 'Integrated Science',
    shortLabel: 'Science',
    icon: '🔬',
    iconKey: 'Beaker',
    pastel: '#dfeadd',
    color: 'purple',
    tailwind: {
      bg:     'bg-purple-600',
      light:  'bg-purple-50',
      text:   'text-purple-700',
      border: 'border-purple-200',
    },
  },
  {
    id: 'mathematics',
    canonicalId: 'mathematics',
    label: 'Mathematics',
    shortLabel: 'Maths',
    icon: '📐',
    iconKey: 'Calculator',
    pastel: '#e3dcf5',
    color: 'blue',
    tailwind: {
      bg:     'bg-blue-600',
      light:  'bg-blue-50',
      text:   'text-blue-700',
      border: 'border-blue-200',
    },
  },
  {
    id: 'social-studies',
    canonicalId: 'social_studies',
    label: 'Social Studies',
    shortLabel: 'Social',
    icon: '🌍',
    iconKey: 'Globe',
    pastel: '#dbe7f4',
    color: 'orange',
    tailwind: {
      bg:     'bg-orange-500',
      light:  'bg-orange-50',
      text:   'text-orange-700',
      border: 'border-orange-200',
    },
  },
  {
    id: 'expressive-arts',
    canonicalId: 'expressive_arts',
    label: 'Expressive Art',
    shortLabel: 'Art',
    icon: '🎨',
    iconKey: 'PaintBrush',
    pastel: '#fde2c4',
    color: 'yellow',
    tailwind: {
      bg:     'bg-amber-500',
      light:  'bg-amber-50',
      text:   'text-amber-700',
      border: 'border-amber-200',
    },
  },
  {
    id: 'technology',
    canonicalId: 'technology_studies',
    label: 'Technology Studies',
    shortLabel: 'Technology',
    icon: '💻',
    iconKey: 'ComputerDesktop',
    pastel: '#e1e8ee',
    color: 'gray',
    tailwind: {
      bg:     'bg-slate-600',
      light:  'bg-slate-50',
      text:   'text-slate-700',
      border: 'border-slate-200',
    },
  },
  {
    id: 'cinyanja',
    canonicalId: 'zambian_language',
    label: 'Cinyanja',
    shortLabel: 'Cinyanja',
    icon: '🗣️',
    iconKey: 'Language',
    pastel: '#f4d6e2',
    color: 'pink',
    tailwind: {
      bg:     'bg-pink-500',
      light:  'bg-pink-50',
      text:   'text-pink-700',
      border: 'border-pink-200',
    },
  },
  {
    id: 'home-economics',
    canonicalId: 'home_economics',
    label: 'Home Economics',
    shortLabel: 'Home Ec.',
    icon: '🏡',
    iconKey: 'Home',
    pastel: '#f9d8c8',
    color: 'rose',
    tailwind: {
      bg:     'bg-rose-500',
      light:  'bg-rose-50',
      text:   'text-rose-700',
      border: 'border-rose-200',
    },
  },
]

/**
 * Past-paper-only subject categories.
 *
 * The ECZ archive carries a few exam categories that aren't CBC learning
 * areas — most notably the Grade 7 PSLE "Special Paper 1" (verbal reasoning)
 * and "Special Paper 2" (non-verbal reasoning). These must be selectable when
 * an admin uploads a past paper and must render with a friendly label/icon in
 * the learner-facing archive, but they are deliberately kept OUT of
 * {@link SUBJECTS} so they never leak into quiz/lesson/dashboard subject
 * dropdowns or CBC topic lookups.
 *
 * Use {@link PAPER_SUBJECTS} (CBC subjects + these) anywhere the past-paper
 * surfaces need the full set of selectable/displayable subjects.
 */
export const SPECIAL_PAPER_SUBJECTS = [
  {
    id: 'special-paper-1',
    canonicalId: null,
    label: 'Special Paper 1',
    shortLabel: 'Special Paper 1',
    icon: '📝',
    iconKey: 'DocumentText',
    pastel: '#e0e7ff',
    color: 'indigo',
    tailwind: {
      bg:     'bg-indigo-600',
      light:  'bg-indigo-50',
      text:   'text-indigo-700',
      border: 'border-indigo-200',
    },
  },
  {
    id: 'special-paper-2',
    canonicalId: null,
    label: 'Special Paper 2',
    shortLabel: 'Special Paper 2',
    icon: '🧩',
    iconKey: 'PuzzlePiece',
    pastel: '#ede9fe',
    color: 'violet',
    tailwind: {
      bg:     'bg-violet-600',
      light:  'bg-violet-50',
      text:   'text-violet-700',
      border: 'border-violet-200',
    },
  },
  {
    id: 'creative-technology-studies',
    canonicalId: 'creative_and_technology_studies',
    label: 'Creative and Technology Studies',
    shortLabel: 'Creative & Tech',
    icon: '🛠️',
    iconKey: 'WrenchScrewdriver',
    pastel: '#ccfbf1',
    color: 'teal',
    tailwind: {
      bg:     'bg-teal-600',
      light:  'bg-teal-50',
      text:   'text-teal-700',
      border: 'border-teal-200',
    },
  },
]

/**
 * Full subject universe for the past-paper surfaces: the eight CBC learning
 * areas plus the special-paper categories above. The Past Paper Studio's
 * subject dropdown and the public archive's filter/label lookups read from
 * this so "Special Paper 1" is both uploadable and displayed with a proper
 * label + icon instead of falling back to the raw id.
 */
export const PAPER_SUBJECTS = [...SUBJECTS, ...SPECIAL_PAPER_SUBJECTS]

/** Subject ID → Subject object lookup */
export const SUBJECT_MAP = Object.fromEntries(SUBJECTS.map(s => [s.id, s]))

/**
 * Canonical display labels for every subject (the wire value stored on
 * quizzes/lessons/notes and matched against learner-facing filters).
 */
export const SUBJECT_LABELS = SUBJECTS.map(s => s.label)

/**
 * Slug/id → display-label lookup. The document importer and some legacy
 * docs carry the curriculum *id* (a slug like "mathematics") instead of the
 * display label ("Mathematics"). Use {@link normalizeSubject} to repair such
 * values back to the canonical label before saving or matching.
 *
 * Includes a lowercased-label alias too, so "MATHEMATICS" or "mathematics"
 * both resolve regardless of whether the slug or the label was lowercased.
 */
const SUBJECT_SLUG_TO_LABEL = (() => {
  const map = {}
  for (const s of SUBJECTS) {
    map[s.id] = s.label
    map[s.id.toLowerCase()] = s.label
    map[s.label.toLowerCase()] = s.label
    // Underscore variant of the slug too — the CBC knowledge base keys
    // subjects with underscores ("expressive_arts", "social_studies")
    // while the curriculum ids use hyphens ("expressive-arts"). Without
    // this, a KB-keyed subject like "expressive_arts" would slip through
    // normalizeSubject unchanged and never match the learner label
    // "Expressive Art" (see BulkPublishQuizzesButton).
    map[s.id.replace(/-/g, '_')] = s.label
  }
  // Extra KB-specific aliases that don't follow the slug<->label rule.
  // "integrated_science" / "integrated science" are how the KB and some
  // teacher tools name what the curriculum calls id "science" / label
  // "Integrated Science".
  map['integrated_science'] = 'Integrated Science'
  map['integrated science'] = 'Integrated Science'
  return map
})()

const SUBJECT_LABEL_SET = new Set(SUBJECT_LABELS)

/**
 * Repair a subject value to its canonical display label.
 *
 * - An already-valid label ("Mathematics") is returned unchanged.
 * - A curriculum id / slug ("mathematics", "social-studies") is mapped to its
 *   label.
 * - Any unrecognised value is returned trimmed-but-unchanged so strict schema
 *   validation can still reject genuine garbage rather than this helper
 *   silently swallowing it.
 */
export function normalizeSubject(value) {
  if (value == null) return value
  const raw = String(value).trim()
  if (!raw) return raw
  if (SUBJECT_LABEL_SET.has(raw)) return raw
  return SUBJECT_SLUG_TO_LABEL[raw.toLowerCase()] ?? raw
}

/** Competencies per subject — CBC strands */
export const COMPETENCIES = {
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
  mathematics: [
    'Number & Operations',
    'Measurement',
    'Geometry & Spatial Reasoning',
    'Data Handling & Statistics',
    'Patterns & Algebra',
  ],
  'social-studies': [
    'History & Heritage',
    'Civic Education',
    'Geography & Environment',
    'Culture & Society',
    'Economics & Livelihoods',
  ],
  'expressive-arts': [
    'Music & Performance',
    'Visual Arts & Design',
    'Drama & Theatre',
    'Dance & Movement',
    'Creative Expression',
  ],
  technology: [
    'Digital Literacy',
    'Computer Applications',
    'Problem Solving & Design',
    'Internet Safety',
    'Technology in Society',
  ],
  cinyanja: [
    'Kuwerenga (Reading)',
    'Kulemba (Writing)',
    'Kulankhula & Kumvera (Speaking & Listening)',
    'Galamala (Grammar)',
    'Chikhalidwe (Culture & Heritage)',
  ],
  'home-economics': [
    'Food & Nutrition',
    'Personal & Family Health',
    'Home Management',
    'Clothing & Textiles',
    'Consumer Education',
  ],
}

/** Topics per grade per subject */
export const TOPICS = {
  english: {
    4: ['Phonics & Word Study', 'Reading Comprehension', 'Creative Writing', 'Parts of Speech', 'Punctuation', 'Oral Communication'],
    5: ['Reading Strategies', 'Essay Writing', 'Advanced Grammar', 'Vocabulary Building', 'Public Speaking', 'Letter Writing'],
    6: ['Critical Reading', 'Argumentative Writing', 'Complex Grammar', 'Literature Study', 'Debate Skills', 'Report Writing'],
    7: ['Comprehension & Summary', 'Composition Writing', 'Functional Writing', 'Literature Appreciation', 'Tenses & Sentence Structure', 'Exam Skills & Revision'],
  },
  science: {
    4: ['Living & Non-living Things', 'Plants', 'Animals', 'Matter & Materials', 'Forces & Motion', 'Light & Sound'],
    5: ['Plant Life Cycles', 'Animal Adaptations', 'States of Matter', 'Electricity Basics', 'Earth & Soil', 'Weather & Climate'],
    6: ['Human Body Systems', 'Ecosystems & Food Chains', 'Chemical Changes', 'Simple Machines', 'Energy Sources', 'Environmental Issues'],
    7: ['The Human Body', 'Health', 'The Environment', 'Plants and Animals', 'Materials and Energy'],
  },
  mathematics: {
    4: ['Whole Numbers', 'Addition & Subtraction', 'Multiplication & Division', 'Fractions', 'Measurement', 'Geometry Basics', 'Data Handling'],
    5: ['Large Numbers', 'Fractions & Decimals', 'Ratio & Proportion', 'Measurement & Units', 'Geometry & Area', 'Statistics & Graphs'],
    6: ['Integers', 'Algebra Basics', 'Percentages', 'Advanced Geometry', 'Probability', 'Advanced Statistics'],
    7: ['Unit 1: Fractions', 'Unit 2: Decimals', 'Unit 3: Percentages', 'Unit 4: Ratio and Proportion', 'Unit 5: Social and Commercial Arithmetic', 'Unit 6: Integers', 'Unit 7: Number Bases', 'Unit 8: Number and Sequence', 'Unit 9: Inequalities', 'Unit 10: Plane Shapes', 'Unit 11: Measurement', 'Unit 12: Solid Shapes', 'Unit 13: Statistics'],
  },
  'social-studies': {
    4: ['My Community', 'Local Government', 'Zambia — Our Country', 'Natural Environment', 'Traditions & Culture', 'Basic Economics'],
    5: ['Zambia — History & Heritage', 'Provinces of Zambia', 'African Countries', 'Civic Rights & Responsibilities', 'Transport & Communication', 'Economic Activities'],
    6: ['Zambia\'s Independence', 'Regional Geography', 'Democracy & Governance', 'Conflict Resolution', 'Trade & Development', 'Global Citizenship'],
    7: ['Governance', 'The World', 'World Challenges', 'Religion', 'Farming', 'Transport and Communication'],
  },
  'expressive-arts': {
    4: ['Rhythm & Beats', 'Drawing & Colour', 'Storytelling & Drama', 'Folk Songs & Dance', 'Creative Play', 'Art Materials'],
    5: ['Music Theory Basics', 'Painting Techniques', 'Script & Performance', 'Traditional Dance', 'Sculpture & Craft', 'Cultural Expressions'],
    6: ['Music Composition', 'Advanced Visual Art', 'Theatre Production', 'Contemporary Dance', 'Multimedia Arts', 'Portfolio & Presentation'],
    7: ['Notation & Performance', 'Drawing & Painting', 'Drama & Improvisation', 'Choreography', 'Crafts & Design', 'Arts in Society'],
  },
  technology: {
    4: ['Parts of a Computer', 'Using a Keyboard', 'Digital Safety', 'Simple Machines', 'Technology Around Us', 'Problem Solving'],
    5: ['Computer Applications', 'Internet Basics', 'Digital Communication', 'Technology Design', 'Coding Introduction', 'Media Literacy'],
    6: ['Spreadsheets & Data', 'Web Research Skills', 'Digital Citizenship', 'Programming Concepts', 'Technology & Society', 'Cybersecurity Basics'],
    7: ['Drawing', 'Construction', 'Calculator', 'Energy', 'The Internet', 'Searching and Retrieving Information', 'Entrepreneurship'],
  },
  cinyanja: {
    4: ['Zilembo & Mawu (Letters & Words)', 'Kuwerenga Nkhani (Reading Stories)', 'Kulemba Mawu (Writing Words)', 'Mawu Otsutsana (Opposites)', 'Miyambi (Proverbs)', 'Nyimbo & Ndakatulo (Songs & Poems)'],
    5: ['Kuwerenga ndi Kumvetsa (Reading Comprehension)', 'Kalembedwe ka Makalata (Letter Writing)', 'Galamala (Grammar)', 'Mauthenga (Messages)', 'Nthano (Folk Tales)', 'Chikhalidwe cha Zambia'],
    6: ['Kuwerenga Kwapamwamba (Advanced Reading)', 'Kufotokoza Nkhani (Composition)', 'Galamala Yapamwamba (Advanced Grammar)', 'Ndakatulo Zatsopano', 'Sewero (Drama)', 'Miyambo & Mwambo'],
    7: ['Kuunika Nkhani (Critical Reading)', 'Maganizo & Mtsutso (Opinion & Debate)', 'Galamala ya Pamlingo Wapamwamba', 'Ntchito ya Cinyanja Pagulu', 'Mabuku a Cinyanja', 'Kukonzekera Mayeso'],
  },
  'home-economics': {
    4: ['Personal Hygiene', 'Balanced Diet', 'Kitchen Safety', 'Cleaning & Tidying', 'Family & Home Care', 'Simple Cooking'],
    5: ['Nutrition & Meal Planning', 'Cooking Methods', 'Laundry & Clothing Care', 'Home Organisation', 'Consumer Skills', 'First Aid Basics'],
    6: ['Advanced Cooking', 'Clothing & Textiles', 'Home Design', 'Entrepreneurship Basics', 'Family Health', 'Budgeting & Finance'],
    7: ['Food Preservation', 'Sewing & Garment Care', 'Hospitality Skills', 'Home Economics Enterprise', 'Health & First Aid', 'Consumer Rights'],
  },
  // Creative & Technology Studies (CTS) is the integrated upper-primary
  // learning area examined as one ECZ Grade 7 PSLE paper. It is NOT one of
  // the eight learner-dashboard SUBJECTS (which split it into Expressive
  // Arts / Technology / Home Economics), so it lives here only as a topic
  // catalogue keyed by the SPECIAL_PAPER_SUBJECTS id 'creative-technology-
  // studies', and is reached via the teacher-subject bridge below.
  //
  // Provisional Grade 7 coverage — derived from the CBC CTS strands and the
  // topic spread seen in the 2022-2024 ECZ Grade 7 CTS papers. Verify against
  // the official CTS syllabus before treating as authoritative.
  'creative-technology-studies': {
    7: ['Design and Technology', 'Textiles and Needlework', 'Art and Design', 'Music and Dance', 'Food and Nutrition', 'Agriculture and Home Management', 'Entrepreneurship', 'ICT and Technology'],
  },
}

/**
 * Subtopics per topic per grade per subject.
 *
 * Opt-in: only entries listed here render the two-level (topic → subtopic →
 * quizzes) course map. Subjects/grades absent from this map continue to use
 * the flat topic list returned by getTopics().
 *
 * Source of truth for Grade 7 Science: Chrisaivans Integrated Science
 * textbook table of contents.
 */
export const SUBTOPICS = {
  science: {
    7: {
      'The Human Body':     ['Digestive System'],
      'Health':             ['Diseases', 'Fruits'],
      'The Environment':    ['Separating Substances', 'Water Supply Systems'],
      'Plants and Animals': ['The Flower', 'Pollination and Fertilisation in Flowering Plants', 'Fruits and Seeds', 'Seed Dispersal', 'Propagation'],
      'Materials and Energy': ['Energy', 'Electric Current and Circuits', 'Lightning', 'The Solar System', 'Metals and Non-metals', 'Mining'],
    },
  },
  mathematics: {
    7: {
      'Unit 1: Fractions': [
        'Operations on Fractions',
        'Addition',
        'Subtraction',
        'Multiplication',
        'Division',
      ],
      'Unit 2: Decimals': [
        'Operations on Decimals',
        'Addition and Subtraction',
        'Multiplication',
        'Division',
        'Conversion of Fractions to Decimals',
        'Conversion of Decimals to Fractions',
        'Ordering Fractions and Decimals',
        'Ordering Decimals',
      ],
      'Unit 3: Percentages': [
        'Conversion of Decimals to Percentages',
        'Conversion of Percentages to Decimals',
        'Conversion of Fractions to Percentages',
        'Conversion of Percentages to Fractions',
        'Problems Involving Percentages and Application in Real Life',
      ],
      'Unit 4: Ratio and Proportion': [
        'Direct Proportion',
        'Inverse / Indirect Proportion',
        'Graphs in Direct and Indirect Proportion',
      ],
      'Unit 5: Social and Commercial Arithmetic': [
        'Foreign Exchange',
        'Conversion of Currencies',
        'Cost of Goods Priced in Foreign Currency',
      ],
      'Unit 6: Integers': [
        'Directed Numbers or Integers',
        'Integers on a Number Line',
        'Ordering Integers',
        'Adding Integers Using a Number Line',
        'Subtracting Numbers Using a Number Line',
        'Addition and Subtraction of Integers Without Using a Number Line',
        'Real Life Problems Involving Addition and Subtraction of Integers',
      ],
      'Unit 7: Number Bases': [
        'System of Numeration',
        'Base Ten / Decimal System',
        'Base Eight',
        'Base Five / Quinary System',
        'Base Two / Binary System',
        'Conversion from Base 10 to Other Bases',
        'Converting from Base Ten to Base Two',
        'Converting from Base Ten to Base Five',
        'Converting from Base Ten to Base Eight',
        'Converting Numbers from Bases 2, 5 and 8 to Base 10',
        'Converting Numbers from Base 2 to Base 10',
        'Converting Numbers from Base 5 to Base 10',
        'Converting Numbers from Base 8 to Base 10',
        'Converting from Base 2 to Base 5',
        'Converting from Base 5 to Base 2',
        'Addition of Numbers in Base 2',
        'Subtraction of Numbers in Base 2',
        'Addition of Numbers in Base 5',
        'Subtraction of Numbers in Base 5',
        'Addition of Numbers in Base 8',
        'Subtraction of Numbers in Base 8',
      ],
      'Unit 8: Number and Sequence': [
        'Perfect Squares',
        'Cubes',
        'Sequences',
        'Generating a Series',
      ],
      'Unit 9: Inequalities': [
        'Open Sentence',
        'Solving Inequalities in One Variable',
      ],
      'Unit 10: Plane Shapes': [
        'Simple Lines of Folding Symmetry',
        'Circumference, Diameter and Radius',
        'Relationship Between Circumference and Diameter',
      ],
      'Unit 11: Measurement': [
        'Finding the Circumference of a Circle',
        'Area of a Circle',
        'Area of Combined Shapes',
      ],
      'Unit 12: Solid Shapes': [
        'Identifying a Cylinder',
        'Parts of a Cylinder',
        'Drawing the Net of a Cylinder',
        'Drawing / Sketching a Cylinder',
        'Triangular Prism',
        'Drawing the Net of a Triangular Prism',
        'Drawing / Sketching a Triangular Prism',
      ],
      'Unit 13: Statistics': [
        'Data Interpretation',
        'Collecting Data',
        'Data Presentation',
        'Mean, Mode and Median',
      ],
    },
  },
  'social-studies': {
    7: {
      'Governance': [
        'Democratic Governance',
        'Organs of Government',
        'Government Ministries',
        'Constitution',
      ],
      'The World': [
        'Continents',
        'Position of the Continents of the World',
        'Physical Features of the World',
      ],
      'World Challenges': [
        'Population Growth',
        'Corruption',
        'Food Shortage',
        'HIV and AIDS',
        'Pollution',
        'Other World Challenges',
      ],
      'Religion': [
        'The Family',
      ],
      'Farming': [
        'World Farming Regions',
      ],
      'Transport and Communication': [
        'Transport and Communication Services Among SADC and COMESA',
        'Road Safety',
        'Safe Cycling',
      ],
    },
  },
  // Provisional CTS Grade 7 sub-topics — see the TOPICS note above.
  'creative-technology-studies': {
    7: {
      'Design and Technology': [
        'Tools and Materials',
        'Carving',
        'Joining and Construction',
        'Workshop Safety',
      ],
      'Textiles and Needlework': [
        'Weaving',
        'Plaiting',
        'Knotting',
        'Tie and Dye',
        'Embroidery and Crocheting',
        'Sewing',
      ],
      'Art and Design': [
        'Drawing and Shading',
        'Colour and Painting',
        'Pottery and Modelling',
        'Decoration and Pattern',
      ],
      'Music and Dance': [
        'Tonic Sol-fa and Notation',
        'Musical Instruments',
        'Songs and Performance',
        'Traditional Dance',
      ],
      'Food and Nutrition': [
        'Balanced Diet',
        'Food Preparation',
        'Food Preservation',
        'Kitchen Hygiene and Safety',
      ],
      'Agriculture and Home Management': [
        'Crop Production',
        'Keeping Animals',
        'Home Care and Cleaning',
      ],
      'Entrepreneurship': [
        'Business Ideas',
        'Profit and Loss',
        'Marketing and Selling',
        'Record Keeping',
      ],
      'ICT and Technology': [
        'Parts of a Computer',
        'Using the Internet',
        'Communication Technology',
      ],
    },
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
    tagline:  'Mastering the Basics',
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
    tagline:  'Ready for Secondary',
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

/**
 * Topic-level terminology overrides per subject + grade. Defaults to
 * "topic" / "topics" when absent. Lets the course map say "13 units"
 * for Grade 7 Mathematics while everything else keeps saying "topics".
 */
export const TOPIC_LABELS = {
  mathematics: {
    7: { singular: 'unit', plural: 'units', titleSingular: 'Unit', titlePlural: 'Units' },
  },
}

/** Helper — return topics for a specific grade + subject */
export function getTopics(subjectId, grade) {
  return TOPICS[subjectId]?.[grade] ?? []
}

/** Helper — return subtopics for a specific topic within a grade + subject */
export function getSubtopics(subjectId, grade, topic) {
  return SUBTOPICS[subjectId]?.[grade]?.[topic] ?? []
}

/**
 * Bridge: the teacher-tools subject ids (underscore slugs shared with the
 * Cloud Functions, e.g. 'social_studies', 'creative_and_technology_studies')
 * → the curriculum topic-catalogue keys above (the SUBJECTS / SPECIAL_PAPER
 * hyphen ids). The teacher generation studios (and the backend KB) speak the
 * underscore vocabulary; the TOPICS/SUBTOPICS catalogues here are keyed by the
 * learner-dashboard hyphen ids. This map lets a studio resolve topic lists for
 * the subject the teacher picked without every caller hard-coding the spelling.
 *
 * Subjects with no catalogue entry simply resolve to `null` → callers fall
 * back to a free-text topic field.
 */
export const TEACHER_SUBJECT_TO_CURRICULUM = {
  english: 'english',
  mathematics: 'mathematics',
  integrated_science: 'science',
  social_studies: 'social-studies',
  expressive_arts: 'expressive-arts',
  technology_studies: 'technology',
  home_economics: 'home-economics',
  cinyanja: 'cinyanja',
  creative_and_technology_studies: 'creative-technology-studies',
}

/**
 * The learner-dashboard visual metadata (icon, pastel, tailwind palette) for a
 * CANONICAL subject id.
 *
 * The canonical model (src/config/canonicalEducation.js) owns what a subject IS
 * and what it is CALLED; this catalogue owns what it LOOKS LIKE on the learner
 * surfaces, keyed by the older hyphen ids. `TEACHER_SUBJECT_TO_CURRICULUM`
 * already bridges the two vocabularies, so this is the one place a surface
 * holding a canonical id turns it into an icon — rather than each one keeping a
 * SUBJECTS.find() against a vocabulary the record no longer speaks.
 *
 * Returns null for a subject with no learner-dashboard entry (a secondary or
 * vocational subject); SubjectIcon already renders a neutral fallback for that.
 */
export function subjectVisualsFor(canonicalSubjectId) {
  const raw = String(canonicalSubjectId ?? '').trim().toLowerCase()
  if (!raw) return null
  const key = TEACHER_SUBJECT_TO_CURRICULUM[raw] || raw
  return SUBJECT_MAP[key] || SUBJECT_MAP[key.replace(/_/g, '-')] || null
}

/**
 * Normalise a teacher grade code ('G7', 'g7', 7, '7') to the numeric key used
 * by the TOPICS/SUBTOPICS catalogues (4-7). Returns null when out of range so
 * callers degrade to free text rather than guessing.
 */
export function gradeCodeToNumber(grade) {
  const n = Number(String(grade ?? '').replace(/[^0-9]/g, ''))
  return Number.isFinite(n) && n >= 4 && n <= 7 ? n : null
}

/**
 * Topics for a teacher-tools subject id + grade code (e.g.
 * getTopicsForTeacherSubject('social_studies', 'G7')). Returns [] when the
 * combination has no catalogue data so the studio shows a free-text field.
 */
export function getTopicsForTeacherSubject(teacherSubjectId, grade) {
  const subjectKey = TEACHER_SUBJECT_TO_CURRICULUM[teacherSubjectId]
  const gradeNum = gradeCodeToNumber(grade)
  if (!subjectKey || gradeNum == null) return []
  return getTopics(subjectKey, gradeNum)
}

/** Sub-topics for a teacher-tools subject id + grade code + topic. */
export function getSubtopicsForTeacherSubject(teacherSubjectId, grade, topic) {
  const subjectKey = TEACHER_SUBJECT_TO_CURRICULUM[teacherSubjectId]
  const gradeNum = gradeCodeToNumber(grade)
  if (!subjectKey || gradeNum == null) return []
  return getSubtopics(subjectKey, gradeNum, topic)
}

/** Helper — return the topic-level label (e.g. "topic" / "unit") for a subject + grade */
export function getTopicLabel(subjectId, grade) {
  return TOPIC_LABELS[subjectId]?.[grade] ?? {
    singular: 'topic',
    plural: 'topics',
    titleSingular: 'Topic',
    titlePlural: 'Topics',
  }
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

/* ─────────────────────────────────────────────────────────────────
 * Notes Studio additions
 * Grade bands so we can roll out Junior/Senior Secondary later
 * without changing every grade picker. Subjects/labels mirror the
 * canonical SUBJECTS list so notes use the same wire values as
 * lessons (label strings).
 * ───────────────────────────────────────────────────────────────── */

export const GRADE_BANDS = {
  primary:          [4, 5, 6, 7],
  junior_secondary: [8, 9],
  senior_secondary: [10, 11, 12],
}

export const ALL_GRADES = [
  { value: 4,  band: 'primary',          active: true  },
  { value: 5,  band: 'primary',          active: true  },
  { value: 6,  band: 'primary',          active: true  },
  { value: 7,  band: 'primary',          active: true  },
  { value: 8,  band: 'junior_secondary', active: false },
  { value: 9,  band: 'junior_secondary', active: false },
  { value: 10, band: 'senior_secondary', active: false },
  { value: 11, band: 'senior_secondary', active: false },
  { value: 12, band: 'senior_secondary', active: false },
]

export const SUBJECTS_BY_BAND = {
  primary:          SUBJECTS.map(s => s.label),
  junior_secondary: [],
  senior_secondary: [],
}

export const NOTE_STATUS = {
  DRAFT:     'draft',
  PENDING:   'pending',
  PUBLISHED: 'published',
  REJECTED:  'rejected',
}

export const NOTE_FORMAT = {
  SLIDES:    'slides',         // legacy slide-built lessons (LessonPlayer)
  RICH_TEXT: 'rich_text',
  FILE:      'file',
  VISUAL:    'visual_slides',  // AI-generated illustrated learner decks
  STUDY:     'study',          // structured, interactive study notes (blocks[])
}

export const BAND_LABELS = {
  primary:          'Primary',
  junior_secondary: 'Junior Secondary',
  senior_secondary: 'Senior Secondary',
}

export const getActiveGrades   = () => ALL_GRADES.filter(g => g.active)
export const getInactiveGrades = () => ALL_GRADES.filter(g => !g.active)

export const getBandForGrade = (gradeValue) => {
  const g = ALL_GRADES.find(x => x.value === Number(gradeValue))
  return g?.band ?? null
}

export const isGradeActive = (gradeValue) => {
  const g = ALL_GRADES.find(x => x.value === Number(gradeValue))
  return g?.active ?? false
}

export const getBandLabel = (band) => BAND_LABELS[band] ?? band

export const getSubjectsForGrade = (gradeValue) => {
  const band = getBandForGrade(gradeValue)
  if (!band) return []
  return SUBJECTS_BY_BAND[band] ?? []
}

/**
 * The subjects a learner in this grade is actually TAUGHT — the list the
 * learner's "My subjects" is built from.
 *
 * `getSubjectsForGrade` above answers a different question: every subject
 * label in the grade's BAND, which is what an admin dropdown wants. It is
 * not a per-grade list at all, so the learner home was showing subjects a
 * Grade 7 never takes (and, through a label-vs-id comparison, mis-grouping
 * the ones it did).
 *
 * Grade 7 is the ECZ Primary School Leaving Examination set, taken from
 * `config/examTimetable2026`, which is the authority on what a Grade 7
 * actually sits:
 *
 *   English Language · Mathematics · Integrated Science · Social Studies ·
 *   Expressive Arts · Home Economics · Technology Studies
 *
 * Two entries in SUBJECTS are deliberately NOT here:
 *   - `cinyanja` is one of SEVEN Zambian-language alternatives on that
 *     timetable (Icibemba, Chitonga, Silozi, Lunda, Luvale, Kiikaonde too).
 *     Listing Cinyanja for everyone would put a subject on a Silozi
 *     learner's home screen that they do not take. A language belongs here
 *     once the learner has told us which one they sit.
 *   - `creative-technology-studies` ("Special Paper 1") is an exam PAPER,
 *     not a taught subject.
 */
export const GRADE_SUBJECT_IDS = {
  7: ['english', 'mathematics', 'science', 'social-studies', 'technology', 'expressive-arts', 'home-economics'],
}

/**
 * Subject OBJECTS for a grade, in teaching order — never labels, because a
 * label ("Integrated Science") is not the id ("science") the content is
 * tagged with, and comparing the two is how the Notes hub quietly lost
 * every multi-word subject.
 *
 * A grade with no explicit list falls back to the subjects that actually
 * have a topic catalogue for it, so a new grade degrades to "what we have
 * content for" rather than to nothing.
 */
export function getGradeSubjects(gradeValue) {
  const grade = Number(gradeValue)
  if (!Number.isFinite(grade)) return []
  const ids = GRADE_SUBJECT_IDS[grade]
  if (ids) return ids.map((id) => SUBJECTS.find((s) => s.id === id)).filter(Boolean)
  return SUBJECTS.filter((s) => (TOPICS[s.id]?.[grade] || []).length > 0)
}
