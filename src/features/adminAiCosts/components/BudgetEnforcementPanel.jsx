/**
 * Budget-enforcement panel for /admin/ai-costs (issue #1755 follow-up).
 *
 * Shows what the reservation-based hard ceiling is actually doing this
 * month: the armed ceiling (static or revenue-linked) vs month-to-date
 * tracked spend, the total currently held in the budget buckets, and a
 * per-provider breakdown of reservations — enforced settled spend vs
 * in-flight holds — plus released/expired counts.
 *
 * Data comes from the admin-gated `getAiBudgetEnforcement` callable (the
 * buckets are server-only in Firestore rules). Loads independently of the
 * rest of the dashboard so a hiccup here never blanks the spend charts.
 */

import { useEffect, useState } from 'react'
import { getBudgetEnforcement } from '../lib/aiBudget'
import Skeleton from '../../../shared/components/Skeleton'

const usdFmt = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 2,
})
const numFmt = new Intl.NumberFormat('en-ZM')

const PROVIDER_LABELS = {
  anthropic: 'Anthropic (generators)',
  openai: 'OpenAI (Zed chat, marking, images)',
  gemini: 'Gemini (imports, OCR, images)',
  embeddings: 'Embeddings (Qix dedup)',
  unattributed: 'Unattributed',
}

function StatusBadge({ budget }) {
  if (!budget?.enabled) {
    return (
      <span className="inline-block rounded-full border theme-border px-2.5 py-0.5 text-[11px] font-bold theme-text-muted">
        No ceiling armed
      </span>
    )
  }
  if (budget.overBudget) {
    return (
      <span className="inline-block rounded-full bg-rose-100 text-rose-700 px-2.5 py-0.5 text-[11px] font-bold">
        Over budget — AI paused
      </span>
    )
  }
  if (budget.warning) {
    return (
      <span className="inline-block rounded-full bg-amber-100 text-amber-700 px-2.5 py-0.5 text-[11px] font-bold">
        Above 80% of ceiling
      </span>
    )
  }
  return (
    <span className="inline-block rounded-full bg-emerald-100 text-emerald-700 px-2.5 py-0.5 text-[11px] font-bold">
      Enforcing — within budget
    </span>
  )
}

export default function BudgetEnforcementPanel() {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [errored, setErrored] = useState(false)

  useEffect(() => {
    let cancelled = false
    getBudgetEnforcement()
      .then((res) => { if (!cancelled) setData(res) })
      .catch((err) => {
        console.warn('[BudgetEnforcementPanel] load failed', err)
        if (!cancelled) setErrored(true)
      })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [])

  if (loading) {
    return <Skeleton className="h-40 rounded-radius-md" />
  }
  if (errored || !data) {
    return (
      <section className="theme-card border theme-border rounded-radius-md p-4">
        <p className="theme-text-muted text-[11px] uppercase tracking-wider font-bold mb-2">
          Budget enforcement
        </p>
        <p className="theme-text-muted text-sm">
          We couldn&apos;t load the budget-enforcement summary. Please refresh.
        </p>
      </section>
    )
  }

  const budget = data.budget || {}
  const providers = data.providers || []
  const ratioPct = budget.enabled
    ? Math.min(100, Math.round((budget.ratio || 0) * 100))
    : 0

  return (
    <section className="theme-card border theme-border rounded-radius-md p-4 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="theme-text-muted text-[11px] uppercase tracking-wider font-bold">
          Budget enforcement · {data.month}
        </p>
        <StatusBadge budget={budget} />
      </div>

      {budget.enabled ? (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            <div className="theme-bg-subtle rounded-radius-md p-3 text-center min-w-0">
              <p className="theme-text font-display font-black text-xl tabular-nums leading-none">
                {usdFmt.format(budget.budgetUsd || 0)}
              </p>
              <p className="theme-text-muted text-[11px] uppercase tracking-wider font-bold mt-1.5">
                Monthly ceiling
              </p>
              <p className="theme-text-muted text-[10px] mt-0.5">
                {budget.mode === 'revenue_linked' ? 'revenue-linked' : 'static'}
              </p>
            </div>
            <div className="theme-bg-subtle rounded-radius-md p-3 text-center min-w-0">
              <p className="theme-text font-display font-black text-xl tabular-nums leading-none">
                {usdFmt.format(budget.monthCostUsd || 0)}
              </p>
              <p className="theme-text-muted text-[11px] uppercase tracking-wider font-bold mt-1.5">
                Month to date
              </p>
              <p className="theme-text-muted text-[10px] mt-0.5">{ratioPct}% of ceiling</p>
            </div>
            <div className="theme-bg-subtle rounded-radius-md p-3 text-center min-w-0">
              <p className="theme-text font-display font-black text-xl tabular-nums leading-none">
                {usdFmt.format(data.reservedNowUsd || 0)}
              </p>
              <p className="theme-text-muted text-[11px] uppercase tracking-wider font-bold mt-1.5">
                Held in buckets
              </p>
              <p className="theme-text-muted text-[10px] mt-0.5">enforced spend + open holds</p>
            </div>
          </div>

          <div
            className="h-2 rounded-full theme-bg-subtle overflow-hidden"
            role="progressbar"
            aria-label="Month-to-date spend against the ceiling"
            aria-valuenow={ratioPct}
            aria-valuemin={0}
            aria-valuemax={100}
          >
            <div
              className={budget.overBudget ? 'h-full bg-rose-500' : 'h-full theme-accent-fill'}
              style={{ width: `${ratioPct}%` }}
            />
          </div>
        </>
      ) : (
        <p className="theme-text-muted text-sm">
          No monthly ceiling is armed (<span className="font-mono">AI_MONTHLY_BUDGET_USD</span> /
          revenue-linked mode unset) — spend is tracked but not limited, and no
          reservations are taken.
        </p>
      )}

      <div>
        <p className="theme-text-muted text-[11px] uppercase tracking-wider font-bold mb-2">
          Reservations by provider
          {data.partial && (
            <span className="ml-2 normal-case font-normal text-amber-600">
              (partial — some reads degraded)
            </span>
          )}
        </p>
        {providers.length === 0 ? (
          <p className="theme-text-muted text-sm">No reservations this month.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="theme-text-muted text-[11px] uppercase tracking-wider">
                  <th className="text-left font-bold py-1.5">Provider</th>
                  <th className="text-right font-bold py-1.5">Enforced spend</th>
                  <th className="text-right font-bold py-1.5">Calls</th>
                  <th className="text-right font-bold py-1.5">Open holds</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-current/10">
                {providers.map((p) => (
                  <tr key={p.provider}>
                    <td className="py-2 theme-text font-bold">
                      {PROVIDER_LABELS[p.provider] || p.provider}
                    </td>
                    <td className="py-2 text-right theme-text font-black tabular-nums whitespace-nowrap">
                      {usdFmt.format(p.settledUsd || 0)}
                    </td>
                    <td className="py-2 text-right theme-text-muted tabular-nums">
                      {numFmt.format(p.settledCount || 0)}
                    </td>
                    <td className="py-2 text-right theme-text-muted tabular-nums whitespace-nowrap">
                      {usdFmt.format(p.openUsd || 0)}
                      {p.openCount > 0 && ` (${numFmt.format(p.openCount)})`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="theme-text-muted text-[11px] mt-2">
          Hard ceiling enforced for {(data.enforcedProviders || []).join(', ') || '—'}.
          {' '}Released: {numFmt.format(data.releasedCount || 0)} ·
          Expired/reclaimed: {numFmt.format(data.expiredCount || 0)} this month.
        </p>
      </div>
    </section>
  )
}
