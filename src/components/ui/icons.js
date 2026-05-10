import { createElement, forwardRef } from 'react'
import {
  AcademicCapIcon,
  ArrowDownTrayIcon,
  ArrowLeftIcon,
  ArrowPathIcon,
  ArrowRightStartOnRectangleIcon,
  ArrowRightIcon,
  ArrowTrendingUpIcon,
  ArrowsPointingOutIcon,
  ArrowUpTrayIcon,
  ArrowUturnLeftIcon,
  ArrowUturnRightIcon,
  Bars3BottomLeftIcon,
  Bars3BottomRightIcon,
  Bars3CenterLeftIcon,
  Bars3Icon,
  Battery100Icon,
  BeakerIcon,
  BellAlertIcon,
  BellIcon,
  BoldIcon,
  BoltIcon,
  BookOpenIcon,
  BookmarkSquareIcon,
  CalendarDaysIcon,
  ChartBarIcon,
  CheckBadgeIcon,
  CheckCircleIcon,
  CheckIcon,
  ChevronDownIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  ChevronUpIcon,
  CircleStackIcon,
  ClockIcon,
  ClipboardDocumentCheckIcon,
  ClipboardDocumentIcon,
  ClipboardDocumentListIcon,
  Cog6ToothIcon,
  CreditCardIcon,
  CursorArrowRaysIcon,
  DocumentDuplicateIcon,
  DocumentTextIcon,
  EnvelopeIcon,
  EyeDropperIcon,
  ExclamationCircleIcon,
  ExclamationTriangleIcon,
  EyeIcon,
  EyeSlashIcon,
  FireIcon,
  FolderOpenIcon,
  H1Icon,
  H2Icon,
  HomeIcon,
  ItalicIcon,
  LightBulbIcon,
  ListBulletIcon,
  LockClosedIcon,
  MagnifyingGlassIcon,
  MicrophoneIcon,
  NoSymbolIcon,
  NumberedListIcon,
  PaintBrushIcon,
  PaperAirplaneIcon,
  PencilSquareIcon,
  PlayIcon,
  PlusIcon,
  PresentationChartBarIcon,
  PrinterIcon,
  PuzzlePieceIcon,
  QueueListIcon,
  RectangleStackIcon,
  GlobeAltIcon,
  ComputerDesktopIcon,
  CalculatorIcon,
  LanguageIcon,
  MusicalNoteIcon,
  ShieldCheckIcon,
  SignalIcon,
  SparklesIcon,
  SpeakerWaveIcon,
  SpeakerXMarkIcon,
  StarIcon,
  Squares2X2Icon,
  StopIcon,
  StrikethroughIcon,
  SwatchIcon,
  TableCellsIcon,
  TrophyIcon,
  UnderlineIcon,
  UserIcon,
  UserGroupIcon,
  VariableIcon,
  XMarkIcon,
  TrashIcon,
  ViewColumnsIcon,
  DocumentIcon,
  PhotoIcon,
} from '@heroicons/react/24/outline'

// Size-token map matches components/ui/Icon.jsx so tokens (xs/sm/md/lg/xl)
// and raw numbers both work, matching the lucide-react API.
const SIZE_PX = { xs: 12, sm: 16, md: 20, lg: 24, xl: 32 }

/**
 * Heroicons spread unknown props onto their <svg> root. A raw `size={16}` prop
 * therefore ends up as `size="16"` on the SVG — which is NOT a real SVG
 * attribute, so browsers ignore it and the icon renders at its intrinsic
 * 24×24 viewBox size.
 *
 * Callers in this repo (Zed, quiz list, dashboard, etc.) originally used
 * lucide-react, where `size={N}` sets both width and height. Wrapping each
 * export with `withSize` restores that API so `<Mic size={14} />` actually
 * renders at 14×14.
 */
function withSize(Inner) {
  return forwardRef(function SizedIcon({ size, width, height, ...rest }, ref) {
    const px = typeof size === 'number' ? size : (size && SIZE_PX[size]) || undefined
    return createElement(Inner, {
      ref,
      ...(px !== undefined ? { width: px, height: px } : {}),
      ...(width !== undefined && px === undefined ? { width } : {}),
      ...(height !== undefined && px === undefined ? { height } : {}),
      ...rest,
    })
  })
}

// A hand-rolled robot/bot SVG (Heroicons has no equivalent). Same
// size-prop semantics as the wrapped heroicons above.
function RobotIconRaw({ size, width, height, ...props }, ref) {
  const px = typeof size === 'number' ? size : (size && SIZE_PX[size]) || undefined
  return createElement(
    'svg',
    {
      ref,
      viewBox: '0 0 24 24',
      fill: 'none',
      stroke: 'currentColor',
      strokeLinecap: 'round',
      strokeLinejoin: 'round',
      ...(px !== undefined ? { width: px, height: px } : {}),
      ...(width !== undefined && px === undefined ? { width } : {}),
      ...(height !== undefined && px === undefined ? { height } : {}),
      ...props,
    },
    createElement('path', { key: 'p1', d: 'M12 4v2' }),
    createElement('path', { key: 'p2', d: 'M8.5 4h7' }),
    createElement('path', { key: 'p3', d: 'M7 8h10a3 3 0 0 1 3 3v5a4 4 0 0 1-4 4H8a4 4 0 0 1-4-4v-5a3 3 0 0 1 3-3Z' }),
    createElement('path', { key: 'p4', d: 'M8.5 13h.01' }),
    createElement('path', { key: 'p5', d: 'M15.5 13h.01' }),
    createElement('path', { key: 'p6', d: 'M9.5 16.5c1.4.9 3.6.9 5 0' }),
    createElement('path', { key: 'p7', d: 'M4 13H2.75' }),
    createElement('path', { key: 'p8', d: 'M21.25 13H20' }),
  )
}
export const RobotIcon = forwardRef(RobotIconRaw)

// Wrap each heroicon once; re-export under the original name AND any
// lucide-style aliases the callers expect.
const GraduationCap = withSize(AcademicCapIcon)
const AcademicCap = withSize(AcademicCapIcon)
const School = withSize(AcademicCapIcon)
const Download = withSize(ArrowDownTrayIcon)
const ArrowDownTray = withSize(ArrowDownTrayIcon)
const ArrowLeft = withSize(ArrowLeftIcon)
const ArrowLeftWrap = withSize(ArrowLeftIcon)
const RefreshCw = withSize(ArrowPathIcon)
const RotateCcw = withSize(ArrowPathIcon)
const LogOut = withSize(ArrowRightStartOnRectangleIcon)
const TrendingUp = withSize(ArrowTrendingUpIcon)
const Maximize2 = withSize(ArrowsPointingOutIcon)
const Upload = withSize(ArrowUpTrayIcon)
const Undo2 = withSize(ArrowUturnLeftIcon)
const Redo2 = withSize(ArrowUturnRightIcon)
const AlignLeft = withSize(Bars3BottomLeftIcon)
const AlignRight = withSize(Bars3BottomRightIcon)
const AlignCenter = withSize(Bars3CenterLeftIcon)
const Menu = withSize(Bars3Icon)
const Battery = withSize(Battery100Icon)
const Beaker = withSize(BeakerIcon)
const BellRing = withSize(BellAlertIcon)
const Bell = withSize(BellIcon)
const Bold = withSize(BoldIcon)
const Zap = withSize(BoltIcon)
const BookMarked = withSize(BookOpenIcon)
const BookOpen = withSize(BookOpenIcon)
const BookmarkSquare = withSize(BookmarkSquareIcon)
const Calendar = withSize(CalendarDaysIcon)
const CalendarDays = withSize(CalendarDaysIcon)
const ChartBar = withSize(ChartBarIcon)
const BarChart3 = withSize(ChartBarIcon)
const Award = withSize(CheckBadgeIcon)
const CheckSquare = withSize(CheckBadgeIcon)
const CheckCircle = withSize(CheckCircleIcon)
const Check = withSize(CheckIcon)
const ChevronDown = withSize(ChevronDownIcon)
const ChevronLeft = withSize(ChevronLeftIcon)
const ChevronRight = withSize(ChevronRightIcon)
const ChevronUp = withSize(ChevronUpIcon)
const Sprout = withSize(CircleStackIcon)
const Clock = withSize(ClockIcon)
const ListChecks = withSize(ClipboardDocumentCheckIcon)
const Copy = withSize(ClipboardDocumentIcon)
const ClipboardList = withSize(ClipboardDocumentListIcon)
const Settings = withSize(Cog6ToothIcon)
const CreditCard = withSize(CreditCardIcon)
const Target = withSize(CursorArrowRaysIcon)
const Files = withSize(DocumentDuplicateIcon)
const DocumentText = withSize(DocumentTextIcon)
const FileText = withSize(DocumentTextIcon)
const Envelope = withSize(EnvelopeIcon)
const Mail = withSize(EnvelopeIcon)
const Highlighter = withSize(EyeDropperIcon)
const AlertCircle = withSize(ExclamationCircleIcon)
const AlertTriangle = withSize(ExclamationTriangleIcon)
const Eye = withSize(EyeIcon)
const EyeOff = withSize(EyeSlashIcon)
const Fire = withSize(FireIcon)
const FolderOpen = withSize(FolderOpenIcon)
const Superscript = withSize(H1Icon)
const Subscript = withSize(H2Icon)
const Home = withSize(HomeIcon)
const Italic = withSize(ItalicIcon)
const Lightbulb = withSize(LightBulbIcon)
const List = withSize(ListBulletIcon)
const Lock = withSize(LockClosedIcon)
const LockClosed = withSize(LockClosedIcon)
const Search = withSize(MagnifyingGlassIcon)
const Mic = withSize(MicrophoneIcon)
const MicOff = withSize(NoSymbolIcon)
const ListOrdered = withSize(NumberedListIcon)
const PaintBrush = withSize(PaintBrushIcon)
const Palette = withSize(PaintBrushIcon)
const Send = withSize(PaperAirplaneIcon)
const PencilLine = withSize(PencilSquareIcon)
const PenLine = withSize(PencilSquareIcon)
const PencilSquare = withSize(PencilSquareIcon)
const Play = withSize(PlayIcon)
const Plus = withSize(PlusIcon)
const Presentation = withSize(PresentationChartBarIcon)
const Printer = withSize(PrinterIcon)
const PuzzlePiece = withSize(PuzzlePieceIcon)
const Gamepad2 = withSize(PuzzlePieceIcon)
const ClipboardCheckList = withSize(QueueListIcon)
const Layers = withSize(RectangleStackIcon)
const ShieldCheck = withSize(ShieldCheckIcon)
const Signal = withSize(SignalIcon)
const Sparkles = withSize(SparklesIcon)
const Volume2 = withSize(SpeakerWaveIcon)
const VolumeX = withSize(SpeakerXMarkIcon)
const LayoutDashboard = withSize(Squares2X2Icon)
const LayoutGrid = withSize(Squares2X2Icon)
const Star = withSize(StarIcon)
const Square = withSize(StopIcon)
const Strikethrough = withSize(StrikethroughIcon)
const Swatch = withSize(SwatchIcon)
const Table = withSize(TableCellsIcon)
const TableIcon = withSize(TableCellsIcon)
const Trophy = withSize(TrophyIcon)
const Underline = withSize(UnderlineIcon)
const User = withSize(UserIcon)
const Users = withSize(UserGroupIcon)
const Sigma = withSize(VariableIcon)
const Bot = RobotIcon
const X = withSize(XMarkIcon)
const XMark = withSize(XMarkIcon)
const Trash2 = withSize(TrashIcon)
const Layout = withSize(ViewColumnsIcon)
const FileType = withSize(DocumentIcon)
const Save = withSize(BookmarkSquareIcon)
const Loader2 = withSize(ArrowPathIcon)
const ArrowRight = withSize(ArrowRightIcon)
const ImageIcon = withSize(PhotoIcon)
const Globe = withSize(GlobeAltIcon)
const ComputerDesktop = withSize(ComputerDesktopIcon)
const Calculator = withSize(CalculatorIcon)
const Language = withSize(LanguageIcon)
const MusicalNote = withSize(MusicalNoteIcon)

export {
  GraduationCap,
  AcademicCap as AcademicCapIcon,
  School,
  Download,
  ArrowDownTray as ArrowDownTrayIcon,
  ArrowLeft as ArrowLeftIcon,
  ArrowLeft,
  RefreshCw,
  RotateCcw,
  LogOut,
  TrendingUp,
  Maximize2,
  Upload,
  Undo2,
  Redo2,
  AlignLeft,
  AlignRight,
  AlignCenter,
  Menu,
  Battery,
  Beaker as BeakerIcon,
  BellRing,
  Bell,
  Bold,
  Zap,
  BookMarked,
  BookOpen as BookOpenIcon,
  BookOpen,
  BookmarkSquare as BookmarkSquareIcon,
  Calendar,
  CalendarDays,
  ChartBar as ChartBarIcon,
  BarChart3,
  Award,
  CheckSquare,
  CheckCircle as CheckCircleIcon,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Sprout,
  Clock,
  ListChecks,
  Copy,
  ClipboardList,
  Settings,
  CreditCard,
  Target,
  Files,
  DocumentText as DocumentTextIcon,
  FileText,
  Envelope as EnvelopeIcon,
  Mail,
  Highlighter,
  AlertCircle,
  AlertTriangle,
  Eye,
  EyeOff,
  Fire as FireIcon,
  FolderOpen as FolderOpenIcon,
  FolderOpen,
  Superscript,
  Subscript,
  Home,
  Italic,
  Lightbulb,
  List,
  Lock,
  LockClosed as LockClosedIcon,
  Search,
  Mic,
  MicOff,
  ListOrdered,
  PaintBrush as PaintBrushIcon,
  Palette,
  Send,
  PencilLine,
  PenLine,
  PencilSquare as PencilSquareIcon,
  Play,
  Plus,
  Presentation,
  Printer,
  PuzzlePiece as PuzzlePieceIcon,
  Gamepad2,
  ClipboardCheckList,
  Layers,
  ShieldCheck,
  Signal,
  Sparkles,
  Volume2,
  VolumeX,
  LayoutDashboard,
  LayoutGrid,
  Star as StarIcon,
  Square,
  Strikethrough,
  Swatch as SwatchIcon,
  Table,
  TableIcon,
  Trophy as TrophyIcon,
  Underline,
  User,
  Users,
  Sigma,
  Bot,
  X,
  XMark as XMarkIcon,
  Trash2,
  Layout,
  FileType,
  Save,
  Loader2,
  ArrowRight,
  ImageIcon,
  Globe,
  ComputerDesktop,
  Calculator,
  Language,
  MusicalNote,
}
