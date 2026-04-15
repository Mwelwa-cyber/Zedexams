/**
 * Competency Badge System — Zambia CBC aligned
 *
 * Each badge has:
 *   id          — unique slug
 *   name        — display name
 *   icon        — emoji
 *   tier        — 'bronze' | 'silver' | 'gold'
 *   description — shown on the badge card
 *   subject     — subject ID (or 'any' for cross-subject)
 *   topicHint   — lowercase keyword matched against quiz topic
 *   competency  — CBC competency strand
 *   criteria    — { minScore: 0-100, minAttempts: n }
 *
 * BADGE LOGIC SUMMARY
 * ──────────────────────────────────────────────────────────
 * A badge is EARNED when a learner has:
 *   1. Taken at least `criteria.minAttempts` quizzes in the
 *      matching subject / topic area, AND
 *   2. Achieved `criteria.minScore`% or higher in ALL of
 *      those qualifying attempts (or in the average).
 *
 * Three tiers exist:
 *   Bronze  — first steps, 60%+ avg, 1 attempt
 *   Silver  — progressing, 70%+ avg, 2 attempts
 *   Gold    — mastery, 80%+ avg, 3 attempts
 *
 * Learners earn the highest tier they qualify for.
 * ──────────────────────────────────────────────────────────
 */

export const BADGE_TIERS = {
  bronze: { label: 'Bronze', color: '#92400E', bg: 'bg-amber-100', text: 'text-amber-800' },
  silver: { label: 'Silver', color: '#6B7280', bg: 'bg-gray-100',  text: 'text-gray-700'  },
  gold:   { label: 'Gold',   color: '#D97706', bg: 'bg-yellow-100',text: 'text-yellow-700'},
}

export const BADGES = [
  // ── Mathematics ───────────────────────────────────────────────
  {
    id: 'fractions-explorer',
    name: 'Fractions Explorer',
    icon: '🧮',
    tier: 'silver',
    description: 'Demonstrated solid understanding of fractions and decimals.',
    subject: 'mathematics',
    topicHint: 'fraction',
    competency: 'Number & Operations',
    criteria: { minScore: 70, minAttempts: 2 },
  },
  {
    id: 'number-wizard',
    name: 'Number Wizard',
    icon: '✨',
    tier: 'bronze',
    description: 'Shows confidence with whole numbers and basic operations.',
    subject: 'mathematics',
    topicHint: 'number',
    competency: 'Number & Operations',
    criteria: { minScore: 65, minAttempts: 1 },
  },
  {
    id: 'geometry-pro',
    name: 'Geometry Pro',
    icon: '📐',
    tier: 'silver',
    description: 'Mastered shapes, angles, and spatial reasoning.',
    subject: 'mathematics',
    topicHint: 'geometry',
    competency: 'Geometry & Spatial Reasoning',
    criteria: { minScore: 75, minAttempts: 2 },
  },
  {
    id: 'maths-champion',
    name: 'Maths Champion',
    icon: '🏅',
    tier: 'gold',
    description: 'Achieved outstanding results across Mathematics topics.',
    subject: 'mathematics',
    topicHint: '',
    competency: 'Number & Operations',
    criteria: { minScore: 85, minAttempts: 4 },
  },

  // ── English Language ──────────────────────────────────────────
  {
    id: 'reading-champion',
    name: 'Reading Champion',
    icon: '📚',
    tier: 'silver',
    description: 'Demonstrated excellent reading comprehension skills.',
    subject: 'english',
    topicHint: 'reading',
    competency: 'Reading & Comprehension',
    criteria: { minScore: 72, minAttempts: 2 },
  },
  {
    id: 'word-explorer',
    name: 'Word Explorer',
    icon: '🔤',
    tier: 'bronze',
    description: 'Shows strong vocabulary and word recognition.',
    subject: 'english',
    topicHint: 'vocabulary',
    competency: 'Grammar & Language Structure',
    criteria: { minScore: 65, minAttempts: 1 },
  },
  {
    id: 'language-ace',
    name: 'Language Ace',
    icon: '🖊️',
    tier: 'gold',
    description: 'Consistently excels in English Language.',
    subject: 'english',
    topicHint: '',
    competency: 'Literature & Creative Expression',
    criteria: { minScore: 80, minAttempts: 3 },
  },

  // ── Integrated Science ────────────────────────────────────────
  {
    id: 'scientific-thinker',
    name: 'Scientific Thinker',
    icon: '🔬',
    tier: 'silver',
    description: 'Applies scientific reasoning and enquiry skills.',
    subject: 'science',
    topicHint: '',
    competency: 'Scientific Inquiry',
    criteria: { minScore: 70, minAttempts: 2 },
  },
  {
    id: 'plant-master',
    name: 'Master of Flowering Plants',
    icon: '🌸',
    tier: 'bronze',
    description: 'Knows the life cycles and structures of plants.',
    subject: 'science',
    topicHint: 'plant',
    competency: 'Living Things & Biology',
    criteria: { minScore: 70, minAttempts: 1 },
  },
  {
    id: 'eco-guardian',
    name: 'Environmental Guardian',
    icon: '🌿',
    tier: 'silver',
    description: 'Understands environmental issues and sustainability.',
    subject: 'science',
    topicHint: 'environment',
    competency: 'Earth & Environment',
    criteria: { minScore: 72, minAttempts: 2 },
  },

  // ── Social Studies ────────────────────────────────────────────
  {
    id: 'civic-leader',
    name: 'Civic Leader',
    icon: '🏛️',
    tier: 'silver',
    description: 'Strong knowledge of civic rights and responsibilities.',
    subject: 'social-studies',
    topicHint: 'civic',
    competency: 'Civic Education',
    criteria: { minScore: 72, minAttempts: 2 },
  },
  {
    id: 'zambia-explorer',
    name: 'Zambia Explorer',
    icon: '🇿🇲',
    tier: 'bronze',
    description: 'Knowledgeable about Zambia\'s geography, history, and culture.',
    subject: 'social-studies',
    topicHint: 'zambia',
    competency: 'History & Heritage',
    criteria: { minScore: 65, minAttempts: 1 },
  },
  {
    id: 'global-citizen',
    name: 'Global Citizen',
    icon: '🌐',
    tier: 'gold',
    description: 'Outstanding understanding of society, rights, and the world.',
    subject: 'social-studies',
    topicHint: '',
    competency: 'Culture & Society',
    criteria: { minScore: 80, minAttempts: 3 },
  },

  // ── Technology Studies ────────────────────────────────────────
  {
    id: 'digital-citizen',
    name: 'Digital Citizen',
    icon: '💻',
    tier: 'bronze',
    description: 'Understands safe and responsible technology use.',
    subject: 'technology',
    topicHint: 'digital',
    competency: 'Digital Literacy',
    criteria: { minScore: 65, minAttempts: 1 },
  },
  {
    id: 'tech-innovator',
    name: 'Tech Innovator',
    icon: '🚀',
    tier: 'gold',
    description: 'Demonstrates excellent problem-solving with technology.',
    subject: 'technology',
    topicHint: '',
    competency: 'Problem Solving & Design',
    criteria: { minScore: 80, minAttempts: 3 },
  },

  // ── Home Economics ────────────────────────────────────────────
  {
    id: 'nutrition-star',
    name: 'Nutrition Star',
    icon: '🥗',
    tier: 'bronze',
    description: 'Understands the importance of a balanced diet and nutrition.',
    subject: 'home-economics',
    topicHint: 'nutrition',
    competency: 'Food & Nutrition',
    criteria: { minScore: 65, minAttempts: 1 },
  },
  {
    id: 'home-skills-hero',
    name: 'Home Skills Hero',
    icon: '🏆',
    tier: 'silver',
    description: 'Demonstrates strong home management and life skills.',
    subject: 'home-economics',
    topicHint: '',
    competency: 'Home Management',
    criteria: { minScore: 70, minAttempts: 2 },
  },

  // ── Expressive Arts ───────────────────────────────────────────
  {
    id: 'creative-mind',
    name: 'Creative Mind',
    icon: '🎨',
    tier: 'bronze',
    description: 'Shows creativity and expression through the arts.',
    subject: 'expressive-arts',
    topicHint: '',
    competency: 'Creative Expression',
    criteria: { minScore: 65, minAttempts: 1 },
  },
  {
    id: 'performing-star',
    name: 'Performing Star',
    icon: '🎭',
    tier: 'silver',
    description: 'Excels in music, drama, or performance arts.',
    subject: 'expressive-arts',
    topicHint: 'music',
    competency: 'Music & Performance',
    criteria: { minScore: 72, minAttempts: 2 },
  },

  // ── Cross-Subject / Special ───────────────────────────────────
  {
    id: 'first-quiz',
    name: 'First Steps',
    icon: '🌱',
    tier: 'bronze',
    description: 'Completed your very first quiz on ZedExams!',
    subject: 'any',
    topicHint: '',
    competency: 'Learning Journey',
    criteria: { minScore: 0, minAttempts: 1 },
  },
  {
    id: 'top-scorer',
    name: 'Top Scorer',
    icon: '⭐',
    tier: 'gold',
    description: 'Achieved 90% or above in any quiz — exceptional performance!',
    subject: 'any',
    topicHint: '',
    competency: 'Academic Excellence',
    criteria: { minScore: 90, minAttempts: 1 },
  },
  {
    id: 'ten-quizzes',
    name: 'Dedicated Learner',
    icon: '🔖',
    tier: 'silver',
    description: 'Completed 10 quizzes — consistent effort pays off!',
    subject: 'any',
    topicHint: '',
    competency: 'Learning Journey',
    criteria: { minScore: 0, minAttempts: 10 },
  },
]

/** Badge ID → Badge lookup */
export const BADGE_MAP = Object.fromEntries(BADGES.map(b => [b.id, b]))

/**
 * Evaluate which badges a user has earned from their results.
 *
 * @param {Array} results   — array of result docs from Firestore
 * @returns {{ earned: Badge[], progress: { badge: Badge, progress: number }[] }}
 *
 * EXAMPLE USAGE:
 *   const { earned, progress } = evaluateBadges(userResults)
 *   // earned[0] = { id: 'fractions-explorer', name: 'Fractions Explorer', … }
 */
export function evaluateBadges(results = []) {
  const earned   = []
  const progress = []

  // Special: first-quiz badge
  if (results.length >= 1) {
    earned.push({ ...BADGE_MAP['first-quiz'], earnedAt: results[0]?.completedAt })
  }

  // Special: top-scorer badge
  const hasPerfect = results.some(r => r.percentage >= 90)
  if (hasPerfect) {
    const r = results.find(r => r.percentage >= 90)
    earned.push({ ...BADGE_MAP['top-scorer'], earnedAt: r?.completedAt })
  }

  // Special: 10-quizzes badge
  if (results.length >= 10) {
    earned.push({ ...BADGE_MAP['ten-quizzes'], earnedAt: results[9]?.completedAt })
  }

  // Subject/topic based badges
  const subjectBadges = BADGES.filter(b => b.subject !== 'any' && !earned.find(e => e.id === b.id))

  for (const badge of subjectBadges) {
    // Filter results matching subject (and optionally topic keyword)
    const relevant = results.filter(r => {
      const subjectMatch = r.subject === badge.subject
      if (!badge.topicHint) return subjectMatch
      const topic = (r.topic || '').toLowerCase()
      return subjectMatch && topic.includes(badge.topicHint)
    })

    const totalAttempts = relevant.length
    const avgScore      = totalAttempts > 0
      ? relevant.reduce((sum, r) => sum + (r.percentage ?? 0), 0) / totalAttempts
      : 0

    if (totalAttempts >= badge.criteria.minAttempts && avgScore >= badge.criteria.minScore) {
      const latestResult = relevant.sort((a, b) =>
        (b.completedAt?.toMillis?.() ?? 0) - (a.completedAt?.toMillis?.() ?? 0)
      )[0]
      earned.push({ ...badge, earnedAt: latestResult?.completedAt })
    } else {
      // Calculate progress 0-100 towards earning this badge
      const scoreProgress    = badge.criteria.minScore > 0 ? Math.min(avgScore / badge.criteria.minScore, 1) : 1
      const attemptProgress  = Math.min(totalAttempts / badge.criteria.minAttempts, 1)
      const overallProgress  = Math.round(((scoreProgress + attemptProgress) / 2) * 100)
      progress.push({ badge, progress: overallProgress, totalAttempts, avgScore: Math.round(avgScore) })
    }
  }

  return { earned, progress }
}
