// Sample lesson-plan content for the Format & Options preview. When a teacher
// clicks "Preview" on a format card, FormatPreviewModal renders one of these
// fixed samples through the real renderPlanHtml() renderers, so the preview is
// byte-for-byte what the studio would output for real content. No API call, no
// Firestore write.
//
// Ported from the legacy studio's public/studio/07-format-preview.js so the new
// React studio keeps the same "see the format before you generate" affordance.

// ── CBC (2023 ECF) sample ─────────────────────────────────────────────────────
// Adapted from the SAMPLE LESSON PLAN in the official Creative and Technology
// Studies Grade 2 teaching module (Term 1 & 2, Appendix 1: "Tourism —
// Attraction sites"), reshaped into the studio's plan contract.
export const CBC_SAMPLE_DATA = {
  topic: '2.10 Tourism',
  subtopic: '2.10.1 Attraction Sites',
  generalCompetences: ['Citizenship', 'Communication', 'Environmental Sustainability'],
  specificCompetence: '2.10.1.1 Explore local attraction sites',
  lessonGoal: 'To enable learners explore local attraction sites and appreciate their importance to the community.',
  rationale: 'This lesson will focus on tourism attraction sites such as museums, waterfalls and parks. Learners will explore local attraction sites and appreciate their importance to the community. To enhance understanding, learners will be engaged in group work and discovery methods. This is lesson 1 in a series of 2.',
  priorKnowledge: 'Learners have visited or watched a trading place, city, waterfalls, show grounds or museums.',
  references: [
    'Lower Primary Syllabus, Creative and Technology Studies, page 87.',
    'Creative and Technology Studies Teaching Module Grade 2, page 87.',
  ],
  learningEnvironment: {
    natural: 'School surroundings and the local community.',
    artificial: 'Classroom with a tourism corner.',
    technological: 'Video clip of a local attraction site shown on a phone or projector.',
  },
  materials: [
    'Pictures of local attraction sites',
    'Video clip of an attraction site',
    'Brochures from local tourism centres',
  ],
  expectedStandard: 'Local attraction sites explored accordingly.',
  stages: [
    {
      name: 'INTRODUCTION',
      duration: '5 min',
      teacher: 'Ask learners: "Have you ever visited a park, waterfall or museum?"\n"What did you see there?"\nShow learners brochures or pictures of local attraction sites.',
      pupils: 'Share their experiences of places they have visited.\nRelate what they see in the pictures to their own experience.',
      assessment: 'Learners appropriately relate what they see in the pictures to their experience.',
    },
    {
      name: 'LESSON DEVELOPMENT',
      duration: '15 min',
      teacher: 'Show learners a video of an attraction site (virtual educational visit).\nAsk learners to observe activities at the site.\nAfter the virtual visit, ask learners to draw or talk about what they saw.\nDiscuss how to behave responsibly at attraction sites (no littering, respect rules, protect property).',
      pupils: 'Describe the environment and the activities taking place at the site.\nDraw what they saw or share their experience.\nDiscuss responsible behaviour at an attraction site.',
      assessment: 'Learners describe the environment and activities on attraction sites accordingly.\nLearners draw what they saw with less difficulty.',
    },
    {
      name: 'EXERCISE / ASSESSMENT',
      duration: '5 min',
      teacher: 'Ask learners to:\n1. Identify local attraction sites.\n2. Describe features of the attraction sites mentioned.\n3. Demonstrate how to behave when visiting an attraction site.',
      pupils: '1. Correctly mention local attraction sites.\n2. Describe features of attraction sites clearly.\n3. Demonstrate appropriate behaviour when visiting sites.',
      assessment: 'Learners show ability to recall and share their experience accordingly.',
    },
    {
      name: 'HOMEWORK',
      duration: '2 min',
      teacher: 'Task learners: with the help of a parent, explore a nearby attraction site in your locality (a physical visit or pictures/videos may be used).',
      pupils: 'Copy the homework task and complete it at home with a family member.',
      assessment: 'Learners copy the homework task correctly.',
    },
    {
      name: 'CONCLUSION',
      duration: '3 min',
      teacher: 'Guide the learners to bring out the main points of the lesson learnt:\n- Tourism helps people learn about their environment and culture.\n- Attraction sites such as parks, dams, waterfalls and museums are important places in the community.',
      pupils: 'Bring out the key points of the lesson (what they learnt from the tour).',
      assessment: 'Learners clearly state what they saw and learnt, mention the important ideas and explain them in their own simple words.',
    },
  ],
  remedialWork: 'Learners who struggled review the picture cards with the teacher and name two attraction sites.',
  extensionActivity: 'Fast finishers design a small poster inviting visitors to one local attraction site.',
}

export const CBC_SAMPLE_META = {
  headerLine: 'Ministry of Education · Republic of Zambia',
  school: 'Mwelu Mantimpa Primary School',
  department: '',
  teacher: 'Mwamba Chanda',
  tsno: '20158502',
  klass: 'Grade 2',
  grade: 'Grade 2',
  subject: 'Creative and Technology Studies',
  duration: 30,
  date: '22 March 2026',
  time: '07:30',
  topic: '2.10 Tourism',
  subtopic: '2.10.1 Attraction Sites',
  compactMeta: true,
  showAttendance: true,
  showEnrolment: true,
  showReflection: true,
  totalLessons: 1,
  lessonNumber: 1,
}

// ── Previous curriculum (2013) sample ─────────────────────────────────────────
// Adapted from the Grade 10 Computer Studies sample lesson plan (Careers in
// ICT), reshaped into the old-curriculum plan contract.
export const OLD_SAMPLE_DATA = {
  topic: 'Computer Career Opportunities',
  subtopic: 'Careers in information and communication technology',
  tlAids: ['Chalk board', 'Ruler', 'Charts'],
  references: ["Longman Computer Studies Pupils' Book 10 (R. Banda, B. Dill & S. Nunkumar, 3rd ed., 2016)"],
  rationale: "This is a lesson on careers in information and communication technology. Teacher exposition, question and answer and class discussion methods will be used. The lesson will develop pupils' knowledge of careers in ICT and the skill of identifying careers in relation to ICT, and they will gain the value of awareness of different opportunities. This lesson is number 1 in the series of 2.",
  prerequisiteKnowledge: 'Pupils have ideas about the use of computers in everyday life.',
  specificOutcomes: [
    'Describe different careers in ICT.',
    'Identify opportunities for further education in ICT.',
  ],
  stages: [
    {
      name: 'INTRODUCTION',
      duration: '5 min',
      content: 'The nature of careers in the computer industry. There are very few careers today that do not involve the use of computer technology.',
      teacher: 'Ask pupils: "Which jobs in our community use computers?"\nExplain the importance of the topic.',
      pupils: 'Pupils answer the question and listen to the explanation.',
      methods: 'Question & Answer',
    },
    {
      name: 'DEVELOPMENT — Step 1: Computer jobs and careers',
      duration: '12 min',
      content: 'Jobs directly linked to computer technology include: computer software trainer, helpdesk support, computer and network technicians, network administrators, software and web developers, mobile app developers and security experts.',
      teacher: 'Jot the main points on the board.\nPut pupils in groups to identify careers they know.',
      pupils: 'Pupils listen and copy brief notes in their books.\nPupils discuss in groups and bring out points.',
      methods: 'Teacher Exposition / Group Work',
    },
    {
      name: 'DEVELOPMENT — Step 2: Training opportunities',
      duration: '13 min',
      content: 'Qualifications can be obtained through accredited computer training institutions, international online services or a university degree. Common qualifications include a degree in computer studies, A+ and N+ certification, MCSE, CCIE and ICDL.',
      teacher: 'Give examples of common computer qualifications.\nGuide the class discussion.',
      pupils: 'Pupils participate in the discussion and ask questions.',
      methods: 'Class Discussion',
    },
    {
      name: 'CONCLUSION',
      duration: '10 min',
      content: 'Summary of the main points of the lesson.',
      teacher: "Emphasise the main points of the lesson.\nAsk random questions to check on pupils' understanding.",
      pupils: "Pupils answer the teacher's questions.",
      methods: 'Individual Work',
    },
  ],
  homework: 'Briefly identify careers and jobs directly linked to computer technology. (Expected answers: computer software trainer, helpdesk support, computer and network technicians, network administrators, software and web developers, mobile app developers, security experts.)',
}

export const OLD_SAMPLE_META = {
  headerLine: 'Ministry of Education · Republic of Zambia',
  school: 'Kabwe Secondary School',
  department: '',
  teacher: 'Mr B. Banda',
  tsno: '20158502',
  klass: 'Grade 10',
  grade: 'Grade 10',
  subject: 'Computer Studies',
  duration: 40,
  date: '22 March 2026',
  time: '07:30',
  topic: 'Computer Career Opportunities',
  subtopic: 'Careers in information and communication technology',
  compactMeta: true,
  showAttendance: true,
  showEnrolment: true,
  showReflection: true,
  totalLessons: 1,
  lessonNumber: 1,
}

/**
 * Human-readable title for a format preview.
 * @param {string} format - 'modern' | 'classic' | 'official'
 * @param {string} curriculumMode - 'cbc' | 'previous'
 * @returns {string}
 */
export function formatPreviewTitle(format, curriculumMode) {
  const era = curriculumMode === 'previous' ? ' (Previous 2013)' : ''
  if (format === 'classic') return `Classic${era} — preview`
  if (format === 'official' || format === 'official-cbc' || format === 'classic2') return `Official CBC${era} — preview`
  return `Modern Clean${era} — preview`
}
