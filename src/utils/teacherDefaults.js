// Teacher defaults → studio seeds (pure, no Firebase, unit-testable).
//
// The Teacher Settings page saves preferences onto users/{uid}
// (teacherPreferences — see ./teacherSettingsCore.js) and schoolProfiles/{uid}
// (see ./schoolProfile.js). These helpers derive the seed shapes the studios
// consume so saved settings actually change what gets generated:
//
//   curriculumSeedFromProfile — StudioCurriculumSelector `value` seed
//   lessonStudioSeed          — Lesson Plan Studio one-shot prefill values
//   aiPrefsPromptLines        — prompt lines appended to client-built prompts
//   preferredDifficulty       — difficulty-control default for a studio
//
// SEEDING RULES (match the studios' existing one-shot semantics):
//   • Seeds are read ONCE on mount (StudioCurriculumSelector normalizes its
//     `value` prop in a state initializer; LessonPlanStudio prefills behind
//     prefilledIdentityRef). Never re-seed reactively.
//   • Only pass a seed when the host has no seed of its own (draft restore,
//     edit flow, Teaching-Kit handoff all win over saved defaults).
//   • Blank/unset preferences yield null/'' so callers can fill-only-blank.
//
// Run tests: node src/utils/teacherDefaults.test.js

import {
  normalizeTeacherPreferences,
  normalizeTeaching,
} from './teacherSettingsCore.js'
import { normalizeSchoolProfile } from './schoolProfile.js'
import { teachingLanguageLabel } from '../config/zambia.js'

// The AI Memory "Remember my preferences" toggle gates ALL auto-seeding —
// when it's off, saved defaults stay saved but stop pre-filling studios.
// (Explicit content preferences — the include switches + English variant in
// aiPrefsPromptLines — still apply: they're instructions, not memory.)
function autoSeedEnabled(userProfile) {
  return normalizeTeacherPreferences(userProfile?.teacherPreferences).ai.rememberLastUsed
}

// StudioCurriculumSelector `value` seed from the saved curriculum defaults.
// Returns null when the teacher has saved nothing useful (or turned memory
// off) — callers pass the null straight through (the selector treats it as
// "no seed"). Shape matches normalizeSelectorSeed: { curriculum, grade,
// subject } with server-ready values ('cbc'/'previous', 'G5', 'mathematics').
export function curriculumSeedFromProfile(userProfile) {
  if (!autoSeedEnabled(userProfile)) return null
  const prefs = normalizeTeacherPreferences(userProfile?.teacherPreferences)
  const { curriculum, grade, subject } = prefs.curriculum
  if (!grade && !subject) return null
  return { curriculum, grade, subject }
}

// One-shot prefill values for the Lesson Plan Studio. Only carries a field
// when the teacher saved a real preference; the caller keeps its own value
// otherwise. `medium` is the display label the studio's medium select stores
// ('Bemba'); `detail` matches formatOptions.detail exactly; `resources`
// mirrors the schoolResources level values.
export function lessonStudioSeed(userProfile, schoolProfile) {
  const prefs = normalizeTeacherPreferences(userProfile?.teacherPreferences)
  const school = normalizeSchoolProfile(schoolProfile)
  if (!autoSeedEnabled(userProfile)) {
    // Memory off → nothing pre-fills; reflection keeps the studio default.
    return { medium: '', detail: '', includeLessonEvaluation: true, resources: '' }
  }
  return {
    medium: prefs.ai.teachingLanguage !== 'english'
      ? teachingLanguageLabel(prefs.ai.teachingLanguage)
      : '',
    detail: prefs.ai.planDetail !== 'standard' ? prefs.ai.planDetail : '',
    includeLessonEvaluation: prefs.ai.include.reflection,
    resources: school.resourceLevel || '',
  }
}

// Prompt lines derived from the AI preferences, appended to the studios'
// client-built user prompts. Order-stable. The include switches only emit
// EXCLUSIONS — generators include those sections by default, so "on" needs no
// line, while "off" must be stated explicitly. The English-variant line is
// always emitted (models otherwise drift to American spelling).
export function aiPrefsPromptLines(userProfile) {
  const prefs = normalizeTeacherPreferences(userProfile?.teacherPreferences)
  const { preferredEnglish, include } = prefs.ai
  const lines = []
  lines.push(
    preferredEnglish === 'american'
      ? '- Use American English spelling and vocabulary.'
      : '- Use British English spelling and vocabulary (Zambian standard).',
  )
  if (!include.competencies) lines.push('- Do not include a competencies section.')
  if (!include.specificOutcomes) lines.push('- Do not list specific learning outcomes.')
  if (!include.teachingAids) lines.push('- Do not include a teaching/learning aids section.')
  if (!include.homework) lines.push('- Do not include homework.')
  if (!include.exercises) lines.push('- Do not include practice exercises.')
  if (!include.reflection) lines.push('- Do not include a lesson reflection or evaluation section.')
  return lines
}

// Default for a studio's difficulty control. `kind` is 'assessment' or
// 'homework'; anything unset (or memory off) falls back to 'mixed' — the
// studios' own default.
export function preferredDifficulty(userProfile, kind) {
  if (!autoSeedEnabled(userProfile)) return 'mixed'
  const prefs = normalizeTeacherPreferences(userProfile?.teacherPreferences)
  return kind === 'homework' ? prefs.ai.homeworkDifficulty : prefs.ai.assessmentDifficulty
}

// Convenience for hero/summary surfaces: counts derived from the saved
// teaching assignment ({ classes, subjects } — classes prefers streams, since
// "5A + 5B" is two classes even when both are Grade 5).
export function teachingCounts(userProfile) {
  const t = normalizeTeaching(userProfile?.teaching)
  return {
    classes: t.streams.length > 0 ? t.streams.length : t.grades.length,
    subjects: t.subjects.length,
  }
}
