import { Link } from 'react-router-dom'
import {
  BellIcon,
  BeakerIcon,
  BookOpenIcon,
  BoltIcon,
  CalculatorIcon,
  CheckBadgeIcon,
  ChevronRightIcon,
  ClipboardDocumentListIcon,
  ClockIcon,
  FireIcon,
  GlobeAltIcon,
  HomeIcon,
  LockClosedIcon,
  MapIcon,
  PlayIcon,
  PuzzlePieceIcon,
  SparklesIcon,
  Squares2X2Icon,
  StarIcon,
  TrophyIcon,
  UserCircleIcon,
} from '@heroicons/react/24/solid'
import { gradeByValue } from '../../utils/gamesService'

export const NAV_ICON_MAP = {
  dashboard: HomeIcon,
  exams: ClipboardDocumentListIcon,
  lessons: BookOpenIcon,
  games: PuzzlePieceIcon,
  leaderboard: TrophyIcon,
  notifications: BellIcon,
  profile: UserCircleIcon,
}

export const SUBJECT_THEMES = {
  mathematics: {
    label: 'Mathematics',
    icon: CalculatorIcon,
    gradient: 'from-amber-200 via-orange-100 to-rose-100',
    strongGradient: 'from-amber-500 via-orange-500 to-rose-500',
    border: 'border-amber-200/80',
    accentText: 'text-amber-800',
    mutedText: 'text-amber-700',
    iconWrap: 'bg-white/85 text-amber-600',
    progress: 'from-amber-500 to-orange-500',
    glow: 'shadow-[0_28px_70px_-38px_rgba(245,158,11,0.52)]',
    ring: 'ring-amber-200/70',
    surface: 'bg-amber-50/80',
  },
  english: {
    label: 'English',
    icon: BookOpenIcon,
    gradient: 'from-sky-200 via-blue-100 to-cyan-100',
    strongGradient: 'from-sky-500 via-blue-500 to-cyan-500',
    border: 'border-sky-200/80',
    accentText: 'text-sky-800',
    mutedText: 'text-sky-700',
    iconWrap: 'bg-white/85 text-sky-600',
    progress: 'from-sky-500 to-cyan-500',
    glow: 'shadow-[0_28px_70px_-38px_rgba(14,165,233,0.52)]',
    ring: 'ring-sky-200/70',
    surface: 'bg-sky-50/80',
  },
  science: {
    label: 'Science',
    icon: BeakerIcon,
    gradient: 'from-emerald-200 via-lime-100 to-teal-100',
    strongGradient: 'from-emerald-500 via-green-500 to-teal-500',
    border: 'border-emerald-200/80',
    accentText: 'text-emerald-800',
    mutedText: 'text-emerald-700',
    iconWrap: 'bg-white/85 text-emerald-600',
    progress: 'from-emerald-500 to-teal-500',
    glow: 'shadow-[0_28px_70px_-38px_rgba(16,185,129,0.52)]',
    ring: 'ring-emerald-200/70',
    surface: 'bg-emerald-50/80',
  },
  social: {
    label: 'Social Studies',
    icon: GlobeAltIcon,
    gradient: 'from-yellow-200 via-amber-100 to-orange-100',
    strongGradient: 'from-yellow-500 via-amber-500 to-orange-500',
    border: 'border-yellow-200/80',
    accentText: 'text-yellow-800',
    mutedText: 'text-amber-700',
    iconWrap: 'bg-white/85 text-amber-600',
    progress: 'from-yellow-500 to-orange-500',
    glow: 'shadow-[0_28px_70px_-38px_rgba(234,179,8,0.52)]',
    ring: 'ring-yellow-200/70',
    surface: 'bg-yellow-50/80',
  },
}

const DEFAULT_SUBJECT_THEME = {
  label: 'Games',
  icon: PuzzlePieceIcon,
  gradient: 'from-slate-200 via-slate-100 to-white',
  strongGradient: 'from-slate-500 to-slate-700',
  border: 'border-slate-200/80',
  accentText: 'text-slate-800',
  mutedText: 'text-slate-600',
  iconWrap: 'bg-white/85 text-slate-600',
  progress: 'from-slate-500 to-slate-700',
  glow: 'shadow-[0_28px_70px_-38px_rgba(15,23,42,0.28)]',
  ring: 'ring-slate-200/70',
  surface: 'bg-slate-50/80',
}

export const GAME_TYPE_THEMES = {
  timed_quiz: { label: 'Quiz', icon: DocumentTypeIcon() },
  quiz: { label: 'Quiz', icon: DocumentTypeIcon() },
  speed: { label: 'Speed', icon: BoltIcon },
  memory_match: { label: 'Match', icon: PuzzlePieceIcon },
  word_builder: { label: 'Builder', icon: Squares2X2Icon },
  reading: { label: 'Reading', icon: BookOpenIcon },
  true_false: { label: 'True / False', icon: CheckBadgeIcon },
  map_explorer: { label: 'Map Explorer', icon: MapIcon },
}

const DEFAULT_TYPE_THEME = { label: 'Game', icon: PuzzlePieceIcon }

const BADGE_ICON_MAP = {
  'first-game': SparklesIcon,
  'on-fire': FireIcon,
  centurion: StarIcon,
  'sharp-shooter': CheckBadgeIcon,
  'maths-racer': CalculatorIcon,
  'word-wizard': BookOpenIcon,
  'science-scout': BeakerIcon,
  'all-rounder': SparklesIcon,
  'dedicated-player': Squares2X2Icon,
  champion: TrophyIcon,
}

const BADGE_TIER_STYLE = {
  bronze: {
    shell: 'border-amber-200/90 bg-amber-50/80',
    icon: 'bg-white/85 text-amber-600',
    badge: 'bg-amber-500/90 text-white',
    glow: 'shadow-[0_24px_50px_-32px_rgba(245,158,11,0.55)]',
  },
  silver: {
    shell: 'border-slate-200/90 bg-slate-50/90',
    icon: 'bg-white/85 text-slate-600',
    badge: 'bg-slate-800 text-white',
    glow: 'shadow-[0_24px_50px_-32px_rgba(100,116,139,0.45)]',
  },
  gold: {
    shell: 'border-yellow-200/90 bg-yellow-50/85',
    icon: 'bg-white/85 text-yellow-600',
    badge: 'bg-yellow-500/90 text-white',
    glow: 'shadow-[0_24px_50px_-30px_rgba(234,179,8,0.58)]',
  },
}

export function getSubjectTheme(subject) {
  return SUBJECT_THEMES[String(subject || '').toLowerCase()] || DEFAULT_SUBJECT_THEME
}

export function getGameTypeTheme(type) {
  return GAME_TYPE_THEMES[String(type || '').toLowerCase()] || DEFAULT_TYPE_THEME
}

export function getGameBadgeMeta(badge) {
  const Icon = BADGE_ICON_MAP[badge?.id] || BADGE_TIER_ICON[badge?.tier] || SparklesIcon
  return {
    Icon,
    tierStyle: BADGE_TIER_STYLE[badge?.tier] || BADGE_TIER_STYLE.bronze,
  }
}

export function getGameStatusBadge(game, index = 0, featuredId = null) {
  if (game?.id && featuredId && game.id === featuredId) {
    return { label: 'Recommended', className: 'bg-white/85 text-slate-900 border border-white/80' }
  }
  if ((game?.difficulty || '').toLowerCase() === 'hard' || index % 3 === 1) {
    return { label: 'Popular', className: 'bg-amber-500/90 text-white' }
  }
  return { label: 'New', className: 'bg-sky-500/90 text-white' }
}

export function getGameStars(game) {
  let filled = 4
  if ((game?.difficulty || '').toLowerCase() === 'easy') filled = 5
  if ((game?.type || '').toLowerCase() === 'memory_match') filled = 5
  if ((game?.type || '').toLowerCase() === 'word_builder') filled = Math.max(filled, 4)
  return Math.min(5, Math.max(3, filled))
}

export function getDurationLabel(game) {
  const timer = Number(game?.timer)
  return timer > 0 ? `${timer}s` : 'Quick play'
}

export function buildSubjectProgress(subjectSlug, games, history) {
  const totalGames = games.filter((game) => String(game.subject || '').toLowerCase() === subjectSlug).length
  const plays = history.filter((entry) => String(entry.subject || '').toLowerCase() === subjectSlug).length
  const progress = totalGames ? Math.min(100, Math.round((plays / totalGames) * 100)) : 0
  return { totalGames, plays, progress }
}

export function GamesSectionHeading({ eyebrow, title, description, action = null }) {
  return (
    <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div className="max-w-2xl">
        {eyebrow && (
          <p className="mb-2 text-[11px] font-black uppercase tracking-[0.24em] text-slate-500">
            {eyebrow}
          </p>
        )}
        <h2 className="text-2xl font-black tracking-tight text-slate-900 sm:text-3xl">
          {title}
        </h2>
        {description && (
          <p className="mt-2 text-sm leading-6 text-slate-600 sm:text-base">
            {description}
          </p>
        )}
      </div>
      {action}
    </div>
  )
}

export function IconBubble({ icon: Icon, theme, size = 'h-12 w-12', className = '', iconClassName = 'h-6 w-6' }) {
  return (
    <span className={`inline-flex ${size} items-center justify-center rounded-full ${theme.iconWrap} ring-1 ${theme.ring} ${className}`}>
      <Icon className={iconClassName} />
    </span>
  )
}

export function MetaPill({ icon: Icon, label, className = '' }) {
  return (
    <span className={`inline-flex items-center gap-2 rounded-full bg-white/72 px-3 py-1.5 text-xs font-bold text-slate-700 ${className}`}>
      <Icon className="h-4 w-4 shrink-0 text-slate-500" />
      <span>{label}</span>
    </span>
  )
}

export function RatingStars({ filled, className = '' }) {
  return (
    <div className={`inline-flex items-center gap-1 ${className}`}>
      {Array.from({ length: 5 }).map((_, index) => (
        <StarIcon
          key={index}
          className={`h-4 w-4 ${index < filled ? 'text-amber-400' : 'text-slate-300'}`}
        />
      ))}
    </div>
  )
}

export function ProgressBar({ value, gradient, className = '' }) {
  return (
    <div className={`h-2.5 rounded-full bg-white/75 ${className}`}>
      <div
        className={`h-full rounded-full bg-gradient-to-r ${gradient} transition-[width] duration-300`}
        style={{ width: `${Math.max(0, Math.min(100, value))}%` }}
      />
    </div>
  )
}

export function GameDiscoveryCard({
  game,
  badge,
  variant = 'standard',
  href = null,
  cta = 'Play now',
  showRating = false,
  hideGrade = false,
}) {
  const subjectTheme = getSubjectTheme(game.subject)
  const typeTheme = getGameTypeTheme(game.type)
  const grade = hideGrade ? null : gradeByValue(game.grade)
  const filledStars = getGameStars(game)
  const Icon = typeTheme.icon
  const target = href || `/games/play/${game.id}`
  const featured = variant === 'featured'

  return (
    <Link
      to={target}
      className={`group relative flex h-full flex-col overflow-hidden rounded-[20px] border border-white/80 bg-gradient-to-br ${subjectTheme.gradient} p-5 text-left transition duration-200 ease-out hover:-translate-y-1 hover:shadow-[0_24px_70px_-34px_rgba(15,23,42,0.28)] active:scale-[0.985] ${subjectTheme.glow} ${featured ? 'sm:p-7' : ''}`}
    >
      <div className="absolute inset-y-0 right-0 w-36 bg-[radial-gradient(circle_at_top,_rgba(255,255,255,0.72),_transparent_68%)]" />
      <div className="absolute -right-6 top-10 h-24 w-24 rounded-full bg-white/35 blur-2xl" />
      <div className="absolute bottom-0 left-0 h-20 w-20 rounded-full bg-white/25 blur-2xl" />

      <div className="relative flex h-full flex-col">
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-3">
            <IconBubble icon={Icon} theme={subjectTheme} size={featured ? 'h-14 w-14' : 'h-12 w-12'} iconClassName={featured ? 'h-7 w-7' : 'h-6 w-6'} />
            <div className="flex flex-wrap gap-2">
              {grade && <MetaPill icon={SparklesIcon} label={grade.label} />}
              <MetaPill icon={getSubjectTheme(game.subject).icon} label={subjectTheme.label} />
            </div>
          </div>
          {badge && (
            <span className={`inline-flex items-center rounded-full px-3 py-1 text-[11px] font-black uppercase tracking-wide shadow-sm ${badge.className}`}>
              {badge.label}
            </span>
          )}
        </div>

        <div className={`relative mt-5 ${featured ? 'max-w-lg' : ''}`}>
          <h3 className={`font-black tracking-tight text-slate-900 ${featured ? 'text-2xl sm:text-3xl' : 'text-xl'}`}>
            {game.title}
          </h3>
          <p className={`mt-2 text-sm leading-6 text-slate-700 ${featured ? 'sm:text-base' : ''}`}>
            {game.description}
          </p>
        </div>

        <div className="relative mt-5 flex flex-wrap gap-2">
          <MetaPill icon={ClockIcon} label={getDurationLabel(game)} />
          <MetaPill icon={StarIcon} label={`${Number(game.points) || 0} pts`} />
          <MetaPill icon={Icon} label={typeTheme.label} />
        </div>

        <div className="relative mt-auto flex items-center justify-between gap-3 pt-6">
          <div className="min-h-[20px]">
            {showRating && <RatingStars filled={filledStars} />}
          </div>
          <span className="inline-flex items-center gap-2 text-sm font-black text-slate-900">
            {cta}
            <PlayIcon className="h-4 w-4 transition duration-200 group-hover:translate-x-0.5" />
          </span>
        </div>
      </div>
    </Link>
  )
}

export function SubjectProgressCard({
  subject,
  gamesCount,
  progress,
  href,
  showComingSoon = false,
  helperText,
}) {
  const theme = getSubjectTheme(subject.slug)
  const Icon = theme.icon

  return (
    <Link
      to={href}
      className={`group relative overflow-hidden rounded-[20px] border ${theme.border} bg-gradient-to-br ${theme.gradient} p-5 transition duration-200 ease-out hover:-translate-y-1 hover:shadow-[0_24px_70px_-34px_rgba(15,23,42,0.25)] active:scale-[0.985] ${theme.glow}`}
    >
      <div className="absolute inset-y-0 right-0 w-28 bg-[radial-gradient(circle_at_center,_rgba(255,255,255,0.7),_transparent_70%)]" />
      <div className="relative space-y-4">
        <div className="flex items-start justify-between gap-3">
          <IconBubble icon={Icon} theme={theme} />
          {showComingSoon ? (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-white/85 px-3 py-1 text-[11px] font-black uppercase tracking-wide text-slate-700">
              <LockClosedIcon className="h-3.5 w-3.5" />
              Coming soon
            </span>
          ) : (
            <span className={`rounded-full bg-white/85 px-3 py-1 text-[11px] font-black uppercase tracking-wide ${theme.accentText}`}>
              {gamesCount} {gamesCount === 1 ? 'game' : 'games'}
            </span>
          )}
        </div>

        <div>
          <h3 className="text-xl font-black text-slate-900">{subject.label}</h3>
          <p className="mt-1 text-sm text-slate-700">
            {helperText}
          </p>
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between text-xs font-bold text-slate-600">
            <span>Progress</span>
            <span>{progress}%</span>
          </div>
          <ProgressBar value={progress} gradient={theme.progress} />
        </div>

        <div className="inline-flex items-center gap-2 text-sm font-black text-slate-900">
          Explore subject
          <ChevronRightIcon className="h-4 w-4 transition duration-200 group-hover:translate-x-0.5" />
        </div>
      </div>
    </Link>
  )
}

export function GameBadgeCard({
  badge,
  earned,
  subtitle,
  compact = false,
}) {
  const { Icon, tierStyle } = getGameBadgeMeta(badge)

  return (
    <div
      title={!earned ? badge.hint : undefined}
      className={`relative overflow-hidden rounded-[20px] border p-4 ${tierStyle.shell} ${earned ? tierStyle.glow : 'opacity-85'} ${compact ? '' : 'sm:p-5'}`}
    >
      <div className="absolute inset-y-0 right-0 w-20 bg-[radial-gradient(circle_at_center,_rgba(255,255,255,0.65),_transparent_72%)]" />
      <div className="relative flex items-start gap-4">
        <span className={`inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-full ${earned ? tierStyle.icon : 'bg-white/70 text-slate-400'}`}>
          {earned ? <Icon className="h-6 w-6" /> : <LockClosedIcon className="h-6 w-6" />}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="truncate text-base font-black text-slate-900">{badge.name}</h3>
            <span className={`rounded-full px-2 py-0.5 text-[10px] font-black uppercase tracking-wide ${earned ? tierStyle.badge : 'bg-slate-200 text-slate-600'}`}>
              {earned ? badge.tier : 'Locked'}
            </span>
          </div>
          <p className="mt-1 text-sm leading-6 text-slate-600">
            {subtitle || (earned ? badge.description : badge.hint)}
          </p>
        </div>
      </div>
    </div>
  )
}

function DocumentTypeIcon() {
  return ClipboardDocumentListIcon
}

const BADGE_TIER_ICON = {
  bronze: StarIcon,
  silver: SparklesIcon,
  gold: TrophyIcon,
}
