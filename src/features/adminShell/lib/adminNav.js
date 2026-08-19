/**
 * THE admin navigation menu — one registry, every surface.
 *
 * The sidebar, the mobile drawer and the ⌘K command palette all render from
 * this array. It used to live inline in AdminLayout.jsx, which meant two
 * things: nothing could check the 30-odd destinations still resolve to a
 * declared route, and the palette was handed only the sections the sidebar
 * happened to pass — so ⌘K could reach "AI costs" but not "Sign out" or
 * "Teacher view", which sat in their own hard-coded block below the nav.
 *
 * Now the shell-level actions are entries here too, carrying a `command`
 * instead of a `to`, so the palette reaches everything the sidebar does.
 *
 * `scripts/test-admin-links.mjs` (`npm run test:admin-links`) text-parses this
 * file and fails if a `to:` has no matching <Route> in App.jsx — the same
 * guard the teacher nav registry has had since the /teacher/settings 404.
 * Keep the destinations as plain string literals so that parser can see them.
 *
 * Icons live here alongside the labels, exactly as the teacher registry
 * (`src/shared/constants/dashboardV2Config.js`) does. The pure, node-tested
 * half is the SEARCH — `adminNavSearch.js` takes flattened commands as data
 * and imports nothing, so it tests under plain node without React.
 */
import {
  LayoutDashboard,
  Presentation,
  BookOpen,
  PencilLine,
  FolderOpen,
  BellRing,
  TrendingUp,
  Volume2,
  CreditCard,
  Home,
  LogOut,
  Users,
  GraduationCap,
  Settings,
  Bot,
  FileText,
  Sparkles,
  Upload,
  ShieldCheck,
  Bell,
  ChartBarIcon,
  Lightbulb,
  LayoutGrid,
  Globe,
} from '../../../shared/components/icons'

/**
 * Grouped navigation.
 *
 * Per item:
 *   to        route path (plain literal — the link guard parses it)
 *   end       NavLink exact-match, for the index route only
 *   badgeKey  key into the pending-counts map AdminLayout computes
 *   keywords  extra search terms for ⌘K. These are the words an admin
 *             actually types — "billing", "money", "refund" for Payments —
 *             none of which appear in the label, so before this the palette
 *             simply returned nothing for them.
 */
export const ADMIN_NAV_SECTIONS = [
  {
    label: 'Overview',
    items: [
      { to: '/admin', icon: LayoutDashboard, label: 'Dashboard', end: true, keywords: 'home overview start' },
      { to: '/admin/company', icon: LayoutGrid, label: 'AI Company', keywords: 'hq agents health marshal org' },
      { to: '/admin/analytics', icon: ChartBarIcon, label: 'Analytics', keywords: 'stats metrics usage charts' },
    ],
  },
  {
    label: 'Users',
    items: [
      { to: '/admin/users', icon: Users, label: 'All users', keywords: 'accounts people directory search' },
      { to: '/admin/learners', icon: GraduationCap, label: 'Learners', keywords: 'students pupils children' },
      { to: '/admin/teachers', icon: GraduationCap, label: 'Teachers', keywords: 'staff educators tutors' },
      { to: '/admin/admins', icon: ShieldCheck, label: 'Admins', keywords: 'administrators superadmin roles' },
    ],
  },
  {
    label: 'Content',
    items: [
      { to: '/admin/content', icon: FolderOpen, label: 'Manage content', keywords: 'library edit delete publish' },
      { to: '/admin/quizzes/new', icon: PencilLine, label: 'Create quiz', keywords: 'new test questions author' },
      { to: '/admin/lessons', icon: Presentation, label: 'Notes Studio', keywords: 'notes lessons slides' },
      { to: '/admin/lessons/new', icon: BookOpen, label: 'Create note', keywords: 'new lesson author write' },
      { to: '/admin/papers', icon: FileText, label: 'Past papers', keywords: 'exams archive pdf ecz' },
      { to: '/admin/import/csv', icon: Upload, label: 'CSV import', keywords: 'bulk upload spreadsheet' },
      { to: '/admin/cbc-kb', icon: BookOpen, label: 'CBC KB', keywords: 'knowledge base curriculum topics outcomes' },
      { to: '/admin/curriculum/replace', icon: Upload, label: 'Replace syllabus', keywords: 'curriculum version rollback' },
      { to: '/admin/curriculum-upload', icon: Upload, label: 'Curriculum uploads', keywords: 'syllabus parse ingest' },
      { to: '/admin/games-seed', icon: Sparkles, label: 'Games seed', keywords: 'games data seed' },
    ],
  },
  {
    label: 'Approvals',
    items: [
      { to: '/admin/approvals', icon: BellRing, label: 'Content queue', badgeKey: 'content', keywords: 'pending review approve reject' },
      { to: '/admin/question-review', icon: BellRing, label: 'Question review', keywords: 'qix bank moderation pending' },
      { to: '/admin/import-questions', icon: Upload, label: 'Import questions', keywords: 'bank bulk upload' },
      { to: '/admin/agents', icon: Bot, label: 'AI agents', badgeKey: 'agents', keywords: 'aria cala reva pubo jobs pipeline' },
      { to: '/admin/generations', icon: Sparkles, label: 'AI generations', keywords: 'output drafts ai library' },
      { to: '/admin/feedback', icon: Lightbulb, label: 'Suggestions', badgeKey: 'feedback', keywords: 'feedback ideas reports contact echo' },
    ],
  },
  {
    label: 'Reports',
    items: [
      { to: '/admin/visitors', icon: Globe, label: 'Website visitors', keywords: 'traffic sessions analytics web' },
      { to: '/admin/results', icon: TrendingUp, label: 'Results', keywords: 'scores marks attempts grades' },
      { to: '/admin/ai-costs', icon: TrendingUp, label: 'AI costs', keywords: 'spend budget anthropic openai treasury tokens' },
      { to: '/admin/voice', icon: Volume2, label: 'Voice & speech', keywords: 'tts text to speech elevenlabs google credits audio read aloud pronunciation cache' },
    ],
  },
  {
    label: 'Billing',
    items: [
      { to: '/admin/payments', icon: CreditCard, label: 'Payments', badgeKey: 'payments', keywords: 'billing money lenco refund subscription invoice mtn airtel' },
      { to: '/admin/demo-trials', icon: Sparkles, label: 'Demo trials', keywords: 'trial grant free access' },
    ],
  },
  {
    label: 'Operations',
    items: [
      { to: '/admin/settings', icon: Settings, label: 'Settings', keywords: 'config flags feature toggles' },
      { to: '/admin/announcements', icon: Bell, label: 'Announcements', keywords: 'broadcast notice banner message' },
      { to: '/admin/activity', icon: ShieldCheck, label: 'Activity log', keywords: 'audit history events security' },
      { to: '/admin/app-check', icon: ShieldCheck, label: 'App Check', keywords: 'recaptcha play integrity security' },
    ],
  },
]

/**
 * The role-switch links. The sidebar and mobile drawer render these under
 * their "Quick switch" heading, where they were previously written out by
 * hand in both places — so the desktop and mobile lists could drift.
 */
export const ADMIN_SWITCH_ITEMS = [
  { to: '/teacher', icon: GraduationCap, label: 'Teacher view', keywords: 'switch role preview teacher' },
  { to: '/dashboard', icon: Home, label: 'Learner view', keywords: 'switch role preview learner student' },
]

/**
 * Actions with no route. `command` is a string the shell resolves to a
 * handler, so the palette can offer Sign out without knowing how logging out
 * works — and without the registry importing the auth context.
 */
export const ADMIN_ACTION_ITEMS = [
  { command: 'logout', icon: LogOut, label: 'Sign out', keywords: 'logout log out exit leave account', danger: true },
]

/**
 * Everything ⌘K offers. The palette used to be handed ADMIN_NAV_SECTIONS
 * alone, so the destinations below — which are right there in the sidebar —
 * were the one part of the admin the shortcut could not reach.
 */
export const ADMIN_PALETTE_SECTIONS = [
  ...ADMIN_NAV_SECTIONS,
  { label: 'Quick switch', items: ADMIN_SWITCH_ITEMS },
  { label: 'Account', items: ADMIN_ACTION_ITEMS },
]

/**
 * Flatten grouped sections into the plain command records `adminNavSearch`
 * ranks. Kept here rather than in the search module so the search module
 * stays free of any knowledge of the nav's shape — it takes data.
 *
 * `id` is the stable React key and the palette's aria-activedescendant
 * target; an action has no `to`, so keying on `to` alone dropped Sign out.
 */
export function flattenAdminCommands(sections) {
  const list = []
  for (const section of sections || []) {
    for (const item of section.items || []) {
      list.push({
        id: item.to || `cmd:${item.command}`,
        section: section.label,
        label: item.label,
        to: item.to,
        command: item.command,
        icon: item.icon,
        badgeKey: item.badgeKey,
        danger: !!item.danger,
        external: !!item.external,
        keywords: item.keywords || '',
      })
    }
  }
  return list
}
