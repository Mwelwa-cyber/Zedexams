/**
 * studioIcons — one consistent icon vocabulary for the Assessment Studio.
 *
 * The studio used to mix emoji (📄 👁 🗝 ✨ 🗑 …) into buttons, chips and cards,
 * which clashed with its premium-paper aesthetic. This maps a small set of
 * semantic names onto the shared Heroicon set in src/components/ui/icons.js so
 * every control draws from the same line-icon family. Use:
 *
 *   <Icon name="save" />                 — 16px, currentColor, decorative
 *   <Icon name="delete" size={14} />     — sized
 *   <Icon name="home" title="Home" />    — labelled for screen readers
 *
 * Add a name here rather than importing a heroicon directly in the studio, so
 * the vocabulary stays centralised and swappable.
 */

import {
  Home, FileText, Eye, Key, Sparkles, ArrowLeft, Undo2, Redo2, Save, Loader2,
  Upload, Search, ImageIcon, Zap, AlertTriangle, PencilSquareIcon, PencilLine,
  ChartBarIcon, Layers, Clock, ChevronUp, ChevronDown, Trash2, Copy, StarIcon,
  RefreshCw, X, Plus, Check, CheckCircleIcon, ClipboardList, Menu, Scissors,
  BookOpen, BeakerIcon, Globe, DocumentTextIcon, ListChecks, ListOrdered, Table,
  Calculator, ArrowLeftRight, Maximize2, Minimize2, PaintBrushIcon, Target, Lightbulb,
  Camera, Scale, Files, AlignLeft, Download, Printer, User, Users, Calendar,
  Info, Layout, Lock,
} from '../../../shared/components/icons'

// Semantic name → icon component. Names describe ROLE, not glyph, so the
// underlying icon can change without touching call sites.
const ICONS = {
  // ── App chrome / navigation ──────────────────────────────────────────
  home: Home,
  builder: FileText,
  preview: Eye,
  key: Key,
  ai: Sparkles,
  back: ArrowLeft,
  undo: Undo2,
  redo: Redo2,
  pages: FileText,

  // ── Primary actions ──────────────────────────────────────────────────
  save: Save,
  spinner: Loader2,
  import: Upload,
  download: Download,
  print: Printer,
  answerSheet: Table,
  verify: Search,
  diagrams: ImageIcon,
  more: Zap,
  warn: AlertTriangle,
  info: Info,
  generate: Sparkles,
  scratch: PencilLine,
  layoutRows: Menu,
  layoutColumns: Layout,

  // ── Live paper stats ─────────────────────────────────────────────────
  questions: FileText,
  marks: ChartBarIcon,
  sections: Layers,
  time: Clock,

  // ── Header field toggles ─────────────────────────────────────────────
  name: User,
  date: Calendar,
  classField: Users,

  // ── Per-block tools ──────────────────────────────────────────────────
  moveUp: ChevronUp,
  moveDown: ChevronDown,
  delete: Trash2,
  duplicate: Copy,
  edit: PencilSquareIcon,
  bank: StarIcon,
  paste: ClipboardList,
  reset: RefreshCw,
  remove: X,
  add: Plus,
  check: Check,
  checkCircle: CheckCircleIcon,

  // ── Structural blocks ────────────────────────────────────────────────
  section: Layers,
  header: FileText,
  instructions: ClipboardList,
  footer: Menu,
  pagebreak: Scissors,

  // ── Question types ───────────────────────────────────────────────────
  comprehension: BookOpen,
  passage: BookOpen,
  map: Globe,
  science: BeakerIcon,
  source: DocumentTextIcon,
  mcq: ListChecks,
  shortAnswer: PencilSquareIcon,
  structured: ClipboardList,
  essay: FileText,
  trueFalse: CheckCircleIcon,
  fillBlanks: AlignLeft,
  matching: ArrowLeftRight,
  numeric: Calculator,
  sequence: ListOrdered,
  table: Table,
  labelledDiagram: Target,
  drawLabel: PaintBrushIcon,
  imageIdentify: Eye,

  // ── Media / AI tools ─────────────────────────────────────────────────
  camera: Camera,
  pictureBank: Files,
  shape: ImageIcon,
  crop: Maximize2,
  fullscreen: Maximize2,
  exitFullscreen: Minimize2,
  replace: RefreshCw,
  enhance: Sparkles,
  bloom: Lightbulb,
  difficulty: Scale,
  target: Target,
  ruler: AlignLeft,
  // A question the teacher has finished with. No regeneration, validation pass
  // or migration may rewrite it — see src/utils/questionRegeneration.js.
  lock: Lock,
  rewrite: RefreshCw,
}

export function hasIcon(name) {
  return Object.prototype.hasOwnProperty.call(ICONS, name)
}

/**
 * Render a studio icon by semantic name.
 * @param {string} name   one of the keys above
 * @param {number} size   px (default 16)
 * @param {string} title  when set, the icon is exposed to screen readers with
 *                        this label; otherwise it is aria-hidden (decorative)
 */
export default function Icon({ name, size = 16, className = '', title, spin = false, ...rest }) {
  const Cmp = ICONS[name]
  if (!Cmp) return null
  const cls = ['sv-icon', spin ? 'sv-icon-spin' : '', className].filter(Boolean).join(' ')
  const a11y = title ? { role: 'img', 'aria-label': title } : { 'aria-hidden': 'true' }
  return <Cmp size={size} className={cls} {...a11y} {...rest} />
}
