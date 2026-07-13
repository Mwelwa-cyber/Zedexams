// Pure display helpers for the Zambian mobile-money number field.
//
// This module only shapes what the teacher SEES while typing
// ("0977 740 465"). Operator detection lives in utils/lenco.js and the
// authoritative normalisation for the actual charge happens server-side in
// functions/lencoService.js — keep this dependency-free so it tests without
// any Firebase imports.

/**
 * The national digits of a Zambian mobile number as typed/pasted so far,
 * capped at 10. Accepts international forms: "+260 977 740 465" and
 * "977740465" both become "0977740465". Letters and symbols are dropped.
 */
export function zambianPhoneDigits(raw) {
  let d = String(raw || '').replace(/\D/g, '')
  // "+260 97…" pasted → strip the country code once there's more than a
  // full national number's worth of digits behind it.
  if (d.startsWith('260') && d.length > 10) d = d.slice(3)
  // International form drops the trunk 0 → re-add it for ZM mobile (7/9).
  if (d.length >= 9 && /^[79]/.test(d)) d = '0' + d
  return d.slice(0, 10)
}

/**
 * Group the digits for readability: "0977740465" → "0977 740 465".
 * Safe to call on every keystroke — partial input formats progressively.
 */
export function formatZambianPhoneInput(raw) {
  const d = zambianPhoneDigits(raw)
  if (!d) return ''
  return [d.slice(0, 4), d.slice(4, 7), d.slice(7, 10)].filter(Boolean).join(' ')
}
