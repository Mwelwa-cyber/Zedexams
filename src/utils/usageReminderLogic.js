// usageReminderLogic — decides whether (and which) soft usage reminder to
// show BEFORE a teacher hits a limit, so the paywall never arrives as a
// surprise. Pure on purpose (no imports): the banner component supplies the
// live usage snapshot from useTeacherUsage plus the feature-label map, so
// this decision table tests without any Firebase or React.
//
// Rules (mirrors the paywall's own thresholds, but earlier):
//   - fires at >= 80% of an allowance, or when exactly 1 is left — small
//     caps (e.g. 2 lesson plans/month on Free) never reach 80% before the
//     final unit, and "1 left" is precisely the warning that matters. Only
//     after at least one has been used (a taster cap of 1 shouldn't warn
//     before the teacher has done anything). At the limit itself the
//     contextual paywall takes over, so the reminder stays quiet;
//   - Max teachers have nowhere to upgrade to → never reminded;
//   - a purchased top-up credit means they can already continue → quiet;
//   - a tool-specific check (inside a studio) outranks the daily cap;
//     the dashboard variant scans every metered feature and picks the most
//     exhausted one.

export const REMINDER_THRESHOLD = 0.8

/**
 * @param {object} data   projection from useTeacherUsage:
 *   { plan, used: {feature: n}, caps: {feature: n}, daily, today, credits, resetDays }
 * @param {object} opts
 * @param {string} [opts.feature]  restrict to one feature key (studio variant)
 * @param {object} [opts.labels]   feature key → human label map
 * @returns {{scope, kind, remaining, title, body}|null}
 */
export function resolveUsageReminder(data, { feature = null, labels = {} } = {}) {
  if (!data) return null
  if (data.plan === 'max') return null
  if (Number(data.credits || 0) > 0) return null

  const resetDays = Number(data.resetDays) || 0
  const resetNote = resetDays > 0 ? ` Your allowance resets in ${resetDays} day${resetDays === 1 ? '' : 's'}.` : ''

  function monthlyCandidate(f) {
    const cap = Number(data.caps?.[f] ?? 0)
    const used = Number(data.used?.[f] ?? 0)
    if (cap <= 0 || used <= 0 || used >= cap) return null
    const ratio = used / cap
    const remaining = cap - used
    if (ratio < REMINDER_THRESHOLD && remaining !== 1) return null
    const label = labels[f] || f
    return {
      scope: `monthly:${f}`,
      kind: 'monthly',
      remaining,
      ratio,
      title: remaining === 1 ? `Almost out of ${label} — 1 left this month` : `Almost out of ${label} — ${remaining} left this month`,
      body: `Upgrade to continue preparing teaching materials without interruption.${resetNote}`,
    }
  }

  function dailyCandidate() {
    const cap = Number(data.daily || 0)
    const used = Number(data.today || 0)
    if (cap <= 0 || used <= 0 || used >= cap) return null
    const ratio = used / cap
    const remaining = cap - used
    if (ratio < REMINDER_THRESHOLD && remaining !== 1) return null
    return {
      scope: 'daily',
      kind: 'daily',
      remaining,
      ratio,
      title: `${remaining} generation${remaining === 1 ? '' : 's'} remaining today`,
      body: 'Upgrade for a higher daily allowance and keep preparing without interruption.',
    }
  }

  if (feature) {
    // Studio variant: this tool's monthly allowance first, else the daily cap.
    return monthlyCandidate(feature) || dailyCandidate()
  }

  // Dashboard variant: the most exhausted monthly allowance, else daily.
  const monthly = Object.keys(data.caps || {})
      .map(monthlyCandidate)
      .filter(Boolean)
      .sort((a, b) => b.ratio - a.ratio)[0] || null
  return monthly || dailyCandidate()
}
