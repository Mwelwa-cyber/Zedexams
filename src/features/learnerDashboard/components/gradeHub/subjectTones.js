/**
 * The per-subject colour palette, and the label→subject resolver that has to
 * exist because results and the curriculum key subjects differently.
 *
 * Shared by GradeHub and by `SubjectCardRich`, which is why it is here rather
 * than inside either.
 */
import { SUBJECTS, normalizeSubject } from '../../../../config/curriculum'

// Subject palette tuned for the light surfaces shown in the product
// screenshot: subtle tinted backgrounds + bold subject-coloured text +
// matching practise CTA. Midnight pulls in a darker remap below via
// the body.theme-midnight selector.
export const SUBJECT_TONES = {
  mathematics: {
    text: 'text-blue-700',
    tile: 'bg-blue-50 text-blue-700 ring-1 ring-blue-100',
    action: 'bg-blue-50 text-blue-700 ring-1 ring-blue-100 hover:bg-blue-100',
  },
  english: {
    text: 'text-green-700',
    tile: 'bg-green-50 text-green-700 ring-1 ring-green-100',
    action: 'bg-green-50 text-green-700 ring-1 ring-green-100 hover:bg-green-100',
  },
  science: {
    text: 'text-purple-700',
    tile: 'bg-purple-50 text-purple-700 ring-1 ring-purple-100',
    action: 'bg-purple-50 text-purple-700 ring-1 ring-purple-100 hover:bg-purple-100',
  },
  'social-studies': {
    text: 'text-orange-700',
    tile: 'bg-orange-50 text-orange-700 ring-1 ring-orange-100',
    action: 'bg-orange-50 text-orange-700 ring-1 ring-orange-100 hover:bg-orange-100',
  },
  technology: {
    text: 'text-slate-700',
    tile: 'bg-slate-100 text-slate-700 ring-1 ring-slate-200',
    action: 'bg-slate-100 text-slate-700 ring-1 ring-slate-200 hover:bg-slate-200',
  },
  'expressive-arts': {
    text: 'text-amber-700',
    tile: 'bg-amber-50 text-amber-700 ring-1 ring-amber-100',
    action: 'bg-amber-50 text-amber-700 ring-1 ring-amber-100 hover:bg-amber-100',
  },
  cinyanja: {
    text: 'text-pink-700',
    tile: 'bg-pink-50 text-pink-700 ring-1 ring-pink-100',
    action: 'bg-pink-50 text-pink-700 ring-1 ring-pink-100 hover:bg-pink-100',
  },
  // legacy
  'home-economics': {
    text: 'text-pink-700',
    tile: 'bg-pink-50 text-pink-700 ring-1 ring-pink-100',
    action: 'bg-pink-50 text-pink-700 ring-1 ring-pink-100 hover:bg-pink-100',
  },
}

// Results, the weakness analysis, and userProfile.performance all key on the
// subject *label* a quiz was saved with (e.g. "Integrated Science", sometimes
// a legacy variant like "Science"). Routes (/practise/:grade/:subjectId) and
// the tone maps below are keyed on the curriculum *id* ("science"). This
// resolver bridges the two so per-subject progress %, chip colours, and
// drill-down links all line up regardless of which spelling was stored.
const SUBJECT_BY_LABEL = Object.fromEntries(SUBJECTS.map(s => [s.label, s]))

export function resolveSubject(value) {
  if (!value) return null
  return SUBJECT_BY_LABEL[normalizeSubject(value)] ?? null
}
