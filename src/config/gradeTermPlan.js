/**
 * gradeTermPlan — which topics a grade covers in which term.
 *
 * WHY THIS FILE EXISTS. The learner Subject screen has a Term 1/2/3
 * switcher, and until now it derived a topic's term from the term tags on
 * that topic's QUIZZES. Nothing is term-tagged, so every tab showed the same
 * list and the switcher looked broken.
 *
 * WHERE THE DATA COMES FROM, exactly. The ECZ 2013 syllabus
 * (`public/syllabi/curriculum-data-2013.json`) carries Grade 7 for all seven
 * subjects, but it has no term column — TOPIC, SUB-TOPIC, SPECIFIC OUTCOMES,
 * CONTENT, SKILLS, VALUES and nothing else. Allocating a syllabus across
 * three terms is the school's scheme of work, not the syllabus, so there was
 * nothing in the repo to read and inventing one would have put a fabricated
 * syllabus in front of a child.
 *
 * The allocation below is the owner's own, transcribed from the learner
 * prototype (`ENG_TERMS` and `SCI_TERMS` in prototype v16) — the two subjects
 * the prototype works end to end. It is not derived, inferred or generated:
 * each row is a topic the owner placed in a term, with the icon and strand
 * they gave it. It cross-checks against the 2013 syllabus ordering (Science
 * runs 7.1 Human Body → 7.6 Materials and Energy across the year, and every
 * planned title matches a real sub-topic in the catalogue).
 *
 * WHAT IS DELIBERATELY ABSENT. The other five Grade 7 subjects, and three
 * Science sub-topics the prototype's plan does not list (The Solar System,
 * Metals and Non-metals, Mining). They are not guessed into a term HERE:
 * this file is the owner's stated allocation, and anything added to it
 * inherits that authority. Sub-topics this plan leaves unplaced show on every
 * tab and the screen says how many there are. Subjects with no plan at all
 * fall through to `config/termDivision`, which divides the published
 * catalogue into three consecutive slices and is labelled on screen as a
 * SUGGESTED split — a weaker claim, made deliberately, because it is pacing
 * rather than the owner's word. Adding a subject here is a data edit, not a
 * code change, and it overrides the derived split for that subject.
 *
 * Pure data + pure lookups: no DOM, no React, no Firebase.
 */

/**
 * The curriculum strands a topic can belong to.
 *
 * English uses the 2013 syllabus's four language components; Integrated
 * Science uses its five Grade 7 topics, which are exactly the entries in
 * `TOPICS.science[7]` — so a Science row's strand IS its parent topic in the
 * catalogue, and the row itself is the sub-topic.
 */
export const STRAND_LABELS = Object.freeze({
  speaking: 'Speaking',
  reading: 'Reading',
  writing: 'Writing',
  structure: 'Structure',
  'human-body': 'Human Body',
  health: 'Health',
  environment: 'Environment',
  'plants-animals': 'Plants & Animals',
  'materials-energy': 'Materials & Energy',
})

const ENGLISH_7 = [
  // Term 1
  { term: 1, title: 'Conversation & Polite Requests', icon: '🗣️', strand: 'speaking' },
  { term: 1, title: 'Stories — Legends & Myths', icon: '🦁', strand: 'speaking' },
  { term: 1, title: 'Intensive Reading', icon: '🔍', strand: 'reading' },
  { term: 1, title: 'Nouns', icon: '🏷️', strand: 'structure' },
  { term: 1, title: 'Adjectives — Comparing Things', icon: '⚖️', strand: 'structure' },
  { term: 1, title: 'Punctuation', icon: '✏️', strand: 'structure' },
  { term: 1, title: 'Dictation & Spelling', icon: '🔤', strand: 'writing' },
  // Term 2
  { term: 2, title: 'Debate', icon: '🎤', strand: 'speaking' },
  { term: 2, title: 'Figures of Speech — Riddles, Proverbs & Idioms', icon: '🧩', strand: 'speaking' },
  { term: 2, title: 'Reading Aloud', icon: '📢', strand: 'reading' },
  { term: 2, title: 'Using References — Dictionary & Index', icon: '📚', strand: 'reading' },
  { term: 2, title: 'Formal Letters', icon: '✉️', strand: 'writing' },
  { term: 2, title: 'Adverbs', icon: '🏃', strand: 'structure' },
  { term: 2, title: 'Conjunctions — Joining Words', icon: '🔗', strand: 'structure' },
  // Term 3
  { term: 3, title: 'Drama & Messages', icon: '🎭', strand: 'speaking' },
  { term: 3, title: 'Extensive Reading', icon: '📚', strand: 'reading' },
  { term: 3, title: 'Interpreting Charts, Maps & Graphs', icon: '📊', strand: 'reading' },
  { term: 3, title: 'Guided Essays', icon: '📝', strand: 'writing' },
  { term: 3, title: 'Notices, Adverts & Summary', icon: '📋', strand: 'writing' },
  { term: 3, title: 'Active & Passive Voice', icon: '🔄', strand: 'structure' },
  { term: 3, title: 'Direct & Indirect Speech', icon: '💬', strand: 'structure' },
]

const SCIENCE_7 = [
  // Term 1 — syllabus 7.1 The human body, 7.2 Health
  { term: 1, title: 'The Digestive System', icon: '🍽️', strand: 'human-body' },
  { term: 1, title: 'Diseases — Viruses & Bacteria', icon: '🦠', strand: 'health' },
  { term: 1, title: 'Fruits & Seeds as Food', icon: '🍊', strand: 'health' },
  // Term 2
  { term: 2, title: 'Separating Substances', icon: '⚗️', strand: 'environment' },
  { term: 2, title: 'Water Supply System', icon: '💧', strand: 'environment' },
  { term: 2, title: 'The Flower', icon: '🌸', strand: 'plants-animals' },
  { term: 2, title: 'Pollination & Fertilisation', icon: '🐝', strand: 'plants-animals' },
  // Term 3
  { term: 3, title: 'Fruits & Seeds', icon: '🍎', strand: 'plants-animals' },
  { term: 3, title: 'Seed Dispersal', icon: '🌬️', strand: 'plants-animals' },
  { term: 3, title: 'Plant Propagation', icon: '🌱', strand: 'plants-animals' },
  { term: 3, title: 'Energy', icon: '⚡', strand: 'materials-energy' },
  { term: 3, title: 'Electric Circuits', icon: '🔌', strand: 'materials-energy' },
  { term: 3, title: 'Lightning', icon: '🌩️', strand: 'materials-energy' },
]

/**
 * grade → subjectId → the plan.
 *
 * Keyed by the SUBJECT ID, never the label: "Integrated Science"
 * lower-cased is not "science", and comparing a label to an id is the bug
 * that silently dropped every multi-word subject from the Notes hub.
 */
export const GRADE_TERM_PLAN = Object.freeze({
  7: Object.freeze({
    english: Object.freeze(ENGLISH_7),
    science: Object.freeze(SCIENCE_7),
  }),
})

/** The plan for this subject+grade, or null when none is published. */
export function getTermPlan(subjectId, grade) {
  const n = Number(grade)
  if (!Number.isInteger(n)) return null
  const plan = GRADE_TERM_PLAN[n]?.[subjectId]
  return Array.isArray(plan) && plan.length > 0 ? plan : null
}

/** Just this term's entries, in plan order. */
export function planTopicsForTerm(plan, term) {
  const t = Number(term)
  return (Array.isArray(plan) ? plan : []).filter((row) => row.term === t)
}

/**
 * The four tag colours, and which strand wears which.
 *
 * Four, not nine: the prototype gives English's four components a colour
 * each and then reuses those same four for Science's five topics, so the
 * palette is a fixed set of tone classes rather than one per strand.
 */
export const STRAND_TONES = Object.freeze({
  speaking: 'speak',
  reading: 'read',
  writing: 'write',
  structure: 'struct',
  'human-body': 'speak',
  health: 'read',
  environment: 'write',
  'plants-animals': 'read',
  'materials-energy': 'struct',
})

/** Human label for a strand tag; unknown strands render as themselves. */
export function strandLabel(strand) {
  return STRAND_LABELS[strand] || String(strand || '')
}

/** Tone class suffix for a strand tag. Unknown strands get the neutral one. */
export function strandTone(strand) {
  return STRAND_TONES[strand] || 'struct'
}

/**
 * Catalogue entries the plan does not place in any term.
 *
 * Returned rather than hidden: these are real syllabus content (three Grade 7
 * Science sub-topics today), and dropping them to make the tabs look tidy
 * would remove curriculum from a child's screen. The caller shows them on
 * every tab and says how many there are.
 *
 * Matching is loose on purpose — the plan's titles are the owner's wording
 * ("Electric Circuits") and the catalogue's are the syllabus's ("Electric
 * Current and Circuits"). An exact match would report almost everything as
 * unplaced and duplicate the whole list onto all three tabs.
 */
export function unplacedCatalogueTopics(plan, catalogueTopics) {
  const rows = Array.isArray(plan) ? plan : []
  if (rows.length === 0) return []
  const planned = rows.map((r) => tokens(r.title))
  return (Array.isArray(catalogueTopics) ? catalogueTopics : [])
    .filter((name) => !planned.some((p) => overlaps(p, tokens(name))))
}

const STOP = new Set(['the', 'a', 'an', 'and', 'of', 'in', 'to', 'as', 'for', 'or'])

function tokens(value) {
  return new Set(
    String(value || '')
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((w) => w && !STOP.has(w))
      // Singular/plural only. The owner writes "Water Supply System" and the
      // syllabus writes "Water Supply Systems"; without this the row reads as
      // unplaced and duplicates onto all three tabs. Deliberately not a real
      // stemmer — a 4-character floor keeps it off "as"/"is"/"gas".
      .map((w) => (w.length > 3 && w.endsWith('s') ? w.slice(0, -1) : w)),
  )
}

/** Two titles describe the same topic when either one's words cover the other. */
function overlaps(a, b) {
  if (a.size === 0 || b.size === 0) return false
  let shared = 0
  for (const w of b) if (a.has(w)) shared += 1
  return shared === Math.min(a.size, b.size)
}
