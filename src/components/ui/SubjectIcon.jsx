import Icon from './Icon'
import {
  BookOpen,
  BeakerIcon,
  Calculator,
  Globe,
  PaintBrushIcon,
  ComputerDesktop,
  Language,
  Home,
} from './icons'
import { SUBJECT_MAP } from '../../config/curriculum'

const ICONS = {
  BookOpen,
  Beaker: BeakerIcon,
  Calculator,
  Globe,
  PaintBrush: PaintBrushIcon,
  ComputerDesktop,
  Language,
  Home,
}

const SIZE = { sm: 36, md: 44, lg: 56, xl: 72 }
const ICON_SIZE = { sm: 'sm', md: 'md', lg: 'lg', xl: 'xl' }

/**
 * Light, friendly subject icon — heroicon outline rendered inside a soft
 * pastel rounded square. Matches the illustrated reference palette used
 * across the dashboard, library and class cards.
 */
export default function SubjectIcon({
  subjectId,
  subject: subjectArg,
  size = 'md',
  className = '',
  fallbackEmoji = '📚',
}) {
  const subject = subjectArg || (subjectId ? SUBJECT_MAP[subjectId] : null)
  const px = SIZE[size] ?? SIZE.md
  const bg = subject?.pastel || '#e3dcc8'
  const IconComp = subject?.iconKey ? ICONS[subject.iconKey] : null

  return (
    <span
      className={`inline-grid place-items-center rounded-2xl ${className}`}
      style={{ width: px, height: px, background: bg, color: '#0e2a32' }}
      aria-hidden="true"
    >
      {IconComp
        ? <Icon as={IconComp} size={ICON_SIZE[size] ?? 'md'} strokeWidth={1.8} />
        : <span style={{ fontSize: px * 0.5 }}>{subject?.icon || fallbackEmoji}</span>}
    </span>
  )
}
