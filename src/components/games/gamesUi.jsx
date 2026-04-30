import { Link } from 'react-router-dom'
import {
  BellIcon,
  BeakerIcon,
  BookOpenIcon,
  BoltIcon,
  CalculatorIcon,
  CheckBadgeIcon,
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
import { isDemoGame } from '../../data/gamesSeed'
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
  province_shapes: { label: 'Map Quiz', icon: MapIcon },
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

/**
 * Friendly subject mascots that appear on the discovery cards. Each mascot
 * has a personality and a short tagline so the experience feels like a
 * cast of guides rather than a list of links.
 */
export const SUBJECT_MASCOTS = {
  mathematics: { emoji: '🦊', name: 'Maths Fox',     tagline: 'Numbers are my game!' },
  english:     { emoji: '🦉', name: 'Story Owl',     tagline: 'Word adventures await.' },
  science:     { emoji: '🐢', name: 'Science Turtle', tagline: 'Let’s explore the world.' },
  social:      { emoji: '🦁', name: 'Adventure Lion', tagline: 'Every place has a story.' },
}

const DEFAULT_MASCOT = { emoji: '🎮', name: 'Game Pal', tagline: 'Pick a game and play!' }

export function getSubjectMascot(slug) {
  return SUBJECT_MASCOTS[String(slug || '').toLowerCase()] || DEFAULT_MASCOT
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

export function getGameAccessMeta(game, { compact = false } = {}) {
  const demo = isDemoGame(game)
  return demo
    ? {
        label: compact ? 'Free' : 'Free demo',
        icon: SparklesIcon,
        className: 'bg-emerald-100 text-emerald-800',
        iconClassName: 'text-emerald-700',
      }
    : {
        label: 'Premium',
        icon: LockClosedIcon,
        className: 'bg-slate-900 text-white border-slate-900',
        iconClassName: 'text-white',
      }
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
        {eyebrow && <span className="zx-eyebrow mb-2">{eyebrow}</span>}
        <h2 className="font-display mt-1 text-[26px] font-bold tracking-tight text-slate-900 sm:text-3xl lg:text-4xl">
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

const SUBJECT_TILE_BG = {
  mathematics: 'bg-orange-100',
  english:     'bg-blue-100',
  science:     'bg-green-100',
  social:      'bg-yellow-100',
}

function tileBgForSubject(subject) {
  return SUBJECT_TILE_BG[String(subject || '').toLowerCase()] || 'bg-amber-100'
}

export function IconBubble({ icon: Icon, theme, size = 'h-12 w-12', className = '', iconClassName = 'h-6 w-6', subjectSlug }) {
  // Square pastel tile with hard navy border, matching the hub's subject tiles.
  // `theme` is kept in the API so existing call sites still work; we derive
  // the background from the subject slug when available.
  const bg = subjectSlug ? tileBgForSubject(subjectSlug) : tileBgForSubject(theme?.label?.toLowerCase())
  return (
    <span className={`grid ${size} place-items-center rounded-[14px] border-2 border-slate-900 text-slate-900 ${bg} ${className}`}>
      <Icon className={iconClassName} />
    </span>
  )
}

export function MetaPill({ icon: Icon, label, className = '' }) {
  return (
    <span className={`zx-chip ${className}`}>
      {Icon && <Icon className="h-3.5 w-3.5" />}
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

const HOT_BADGE_SKIN = {
  Popular:     'bg-[#FF7A1A] text-white',
  New:         'bg-blue-600 text-white',
  Recommended: 'bg-emerald-500 text-white',
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
  const tileBg = tileBgForSubject(game.subject)
  const badgeSkin = badge?.label
    ? HOT_BADGE_SKIN[badge.label] || HOT_BADGE_SKIN.Popular
    : null
  const accessMeta = getGameAccessMeta(game)
  const AccessIcon = accessMeta.icon

  return (
    <Link
      to={target}
      className={`zx-card group relative flex h-full flex-col rounded-[22px] bg-white p-5 text-left transition active:translate-y-[2px] active:shadow-none ${featured ? 'sm:p-7' : ''}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className={`grid ${featured ? 'h-14 w-14' : 'h-12 w-12'} place-items-center rounded-[14px] border-2 border-slate-900 text-slate-900 ${tileBg}`}>
          <Icon className={featured ? 'h-7 w-7' : 'h-6 w-6'} />
        </div>
        {badge && (
          <span className={`rounded-full border-[1.5px] border-slate-900 px-2 py-1 text-[9.5px] font-extrabold uppercase tracking-[0.08em] ${badgeSkin}`}>
            {badge.label}
          </span>
        )}
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        {grade && <MetaPill icon={SparklesIcon} label={grade.label} />}
        <MetaPill icon={subjectTheme.icon} label={subjectTheme.label} />
        <MetaPill icon={AccessIcon} label={accessMeta.label} className={accessMeta.className} />
      </div>

      <div className={`mt-4 ${featured ? 'max-w-lg' : ''}`}>
        <h3 className={`font-display font-bold tracking-tight text-slate-900 ${featured ? 'text-2xl sm:text-3xl' : 'text-xl'}`}>
          {game.title}
        </h3>
        <p className={`mt-2 text-sm leading-6 text-slate-600 ${featured ? 'sm:text-base' : ''}`}>
          {game.description}
        </p>
      </div>

      <div className="mt-auto flex items-center justify-between gap-3 border-t border-dashed border-[#D8D0BC] pt-4 text-[11px] text-slate-500">
        <div className="flex flex-wrap gap-3">
          <span className="inline-flex items-center gap-1"><ClockIcon className="h-3.5 w-3.5" /> {getDurationLabel(game)}</span>
          <span className="inline-flex items-center gap-1"><StarIcon className="h-3.5 w-3.5 text-amber-500" /> {Number(game.points) || 0} pts</span>
          <span className="inline-flex items-center gap-1"><Icon className="h-3.5 w-3.5" /> {typeTheme.label}</span>
        </div>
        <span className="inline-flex items-center gap-1 text-sm font-black text-slate-900">
          {cta}
          <PlayIcon className="h-4 w-4 transition duration-200 group-hover:translate-x-0.5" />
        </span>
      </div>
      {showRating && (
        <div className="mt-3"><RatingStars filled={filledStars} /></div>
      )}
    </Link>
  )
}

const SUBJECT_BAR_BG = {
  mathematics: 'bg-orange-500',
  english:     'bg-blue-600',
  science:     'bg-green-600',
  social:      'bg-yellow-500',
}

export function SubjectProgressCard({
  subject,
  gamesCount,
  progress,
  href,
  showComingSoon = false,
  helperText,
}) {
  const mascot = getSubjectMascot(subject.slug)
  const tileBg = tileBgForSubject(subject.slug)
  const barBg = SUBJECT_BAR_BG[subject.slug] || 'bg-orange-500'

  return (
    <Link
      to={href}
      aria-label={`${subject.label} games — meet ${mascot.name}`}
      className="zx-card group relative flex flex-col rounded-[22px] bg-white p-5 transition active:translate-y-[2px] active:shadow-none"
    >
      <span className="absolute right-3 top-3 inline-flex items-center gap-1 rounded-full bg-slate-900 px-2 py-1 text-[9.5px] font-extrabold uppercase tracking-[0.08em] text-white">
        {showComingSoon ? (
          <>
            <LockClosedIcon className="h-3 w-3" />
            Coming soon
          </>
        ) : (
          <>{gamesCount} {gamesCount === 1 ? 'game' : 'games'}</>
        )}
      </span>

      <div className={`zx-mascot-tile mb-3 grid h-16 w-16 place-items-center rounded-[18px] border-2 border-slate-900 text-[36px] leading-none sm:h-20 sm:w-20 sm:text-[44px] ${tileBg}`}>
        <span aria-hidden="true">{mascot.emoji}</span>
      </div>

      <h3 className="font-display text-[19px] font-bold leading-none text-slate-900 sm:text-xl lg:text-[22px]">{subject.label}</h3>
      <p className="mt-1 text-[11.5px] font-semibold text-slate-500 sm:text-xs">{mascot.name}</p>

      <div className="mt-3 h-2 overflow-hidden rounded-full border-[1.5px] border-slate-900 bg-[#EFE9DB] sm:h-2.5">
        <div className={`h-full rounded-full ${barBg}`} style={{ width: `${showComingSoon ? 0 : progress}%` }} />
      </div>
      <div className="mt-1.5 flex items-center justify-between gap-2">
        <span className="text-[11px] font-extrabold text-slate-900 sm:text-xs">
          {showComingSoon ? 'Soon' : progress === 100 ? '100% ✓' : `${progress}%`}
        </span>
        <span className="truncate text-right text-[10.5px] uppercase tracking-[0.06em] text-slate-500 sm:text-[11px]">
          {helperText || (showComingSoon ? 'Coming soon' : `${gamesCount} games ready`)}
        </span>
      </div>
    </Link>
  )
}

const BADGE_TIER_BG = {
  bronze: 'bg-amber-100',
  silver: 'bg-slate-100',
  gold:   'bg-yellow-100',
}

const BADGE_TIER_TILE = {
  bronze: 'bg-amber-300',
  silver: 'bg-slate-200',
  gold:   'bg-yellow-300',
}

export function GameBadgeCard({
  badge,
  earned,
  subtitle,
  compact = false,
}) {
  const { Icon } = getGameBadgeMeta(badge)
  const wrapBg = earned ? (BADGE_TIER_BG[badge?.tier] || BADGE_TIER_BG.bronze) : 'bg-white'
  const tileBg = earned ? (BADGE_TIER_TILE[badge?.tier] || BADGE_TIER_TILE.bronze) : 'bg-slate-100'

  return (
    <div
      title={!earned ? badge.hint : undefined}
      className={`zx-card rounded-[18px] p-4 ${wrapBg} ${earned ? '' : 'opacity-70'} ${compact ? '' : 'sm:p-5'}`}
    >
      <div className="flex items-start gap-4">
        <span className={`grid h-12 w-12 shrink-0 place-items-center rounded-[12px] border-2 border-slate-900 text-slate-900 ${tileBg}`}>
          {earned ? <Icon className="h-6 w-6" /> : <LockClosedIcon className="h-6 w-6" />}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="font-display truncate text-base font-bold text-slate-900">{badge.name}</h3>
            <span className="zx-chip">
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
