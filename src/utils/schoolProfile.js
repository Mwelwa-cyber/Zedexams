// School Profile — pure helpers (no Firebase, unit-testable).
//
// A teacher's saved school branding lives in schoolProfiles/{uid}: the logo,
// school name, and the default paper duration + cover instructions. These
// helpers normalise the stored shape and apply it as DEFAULTS onto a fresh
// paper's header so new papers print pre-branded. The Firestore + Storage IO
// lives in ./schoolProfileService; everything here is pure so it can be
// covered by the plain-node test suite (schoolProfile.test.js).

const MAX_NAME = 200
const MAX_URL = 2000
const MAX_INSTRUCTIONS = 2000

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
    schoolLogoUrl: trimStr(d.schoolLogoUrl, MAX_URL),
    schoolLogoTransform:
      d.schoolLogoTransform && typeof d.schoolLogoTransform === 'object'
        ? d.schoolLogoTransform
        : null,
    defaultDuration: positiveIntOrNull(d.defaultDuration),
    // Instructions keep their internal whitespace (multi-line block) — only
    // the length is capped.
    defaultCoverInstructions:
      typeof d.defaultCoverInstructions === 'string'
        ? d.defaultCoverInstructions.slice(0, MAX_INSTRUCTIONS)
        : '',
  }
}

// True when the profile carries no usable branding at all.
export function isEmptySchoolProfile(profile) {
  const p = normalizeSchoolProfile(profile)
  return (
    !p.schoolName &&
    !p.schoolLogoUrl &&
    !p.defaultDuration &&
    !p.defaultCoverInstructions
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
    schoolLogoUrl: p.schoolLogoUrl || f.schoolLogoUrl || '',
    schoolLogoTransform: p.schoolLogoTransform || f.schoolLogoTransform || null,
    duration: p.defaultDuration || f.duration,
    coverInstructions: p.defaultCoverInstructions || f.coverInstructions || '',
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
    schoolLogoTransform:
      f.schoolLogoTransform || p?.schoolLogoTransform || r?.schoolLogoTransform || null,
  }
}

// Derive a branding profile from the teacher's recent papers — the one-time
// migration source so existing teachers don't lose their logo/name when they
// first open the School Profile form. `papers` must be newest-first; the most
// recent paper carrying each field wins.
export function brandingFromPapers(papers = []) {
  const list = Array.isArray(papers) ? papers : []
  const withSchool = list.find(p => p && hasText(p.schoolName))
  const withLogo = list.find(p => p && hasText(p.schoolLogoUrl))
  const withDuration = list.find(p => p && positiveIntOrNull(p.duration))
  if (!withSchool && !withLogo) return null
  return normalizeSchoolProfile({
    schoolName: withSchool?.schoolName || '',
    schoolLogoUrl: withLogo?.schoolLogoUrl || '',
    schoolLogoTransform: withLogo?.schoolLogoTransform || null,
    defaultDuration: withDuration ? withDuration.duration : null,
    defaultCoverInstructions: '',
  })
}
