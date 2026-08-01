import { createElement, forwardRef } from 'react'
import {
  AcademicCapIcon,
  AdjustmentsHorizontalIcon,
  ArrowDownTrayIcon,
  ArrowLeftIcon,
  ArrowPathIcon,
  ArrowRightStartOnRectangleIcon,
  ArrowRightIcon,
  ArrowTrendingUpIcon,
  ArrowsPointingInIcon,
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
  ChevronDoubleLeftIcon,
  ChevronDoubleRightIcon,
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
  KeyIcon,
  CameraIcon,
  ScissorsIcon,
  ScaleIcon,
  ArrowsRightLeftIcon,
  InformationCircleIcon,
  MagnifyingGlassPlusIcon,
  MagnifyingGlassMinusIcon,
  EllipsisHorizontalIcon,
  EllipsisVerticalIcon,
  DevicePhoneMobileIcon,
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

// Hand-rolled fingerprint (Heroicons has no equivalent; used by the passkey
// sign-in + management surfaces). Same size-prop semantics as above.
function FingerprintIconRaw({ size, width, height, ...props }, ref) {
  const px = typeof size === 'number' ? size : (size && SIZE_PX[size]) || undefined
  return createElement(
    'svg',
    {
      ref,
      viewBox: '0 0 24 24',
      fill: 'none',
      stroke: 'currentColor',
      strokeWidth: 1.5,
      strokeLinecap: 'round',
      strokeLinejoin: 'round',
      ...(px !== undefined ? { width: px, height: px } : {}),
      ...(width !== undefined && px === undefined ? { width } : {}),
      ...(height !== undefined && px === undefined ? { height } : {}),
      ...props,
    },
    createElement('path', { key: 'p1', d: 'M12 10a2 2 0 0 0-2 2c0 1.02-.1 2.51-.26 4' }),
    createElement('path', { key: 'p2', d: 'M14 13.12c0 2.38 0 6.38-1 8.88' }),
    createElement('path', { key: 'p3', d: 'M17.29 21.02c.12-.6.43-2.3.5-3.02' }),
    createElement('path', { key: 'p4', d: 'M2 12a10 10 0 0 1 18-6' }),
    createElement('path', { key: 'p5', d: 'M2 16h.01' }),
    createElement('path', { key: 'p6', d: 'M21.8 16c.2-2 .131-5.354 0-6' }),
    createElement('path', { key: 'p7', d: 'M5 19.5C5.5 18 6 15 6 12a6 6 0 0 1 .34-2' }),
    createElement('path', { key: 'p8', d: 'M8.65 22c.21-.66.45-1.32.57-2' }),
    createElement('path', { key: 'p9', d: 'M9 6.8a6 6 0 0 1 9 5.2v2' }),
  )
}
export const Fingerprint = forwardRef(FingerprintIconRaw)

// Wrap each heroicon once; re-export under the original name AND any
// lucide-style aliases the callers expect.
const GraduationCap = /*#__PURE__*/ withSize(AcademicCapIcon)
const AcademicCap = /*#__PURE__*/ withSize(AcademicCapIcon)
const School = /*#__PURE__*/ withSize(AcademicCapIcon)
const Download = /*#__PURE__*/ withSize(ArrowDownTrayIcon)
const ArrowDownTray = /*#__PURE__*/ withSize(ArrowDownTrayIcon)
const ArrowLeft = /*#__PURE__*/ withSize(ArrowLeftIcon)
const RefreshCw = /*#__PURE__*/ withSize(ArrowPathIcon)
const RotateCcw = /*#__PURE__*/ withSize(ArrowPathIcon)
const LogOut = /*#__PURE__*/ withSize(ArrowRightStartOnRectangleIcon)
const TrendingUp = /*#__PURE__*/ withSize(ArrowTrendingUpIcon)
const Maximize2 = /*#__PURE__*/ withSize(ArrowsPointingOutIcon)
const Minimize2 = /*#__PURE__*/ withSize(ArrowsPointingInIcon)
const Upload = /*#__PURE__*/ withSize(ArrowUpTrayIcon)
const Undo2 = /*#__PURE__*/ withSize(ArrowUturnLeftIcon)
const Redo2 = /*#__PURE__*/ withSize(ArrowUturnRightIcon)
const AlignLeft = /*#__PURE__*/ withSize(Bars3BottomLeftIcon)
const AlignRight = /*#__PURE__*/ withSize(Bars3BottomRightIcon)
const AlignCenter = /*#__PURE__*/ withSize(Bars3CenterLeftIcon)
const Menu = /*#__PURE__*/ withSize(Bars3Icon)
const Battery = /*#__PURE__*/ withSize(Battery100Icon)
const Beaker = /*#__PURE__*/ withSize(BeakerIcon)
const BellRing = /*#__PURE__*/ withSize(BellAlertIcon)
const Bell = /*#__PURE__*/ withSize(BellIcon)
const Bold = /*#__PURE__*/ withSize(BoldIcon)
const Zap = /*#__PURE__*/ withSize(BoltIcon)
const BookMarked = /*#__PURE__*/ withSize(BookOpenIcon)
const BookOpen = /*#__PURE__*/ withSize(BookOpenIcon)
const BookmarkSquare = /*#__PURE__*/ withSize(BookmarkSquareIcon)
const Calendar = /*#__PURE__*/ withSize(CalendarDaysIcon)
const CalendarDays = /*#__PURE__*/ withSize(CalendarDaysIcon)
const ChartBar = /*#__PURE__*/ withSize(ChartBarIcon)
const BarChart3 = /*#__PURE__*/ withSize(ChartBarIcon)
const Award = /*#__PURE__*/ withSize(CheckBadgeIcon)
const CheckSquare = /*#__PURE__*/ withSize(CheckBadgeIcon)
const CheckCircle = /*#__PURE__*/ withSize(CheckCircleIcon)
const Check = /*#__PURE__*/ withSize(CheckIcon)
const ChevronDown = /*#__PURE__*/ withSize(ChevronDownIcon)
const ChevronLeft = /*#__PURE__*/ withSize(ChevronLeftIcon)
const ChevronRight = /*#__PURE__*/ withSize(ChevronRightIcon)
const ChevronUp = /*#__PURE__*/ withSize(ChevronUpIcon)
const ChevronsLeft = /*#__PURE__*/ withSize(ChevronDoubleLeftIcon)
const ChevronsRight = /*#__PURE__*/ withSize(ChevronDoubleRightIcon)
const Sprout = /*#__PURE__*/ withSize(CircleStackIcon)
const Clock = /*#__PURE__*/ withSize(ClockIcon)
const ListChecks = /*#__PURE__*/ withSize(ClipboardDocumentCheckIcon)
const Copy = /*#__PURE__*/ withSize(ClipboardDocumentIcon)
const ClipboardList = /*#__PURE__*/ withSize(ClipboardDocumentListIcon)
const Settings = /*#__PURE__*/ withSize(Cog6ToothIcon)
const CreditCard = /*#__PURE__*/ withSize(CreditCardIcon)
const Target = /*#__PURE__*/ withSize(CursorArrowRaysIcon)
const Files = /*#__PURE__*/ withSize(DocumentDuplicateIcon)
const DocumentText = /*#__PURE__*/ withSize(DocumentTextIcon)
const FileText = /*#__PURE__*/ withSize(DocumentTextIcon)
const Envelope = /*#__PURE__*/ withSize(EnvelopeIcon)
const Mail = /*#__PURE__*/ withSize(EnvelopeIcon)
const Highlighter = /*#__PURE__*/ withSize(EyeDropperIcon)
const AlertCircle = /*#__PURE__*/ withSize(ExclamationCircleIcon)
const AlertTriangle = /*#__PURE__*/ withSize(ExclamationTriangleIcon)
const Eye = /*#__PURE__*/ withSize(EyeIcon)
const EyeOff = /*#__PURE__*/ withSize(EyeSlashIcon)
const Fire = /*#__PURE__*/ withSize(FireIcon)
const FolderOpen = /*#__PURE__*/ withSize(FolderOpenIcon)
const Superscript = /*#__PURE__*/ withSize(H1Icon)
const Subscript = /*#__PURE__*/ withSize(H2Icon)
const Home = /*#__PURE__*/ withSize(HomeIcon)
const Italic = /*#__PURE__*/ withSize(ItalicIcon)
const Lightbulb = /*#__PURE__*/ withSize(LightBulbIcon)
const List = /*#__PURE__*/ withSize(ListBulletIcon)
const Lock = /*#__PURE__*/ withSize(LockClosedIcon)
const LockClosed = /*#__PURE__*/ withSize(LockClosedIcon)
const Search = /*#__PURE__*/ withSize(MagnifyingGlassIcon)
const SlidersHorizontal = /*#__PURE__*/ withSize(AdjustmentsHorizontalIcon)
const Mic = /*#__PURE__*/ withSize(MicrophoneIcon)
const MicOff = /*#__PURE__*/ withSize(NoSymbolIcon)
const ListOrdered = /*#__PURE__*/ withSize(NumberedListIcon)
const PaintBrush = /*#__PURE__*/ withSize(PaintBrushIcon)
const Palette = /*#__PURE__*/ withSize(PaintBrushIcon)
const Send = /*#__PURE__*/ withSize(PaperAirplaneIcon)
const PencilLine = /*#__PURE__*/ withSize(PencilSquareIcon)
const PenLine = /*#__PURE__*/ withSize(PencilSquareIcon)
const PencilSquare = /*#__PURE__*/ withSize(PencilSquareIcon)
const Play = /*#__PURE__*/ withSize(PlayIcon)
const Plus = /*#__PURE__*/ withSize(PlusIcon)
const Presentation = /*#__PURE__*/ withSize(PresentationChartBarIcon)
const Printer = /*#__PURE__*/ withSize(PrinterIcon)
const PuzzlePiece = /*#__PURE__*/ withSize(PuzzlePieceIcon)
const Gamepad2 = /*#__PURE__*/ withSize(PuzzlePieceIcon)
const ClipboardCheckList = /*#__PURE__*/ withSize(QueueListIcon)
const Layers = /*#__PURE__*/ withSize(RectangleStackIcon)
const ShieldCheck = /*#__PURE__*/ withSize(ShieldCheckIcon)
const Signal = /*#__PURE__*/ withSize(SignalIcon)
const Sparkles = /*#__PURE__*/ withSize(SparklesIcon)
const Volume2 = /*#__PURE__*/ withSize(SpeakerWaveIcon)
const VolumeX = /*#__PURE__*/ withSize(SpeakerXMarkIcon)
const LayoutDashboard = /*#__PURE__*/ withSize(Squares2X2Icon)
const LayoutGrid = /*#__PURE__*/ withSize(Squares2X2Icon)
const Star = /*#__PURE__*/ withSize(StarIcon)
const Square = /*#__PURE__*/ withSize(StopIcon)
const Strikethrough = /*#__PURE__*/ withSize(StrikethroughIcon)
const Swatch = /*#__PURE__*/ withSize(SwatchIcon)
const Table = /*#__PURE__*/ withSize(TableCellsIcon)
const TableIcon = /*#__PURE__*/ withSize(TableCellsIcon)
const Trophy = /*#__PURE__*/ withSize(TrophyIcon)
const Underline = /*#__PURE__*/ withSize(UnderlineIcon)
const User = /*#__PURE__*/ withSize(UserIcon)
const Users = /*#__PURE__*/ withSize(UserGroupIcon)
const Sigma = /*#__PURE__*/ withSize(VariableIcon)
const Bot = RobotIcon
const X = /*#__PURE__*/ withSize(XMarkIcon)
const XMark = /*#__PURE__*/ withSize(XMarkIcon)
const Trash2 = /*#__PURE__*/ withSize(TrashIcon)
const Layout = /*#__PURE__*/ withSize(ViewColumnsIcon)
const FileType = /*#__PURE__*/ withSize(DocumentIcon)
const Save = /*#__PURE__*/ withSize(BookmarkSquareIcon)
const Loader2 = /*#__PURE__*/ withSize(ArrowPathIcon)
const ArrowRight = /*#__PURE__*/ withSize(ArrowRightIcon)
const ImageIcon = /*#__PURE__*/ withSize(PhotoIcon)
const Globe = /*#__PURE__*/ withSize(GlobeAltIcon)
const ComputerDesktop = /*#__PURE__*/ withSize(ComputerDesktopIcon)
const Calculator = /*#__PURE__*/ withSize(CalculatorIcon)
const Language = /*#__PURE__*/ withSize(LanguageIcon)
const MusicalNote = /*#__PURE__*/ withSize(MusicalNoteIcon)
const Key = /*#__PURE__*/ withSize(KeyIcon)
const Camera = /*#__PURE__*/ withSize(CameraIcon)
const Scissors = /*#__PURE__*/ withSize(ScissorsIcon)
const Scale = /*#__PURE__*/ withSize(ScaleIcon)
const ArrowLeftRight = /*#__PURE__*/ withSize(ArrowsRightLeftIcon)
const Info = /*#__PURE__*/ withSize(InformationCircleIcon)
const ZoomIn = /*#__PURE__*/ withSize(MagnifyingGlassPlusIcon)
const ZoomOut = /*#__PURE__*/ withSize(MagnifyingGlassMinusIcon)
const MoreHorizontal = /*#__PURE__*/ withSize(EllipsisHorizontalIcon)
const RotateCw = /*#__PURE__*/ withSize(ArrowPathIcon)
const MoreVertical = /*#__PURE__*/ withSize(EllipsisVerticalIcon)
const Smartphone = /*#__PURE__*/ withSize(DevicePhoneMobileIcon)
const KeyRound = /*#__PURE__*/ withSize(KeyIcon)
const Laptop = /*#__PURE__*/ withSize(ComputerDesktopIcon)

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
  Minimize2,
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
  ChevronsLeft,
  ChevronsRight,
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
  SlidersHorizontal,
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
  Key,
  Camera,
  Scissors,
  Scale,
  ArrowLeftRight,
  Info,
  ZoomIn,
  ZoomOut,
  MoreHorizontal,
  RotateCw,
  MoreVertical,
  Smartphone,
  KeyRound,
  Laptop,
}
