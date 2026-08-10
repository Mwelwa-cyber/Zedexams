/**
 * settingsRegistry — the single source of truth for the Platform Control
 * Center (/admin/settings).
 *
 * Pure data, no JSX/Firebase imports, so the plain-node test
 * (scripts/test-settings-registry.mjs) can validate it and settingsCore.js
 * can derive defaults / search indexes from it.
 *
 * Shape:
 *   SETTINGS_GROUPS      — sidebar group headers, in display order.
 *   SETTINGS_CATEGORIES  — one entry per sidebar item. A category renders
 *     its `sections` (persisted fields in settings/global) followed by its
 *     `links` (deep links into the dedicated admin surface that actually
 *     manages that area — payments, agents, curriculum uploads, …). The
 *     control center deliberately does NOT clone those surfaces; it is the
 *     hub that configures the platform and routes to them.
 *
 * Field shape:
 *   key      — path in the settings/global doc ('siteName' or dotted
 *              'featureFlags.universalDrafts')
 *   type     — text | email | url | number | textarea | toggle | select | segmented
 *   default  — value used when the doc has no entry (also Reset target)
 *   help     — one-line explanation shown under the control
 *   keywords — extra search terms beyond the label
 *   danger   — renders with warning styling (platform-wide blast radius)
 */

import { gradesForFeature, gradeNumberOf } from '../../../config/canonicalEducation.js'

// Derived from the canonical model — see FEATURE_GRADE_RESTRICTIONS.
const GRADE_OPTIONS = gradesForFeature('learner-catalogue').map((g) => gradeNumberOf(g.code))
const THEME_OPTIONS = ['oatmeal', 'sky', 'solar', 'midnight']

export const SETTINGS_GROUPS = [
  { id: 'platform', label: 'Platform' },
  { id: 'ai', label: 'AI & Intelligence' },
  { id: 'learning', label: 'Learning' },
  { id: 'revenue', label: 'Revenue & Comms' },
  { id: 'mobile', label: 'Mobile & Security' },
  { id: 'developer', label: 'Developer' },
]

export const SETTINGS_CATEGORIES = [
  {
    id: 'overview',
    group: 'platform',
    label: 'Dashboard',
    icon: 'dashboard',
    blurb: 'Live platform vitals, AI insights and the latest admin activity.',
    keywords: ['overview', 'stats', 'health', 'monitoring', 'insights', 'activity'],
    special: 'overview',
    sections: [],
    links: [],
  },
  {
    id: 'general',
    group: 'platform',
    label: 'General',
    icon: 'settings',
    blurb: 'Identity, contact details and locale for the whole platform.',
    keywords: ['site', 'branding', 'company', 'locale', 'timezone', 'currency', 'language'],
    sections: [
      {
        id: 'identity',
        title: 'Platform identity',
        description: 'Shown across the app, in emails and in exported documents.',
        fields: [
          { key: 'siteName', label: 'Site name', type: 'text', default: 'ZedExams', help: 'The product name learners and teachers see.', keywords: ['brand', 'title'] },
          { key: 'siteUrl', label: 'Website URL', type: 'url', default: 'https://zedexams.com', help: 'Canonical public origin, used in links and share text.', keywords: ['domain', 'origin'] },
          { key: 'companyName', label: 'Company name', type: 'text', default: 'ZedExams', help: 'Legal name used on invoices and receipts.', keywords: ['legal', 'invoice'] },
          { key: 'companyAddress', label: 'Company address', type: 'text', default: 'Lusaka, Zambia', help: 'Appears on invoices and the contact page.', keywords: ['location'] },
        ],
      },
      {
        id: 'support',
        title: 'Support contacts',
        description: 'Where users are pointed when something goes wrong.',
        fields: [
          { key: 'supportEmail', label: 'Support email', type: 'email', default: 'support@zedexams.com', help: 'Shown on error screens, receipts and the help pages.', keywords: ['contact', 'help'] },
          { key: 'supportPhone', label: 'Support phone', type: 'text', default: '', help: 'Optional phone/WhatsApp line shown alongside the email.', keywords: ['contact', 'whatsapp', 'phone'] },
        ],
      },
      {
        id: 'locale',
        title: 'Locale & academic year',
        description: 'Regional defaults every surface inherits.',
        fields: [
          { key: 'timezone', label: 'Timezone', type: 'select', default: 'Africa/Lusaka', options: ['Africa/Lusaka', 'Africa/Harare', 'Africa/Johannesburg', 'UTC'], help: 'Used for schedules, digests and daily-exam windows.', keywords: ['time', 'clock', 'region'] },
          { key: 'currency', label: 'Currency', type: 'select', default: 'ZMW', options: ['ZMW', 'USD'], help: 'Display currency for pricing and invoices (payments settle in ZMW).', keywords: ['money', 'kwacha', 'pricing'] },
          { key: 'academicYear', label: 'Academic year', type: 'text', default: '', help: 'e.g. 2026 — stamped on schemes of work and reports.', keywords: ['calendar', 'term', 'school year'] },
          { key: 'defaultLanguage', label: 'Default language', type: 'select', default: 'en', options: [{ value: 'en', label: 'English' }], help: 'Platform language. More languages can be added later.', keywords: ['locale', 'english'] },
          { key: 'defaultTheme', label: 'Default theme', type: 'select', default: 'oatmeal', options: THEME_OPTIONS, help: 'Theme new accounts start with. Users can change theirs anytime.', keywords: ['appearance', 'color', 'skin'] },
        ],
      },
    ],
    links: [],
  },
  {
    id: 'registration',
    group: 'platform',
    label: 'Registration',
    icon: 'userPlus',
    blurb: 'Who can create an account, and what a new account starts with.',
    keywords: ['signup', 'sign up', 'register', 'accounts', 'onboarding', 'invite'],
    sections: [
      {
        id: 'access',
        title: 'Registration access',
        description: 'Controls stored in settings/global — the register flow reads registrationOpen live.',
        fields: [
          {
            key: 'registrationMode',
            label: 'Registration status',
            type: 'segmented',
            default: 'open',
            options: [
              { value: 'open', label: 'Open', tone: 'good' },
              { value: 'invite', label: 'Invite only', tone: 'warn' },
              { value: 'closed', label: 'Closed', tone: 'danger' },
            ],
            help: 'Open lets anyone self-register. Invite only and Closed both stop self-serve signup (invited accounts are created by an admin).',
            keywords: ['open', 'closed', 'invite', 'signups'],
          },
          { key: 'allowTeacherRegistration', label: 'Allow teacher registration', type: 'toggle', default: true, help: 'Whether the teacher option is offered on the register page.', keywords: ['teachers', 'signup'] },
          { key: 'allowLearnerRegistration', label: 'Allow learner registration', type: 'toggle', default: true, help: 'Whether the learner option is offered on the register page.', keywords: ['learners', 'students', 'signup'] },
          { key: 'requireEmailVerification', label: 'Require email verification', type: 'toggle', default: false, help: 'Ask new accounts to verify their email before full access.', keywords: ['verify', 'email'] },
        ],
      },
      {
        id: 'newAccounts',
        title: 'New-account defaults',
        fields: [
          { key: 'defaultRole', label: 'Default role', type: 'segmented', default: 'learner', options: [{ value: 'learner', label: 'Learner' }, { value: 'teacher', label: 'Teacher' }], help: 'Preselected role on the register page.', keywords: ['role'] },
          { key: 'defaultGrade', label: 'Default grade', type: 'select', default: '7', options: GRADE_OPTIONS, help: 'Grade a new learner account starts in.', keywords: ['grade', 'class'] },
        ],
      },
    ],
    links: [],
  },
  {
    id: 'users',
    group: 'platform',
    label: 'User management',
    icon: 'users',
    blurb: 'Account limits and the dedicated user-administration surfaces.',
    keywords: ['learners', 'teachers', 'admins', 'accounts', 'roles', 'limits', 'ban', 'suspend'],
    sections: [
      {
        id: 'limits',
        title: 'Usage limits',
        fields: [
          { key: 'maxExamAttemptsPerDay', label: 'Max exam attempts per day', type: 'number', default: 3, min: 0, max: 20, help: 'Daily-exam attempts a learner gets per day (0 = unlimited).', keywords: ['attempts', 'exams', 'quota'] },
        ],
      },
    ],
    links: [
      { label: 'All users', to: '/admin/users', description: 'Search, suspend, delete and change roles.' },
      { label: 'Learners', to: '/admin/learners', description: 'Learner profiles, results and subscriptions.' },
      { label: 'Teachers', to: '/admin/teachers', description: 'Teacher accounts and plan status.' },
      { label: 'Admins', to: '/admin/admins', description: 'Administrator accounts.' },
    ],
  },
  {
    id: 'ai',
    group: 'ai',
    label: 'AI & budgets',
    icon: 'bot',
    blurb: 'Spend guardrails for the AI fleet, plus every AI operations surface.',
    keywords: ['anthropic', 'claude', 'openai', 'gemini', 'models', 'budget', 'cost', 'spend', 'tokens'],
    sections: [
      {
        id: 'budgets',
        title: 'Spend guardrails',
        description: 'Targets the dashboard alerts against. Hard enforcement lives in the server-side treasury (functions/treasury.js).',
        fields: [
          { key: 'aiDailyBudgetUsd', label: 'Daily budget (USD)', type: 'number', default: 0, min: 0, help: 'Insight alerts fire as today’s AI spend approaches this. 0 disables the alert.', keywords: ['budget', 'daily', 'limit', 'cost'] },
          { key: 'aiMonthlyBudgetUsd', label: 'Monthly budget (USD)', type: 'number', default: 0, min: 0, help: 'Insight alerts fire as 30-day AI spend approaches this. 0 disables the alert.', keywords: ['budget', 'monthly', 'limit', 'cost'] },
          { key: 'aiCostAlertsEnabled', label: 'AI cost alerts', type: 'toggle', default: true, help: 'Show budget and anomaly warnings on this dashboard.', keywords: ['alerts', 'anomaly', 'warning'] },
        ],
      },
    ],
    links: [
      { label: 'AI costs', to: '/admin/ai-costs', description: 'Daily spend, per-tool breakdown, top consumers.' },
      { label: 'AI agents', to: '/admin/agents', description: 'Agent fleet, approvals, pause switches, auto-publish gate.' },
      { label: 'AI company HQ', to: '/admin/company', description: 'Marshal’s hourly fleet-health verdict.' },
      { label: 'AI generations', to: '/admin/generations', description: 'Everything the generators have produced.' },
    ],
  },
  {
    id: 'curriculum',
    group: 'learning',
    label: 'Curriculum',
    icon: 'book',
    blurb: 'The CBC knowledge base, syllabus versions and the question bank.',
    keywords: ['cbc', 'syllabus', 'knowledge base', 'topics', 'question bank', 'qix', 'modules'],
    sections: [],
    links: [
      { label: 'CBC knowledge base', to: '/admin/cbc-kb', description: 'Browse and edit the verified CBC KB.' },
      { label: 'Replace syllabus', to: '/admin/curriculum/replace', description: 'Upload, activate or roll back a syllabus version.' },
      { label: 'Curriculum uploads', to: '/admin/curriculum-upload', description: 'Source documents feeding the KB.' },
      { label: 'Question review (Qix)', to: '/admin/question-review', description: 'Central Question Bank review queue.' },
      { label: 'Import questions', to: '/admin/import-questions', description: 'Bulk-import past-paper questions.' },
    ],
  },
  {
    id: 'content',
    group: 'learning',
    label: 'Content',
    icon: 'folder',
    blurb: 'Quizzes, notes, past papers and the approval pipeline.',
    keywords: ['quizzes', 'notes', 'lessons', 'papers', 'approvals', 'publish', 'ocr', 'import'],
    sections: [],
    links: [
      { label: 'Manage content', to: '/admin/content', description: 'Every quiz, note and lesson in one table.' },
      { label: 'Approval queue', to: '/admin/approvals', description: 'Pending quizzes and lessons awaiting review.' },
      { label: 'Notes Studio', to: '/admin/lessons', description: 'Author and edit learner notes.' },
      { label: 'Past papers', to: '/admin/papers', description: 'Past-paper library and studio.' },
      { label: 'CSV import', to: '/admin/import/csv', description: 'Bulk quiz import from spreadsheets.' },
      { label: 'Games seed', to: '/admin/games-seed', description: 'Seed data for the games hub.' },
    ],
  },
  {
    id: 'billing',
    group: 'revenue',
    label: 'Billing',
    icon: 'card',
    blurb: 'Payments run through Lenco (mobile money + cards) and Google Play.',
    keywords: ['payments', 'subscriptions', 'lenco', 'mtn', 'airtel', 'zamtel', 'google play', 'pricing', 'invoices', 'refunds', 'trials'],
    sections: [],
    links: [
      { label: 'Payments', to: '/admin/payments', description: 'Confirm, reject and recover payments; revenue trend.' },
      { label: 'Demo trials', to: '/admin/demo-trials', description: 'Grant and manage trial access.' },
    ],
  },
  {
    id: 'communication',
    group: 'revenue',
    label: 'Communication',
    icon: 'bell',
    blurb: 'Announcements, feedback triage and outbound messaging.',
    keywords: ['announcements', 'email', 'whatsapp', 'push', 'notifications', 'feedback', 'newsletter', 'sms'],
    sections: [],
    links: [
      { label: 'Announcements', to: '/admin/announcements', description: 'Publish banners and in-app announcements.' },
      { label: 'Feedback inbox', to: '/admin/feedback', description: 'Suggestions and support messages (Echo pre-triages).' },
    ],
  },
  {
    id: 'website',
    group: 'platform',
    label: 'Website',
    icon: 'globe',
    blurb: 'Public-site availability and visitor analytics.',
    keywords: ['maintenance', 'downtime', 'homepage', 'seo', 'visitors', 'analytics', 'banner'],
    sections: [
      {
        id: 'availability',
        title: 'Availability',
        fields: [
          { key: 'maintenanceMode', label: 'Maintenance mode', type: 'toggle', default: false, danger: true, help: 'Shows a platform-wide banner and blocks non-admin sign-in flows.', keywords: ['downtime', 'offline', 'maintenance'] },
          { key: 'maintenanceMessage', label: 'Maintenance message', type: 'textarea', default: '', help: 'Shown in the maintenance banner while maintenance mode is on.', keywords: ['downtime', 'banner', 'message'] },
        ],
      },
    ],
    links: [
      { label: 'Website visitors', to: '/admin/visitors', description: 'Traffic on the public site.' },
      { label: 'Analytics', to: '/admin/analytics', description: 'Usage analytics across the platform.' },
    ],
  },
  {
    id: 'android',
    group: 'mobile',
    label: 'Android app',
    icon: 'device',
    blurb: 'In-app update nudge for the Capacitor build.',
    keywords: ['apk', 'play store', 'capacitor', 'mobile', 'version', 'update', 'build'],
    sections: [
      {
        id: 'update',
        title: 'Update nudge',
        description: 'After building an APK, enter the versionCode gradle prints and where to download it — older installs then see an in-app update banner.',
        fields: [
          { key: 'androidLatestBuild', label: 'Latest build (versionCode)', type: 'number', default: 0, min: 0, help: 'The versionCode of the newest APK.', keywords: ['versioncode', 'build number'] },
          { key: 'androidApkUrl', label: 'APK download URL', type: 'url', default: '', help: 'Where the update banner sends users.', keywords: ['download', 'apk'] },
          { key: 'androidUpdateMessage', label: 'Update message', type: 'text', default: '', help: 'Optional custom text in the update banner.', keywords: ['banner', 'message'] },
        ],
      },
    ],
    links: [
      { label: 'App Check', to: '/admin/app-check', description: 'reCAPTCHA Enterprise + Play Integrity status.' },
    ],
  },
  {
    id: 'security',
    group: 'mobile',
    label: 'Security',
    icon: 'shield',
    blurb: 'Audit trail, attestation and administrator accounts.',
    keywords: ['audit', 'logs', 'app check', 'rules', 'permissions', 'authentication', 'admins'],
    sections: [],
    links: [
      { label: 'Activity log', to: '/admin/activity', description: 'Tamper-resistant ledger of sensitive admin actions.' },
      { label: 'App Check', to: '/admin/app-check', description: 'Client attestation configuration.' },
      { label: 'Admins', to: '/admin/admins', description: 'Who holds administrator access.' },
    ],
  },
  {
    id: 'developer',
    group: 'developer',
    label: 'Developer',
    icon: 'beaker',
    blurb: 'Feature flags and configuration portability. Super-admin territory.',
    keywords: ['feature flags', 'flags', 'experiments', 'export', 'import', 'config', 'json'],
    sections: [
      {
        id: 'flags',
        title: 'Feature flags',
        description: 'Live switches read by every connected client via settings/global.',
        fields: [
          { key: 'featureFlags.universalDrafts', label: 'Universal studio drafts', type: 'toggle', default: true, help: 'Auto-saves teacher studio inputs as drafts. Turning this off disables draft restore everywhere.', keywords: ['drafts', 'autosave', 'studios'] },
          { key: 'featureFlags.passkeyAuthenticationEnabled', label: 'Passkey sign-in', type: 'toggle', default: false, help: 'Shows "Sign in with a passkey" on the login page and the Passkeys section under Settings → Security. The Cloud Functions check the same flag (fail-closed). Staged rollout: featureFlags.passkeyRolloutRoles / passkeyRolloutUids (arrays, edited via config JSON) narrow who can REGISTER while testing.', keywords: ['passkey', 'webauthn', 'fingerprint', 'biometric', 'sign in'] },
          { key: 'featureFlags.worksheetStudioEnabled', label: 'Worksheet Studio', type: 'toggle', default: false, help: 'Worksheet Studio was withdrawn for launch: its picture-dependent output (tracing sheets, labelled diagrams) is mislabelled often enough to be unusable in children\'s materials. Turning this on restores the studio and every entry point to it — the tile, the menus, Quick Create, the usage bar and the lesson-plan hand-off. Leave it off until worksheets are rebuilt on the curated Diagram Library. Saved worksheets stay readable and exportable either way.', keywords: ['worksheet', 'studio', 'withdrawn', 'launch', 'diagram library'] },
        ],
      },
      {
        // The Assessment Engine cutover switches (docs/phase3-plan.md §4.2).
        // These are the ROLLBACK: flipping one off returns every visitor on
        // that route to the old runner within a snapshot, with no deploy.
        // One switch per runner, because a cutover that cannot be reverted on
        // its own is not three cutovers.
        id: 'assessment-engine',
        title: 'Assessment Engine rollout',
        description: 'Which learner runners are served by the shared engine. Off is the known-good path — flip one back off to revert that route instantly.',
        fields: [
          { key: 'featureFlags.assessmentEngine.pastPaperQuiz', label: 'Past-paper quizzes', type: 'toggle', default: false, help: 'The /papers/:paperId/quiz route. Flipped FIRST — it is the only runner that persists nothing, so a wrong render reverts with nothing to clean up.', keywords: ['assessment engine', 'past paper', 'canary', 'rollout', 'cutover'] },
          { key: 'featureFlags.assessmentEngine.quiz', label: 'Learner quizzes', type: 'toggle', default: false, help: 'The /quiz/:quizId route. Writes a results document — do not flip before the past-paper canary has run clean.', keywords: ['assessment engine', 'quiz', 'rollout', 'cutover'] },
          { key: 'featureFlags.assessmentEngine.game', label: 'Timed quiz game', type: 'toggle', default: false, help: 'The timed_quiz game engine. Flipped LAST — four write targets, including the leaderboard.', keywords: ['assessment engine', 'game', 'timed quiz', 'rollout', 'cutover'] },
          { key: 'featureFlags.assessmentEngine.rolloutPercent', label: 'Rollout (%)', type: 'number', default: 0, min: 0, max: 100, help: 'Narrows all three switches to a share of visitors, bucketed on a stable per-visitor id. 0 = nobody (so a switch on its own changes nothing), 100 = everyone. Raising it only ADDS visitors — nobody already on the engine is moved off by a ramp-up. Below 1% rounds to nobody.', keywords: ['assessment engine', 'rollout', 'percent', 'canary', 'gradual'] },
          // A real control rather than "edit the config JSON". The registry is
          // the ONLY thing normalizeSettings, exportConfig and validateImport
          // traverse, so an unregistered key is silently dropped on import and
          // absent from every export — which made the documented staff-pilot
          // path impossible to perform. Text, not an array, because that is
          // what a textarea stores; the resolver accepts both shapes so a value
          // written through the Firebase console still works.
          { key: 'featureFlags.assessmentEngine.rolloutUids', label: 'Always on for these accounts', type: 'textarea', default: '', help: 'Account UIDs, one per line (or comma-separated), that get the engine regardless of the rollout percentage — how you try a runner on your own account before any learner sees it. It does NOT survive the switch above: turning a runner off reverts these accounts too, so a rollback is total.', keywords: ['assessment engine', 'rollout', 'allow list', 'pilot', 'staff', 'uid'] },
        ],
      },
    ],
    links: [],
  },
]
