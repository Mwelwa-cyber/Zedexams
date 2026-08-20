/**
 * Demo-trial batch rules — pure, no React, no DOM, no Firebase.
 *
 * Lifted verbatim out of `BulkGrantTrialsPanel.jsx` during the adminTrials
 * migration (docs/architecture.md Phase 4, Wave 4). Every rule here is the one
 * the panel already applied, in the order it already applied it, down to the
 * message strings the operator reads — a migration is a move, and the validation
 * order is observable: an empty list and a sixty-name list are both invalid, and
 * which one the operator is told about first is behaviour.
 *
 * It gets a test here that it never had inline. Pinning pure logic as it is
 * lifted is what stops a move becoming a regression, and the two rules most
 * worth pinning are the ones that guard money and identity: the 50-account
 * ceiling, and the day clamp below.
 */

import { passwordIssue } from '../../../utils/passwordPolicy.js'

/** The plans a demo trial may be granted on. */
export const PLAN_OPTIONS = [
  { id: 'weekly', label: 'Weekly (7 days)' },
  { id: 'monthly', label: 'Monthly (30 days)' },
]

/** One batch may not exceed this many accounts — each one is a real Auth user. */
export const MAX_BATCH = 50

export const DEFAULT_DAYS = 30
export const MIN_DAYS = 1
export const MAX_DAYS = 365

export const DEFAULT_SCHOOL = 'Demo School'

/** The domain a generated address is minted under when none is supplied. */
export const DEMO_EMAIL_DOMAIN = 'zedexams.com'

/**
 * Mirrors `functions/index.js#bulkGrantDemoTrials` so the email preview the
 * operator sees matches what the server will actually use. Drifting from the
 * server here does not fail — it silently shows the operator an address that
 * is not the one created.
 */
export function slugify(name) {
  return String(name || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9\s.-]/g, '')
    .trim()
    .replace(/\s+/g, '.')
    .replace(/\.+/g, '.')
    .replace(/^\.+|\.+$/g, '')
}

/**
 * Accept "Name" or "Name, email@domain" per line. Comments (#…) and blank
 * lines are ignored.
 */
export function parseNamesBlob(blob) {
  return String(blob || '')
    .split(/\r?\n/)
    .map(s => s.trim())
    .filter(s => s && !s.startsWith('#'))
    .map(line => {
      const [namePart, emailPart] = line.split(',').map(s => (s || '').trim())
      return { name: namePart, email: emailPart || '' }
    })
}

/**
 * What the operator is shown before confirming: the address each learner will
 * actually get. A name that slugifies to nothing has no address to preview, and
 * says so rather than previewing `@zedexams.com`.
 */
export function buildPreviewRows(blob) {
  return parseNamesBlob(blob).map(({ name, email }) => {
    const slug = slugify(name)
    return {
      name,
      email: email || (slug ? `${slug}@${DEMO_EMAIL_DOMAIN}` : '(invalid name)'),
    }
  })
}

/**
 * Validate a batch before it is sent. Returns `{ error }` with the operator's
 * message, or `{ entries, daysNum }` ready for the callable.
 *
 * The day clamp is not cosmetic. The number input hands back a string, so an
 * emptied field arrives as `''` → `Number('') || 30`; without the fallback it
 * would send 0 days and grant a trial that expires the instant it is created.
 */
export function validateBatch({ namesBlob, password, days }) {
  const entries = parseNamesBlob(namesBlob)
  if (entries.length === 0) {
    return { error: '❌ Add at least one name (one per line).' }
  }
  if (entries.length > MAX_BATCH) {
    return { error: `❌ Max ${MAX_BATCH} accounts per batch — split the list.` }
  }
  // A blank shared password randomises one per account; a supplied one is
  // typed into every account in the batch, so the same policy every other
  // password-setting surface uses applies here too. Edge whitespace matters
  // MORE here, not less: an operator who pastes a padded password mints a
  // whole cohort of accounts nobody can sign into, and the credentials CSV
  // they hand out will not show them the space.
  if (password) {
    const policyIssue = passwordIssue(password)
    if (policyIssue) return { error: `❌ Shared password — ${policyIssue}` }
  }
  const daysNum = Math.max(MIN_DAYS, Math.min(MAX_DAYS, Number(days) || DEFAULT_DAYS))
  return { entries, daysNum }
}

/** The payload shape `bulkGrantDemoTrials` expects. */
export function buildGrantPayload({ entries, daysNum, grade, plan, school, password }) {
  const payload = {
    entries: entries.map(e => ({ name: e.name, email: e.email || undefined })),
    grade: Number(grade),
    days: daysNum,
    plan,
    school: String(school || '').trim() || DEFAULT_SCHOOL,
  }
  if (password) payload.password = password
  return payload
}

/** Counts under the results table. `reused` is a success: the account existed. */
export function summariseResults(rows) {
  const list = Array.isArray(rows) ? rows : []
  return {
    ok: list.filter(r => r.status === 'created' || r.status === 'reused').length,
    err: list.filter(r => r.status === 'error').length,
    total: list.length,
  }
}

export const CREDENTIALS_CSV_HEADER = ['name', 'email', 'password', 'uid', 'status', 'error']

function csvEscape(v) {
  const s = String(v ?? '')
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

/**
 * The credentials CSV, as text.
 *
 * Deliberately NOT routed through `src/utils/csvExport.js`: that helper derives
 * its headers from the keys of the first row, so a batch whose first row is a
 * success (no `error` key) would drop the error column for every failed row
 * under it. This writer states the six columns, so every row has all six
 * whatever the batch happened to contain.
 */
export function toCredentialsCsv(rows) {
  const list = Array.isArray(rows) ? rows : []
  const lines = [CREDENTIALS_CSV_HEADER.join(',')]
  for (const r of list) {
    lines.push(CREDENTIALS_CSV_HEADER.map(k => csvEscape(r[k])).join(','))
  }
  return lines.join('\n') + '\n'
}

/** `demo-trial-credentials-2026-08-12.csv` — dated, because passwords are one-shot. */
export function credentialsFilename(now = new Date()) {
  return `demo-trial-credentials-${now.toISOString().slice(0, 10)}.csv`
}
