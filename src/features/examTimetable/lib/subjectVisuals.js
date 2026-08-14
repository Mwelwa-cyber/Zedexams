/**
 * subjectVisuals — one coherent icon set for the exam-timetable subject tiles.
 *
 * Every session/paper resolves to a Heroicon component (via components/ui/icons)
 * plus a soft tint {bg, fg}, so the timeline uses a single, consistent
 * illustration language instead of mixed emoji. Colours are fixed accent hues
 * that read on any theme (the tiles sit on the card surface, not the page bg).
 *
 * Resolution order for a session:
 *   briefing            → clipboard / guidelines
 *   many papers + lang  → language bubble ("Choose your Zambian Language")
 *   many papers         → checklist ("Choose your paper")
 *   single paper        → the paper's subject (curriculum subjectId, then the
 *                         past-paper subject id for special papers)
 */

import {
  BookOpen,
  BeakerIcon,
  Calculator,
  Globe,
  Palette,
  ComputerDesktop,
  Home,
  Language,
  FileText,
  ListChecks,
} from '../../../shared/components/icons'

const TINT = {
  blue: { bg: '#e3edfb', fg: '#1d4ed8' },
  green: { bg: '#dcf5e6', fg: '#15803d' },
  orange: { bg: '#fdebd8', fg: '#ea6a17' },
  yellow: { bg: '#fef3c7', fg: '#a16207' },
  rose: { bg: '#fce4ec', fg: '#be185d' },
  cyan: { bg: '#d7f1f4', fg: '#0e7490' },
  amber: { bg: '#fbebd2', fg: '#b45309' },
  pink: { bg: '#fce7f0', fg: '#be185d' },
  purple: { bg: '#ede6fb', fg: '#6d28d9' },
  slate: { bg: '#eef1f5', fg: '#475569' },
}

// Curriculum subjectId → icon + tint.
const BY_SUBJECT = {
  english: { Icon: BookOpen, tint: TINT.blue },
  science: { Icon: BeakerIcon, tint: TINT.green },
  mathematics: { Icon: Calculator, tint: TINT.orange },
  'social-studies': { Icon: Globe, tint: TINT.yellow },
  'expressive-arts': { Icon: Palette, tint: TINT.rose },
  technology: { Icon: ComputerDesktop, tint: TINT.cyan },
  'home-economics': { Icon: Home, tint: TINT.amber },
  cinyanja: { Icon: Language, tint: TINT.pink },
}

const SPECIAL = { Icon: FileText, tint: TINT.purple }
const LANGUAGE = { Icon: Language, tint: TINT.pink }
const CHOICE = { Icon: ListChecks, tint: TINT.purple }
const BRIEFING = { Icon: FileText, tint: TINT.slate }
const FALLBACK = { Icon: FileText, tint: TINT.slate }

// Icon + tint for one paper (used by the alternative-paper rows too).
export function paperVisual(paper) {
  if (!paper) return FALLBACK
  if (paper.subjectId && BY_SUBJECT[paper.subjectId]) return BY_SUBJECT[paper.subjectId]
  // Special papers carry no curriculum subjectId but do map to a past-paper id.
  if (paper.paperSubjectId && String(paper.paperSubjectId).startsWith('special')) return SPECIAL
  return FALLBACK
}

// Icon + tint for a whole session (the leading tile on a subject card).
export function sessionVisual(session) {
  if (!session) return FALLBACK
  if (session.briefing) return BRIEFING
  const papers = session.papers || []
  if (papers.length > 1) {
    const isLanguage = (session.sessionNote || '').toLowerCase().includes('language')
    return isLanguage ? LANGUAGE : CHOICE
  }
  return paperVisual(papers[0])
}
