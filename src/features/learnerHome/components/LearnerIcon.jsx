/**
 * LearnerIcon — the central icon registry for the learner interface.
 *
 * Screens never choose icons themselves: they ask for a semantic name
 * (`<LearnerIcon name="papers" />`) and the registry resolves it. Each
 * name maps to a supplied SVG asset under /assets/learner/icons/ plus a
 * Lucide fallback used only if the asset fails to load (offline first
 * paint, missing file). Assets are single-colour stroke SVGs rendered
 * through a CSS mask so `currentColor` tinting works exactly like an
 * inline icon.
 *
 * Allowed sizes are the approved set only: 18, 20, 22, 24.
 */
import { useEffect, useState } from 'react'
import {
  Award,
  Bell,
  BookA,
  BookOpen,
  Bookmark,
  Calculator,
  CalendarDays,
  ChartNoAxesColumnIncreasing,
  ClipboardCheck,
  Clock3,
  Download,
  FileCheck2,
  FileClock,
  Files,
  Flame,
  Gamepad2,
  Globe2,
  House,
  Languages,
  Laptop,
  Microscope,
  NotebookPen,
  Paintbrush,
  Palette,
  Target,
  Trophy,
} from 'lucide-react'

const ICON_BASE = '/assets/learner/icons'

// name → { asset file stem, Lucide fallback } (approved mapping)
export const LEARNER_ICONS = {
  home: { file: 'home', Fallback: House },
  learn: { file: 'learn', Fallback: BookOpen },
  papers: { file: 'papers', Fallback: Files },
  practice: { file: 'practice', Fallback: Target },
  games: { file: 'games', Fallback: Gamepad2 },
  lessons: { file: 'lessons', Fallback: BookOpen },
  notes: { file: 'notes', Fallback: NotebookPen },
  quiz: { file: 'quiz', Fallback: ClipboardCheck },
  'daily-exam': { file: 'daily-exam', Fallback: FileClock },
  timetable: { file: 'timetable', Fallback: CalendarDays },
  countdown: { file: 'countdown', Fallback: Clock3 },
  bookmark: { file: 'bookmark', Fallback: Bookmark },
  notification: { file: 'notification', Fallback: Bell },
  progress: { file: 'progress', Fallback: ChartNoAxesColumnIncreasing },
  theme: { file: 'theme', Fallback: Paintbrush },
  trophy: { file: 'trophy', Fallback: Trophy },
  streak: { file: 'streak', Fallback: Flame },
  download: { file: 'download', Fallback: Download },
  'marking-scheme': { file: 'marking-scheme', Fallback: FileCheck2 },
  achievement: { file: 'trophy', Fallback: Award },
  // Subjects (curriculum subject id → learner icon name handled below)
  'integrated-science': { file: 'integrated-science', Fallback: Microscope },
  mathematics: { file: 'mathematics', Fallback: Calculator },
  english: { file: 'english', Fallback: BookA },
  'social-studies': { file: 'social-studies', Fallback: Globe2 },
  technology: { file: 'technology', Fallback: Laptop },
  'home-economics': { file: 'home-economics', Fallback: House },
  'expressive-arts': { file: 'expressive-arts', Fallback: Palette },
  'zambian-language': { file: 'zambian-language', Fallback: Languages },
}

// curriculum.js subject ids → learner icon names
const SUBJECT_ICON_BY_ID = {
  science: 'integrated-science',
  mathematics: 'mathematics',
  english: 'english',
  'social-studies': 'social-studies',
  technology: 'technology',
  'home-economics': 'home-economics',
  'expressive-arts': 'expressive-arts',
  cinyanja: 'zambian-language',
}

export function subjectIconName(subjectId) {
  return SUBJECT_ICON_BY_ID[subjectId] || 'learn'
}

// Session-level probe cache: each asset URL is checked once; until the
// probe settles we optimistically render the mask (the common case),
// and swap to the Lucide fallback only on a confirmed failure.
const assetStatus = new Map() // url → 'ok' | 'fail' | Promise
function probeAsset(url) {
  const cached = assetStatus.get(url)
  if (cached) return cached
  const p = new Promise((resolve) => {
    if (typeof Image === 'undefined') { resolve('ok'); return }
    const img = new Image()
    img.onload = () => { assetStatus.set(url, 'ok'); resolve('ok') }
    img.onerror = () => { assetStatus.set(url, 'fail'); resolve('fail') }
    img.src = url
  })
  assetStatus.set(url, p)
  return p
}

const SIZES = new Set([18, 20, 22, 24])

export default function LearnerIcon({ name, size = 22, label, className = '' }) {
  const entry = LEARNER_ICONS[name] || LEARNER_ICONS.learn
  const url = `${ICON_BASE}/${entry.file}.svg`
  const [failed, setFailed] = useState(assetStatus.get(url) === 'fail')

  useEffect(() => {
    let alive = true
    const status = assetStatus.get(url)
    if (status === 'fail') { setFailed(true); return undefined }
    if (status === 'ok') { setFailed(false); return undefined }
    Promise.resolve(probeAsset(url))
      .then((s) => { if (alive && s === 'fail') setFailed(true) })
      .catch(() => { /* probe never rejects */ })
    return () => { alive = false }
  }, [url])

  const px = SIZES.has(size) ? size : 22
  const a11y = label
    ? { role: 'img', 'aria-label': label }
    : { 'aria-hidden': true }

  if (failed) {
    const { Fallback } = entry
    return <Fallback size={px} strokeWidth={2} className={className} {...a11y} />
  }

  const mask = `url("${url}") center / contain no-repeat`
  return (
    <span
      {...a11y}
      className={className}
      style={{
        display: 'inline-block',
        width: px,
        height: px,
        backgroundColor: 'currentColor',
        WebkitMask: mask,
        mask,
        flexShrink: 0,
      }}
    />
  )
}
