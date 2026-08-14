import {
  BanknotesIcon,
  CalculatorIcon,
  BookOpenIcon,
  InboxStackIcon,
  QueueListIcon,
  BeakerIcon,
  GlobeAltIcon,
  PuzzlePieceIcon,
  DocumentTextIcon,
  BoltIcon,
  Squares2X2Icon,
  CheckBadgeIcon,
  MapIcon,
  SparklesIcon,
  FireIcon,
  StarIcon,
  TrophyIcon,
  HomeIcon,
  ClipboardDocumentListIcon,
  BellIcon,
  UserCircleIcon,
  ClockIcon,
  PlayIcon,
  LockClosedIcon,
  SpeakerWaveIcon,
  SpeakerXMarkIcon,
  ArrowRightIcon,
  ChevronRightIcon,
  RocketLaunchIcon,
  AcademicCapIcon,
  ChartBarIcon,
  ShareIcon,
} from '@heroicons/react/24/solid'

/**
 * Shared design system for the /games surface.
 *
 * Single source of truth for:
 *   - subject visuals (icon + gradient + soft/ring/chip palettes)
 *   - game-type iconography (quiz / speed / builder / match / reading …)
 *   - stat-card iconography (level / streak / points / rank)
 *   - nav iconography (home / exams / lessons / games / leaderboard / bell / profile)
 *
 * Pure data + Heroicon imports — no side effects, no Firebase, no routing.
 */

/* ──────────── Subjects ──────────── */

const DEFAULT_SUBJECT = {
  key: 'default',
  label: 'Games',
  icon: PuzzlePieceIcon,
  gradient: 'from-slate-400 to-slate-500',
  soft: 'from-slate-50 to-slate-100',
  ring: 'border-slate-200',
  text: 'text-slate-700',
  chip: 'bg-slate-100 text-slate-700 border-slate-200',
  tile: 'bg-slate-100 text-slate-700',
  blob: 'bg-slate-300',
  bar:  'bg-slate-500',
}

export const SUBJECT_THEME = {
  mathematics: {
    key: 'mathematics',
    label: 'Mathematics',
    icon: CalculatorIcon,
    gradient: 'from-amber-400 via-orange-400 to-yellow-500',
    soft: 'from-amber-50 to-yellow-50',
    ring: 'border-amber-200',
    text: 'text-amber-700',
    chip: 'bg-amber-100 text-amber-800 border-amber-200',
    tile: 'bg-gradient-to-br from-amber-100 to-yellow-100 text-amber-700',
    blob: 'bg-amber-300',
    bar:  'bg-amber-500',
  },
  english: {
    key: 'english',
    label: 'English',
    icon: BookOpenIcon,
    gradient: 'from-sky-400 via-blue-400 to-indigo-500',
    soft: 'from-sky-50 to-blue-50',
    ring: 'border-sky-200',
    text: 'text-sky-700',
    chip: 'bg-sky-100 text-sky-800 border-sky-200',
    tile: 'bg-gradient-to-br from-sky-100 to-blue-100 text-sky-700',
    blob: 'bg-sky-300',
    bar:  'bg-sky-500',
  },
  science: {
    key: 'science',
    label: 'Science',
    icon: BeakerIcon,
    gradient: 'from-emerald-400 via-teal-400 to-green-500',
    soft: 'from-emerald-50 to-teal-50',
    ring: 'border-emerald-200',
    text: 'text-emerald-700',
    chip: 'bg-emerald-100 text-emerald-800 border-emerald-200',
    tile: 'bg-gradient-to-br from-emerald-100 to-teal-100 text-emerald-700',
    blob: 'bg-emerald-300',
    bar:  'bg-emerald-500',
  },
  social: {
    key: 'social',
    label: 'Social Studies',
    icon: GlobeAltIcon,
    gradient: 'from-yellow-500 via-amber-500 to-orange-500',
    soft: 'from-amber-50 to-orange-50',
    ring: 'border-amber-300',
    text: 'text-amber-800',
    chip: 'bg-amber-100 text-amber-900 border-amber-200',
    tile: 'bg-gradient-to-br from-amber-100 to-orange-100 text-orange-700',
    blob: 'bg-orange-300',
    bar:  'bg-orange-500',
  },
}

export function subjectTheme(slugOrColor) {
  if (!slugOrColor) return DEFAULT_SUBJECT
  const byKey = SUBJECT_THEME[slugOrColor]
  if (byKey) return byKey
  // Tolerate the legacy `color` field (rose/sky/emerald/amber) used in
  // gamesService's SUBJECTS list.
  const byColor = {
    rose: SUBJECT_THEME.mathematics,
    sky:  SUBJECT_THEME.english,
    emerald: SUBJECT_THEME.science,
    amber: SUBJECT_THEME.social,
  }[slugOrColor]
  return byColor || DEFAULT_SUBJECT
}

/* ──────────── Game types ──────────── */

const GAME_TYPE_META = {
  timed_quiz:   { icon: BoltIcon,         label: 'Speed' },
  memory_match: { icon: PuzzlePieceIcon,  label: 'Match' },
  word_builder: { icon: Squares2X2Icon,   label: 'Builder' },
  quiz:         { icon: DocumentTextIcon, label: 'Quiz' },
  reading:      { icon: BookOpenIcon,     label: 'Reading' },
  true_false:   { icon: CheckBadgeIcon,   label: 'True/False' },
  map:          { icon: MapIcon,          label: 'Map Explorer' },
  number_target: { icon: CalculatorIcon,  label: 'Number Target' },
  sorting_factory: { icon: InboxStackIcon, label: 'Sorting' },
  sentence_scramble: { icon: QueueListIcon, label: 'Scramble' },
  market_challenge: { icon: BanknotesIcon,  label: 'Market' },
}

export function gameTypeMeta(type) {
  return GAME_TYPE_META[type] || { icon: PuzzlePieceIcon, label: 'Game' }
}

/* ──────────── Stats ──────────── */

export const STAT_ICON = {
  level:  SparklesIcon,
  streak: FireIcon,
  points: StarIcon,
  rank:   TrophyIcon,
}

/* ──────────── Nav ──────────── */

export const NAV_ICON = {
  dashboard:     HomeIcon,
  exams:         ClipboardDocumentListIcon,
  lessons:       BookOpenIcon,
  games:         PuzzlePieceIcon,
  leaderboard:   TrophyIcon,
  notifications: BellIcon,
  profile:       UserCircleIcon,
}

/* ──────────── Re-export common icons (single import site) ──────────── */

export {
  CalculatorIcon,
  BookOpenIcon,
  BeakerIcon,
  GlobeAltIcon,
  PuzzlePieceIcon,
  DocumentTextIcon,
  BoltIcon,
  Squares2X2Icon,
  CheckBadgeIcon,
  MapIcon,
  SparklesIcon,
  FireIcon,
  StarIcon,
  TrophyIcon,
  HomeIcon,
  ClipboardDocumentListIcon,
  BellIcon,
  UserCircleIcon,
  ClockIcon,
  PlayIcon,
  LockClosedIcon,
  SpeakerWaveIcon,
  SpeakerXMarkIcon,
  ArrowRightIcon,
  ChevronRightIcon,
  RocketLaunchIcon,
  AcademicCapIcon,
  ChartBarIcon,
  ShareIcon,
}
