// Subject → icon + tone, in one place.
//
// The papers list used to draw the same eagle avatar on every row, so the
// left-hand tile carried no information at all. This maps a paper's subject to
// a Lucide icon and a named TONE — never a literal colour: the tones resolve to
// `--zt-subj-*` custom properties declared once in assessmentLibrary.css, which
// carry a Night-mode override. A component that hard-codes a hex here would be
// invisible or glaring on one of the four themes.
//
// NOT src/components/ui/SubjectIcon.jsx: that one is keyed by canonical subject
// ID (which a paper does not store — it stores the NAME), falls back to an
// emoji, and paints from a fixed pastel palette that ignores the theme. All
// three are wrong for a teacher paper row. Keyed by name, Lucide only, tokens
// only.
//
// Matching is by slug with a keyword fallback, because the same subject is
// written several ways across the product: 'Expressive Art' / 'Expressive
// Arts', 'Integrated Science' / 'Science' (CBC drops the qualifier),
// 'Mathematics' / 'Mathematics and Science' / 'Numeracy'. An unmatched subject
// is NOT an error — it gets the neutral document tile, which is exactly what
// every row looked like before.

import {
  FlaskConical, Wrench, CookingPot, Calculator, BookOpen, Globe, Palette,
  FileText, Music, Dumbbell, Church, Laptop, Leaf,
} from 'lucide-react'

const NEUTRAL = { Icon: FileText, tone: 'neutral' }

// Exact slugs first — the names the syllabus and the canonical subject model
// actually use.
const BY_SLUG = {
  integratedscience: { Icon: FlaskConical, tone: 'green' },
  science: { Icon: FlaskConical, tone: 'green' },
  biology: { Icon: Leaf, tone: 'green' },
  chemistry: { Icon: FlaskConical, tone: 'green' },
  physics: { Icon: FlaskConical, tone: 'green' },
  technologystudies: { Icon: Wrench, tone: 'blue' },
  designandtechnology: { Icon: Wrench, tone: 'blue' },
  computerstudies: { Icon: Laptop, tone: 'blue' },
  ict: { Icon: Laptop, tone: 'blue' },
  homeeconomics: { Icon: CookingPot, tone: 'pink' },
  mathematics: { Icon: Calculator, tone: 'amber' },
  maths: { Icon: Calculator, tone: 'amber' },
  numeracy: { Icon: Calculator, tone: 'amber' },
  english: { Icon: BookOpen, tone: 'indigo' },
  englishlanguage: { Icon: BookOpen, tone: 'indigo' },
  literacy: { Icon: BookOpen, tone: 'indigo' },
  socialstudies: { Icon: Globe, tone: 'teal' },
  civiceducation: { Icon: Globe, tone: 'teal' },
  geography: { Icon: Globe, tone: 'teal' },
  history: { Icon: Globe, tone: 'teal' },
  expressivearts: { Icon: Palette, tone: 'plum' },
  expressiveart: { Icon: Palette, tone: 'plum' },
  art: { Icon: Palette, tone: 'plum' },
  music: { Icon: Music, tone: 'plum' },
  physicaleducation: { Icon: Dumbbell, tone: 'rose' },
  religiouseducation: { Icon: Church, tone: 'rose' },
}

// Keyword fallbacks, checked in order. Deliberately after the exact table so
// "Social Studies" is a globe rather than being caught by a stray 'stud' rule.
const BY_KEYWORD = [
  ['science', { Icon: FlaskConical, tone: 'green' }],
  ['math', { Icon: Calculator, tone: 'amber' }],
  ['numer', { Icon: Calculator, tone: 'amber' }],
  ['technolog', { Icon: Wrench, tone: 'blue' }],
  ['comput', { Icon: Laptop, tone: 'blue' }],
  ['economic', { Icon: CookingPot, tone: 'pink' }],
  ['english', { Icon: BookOpen, tone: 'indigo' }],
  ['literac', { Icon: BookOpen, tone: 'indigo' }],
  ['language', { Icon: BookOpen, tone: 'indigo' }],
  ['social', { Icon: Globe, tone: 'teal' }],
  ['geograph', { Icon: Globe, tone: 'teal' }],
  ['histor', { Icon: Globe, tone: 'teal' }],
  ['art', { Icon: Palette, tone: 'plum' }],
  ['music', { Icon: Music, tone: 'plum' }],
]

function slug(value) {
  return String(value ?? '').toLowerCase().replace(/[^a-z]/g, '')
}

/** `{ Icon, tone }` for a subject name. Never throws, never returns null. */
export function subjectVisual(subject) {
  const key = slug(subject)
  if (!key) return NEUTRAL
  if (BY_SLUG[key]) return BY_SLUG[key]
  for (const [needle, visual] of BY_KEYWORD) {
    if (key.includes(needle)) return visual
  }
  return NEUTRAL
}

/**
 * The rounded, colour-coded tile that opens a paper row.
 *
 * Decorative by default: the row's title already names the subject, so a
 * screen reader announcing it again is noise. Pass `label` where the tile is
 * the only thing carrying the subject.
 */
export function SubjectTile({ subject, size = 46, label = '', className = '' }) {
  const { Icon, tone } = subjectVisual(subject)
  const a11y = label ? { role: 'img', 'aria-label': label } : { 'aria-hidden': 'true' }
  return (
    <span
      className={`zt-subject-tile tone-${tone} ${className}`.trim()}
      style={{ width: size, height: size, borderRadius: Math.round(size * 0.28) }}
      {...a11y}
    >
      <Icon size={Math.round(size * 0.5)} strokeWidth={1.9} aria-hidden="true" />
    </span>
  )
}
