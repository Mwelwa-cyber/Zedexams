/**
 * src/utils/formValidation.js
 *
 * Friendly, field-level form validation. The product spec is explicit: a
 * validation error must name the exact field, say plainly what's wrong, and
 * the page should scroll to + highlight the offending input. No "Invalid
 * input" walls, no native browser bubbles.
 *
 * Pure helpers (no React) so the rules are unit-testable under `node`; the
 * one DOM helper (`focusFirstError`) guards `document` so it no-ops safely
 * in tests / SSR.
 *
 * Usage:
 *   const errors = validateFields(
 *     { email, password, subject },
 *     { email: ['required', 'email'], password: ['required', 'passwordPolicy'], subject: ['required'] },
 *     { subject: 'subject' },           // label overrides → "Please select a subject."
 *   )
 *   if (hasErrors(errors)) { setErrors(errors); focusFirstError(errors); return }
 */

import { passwordIssue } from './passwordPolicy.js'

// Map a field name to the friendly noun used in its message. Anything not
// listed falls back to a humanised version of the field name.
const DEFAULT_LABELS = {
  email: 'email address',
  password: 'password',
  confirmPassword: 'password confirmation',
  name: 'name',
  fullName: 'full name',
  firstName: 'first name',
  lastName: 'last name',
  phone: 'phone number',
  subject: 'subject',
  grade: 'grade',
  topic: 'topic',
  title: 'title',
}

// Fields a learner *selects* rather than *types* read better as "select"/
// "choose" than "enter".
const SELECT_FIELDS = new Set(['subject', 'grade', 'topic', 'gender', 'role', 'province'])

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function humanise(field) {
  return String(field)
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .trim()
    .toLowerCase()
}

function labelFor(field, labels) {
  return labels[field] || DEFAULT_LABELS[field] || humanise(field)
}

function isEmpty(value) {
  if (value == null) return true
  if (typeof value === 'string') return value.trim().length === 0
  if (Array.isArray(value)) return value.length === 0
  return false
}

/**
 * Validate a single value against one rule. A rule is either a string name
 * ('required', 'email') or an object ({ min: 8 }, { max: 50 }, { match:
 * 'password', value }, { pattern: RegExp, message }). Returns a friendly
 * message string, or '' when the value passes.
 */
export function validateRule(value, rule, field, labels = {}) {
  const label = labelFor(field, labels)
  const ruleName = typeof rule === 'string' ? rule : Object.keys(rule)[0]

  switch (ruleName) {
    case 'required': {
      if (!isEmpty(value)) return ''
      if (SELECT_FIELDS.has(field)) {
        const verb = field === 'grade' ? 'choose' : 'select'
        return `Please ${verb} a ${label}.`
      }
      // Email/password get their own gentle phrasing; everything else the
      // generic "cannot be blank" so we never say "Enter your subject".
      if (field === 'email') return 'Enter your email address.'
      if (field === 'password') return 'Please enter your password.'
      return `Please enter your ${label}.`
    }
    case 'email':
      if (isEmpty(value)) return ''
      return EMAIL_RE.test(String(value).trim())
        ? ''
        : 'Please enter a valid email address.'
    case 'min': {
      if (isEmpty(value)) return ''
      const min = rule.min
      if (String(value).length >= min) return ''
      if (field === 'password') {
        return `Password must contain at least ${min} characters.`
      }
      return `Your ${label} must be at least ${min} characters.`
    }
    case 'max': {
      if (isEmpty(value)) return ''
      const max = rule.max
      return String(value).length <= max
        ? ''
        : `Your ${label} must be ${max} characters or fewer.`
    }
    case 'match': {
      if (isEmpty(value)) return ''
      return value === rule.value
        ? ''
        : rule.message || `Your ${label} does not match.`
    }
    case 'pattern': {
      if (isEmpty(value)) return ''
      return rule.pattern.test(String(value))
        ? ''
        : rule.message || `Please enter a valid ${label}.`
    }
    case 'passwordPolicy': {
      // Delegates to src/utils/passwordPolicy.js, which owns the minimum
      // length AND the whitespace rules, so every surface that sets a
      // password enforces one policy. Use this INSTEAD of { min: N } on a
      // password field; a bare `min` accepts a space-padded password that
      // its owner can then never type back in.
      return passwordIssue(value)
    }
    default:
      return ''
  }
}

/**
 * Validate a whole form. `values` is the field→value map; `schema` is the
 * field→rules map (rules run in order, first failure wins per field).
 * Returns a field→message map of ONLY the fields that failed.
 */
export function validateFields(values, schema, labels = {}) {
  const errors = {}
  for (const field of Object.keys(schema)) {
    const rules = schema[field] || []
    for (const rule of rules) {
      const msg = validateRule(values[field], rule, field, labels)
      if (msg) {
        errors[field] = msg
        break
      }
    }
  }
  return errors
}

export function hasErrors(errors) {
  return !!errors && Object.keys(errors).length > 0
}

/**
 * The order fields appear in the error map drives which one we scroll to.
 * `validateFields` preserves schema order, so the first key is the
 * top-most failing field — exactly what we want to focus.
 */
export function firstErrorField(errors) {
  if (!hasErrors(errors)) return null
  return Object.keys(errors)[0]
}

/**
 * Scroll to + focus the first invalid field so the learner is taken straight
 * to the problem. Looks the element up by `name`, then `id`, then a
 * `[data-field]` hook. No-ops safely outside the browser. Returns the
 * element it focused (or null) so tests / callers can assert.
 *
 * `options.getElement` lets a caller supply a custom resolver (e.g. a ref
 * map) instead of a DOM query — also what the unit test injects.
 */
export function focusFirstError(errors, options = {}) {
  const field = firstErrorField(errors)
  if (!field) return null

  const resolve =
    options.getElement ||
    ((name) => {
      if (typeof document === 'undefined') return null
      return (
        document.querySelector(`[name="${name}"]`) ||
        document.getElementById(name) ||
        document.querySelector(`[data-field="${name}"]`)
      )
    })

  const el = resolve(field)
  if (!el) return null
  try {
    if (typeof el.scrollIntoView === 'function') {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }
    if (typeof el.focus === 'function') {
      // preventScroll so focus() doesn't fight the smooth scrollIntoView.
      el.focus({ preventScroll: true })
    }
  } catch {
    /* a detached or exotic element — best-effort only */
  }
  return el
}
