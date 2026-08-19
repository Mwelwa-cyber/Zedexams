// Learner Settings — pure preference helpers (no Firebase, no React).
//
// This module is the single source of truth for the *shape* of every learner
// preference group and the derived indicators the redesigned Settings page
// shows (profile completion %, security strength). Keeping it pure means the
// whole persistence contract is unit-testable under plain `node`
// (lib/learnerPrefs.test.js) and every panel imports the same normalizers, so
// what one panel writes another reads back unchanged.
//
// Persistence map (all live on the user's Firestore doc unless noted):
//   displayName, preferredName, school, grade, className, gender,
//   preferredLanguage, country, avatarCharacter, avatarPhotoUrl
//                                            → flat profile fields
//   dob                                      → READ-ONLY here. The age
//     screen's answer, pinned against client updates in firestore.rules; the
//     profile panel displays it and offers no control. (A second, editable
//     `dateOfBirth` used to live beside it and fed nothing — see that panel.)
//   notificationPrefs                        → src/engines/notification-engine/notificationPrefs.js
//   learningPrefs                            → extended below
//   learnerSettings.security                 → recovery email/phone, 2FA intent
//   learnerSettings.personalisation          → card style, accent, nav, layout
//   learnerSettings.zedAi                    → Zed assistant voice/personality
//   learnerSettings.privacy                  → sharing, visibility, recs
// Accessibility lives in localStorage (src/utils/accessibility.js).
//
// Firestore's offline persistence (config.js) caches these for offline viewing
// and replays writes on reconnect, which is where "sync across devices" and
// "cache for offline" come from for free.

const bool = (v, dflt) => (typeof v === 'boolean' ? v : dflt(v))
const dflt = (fallback) => () => fallback
const str = (v, allowed, fallback) =>
  typeof v === 'string' && (!allowed || allowed.includes(v)) ? v : fallback

/* ── Section memory (last opened) ─────────────────────────────────────────── */

// `config/curriculum` is plain data with no imports of its own, so this stays
// loadable under plain `node` for lib/learnerPrefs.test.js.
import { LEARNER_GRADES } from '../../../config/curriculum.js'

export const SECTION_MEMORY_KEY = 'zedexams:learnerSettings:lastSection:v1'

export function readLastSection() {
  if (typeof window === 'undefined') return null
  try {
    return window.localStorage.getItem(SECTION_MEMORY_KEY) || null
  } catch {
    return null
  }
}

export function writeLastSection(id) {
  if (typeof window === 'undefined' || !id) return
  try {
    window.localStorage.setItem(SECTION_MEMORY_KEY, String(id))
  } catch {
    // Private mode / quota — non-fatal; the page just forgets the tab.
  }
}

/* ── Profile ──────────────────────────────────────────────────────────────── */

/**
 * The grades the learner settings selects offer.
 *
 * Re-exported from the rollout list rather than restated: a learner may only
 * move themselves into a grade that is actually open, and a second hard-coded
 * [4, 5, 6, 7] here is how the settings page kept offering a closed grade after
 * the wizard stopped. Named `GRADE_NUMBERS` still because that is what the two
 * panels import.
 */
export const GRADE_NUMBERS = LEARNER_GRADES

export const GENDER_OPTIONS = Object.freeze([
  { value: '', label: 'Prefer not to say' },
  { value: 'female', label: 'Female' },
  { value: 'male', label: 'Male' },
  { value: 'other', label: 'Other' },
])

export const LANGUAGE_OPTIONS = Object.freeze([
  { value: 'en', label: 'English' },
  { value: 'ny', label: 'Nyanja' },
  { value: 'bem', label: 'Bemba' },
  { value: 'toi', label: 'Tonga' },
])

export const COUNTRY_OPTIONS = Object.freeze([
  { value: 'ZM', label: 'Zambia' },
  { value: 'ZW', label: 'Zimbabwe' },
  { value: 'MW', label: 'Malawi' },
  { value: 'TZ', label: 'Tanzania' },
  { value: 'CD', label: 'DR Congo' },
  { value: 'ZA', label: 'South Africa' },
  { value: 'other', label: 'Other' },
])

// The fields that count toward the "profile completion" ring. Optional fields
// (preferredName, gender) are intentionally excluded so a learner is never
// nagged for information the platform doesn't require. Date of birth is not
// here either, and for a stronger reason: it is not a field the learner can
// complete, so counting it would be a ring that never fills.
const COMPLETION_FIELDS = [
  (p) => p.displayName,
  (p) => p.school,
  (p) => p.grade,
  (p) => p.className,
  (p) => p.preferredLanguage,
  (p) => p.country,
  (p) => p.avatarCharacter || p.avatarPhotoUrl,
  (p) => p.security?.recoveryEmail || p.security?.recoveryPhone || p.recoveryEmail,
]

// Returns { percent, complete, total, missing[] } for the completion badge.
// `missing` uses stable ids so the UI can deep-link to the right section.
const COMPLETION_LABELS = [
  'name', 'school', 'grade', 'class', 'language', 'country', 'avatar', 'recovery',
]

export function computeProfileCompletion(profile) {
  const p = profile && typeof profile === 'object' ? profile : {}
  const security = p.learnerSettings?.security || {}
  const src = { ...p, security }
  const results = COMPLETION_FIELDS.map((fn) => {
    const v = fn(src)
    return typeof v === 'string' ? v.trim().length > 0 : v != null && v !== ''
  })
  const complete = results.filter(Boolean).length
  const total = results.length
  const percent = total ? Math.round((complete / total) * 100) : 0
  const missing = COMPLETION_LABELS.filter((_, i) => !results[i])
  return { percent, complete, total, missing }
}

/* ── Security ─────────────────────────────────────────────────────────────── */

export function normalizeSecurityPrefs(input) {
  const p = input && typeof input === 'object' ? input : {}
  return {
    recoveryEmail: str(p.recoveryEmail, null, ''),
    recoveryPhone: str(p.recoveryPhone, null, ''),
    twoFactorEnabled: bool(p.twoFactorEnabled, dflt(false)),
  }
}

// Security strength: a deterministic 0–3 score → red / yellow / green, derived
// only from real, observable account state so the badge never lies.
//   +1 the account has been signed in recently (password known & working)
//   +1 a recovery email OR phone is on file
//   +1 email is verified OR 2FA intent is set
export function computeSecurityStrength({ security, emailVerified, hasPassword }) {
  const sec = normalizeSecurityPrefs(security)
  let score = 0
  if (hasPassword) score += 1
  if (sec.recoveryEmail.trim() || sec.recoveryPhone.trim()) score += 1
  if (emailVerified || sec.twoFactorEnabled) score += 1
  const level = score >= 3 ? 'excellent' : score === 2 ? 'good' : 'weak'
  const meta = {
    excellent: { label: 'Excellent', tone: 'green', emoji: '🟢' },
    good: { label: 'Good', tone: 'amber', emoji: '🟡' },
    weak: { label: 'Weak', tone: 'danger', emoji: '🔴' },
  }[level]
  return { score, level, ...meta }
}

/* ── Learning preferences ─────────────────────────────────────────────────── */

export const QUIZ_DIFFICULTY_OPTIONS = Object.freeze([
  { value: 'easy', label: 'Gentle' },
  { value: 'medium', label: 'Balanced' },
  { value: 'hard', label: 'Challenge' },
  { value: 'adaptive', label: 'Adaptive' },
])

export const QUIZ_MODE_OPTIONS = Object.freeze([
  { value: 'practice', label: 'Practice' },
  { value: 'timed', label: 'Timed' },
  { value: 'exam', label: 'Exam' },
])

export const READING_SPEED_OPTIONS = Object.freeze([
  { value: 'slow', label: 'Slow' },
  { value: 'normal', label: 'Normal' },
  { value: 'fast', label: 'Fast' },
])

export const PLAYBACK_SPEED_OPTIONS = Object.freeze([
  { value: '0.75', label: '0.75×' },
  { value: '1', label: '1×' },
  { value: '1.25', label: '1.25×' },
  { value: '1.5', label: '1.5×' },
])

// Daily study-goal presets (minutes/day) surfaced as chip buttons on the
// Learning Preferences card, mirroring the mockup (10 / 20 / 30 / 45 / 60).
export const DAILY_GOAL_OPTIONS = Object.freeze([
  { value: 10, label: '10 min' },
  { value: 20, label: '20 min' },
  { value: 30, label: '30 min' },
  { value: 45, label: '45 min' },
  { value: 60, label: '1 hour' },
])

const DAILY_GOAL_VALUES = DAILY_GOAL_OPTIONS.map((o) => o.value)

export function normalizeLearningPrefs(input) {
  const p = input && typeof input === 'object' ? input : {}
  const goal = Number(p.dailyGoal)
  return {
    // Original three (kept for backwards compatibility with the old page).
    soundEffects: bool(p.soundEffects, dflt(true)),
    // The learner's own Ask Zed switch (prototype-v7 Settings → Learning).
    // A guardian's `guardianControls.askZed === false` overrides it; see
    // features/learnerHome/lib/guardianControlsCore.js.
    askZed: bool(p.askZed, dflt(true)),
    showHints: bool(p.showHints, dflt(true)),
    autoplayLessons: bool(p.autoplayLessons, dflt(false)),
    // Extended set.
    curriculum: str(p.curriculum, ['cbc'], 'cbc'),
    quizDifficulty: str(p.quizDifficulty, ['easy', 'medium', 'hard', 'adaptive'], 'medium'),
    defaultQuizMode: str(p.defaultQuizMode, ['practice', 'timed', 'exam'], 'practice'),
    dailyGoal: DAILY_GOAL_VALUES.includes(goal) ? goal : 20,
    timedQuizzes: bool(p.timedQuizzes, dflt(false)),
    autoSubmitTimer: bool(p.autoSubmitTimer, dflt(true)),
    textToSpeech: bool(p.textToSpeech, dflt(false)),
    readingSpeed: str(p.readingSpeed, ['slow', 'normal', 'fast'], 'normal'),
    audioSpeed: str(p.audioSpeed, ['0.75', '1', '1.25', '1.5'], '1'),
  }
}

/* ── Personalisation ──────────────────────────────────────────────────────── */

export const ACCENT_OPTIONS = Object.freeze([
  { value: 'default', label: 'Theme default', swatch: 'var(--accent)' },
  { value: 'emerald', label: 'Emerald', swatch: '#10b981' },
  { value: 'sky', label: 'Sky', swatch: '#0ea5e9' },
  { value: 'violet', label: 'Violet', swatch: '#8b5cf6' },
  { value: 'rose', label: 'Rose', swatch: '#f43f5e' },
  { value: 'amber', label: 'Amber', swatch: '#f59e0b' },
])

export const CARD_STYLE_OPTIONS = Object.freeze([
  { value: 'rounded', label: 'Rounded', hint: 'Soft 20px corners' },
  { value: 'sharp', label: 'Sharp', hint: 'Crisp 8px corners' },
  { value: 'glass', label: 'Glass', hint: 'Frosted & translucent' },
])

export const NAV_STYLE_OPTIONS = Object.freeze([
  { value: 'sidebar', label: 'Sidebar', hint: 'List down the side' },
  { value: 'tabs', label: 'Tabs', hint: 'Chips across the top' },
])

export const DASHBOARD_LAYOUT_OPTIONS = Object.freeze([
  { value: 'comfortable', label: 'Comfortable', hint: 'Big cards, more spacing' },
  { value: 'compact', label: 'Compact', hint: 'Denser, more on screen' },
])

export const BACKGROUND_OPTIONS = Object.freeze([
  { value: 'none', label: 'None' },
  { value: 'aurora', label: 'Aurora' },
  { value: 'mesh', label: 'Mesh' },
  { value: 'grid', label: 'Grid' },
])

export function normalizePersonalisation(input) {
  const p = input && typeof input === 'object' ? input : {}
  return {
    accent: str(p.accent, ACCENT_OPTIONS.map((o) => o.value), 'default'),
    cardStyle: str(p.cardStyle, ['rounded', 'sharp', 'glass'], 'rounded'),
    navStyle: str(p.navStyle, ['sidebar', 'tabs'], 'sidebar'),
    dashboardLayout: str(p.dashboardLayout, ['comfortable', 'compact'], 'comfortable'),
    background: str(p.background, ['none', 'aurora', 'mesh', 'grid'], 'none'),
    darkMode: bool(p.darkMode, dflt(false)),
  }
}

/* ── Zed AI assistant ─────────────────────────────────────────────────────── */

export const ZED_VOICE_OPTIONS = Object.freeze([
  { value: 'warm', label: 'Warm' },
  { value: 'bright', label: 'Bright' },
  { value: 'calm', label: 'Calm' },
  { value: 'off', label: 'No voice' },
])

export const ZED_PERSONALITY_OPTIONS = Object.freeze([
  { value: 'friendly', label: 'Friendly', hint: 'Encouraging study buddy' },
  { value: 'coach', label: 'Coach', hint: 'Direct and motivating' },
  { value: 'tutor', label: 'Tutor', hint: 'Patient and thorough' },
])

export const ZED_STYLE_OPTIONS = Object.freeze([
  { value: 'concise', label: 'Concise' },
  { value: 'balanced', label: 'Balanced' },
  { value: 'detailed', label: 'Detailed' },
])

export const ZED_SPEED_OPTIONS = Object.freeze([
  { value: 'slow', label: 'Slow' },
  { value: 'normal', label: 'Normal' },
  { value: 'fast', label: 'Fast' },
])

export function normalizeZedAiPrefs(input) {
  const p = input && typeof input === 'object' ? input : {}
  return {
    // Whether the Ask Zed entry points appear at all (the Settings
    // "Ask Zed" switch). Default on — turning the helper off is a
    // deliberate choice, not the starting state.
    enabled: bool(p.enabled, dflt(true)),
    voice: str(p.voice, ['warm', 'bright', 'calm', 'off'], 'warm'),
    personality: str(p.personality, ['friendly', 'coach', 'tutor'], 'friendly'),
    avatar: str(p.avatar, null, 'spark'),
    conversationStyle: str(p.conversationStyle, ['concise', 'balanced', 'detailed'], 'balanced'),
    speakingSpeed: str(p.speakingSpeed, ['slow', 'normal', 'fast'], 'normal'),
    language: str(p.language, LANGUAGE_OPTIONS.map((o) => o.value), 'en'),
    rememberContext: bool(p.rememberContext, dflt(true)),
  }
}

export const ZED_AVATARS = Object.freeze([
  { id: 'spark', label: 'Spark', emoji: '✨' },
  { id: 'owl', label: 'Owl', emoji: '🦉' },
  { id: 'robot', label: 'Robot', emoji: '🤖' },
  { id: 'star', label: 'Star', emoji: '⭐' },
  { id: 'rocket', label: 'Rocket', emoji: '🚀' },
  { id: 'brain', label: 'Brain', emoji: '🧠' },
])

/* ── AI Learning Assistant (personalisation the assistant learns from) ─────── */
//
// These prefs steer how the AI tailors practice — they persist under
// learnerSettings.aiAssistant and are read by the AI card + detail panel. They
// are declarations of intent (a learning goal, subjects to improve, whether to
// let AI pick practice / focus weak topics); the generators that consume them
// are entry-point cards, so nothing here fabricates a result.

export const AI_GOAL_OPTIONS = Object.freeze([
  { value: 'pass_exams', label: 'Pass my exams', emoji: '🎯' },
  { value: 'top_marks', label: 'Get top marks', emoji: '🏆' },
  { value: 'keep_streak', label: 'Study every day', emoji: '🔥' },
  { value: 'catch_up', label: 'Catch up on weak areas', emoji: '📈' },
  { value: 'stay_ahead', label: 'Stay ahead of class', emoji: '🚀' },
])

// Core CBC subjects a learner may want to prioritise. Kept as a static list so
// this module stays pure + unit-testable (no curriculum import).
export const IMPROVE_SUBJECT_OPTIONS = Object.freeze([
  { value: 'mathematics', label: 'Mathematics' },
  { value: 'english', label: 'English' },
  { value: 'science', label: 'Science' },
  { value: 'social_studies', label: 'Social Studies' },
  { value: 'ict', label: 'ICT' },
  { value: 'creative_technology', label: 'Creative & Technology' },
  { value: 'zambian_languages', label: 'Zambian Languages' },
])

const IMPROVE_SUBJECT_VALUES = IMPROVE_SUBJECT_OPTIONS.map((o) => o.value)

export function normalizeAiAssistantPrefs(input) {
  const p = input && typeof input === 'object' ? input : {}
  const subjects = Array.isArray(p.improveSubjects)
    ? p.improveSubjects.filter((s) => IMPROVE_SUBJECT_VALUES.includes(s))
    : []
  return {
    learningGoal: str(p.learningGoal, AI_GOAL_OPTIONS.map((o) => o.value), 'pass_exams'),
    improveSubjects: Array.from(new Set(subjects)),
    autoPickPractice: bool(p.autoPickPractice, dflt(true)),
    focusWeakTopics: bool(p.focusWeakTopics, dflt(true)),
  }
}

/* ── Privacy ──────────────────────────────────────────────────────────────── */

export const PROFILE_VISIBILITY_OPTIONS = Object.freeze([
  { value: 'public', label: 'Everyone', hint: 'Classmates can see your name & badges' },
  { value: 'class', label: 'My class', hint: 'Only people in your classes' },
  { value: 'private', label: 'Only me', hint: 'Hidden from leaderboards' },
])

export function normalizePrivacyPrefs(input) {
  const p = input && typeof input === 'object' ? input : {}
  return {
    dataSharing: bool(p.dataSharing, dflt(true)),
    analyticsParticipation: bool(p.analyticsParticipation, dflt(true)),
    personalisedRecommendations: bool(p.personalisedRecommendations, dflt(true)),
    profileVisibility: str(p.profileVisibility, ['public', 'class', 'private'], 'class'),
  }
}

/* ── Notification reminders (learner-friendly grouping) ───────────────────── */
//
// The notification *centre* still runs off src/engines/notification-engine/notificationPrefs.js
// (server-honoured categories + channels). This grouped set is the learner
// experience layer — granular reminders + the extra Email/SMS channels — and
// persists under learnerSettings.notifications so it syncs across devices.

export const REMINDER_GROUPS = Object.freeze([
  {
    id: 'learning',
    label: 'Learning',
    items: [
      { key: 'dailyPractice', label: 'Daily practice reminders' },
      { key: 'homework', label: 'Homework reminders' },
      { key: 'weeklyStudy', label: 'Weekly study reminder' },
      { key: 'lessons', label: 'Lesson reminders' },
    ],
  },
  {
    id: 'exams',
    label: 'Exams',
    items: [
      { key: 'upcomingExams', label: 'Upcoming exam reminders' },
      { key: 'examCountdown', label: 'Exam countdown' },
      { key: 'results', label: 'Result notifications' },
    ],
  },
  {
    id: 'teachers',
    label: 'Teachers',
    items: [
      { key: 'announcements', label: 'Teacher announcements' },
      { key: 'assignedWork', label: 'Assigned work' },
      { key: 'feedback', label: 'Feedback received' },
    ],
  },
  {
    id: 'achievements',
    label: 'Achievements',
    items: [
      { key: 'badges', label: 'Badges earned' },
      { key: 'certificates', label: 'Certificates' },
      { key: 'milestones', label: 'New milestones' },
      { key: 'leaderboard', label: 'Leaderboard updates' },
    ],
  },
])

const REMINDER_KEYS = REMINDER_GROUPS.flatMap((g) => g.items.map((i) => i.key))

export function normalizeReminderPrefs(input) {
  const p = input && typeof input === 'object' ? input : {}
  const items = p.items && typeof p.items === 'object' ? p.items : {}
  const ch = p.channels && typeof p.channels === 'object' ? p.channels : {}
  const out = { channels: {}, items: {} }
  out.channels = {
    push: bool(ch.push, dflt(true)),
    email: bool(ch.email, dflt(true)),
    sms: bool(ch.sms, dflt(false)),
  }
  for (const key of REMINDER_KEYS) out.items[key] = bool(items[key], dflt(true))
  return out
}

/* ── Parent / guardian contact ────────────────────────────────────────────── */

export const RELATIONSHIP_OPTIONS = Object.freeze([
  { value: 'parent', label: 'Parent' },
  { value: 'guardian', label: 'Guardian' },
  { value: 'grandparent', label: 'Grandparent' },
  { value: 'sibling', label: 'Sibling' },
  { value: 'other', label: 'Other' },
])

export function normalizeParentContact(input) {
  const p = input && typeof input === 'object' ? input : {}
  return {
    name: str(p.name, null, ''),
    phone: str(p.phone, null, ''),
    email: str(p.email, null, ''),
    relationship: str(p.relationship, RELATIONSHIP_OPTIONS.map((o) => o.value), 'parent'),
  }
}

/* ── Avatar categories (maps CharacterAvatar interest groups → friendly UX) ── */

export const AVATAR_CATEGORIES = Object.freeze([
  { id: 'all', label: 'All', emoji: '🎭' },
  { id: 'academic', label: 'Academic', emoji: '🎓' },
  { id: 'sports', label: 'Sports', emoji: '⚽' },
  { id: 'creative', label: 'Creative', emoji: '🎨' },
  { id: 'tech', label: 'Gaming', emoji: '🎮' },
  { id: 'leadership', label: 'Leadership', emoji: '🏅' },
])

/* ── Full learnerSettings map normalizer ──────────────────────────────────── */

export function normalizeLearnerSettings(input) {
  const p = input && typeof input === 'object' ? input : {}
  return {
    security: normalizeSecurityPrefs(p.security),
    personalisation: normalizePersonalisation(p.personalisation),
    zedAi: normalizeZedAiPrefs(p.zedAi),
    aiAssistant: normalizeAiAssistantPrefs(p.aiAssistant),
    privacy: normalizePrivacy_(p.privacy),
  }
}

// alias kept internal to avoid a name clash in re-exports
function normalizePrivacy_(v) {
  return normalizePrivacyPrefs(v)
}
