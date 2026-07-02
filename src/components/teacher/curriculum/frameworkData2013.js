/**
 * Shared reference data drawn from *The Zambia Education Curriculum Framework
 * 2013* (ZECF 2013) — Curriculum Development Centre, Ministry of Education,
 * Science, Vocational Training and Early Education (MESVTEE), Republic of
 * Zambia. ISBN 978-9982-54-070-4.
 *
 * This is the PREVIOUS ("old") national curriculum. Some grades are still
 * taught on it, so the teacher Curriculum reference surfaces it alongside the
 * current 2023 framework (see the sibling `frameworkData.js`).
 *
 * Consumed by the 2013 reference pages: Curriculum2013Home, ECE2013Curriculum,
 * Primary2013Curriculum, Secondary2013Curriculum. Chapter references point at
 * the framework document for verification.
 *
 * NB — this is deliberately kept as the 2013 content, not a copy of the 2023
 * data. The two frameworks differ (2013 uses Grades 1–12 with two career
 * pathways; 2023 uses Forms and O/A-Level). Keep them distinct.
 */

/** Zambia national-flag accents reused by every 2013 reference page. */
export const ZM_GREEN = '#1a7a4a'
export const ZM_GOLD = '#d4a017'
export const ZM_RED = '#c0392b'

/** One-line source attribution rendered at the foot of each page. */
export const SOURCE_2013 =
  'The Zambia Education Curriculum Framework 2013 · Curriculum Development Centre, Ministry of Education, Science, Vocational Training and Early Education, Republic of Zambia'

/**
 * The education structure the 2013 framework prescribes (Chapter 4). Note the
 * Grade-based ladder all the way to Grade 12 — the two-tier career pathways
 * open at Junior Secondary and continue through Senior Secondary.
 */
export const STRUCTURE_2013 = [
  ['Early Childhood Care, Development & Education', 'Ages 0 – 6 (Day-Care, Nursery, Reception)'],
  ['Primary', 'Grades 1 – 7 (Lower Primary G1–4, Upper Primary G5–7)'],
  ['Junior Secondary', 'Grades 8 – 9 (Academic + Vocational career pathways)'],
  ['Senior Secondary', 'Grades 10 – 12 (Academic + Vocational career pathways)'],
  ['Tertiary', 'Colleges & universities (incl. Teacher Education)'],
  ['Adult Literacy', 'Second-chance learning for youths & adults who missed formal schooling'],
]

/**
 * The defining reform of 2013: two career pathways opening at secondary. This
 * is the single biggest difference from the older subject-only curriculum and
 * the reason the framework matters to teachers of grades still on it.
 */
export const CAREER_PATHWAYS_2013 = [
  {
    emoji: '📘',
    title: 'Academic Career Pathway',
    body: 'For learners with a passion for academic subjects and careers in that direction. Runs from Grade 8 through to Grade 12, leading to the Junior Secondary School Certificate and the School Certificate (ECZ).',
  },
  {
    emoji: '🔧',
    title: 'Vocational Career Pathway',
    body: 'For learners with ambitions in technical and practical work. Provides hands-on skills from Grade 8, and successful learners earn TEVETA trade certificates alongside their school certificate.',
  },
]

/**
 * The main focus areas of the new (2013) curriculum (Chapter 2 — "The Focus of
 * the New Education Curriculum"). Curated to those most visible in the
 * classroom.
 */
export const FOCUS_AREAS_2013 = [
  ['Two career pathways at secondary', 'Opened Academic and Vocational pathways so learners progress by ability and interest.'],
  ['School ↔ TEVET linkage', 'Linked the school vocational curriculum to technical and vocational training so learners can earn trade certificates.'],
  ['Subjects integrated into learning areas', 'Grouped subjects with related competences into learning areas to reduce curriculum overload and fragmentation.'],
  ['Language of instruction reviewed', 'A familiar Zambian Language is the medium at ECE and Lower Primary (Grades 1–4); literacy in English follows from Grade 2.'],
  ['Clear key competences per level', 'Spelt out the competences each learner should achieve at every level of education.'],
  ['National concerns integrated', 'Wove cross-cutting issues (see below) across every learning area rather than teaching them stand-alone.'],
  ['Foreign languages introduced', 'Added French, Chinese and Portuguese as optional subjects at secondary school.'],
  ['Early & adult literacy standardised', 'Standardised the early-grade and adult-literacy curricula and teaching methodologies.'],
]

/**
 * Education development principles of the Education Act, 2011 (Chapter 2) —
 * the guiding principles on which the framework provides education at all
 * levels.
 */
export const GUIDING_PRINCIPLES_2013 = [
  ['Liberalisation', 'Opening education provision to a range of providers alongside the State.'],
  ['Decentralisation', 'Devolving management and decision-making closer to schools and communities.'],
  ['Equality', 'Treating all learners fairly with the same opportunity to learn.'],
  ['Equity', 'Giving poor and vulnerable learners the special consideration they need to benefit.'],
  ['Partnership', 'Encouraging stakeholder participation in providing education services.'],
  ['Accountability', 'Making providers responsible and answerable for education outcomes.'],
]

/**
 * Chapter 3 — National Concerns (Cross-Cutting Themes). Emerging challenges
 * that cut across the curriculum and are integrated at all levels; those that
 * cannot be integrated are offered as special modules within a learning area.
 */
export const NATIONAL_CONCERNS_2013 = [
  ['Special Educational Needs', 'Identifying, screening and supporting learners with hearing, visual, physical or intellectual impairments and the gifted/talented — through adapted curriculum, Braille, Sign Language and, where needed, an Alternative Education Curriculum.'],
  ['Careers Guidance & Counselling', 'Personal, social, vocational and educational guidance so every learner becomes a well-balanced individual — learning to live, learning to learn and learning to work.'],
  ['Environmental Education & Climate Change', 'Values, knowledge and attitudes for environmentally friendly action, Education for Sustainable Development, and awareness of the ecological and social dimensions of the climate crisis.'],
  ['Life Skills', 'Abilities for positive behaviour and everyday challenges — vocational, practical-health, expressive, literacy, numeracy and psychosocial skills.'],
  ['Governance', 'Developing, implementing and evaluating the laws, policies and rules that govern society, and exposing learners to good, democratic governance.'],
  ['Gender', 'Addressing the socially constructed relations between men and women through gender-sensitive teaching and issues of equity and equality.'],
  ['Human Rights', 'Integrating human-rights awareness across the curriculum in line with the UN conventions Zambia has signed.'],
  ['Population & Family Life Education', 'The dynamics of human populations and their environments, health needs and challenges — delivered through Comprehensive Sexuality Education.'],
  ['Reproductive Health & Sexuality', 'Helping learners appreciate how their bodies function and handle issues of sexuality with the right knowledge, skills and attitudes.'],
  ['HIV and AIDS', 'Knowledge, values and skills on prevention, counselling, testing and living with HIV and AIDS.'],
  ['Health & Nutrition', 'School Health and Nutrition interventions — including water, sanitation and hygiene — that protect learners’ attendance, retention and performance.'],
  ['Entrepreneurship Education & Training', 'Knowledge, values, skills and motivation to turn innovative ideas into goods and services — learned through learner-run projects and companies at secondary and tertiary level.'],
]

/**
 * Legal and policy instruments the framework is built on (Chapter 2 —
 * Government Laws, Policies, National Strategies & International Conventions),
 * curated to the items most relevant to teachers.
 */
export const KEY_INSTRUMENTS_2013 = {
  Laws: [
    'Education Act of 1966 (repealed 2011)',
    'Constitution of Zambia, Act No. 1 of 1991 & Amendment Act No. 18 of 1996',
    'The Disability Act, 1996',
    'TEVET Act No. 13 of 1998 (Amendment Act No. 11 of 2005)',
    'Education Act of 2011',
    'Zambia National Qualifications Authority Act No. 13 of 2011',
  ],
  'Policies & Strategies': [
    '“Educating Our Future” — National Policy on Education, 1996',
    'TEVET Policy, 1996',
    'Vision 2030 — “A Prosperous Middle-Income Nation”',
    'Sixth National Development Plan (SNDP)',
  ],
  'International Instruments': [
    'Universal Declaration of Human Rights (1948)',
    'UN Convention on the Rights of the Child',
    'Education for All (EFA) goals',
    'Millennium Development Goals',
    'SADC Protocol on Education and Training',
  ],
}

/**
 * The other levels of the education system (Chapter 4) — present so teachers
 * see the whole 2013 ladder even though ZedExams centres on Primary &
 * Secondary. Same shape as `OTHER_LEVELS` in frameworkData.js.
 */
export const OTHER_LEVELS_2013 = [
  {
    emoji: '🎓',
    title: 'Teacher Education (Tertiary)',
    range: 'Colleges & Universities',
    section: 'Chapter 4',
    facts: [
      ['Courses', 'Early Childhood, Primary, Junior Secondary and Senior Secondary teacher education'],
      ['Award', 'Certificate, Diploma or Degree depending on the course'],
      ['Teaching subjects', 'Student teachers study at least two teaching subjects aligned with the school curriculum they will teach'],
    ],
    notes: 'Practical subjects are allocated more time so student teachers can teach the vocational learning areas competently.',
  },
  {
    emoji: '🔧',
    title: 'Technical, Vocational & Entrepreneurship Training (TEVET)',
    range: 'TEVETA-accredited institutions',
    section: 'Chapter 4',
    facts: [
      ['Trade Test Certificate', 'TEVET Qualifications Framework Level 3'],
      ['Certificate / Craft Certificate', 'Level 4'],
      ['Advanced (Technician) Certificate', 'Level 5'],
      ['Diploma', 'Level 6'],
    ],
    notes: 'The school vocational pathway links directly to TEVET, so learners can earn trade certificates from TEVETA alongside their school certificate.',
  },
  {
    emoji: '📚',
    title: 'Adult Literacy',
    range: 'Youths & adults who missed formal schooling',
    section: 'Chapter 4',
    facts: [
      ['Learning areas', 'Literacy · Numeracy · Entrepreneurship & ICT · Civic Education · Environment & Health Education'],
      ['Contact time', '9 hours per week (Table 18)'],
      ['Progression', 'Learners can proceed into Grade 5–7 and beyond — secondary and tertiary'],
    ],
    notes: 'Redesigned to connect to the formal system, with entrepreneurship, ICT and Civic Education now part of the core curriculum.',
  },
]
