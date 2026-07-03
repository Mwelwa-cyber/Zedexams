// School Profile — pure helpers (no Firebase, unit-testable).
//
// A teacher's saved school branding lives in schoolProfiles/{uid}: the school
// name and identity (EMIS number, province, district, type, address, motto),
// the default paper duration + cover instructions, the school's resource
// level, and uploaded branding assets (logo, teacher signature, letterhead).
// These helpers normalise the stored shape and apply it as
// DEFAULTS onto a fresh paper's header so new papers print pre-branded. The
// Firestore IO lives in ./schoolProfileService; everything here is pure so it
// can be covered by the plain-node test suite (schoolProfile.test.js).

const MAX_NAME = 200
const MAX_INSTRUCTIONS = 2000
const MAX_SHORT = 80
const MAX_ADDRESS = 300
const MAX_MOTTO = 160
const MAX_FOOTER = 300
const MAX_URL = 2000
const MAX_PATH = 500

// How well-equipped the school is — mirrors src/config/schoolResources.js
// values. Stored here (a property of the school, not the teacher) and used to
// seed the studios' resource-level selects.
export const SCHOOL_RESOURCE_LEVELS = ['low', 'basic', 'full']

function hasText(v) {
  return typeof v === 'string' && v.trim().length > 0
}

function trimStr(v, max) {
  return typeof v === 'string' ? v.trim().slice(0, max) : ''
}

function positiveIntOrNull(v) {
  const n = Number(v)
  return Number.isFinite(n) && n > 0 ? Math.round(n) : null
}

// Canonical saved shape. Blanks stay '' / null so callers can `|| fallback`.
export function normalizeSchoolProfile(data = {}) {
  const d = data && typeof data === 'object' ? data : {}
  return {
    schoolName: trimStr(d.schoolName, MAX_NAME),
    defaultDuration: positiveIntOrNull(d.defaultDuration),
    // Instructions keep their internal whitespace (multi-line block) — only
    // the length is capped.
    defaultCoverInstructions:
      typeof d.defaultCoverInstructions === 'string'
        ? d.defaultCoverInstructions.slice(0, MAX_INSTRUCTIONS)
        : '',
    // School identity (Teacher Settings → School panel).
    emisNumber: trimStr(d.emisNumber, 40),
    province: trimStr(d.province, 40),
    district: trimStr(d.district, MAX_SHORT),
    schoolType: trimStr(d.schoolType, 40),
    address: trimStr(d.address, MAX_ADDRESS),
    department: trimStr(d.department, MAX_SHORT),
    motto: trimStr(d.motto, MAX_MOTTO),
    footerText: trimStr(d.footerText, MAX_FOOTER),
    // '' means "not set" — studios fall back to their own default ('basic').
    resourceLevel: SCHOOL_RESOURCE_LEVELS.includes(d.resourceLevel) ? d.resourceLevel : '',
    // Branding assets (Documents & Branding panel) — Storage download URL +
    // the object path so the panel can overwrite/delete in place.
    schoolLogoUrl: trimStr(d.schoolLogoUrl, MAX_URL),
    schoolLogoPath: trimStr(d.schoolLogoPath, MAX_PATH),
    teacherSignatureUrl: trimStr(d.teacherSignatureUrl, MAX_URL),
    teacherSignaturePath: trimStr(d.teacherSignaturePath, MAX_PATH),
    letterheadUrl: trimStr(d.letterheadUrl, MAX_URL),
    letterheadPath: trimStr(d.letterheadPath, MAX_PATH),
  }
}

// Normalize ONLY the keys the caller actually provided — the write-side
// companion to normalizeSchoolProfile. saveSchoolProfile writes this partial
// payload with setDoc merge:true, so a caller editing one slice (the Branding
// upload, the legacy settings page's three fields, one panel of the Teacher
// Settings) can never blank the other 17 fields by omission. Without this,
// every save wrote the FULL normalized shape ('' for anything absent) and
// merge protected nothing — a blank form after a failed read wiped the whole
// saved school identity on the next Save.
export function normalizeSchoolProfilePartial(data = {}) {
  const d = data && typeof data === 'object' ? data : {}
  const normalized = normalizeSchoolProfile(d)
  const out = {}
  for (const key of Object.keys(normalized)) {
    if (key in d) out[key] = normalized[key]
  }
  return out
}

// True when the profile carries no usable branding at all. Only the fields
// that would visibly brand a paper count — a saved export-format preference
// alone doesn't make the profile "set up".
export function isEmptySchoolProfile(profile) {
  const p = normalizeSchoolProfile(profile)
  return (
    !p.schoolName &&
    !p.defaultDuration &&
    !p.defaultCoverInstructions &&
    !p.emisNumber &&
    !p.address &&
    !p.motto &&
    !p.schoolLogoUrl
  )
}

// Apply a saved profile onto a FRESH/untouched paper header. The profile's
// value wins wherever it has one; otherwise the form's value is kept. Callers
// only run this on an untouched paper (no title, no school name, empty starter
// section), so "profile wins" never clobbers anything the teacher typed.
export function applySchoolProfileDefaults(form, profile) {
  const f = form || {}
  if (!profile) return f
  const p = normalizeSchoolProfile(profile)
  return {
    ...f,
    schoolName: p.schoolName || f.schoolName || '',
    duration: p.defaultDuration || f.duration,
    coverInstructions: p.defaultCoverInstructions || f.coverInstructions || '',
    schoolLogoUrl: p.schoolLogoUrl || f.schoolLogoUrl || '',
    motto: p.motto || f.motto || '',
    address: p.address || f.address || '',
    emisNumber: p.emisNumber || f.emisNumber || '',
    footerText: p.footerText || f.footerText || '',
  }
}

// Fill only the BLANK school header fields of an AI-generated paper from the
// saved profile, falling back to branding scanned from recent papers. Unlike
// applySchoolProfileDefaults, anything the teacher already set on the paper
// (form wins) is preserved — the AI flow may run on a partly-filled paper.
export function brandingForAiPaper(form, profile, recentBranding) {
  const f = form || {}
  const p = profile ? normalizeSchoolProfile(profile) : null
  const r = recentBranding ? normalizeSchoolProfile(recentBranding) : null
  const pick = (formVal, key) =>
    hasText(formVal) ? formVal : (p?.[key] || r?.[key] || formVal || '')
  return {
    schoolName: pick(f.schoolName, 'schoolName'),
    schoolLogoUrl: pick(f.schoolLogoUrl, 'schoolLogoUrl'),
    motto: pick(f.motto, 'motto'),
    address: pick(f.address, 'address'),
    emisNumber: pick(f.emisNumber, 'emisNumber'),
    footerText: pick(f.footerText, 'footerText'),
  }
}

// Derive a branding profile from the teacher's recent papers — the one-time
// migration source so existing teachers don't lose their school name when they
// first open the School Profile form. `papers` must be newest-first; the most
// recent paper carrying each field wins.
export function brandingFromPapers(papers = []) {
  const list = Array.isArray(papers) ? papers : []
  const withSchool = list.find(p => p && hasText(p.schoolName))
  const withDuration = list.find(p => p && positiveIntOrNull(p.duration))
  if (!withSchool) return null
  return normalizeSchoolProfile({
    schoolName: withSchool?.schoolName || '',
    defaultDuration: withDuration ? withDuration.duration : null,
    defaultCoverInstructions: '',
  })
}
