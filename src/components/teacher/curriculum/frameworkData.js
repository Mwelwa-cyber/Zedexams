/**
 * Shared reference data drawn from the 2023 Approved National School
 * Curriculum Framework (ZECF) — Curriculum Development Centre, Ministry of
 * Education, Republic of Zambia.
 *
 * Consumed by the teacher Curriculum reference pages (CurriculumHome,
 * SecondaryCurriculum). PrimaryCurriculum keeps its own primary-specific
 * cross-cutting table (which maps each theme to where it lands in each
 * subject), so it is intentionally not refactored onto this module.
 *
 * Section references (e.g. §2.3.1) point at the framework for verification.
 */

/**
 * Table 1 — General Competences and Definition (§2.3.1). The cross-curricular
 * heart of the Competence-Based Curriculum: every subject syllabus breaks
 * these down into subject-specific, examinable competences.
 */
export const GENERAL_COMPETENCES = [
  ['🧩', 'Analytical Thinking', 'Breaking down complex information into its components and understanding how they are interconnected.'],
  ['🤝', 'Collaboration', 'Working with others to achieve results as a team.'],
  ['💬', 'Communication', 'Sharing ideas, thoughts, information and messages concisely and precisely.'],
  ['💡', 'Creativity & Innovation', 'Creating new ideas and products by applying processes and introducing new techniques that add value.'],
  ['🔎', 'Critical Thinking', 'Conceptualising, applying, analysing, synthesising and evaluating information to form a judgement or guide a belief or action.'],
  ['🏛️', 'Citizenship', 'Acting as a responsible citizen and participating fully in civic and social life, grounded in social, cultural, economic, legal and political principles, global trends and sustainability.'],
  ['💻', 'Digital Literacy', 'Using a broad range of ICTs — such as a phone, computer or calculator — in specific contexts.'],
  ['❤️', 'Emotional Intelligence', "Recognising one's own emotions and those of others, and using that to manage oneself and one's relationships in different situations."],
  ['🚀', 'Entrepreneurship', 'The knowledge, skills and behaviour needed to identify, create, develop, manage and grow a business venture.'],
  ['🌳', 'Environmental Sustainability', 'Appropriate and sustainable use of natural resources and preservation of the environment.'],
  ['💰', 'Financial Literacy', 'Applying knowledge of key financial concepts, products and services to financial management.'],
  ['🧠', 'Problem Solving', 'Identifying, analysing and finding solutions to challenging situations.'],
]

/** Language of Instruction policy (§2.3.2 + the level reforms in §4.1–4.2). */
export const LANGUAGE_OF_INSTRUCTION = [
  'The Education Act of 2011 prescribes English as the official Language of Instruction from Early Childhood Education (ECE) through to Tertiary, building one continuous learning foundation.',
  'A Zambian Language may be used to explain concepts, while English stays the medium across the curriculum — except when a Zambian or foreign language is itself the subject being taught.',
  'At ECE and Lower Primary (Grades 1–3), code-switching to a community Zambian Language is encouraged to ease transition, supported by the Early Grade Literacy Programme (EGLP) in both English and a Zambian Language.',
  'Sign Language is the medium of instruction for learners with hearing impairment at all levels; Braille materials support learners with visual impairment.',
]

/** National Values & Principles — Article 8 of the Constitution (§3.6). */
export const NATIONAL_VALUES = [
  'Morality and Ethics',
  'Patriotism and National Unity',
  'Democracy and Constitutionalism',
  'Good Governance and Integrity',
  'Human Dignity, Equity, Social Justice, Equality and Non-Discrimination',
  'Sustainable Development',
]

/**
 * Chapter 3 — National Concerns / Cross-Cutting Themes (§3.1–§3.18). These 18
 * concerns must be integrated across the curriculum at every level.
 */
export const CROSS_CUTTING_THEMES = [
  ['Life Skills & Health Education (LSHE)', 'Builds knowledge, attitudes and psycho-social skills — self-awareness, decision-making, communication — for healthy, informed choices and relationships.'],
  ['Gender', 'Addresses the socially constructed roles of males and females and tackles inequalities that harm social, mental and economic wellbeing.'],
  ['Governance', 'Promotes the organisation, regulation and accountability of laws and behaviour for sound national development.'],
  ['Corruption', 'Builds awareness and rejection of bribery and abuse of office that erode public trust and good governance.'],
  ['Human Rights & Freedoms', 'Upholds the rights and freedoms of every person regardless of gender, colour, nationality, ethnicity, language or religion.'],
  ['National Values & Principles', 'Instils the Article 8 values — morality, patriotism, democracy, good governance, human dignity and sustainable development.'],
  ['Entrepreneurship Education', 'Equips learners to spot business opportunities and create jobs through self-employment.'],
  ['HIV and AIDS', 'Creates awareness of prevention, counselling, testing and treatment to reduce the impact of the epidemic.'],
  ['Environmental Health & Pollution Management', 'Promotes sustainable use of resources and reduction of waste, pollution and environmental degradation.'],
  ['Climate Change Education', 'Builds awareness of climate-change impacts and mitigation across social, economic and ecological systems.'],
  ['Health and Nutrition', 'Improves learner health and nutrition, which directly affect attendance, retention and performance.'],
  ['Drug and Substance Abuse', 'Addresses the rising abuse of drugs and substances among learners and its consequences.'],
  ['Mental Health', 'Supports mental wellbeing so learners can cope with stress and learn productively.'],
  ['Social & Emotional Learning (SEL)', 'Helps learners of all ages make positive, responsible decisions and manage emotions and relationships.'],
  ['Financial Education', 'Builds the knowledge and confidence to manage money and make sound financial decisions.'],
  ['Special & Inclusive Education', 'Ensures learners with disabilities and special educational needs can access and benefit from the curriculum.'],
  ['Education for Sustainable Development (ESD)', 'Develops the knowledge, skills and values needed to live and act sustainably.'],
  ['Digital Literacy', 'Equips learners to use technology safely and productively across all subjects.'],
]

/** Education Guiding Principles (§2.2). */
export const GUIDING_PRINCIPLES = [
  ['Inclusiveness & Equity', 'Every learner — whatever their age, gender, ethnicity, language or disability — can access, participate in and benefit from quality education.'],
  ['Accountability', 'Government is responsible and answerable to citizens and stakeholders for delivering education objectives and their measures.'],
  ['Transparency', 'Information on education performance is accessible to stakeholders following agreed procedures and timelines.'],
  ['Partnerships', 'Stakeholder participation in providing education services is actively encouraged and supported.'],
  ['Social Justice', 'Poor and vulnerable learners are given special consideration in the fairness of education provision.'],
  ['Integrity', 'The education sector operates honestly, aligning its actions with sound values.'],
]

/**
 * Key legal, policy and international instruments underpinning the framework
 * (§2.1). Curated to the items most relevant to classroom teachers rather than
 * the framework's full legislative list.
 */
export const KEY_INSTRUMENTS = {
  Laws: [
    'Education Act No. 23 of 2011',
    'Constitution of Zambia (Amendment) Act, 2016 — Article 8 national values',
    'Teaching Profession Act No. 5 of 2013',
    'Examinations Council of Zambia Act (Cap 137, amended 2021)',
    'TEVET Act No. 13 of 1998',
    'Higher Education Act No. 4 of 2013',
    'Persons with Disabilities Act No. 6 of 2012',
    "Children's Code Act No. 12 of 2022",
    'Cyber Security and Cyber Crimes Act No. 2 of 2021',
    'Data Protection Act No. 3 of 2021',
  ],
  'Policies & Plans': [
    'Vision 2030 — “A Prosperous Middle-Income Nation”',
    'Eighth National Development Plan (8NDP)',
    '2023 National Education Policy — “Education for Sustainability”',
    'National ICT Policy, 2023',
    'School Health and Nutrition Policy, 2006',
    'National Policy on Disability, 2015',
  ],
  'International Instruments': [
    'Sustainable Development Goals (esp. Goal 4)',
    'African Union Agenda 2063',
    'Continental Education Strategy for Africa (CESA)',
    'Universal Declaration of Human Rights (1948)',
    'UN Convention on the Rights of Persons with Disabilities',
    'SADC Protocol on Education and Training',
  ],
}

/**
 * The other education levels in the framework (§4.1, §4.4, §4.5) — present for
 * a complete picture even though ZedExams is centred on Primary & Secondary.
 */
export const OTHER_LEVELS = [
  {
    emoji: '🧸',
    title: 'Early Childhood Education (ECE)',
    range: 'Ages 0–5',
    section: '§4.1',
    facts: [
      ['Levels', 'Day-Care (0–3), Nursery (3–4), Reception (4–5)'],
      ['Learning areas', 'Pre-Literacy & Language · Pre-Mathematics & Science · Creative & Technology Studies (CTS)'],
      ['Contact time', '15 hours / 30 periods per week'],
    ],
    notes: 'Thematic, play-based learning across five developmental domains (physical, cognitive, language, social-emotional, aesthetic). Learning areas were cut from 5 to 3 to align with Primary, with Expressive Arts replaced by CTS.',
  },
  {
    emoji: '🎓',
    title: 'Teacher Education (Tertiary)',
    range: 'Colleges & Universities',
    section: '§4.4',
    facts: [
      ['Prepares teachers for', 'Early Childhood, Primary and Secondary levels'],
      ['Pre-service', 'For candidates with no prior teacher training or experience'],
      ['In-service', 'Serving teachers upgrading skills via CPD — short courses, workshops, seminars, distance & face-to-face study'],
    ],
    notes: 'Built around the same 12 general competences, captured in the Student Teacher Exit Profile.',
  },
  {
    emoji: '📚',
    title: 'Youth & Adult Literacy Education (YALE)',
    range: 'Ages 15+',
    section: '§4.5',
    facts: [
      ['For', 'Out-of-school youth and adults seeking a second chance'],
      ['Builds', 'The 3Rs (reading, writing, arithmetic) plus functional life skills'],
      ['Progression', 'Learners can enter open classes at Grade 4, 5, 6 and beyond'],
    ],
    notes: 'Two options — Option 1 builds basic literacy & numeracy (≈ Grade 3); Option 2 adds vocational, language, numeracy and financial-literacy skills.',
  },
]
