/**
 * paperVisuals — subject presentation shared across the past-paper
 * surfaces (hub year/subject cards + the viewer breadcrumb/panels).
 *
 * A lucide-named icon + a soft tint per subject so cards scan fast and
 * feel warm without shouting. Falls back to a neutral document tile for
 * any subject not explicitly styled here.
 */

import {
  BookOpen,
  Calculator,
  Globe,
  ComputerDesktop,
  Sparkles,
  FileText,
  PuzzlePieceIcon,
} from '../../../shared/components/icons'
import { PAPER_SUBJECTS } from '../../../config/curriculum'

export const SUBJECT_VISUALS = {
  english:                       { Icon: BookOpen,        tile: 'bg-amber-100 text-amber-700' },
  mathematics:                   { Icon: Calculator,      tile: 'bg-blue-100 text-blue-700' },
  'social-studies':              { Icon: Globe,           tile: 'bg-emerald-100 text-emerald-700' },
  'creative-technology-studies': { Icon: ComputerDesktop, tile: 'bg-violet-100 text-violet-700' },
  'home-economics':              { Icon: Sparkles,        tile: 'bg-rose-100 text-rose-700' },
  'special-paper-1':             { Icon: FileText,        tile: 'bg-indigo-100 text-indigo-700' },
  'special-paper-2':             { Icon: PuzzlePieceIcon, tile: 'bg-purple-100 text-purple-700' },
}

// Short, learner-friendly labels for the filter chips. Real papers
// prefer the curriculum label.
export const SUBJECT_FILTERS = [
  { id: 'english',                     label: 'English' },
  { id: 'mathematics',                 label: 'Maths' },
  { id: 'social-studies',              label: 'Social Studies' },
  { id: 'creative-technology-studies', label: 'Technology' },
  { id: 'home-economics',              label: 'Home Ec.' },
  { id: 'special-paper-1',             label: 'Special Paper 1' },
  { id: 'special-paper-2',             label: 'Special Paper 2' },
]

const SUBJECT_LABEL = Object.fromEntries(SUBJECT_FILTERS.map((s) => [s.id, s.label]))

/** Resolve a subject id to its display label + icon + tint classes. */
export function subjectMeta(id) {
  const curriculum = PAPER_SUBJECTS.find((s) => s.id === id)
  return {
    label: SUBJECT_LABEL[id] || curriculum?.shortLabel || curriculum?.label || 'Paper',
    fullLabel: curriculum?.label || SUBJECT_LABEL[id] || 'Paper',
    Icon: SUBJECT_VISUALS[id]?.Icon || FileText,
    tile: SUBJECT_VISUALS[id]?.tile || 'bg-orange-100 text-orange-700',
  }
}
