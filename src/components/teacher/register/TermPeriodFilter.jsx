/**
 * TermPeriodFilter — a small <select> for choosing which term/year's records to
 * view. Default "This term" follows the class's current period; other periods
 * present in the records are listed, plus "All terms". Used by the records,
 * reports and progress tabs so each term reads cleanly without losing history.
 */

import { periodsFromRecords, periodKey, formatPeriod, samePeriod } from '../../../utils/classTerms'

export default function TermPeriodFilter({ records, value, onChange, currentPeriod }) {
  const periods = periodsFromRecords(records).filter((p) => !samePeriod(p, currentPeriod))
  return (
    <label className="flex items-center gap-2 text-xs theme-text-muted">
      <span className="font-black uppercase tracking-wider">View</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="rounded-radius-md border theme-border theme-card theme-text px-2 py-1.5 text-xs font-bold"
      >
        <option value="current">This term · {formatPeriod(currentPeriod)}</option>
        {periods.map((p) => (
          <option key={periodKey(p)} value={periodKey(p)}>{formatPeriod(p)}</option>
        ))}
        <option value="all">All terms</option>
      </select>
    </label>
  )
}
