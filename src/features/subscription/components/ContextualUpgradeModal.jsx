import ResponsiveModal from '../../../components/ui/ResponsiveModal'

// ContextualUpgradeModal — the compact upgrade pop-up shown when a teacher
// hits a real restriction. Presentational only: PaywallHost resolves the
// scenario (via upgradeScenarios.js) and owns the bus/analytics/checkout
// wiring; this component just renders one icon, one heading, a short
// explanation, the plan summary, at most three benefits, one primary CTA and
// one secondary action — never a full pricing table. "Compare plans" links
// out to the full /pricing page for teachers who want the detail.
//
// Renders as a centred ≤440px card on desktop/tablet and a bottom sheet on
// mobile (ResponsiveModal handles the split, focus trap and safe areas).
// The actions render in ResponsiveModal's footer slot so the primary CTA
// stays pinned while the copy scrolls.
export default function ContextualUpgradeModal({
  scenario,
  onPrimary,
  onSecondary,
  onDismiss,
  onCompare,
}) {
  if (!scenario) return null

  const footer = (
    <div className="flex flex-col gap-1.5">
      <button
        type="button"
        onClick={onPrimary}
        className="w-full rounded-2xl bg-[#CF6B51] px-4 py-3 text-[15px] font-bold text-white shadow-[0_6px_18px_rgba(207,107,81,0.28)] transition-colors hover:bg-[#C5613F]"
      >
        {scenario.primaryLabel}
      </button>
      {scenario.secondary && (
        <button
          type="button"
          onClick={() => onSecondary(scenario.secondary)}
          className="w-full rounded-2xl border border-gray-200 bg-white px-4 py-2.5 text-sm font-bold text-slate-900 transition-colors hover:border-slate-400"
        >
          {scenario.secondary.label}
        </button>
      )}
      <button
        type="button"
        onClick={() => onDismiss('not-now')}
        className="w-full rounded-xl px-3 py-1.5 text-[13px] font-medium text-gray-500 transition-colors hover:text-slate-900"
      >
        {scenario.dismissLabel}
      </button>
      <div className="flex flex-wrap items-center justify-between gap-2 pt-0.5 text-xs text-gray-500">
        <button
          type="button"
          onClick={onCompare}
          className="font-semibold text-slate-700 underline underline-offset-2 hover:text-slate-900"
        >
          Compare plans
        </button>
        <span className="flex items-center gap-3">
          {scenario.footerNote}
          {/* Mobile-money trust badges — web only (priceLabel is stripped on
              native, where Google Play is the only payment surface). */}
          {scenario.planSummary?.priceLabel && (
            <span className="flex items-center gap-3">
              <span className="flex items-center gap-1.5">
                <span className="inline-block h-2.5 w-3.5 rounded-sm bg-[#FFCC00]" aria-hidden="true" />
                MoMo
              </span>
              <span className="flex items-center gap-1.5">
                <span className="inline-block h-2.5 w-3.5 rounded-sm bg-[#E60012]" aria-hidden="true" />
                Airtel
              </span>
            </span>
          )}
        </span>
      </div>
    </div>
  )

  return (
    <ResponsiveModal onClose={onDismiss} labelledBy="cup-title" footer={footer}>
      <div className="relative px-5 pt-3 pb-2 text-center sm:px-6 sm:pt-5">
        <div
          className="mx-auto mb-2.5 grid h-12 w-12 place-items-center rounded-full bg-emerald-50 text-2xl"
          aria-hidden="true"
        >
          {scenario.icon}
        </div>
        <p className="mb-1 text-[11px] font-bold uppercase tracking-[0.14em] text-orange-500">
          {scenario.tag}
        </p>
        <h2 id="cup-title" className="text-xl font-bold leading-snug text-slate-900">
          {scenario.heading}
        </h2>
        <p className="mt-2 text-sm leading-relaxed text-gray-600">{scenario.description}</p>
        {scenario.note && <p className="mt-1.5 text-xs text-gray-500">{scenario.note}</p>}

        {scenario.planSummary?.name && (
          <div className="mt-3 rounded-2xl border border-orange-100 bg-orange-50/70 px-4 py-2 text-sm text-slate-900">
            <span className="font-bold">{scenario.planSummary.name}</span>
            {scenario.planSummary.priceLabel && (
              <span className="text-gray-600"> — {scenario.planSummary.priceLabel}</span>
            )}
          </div>
        )}

        {scenario.benefits?.length > 0 && (
          <ul className="mx-auto mt-3 max-w-[320px] space-y-1.5 text-left">
            {scenario.benefits.slice(0, 3).map((benefit) => (
              <li key={benefit} className="flex gap-2.5 text-sm text-slate-800">
                <span className="mt-0.5 shrink-0 font-bold text-emerald-600" aria-hidden="true">
                  ✓
                </span>
                {benefit}
              </li>
            ))}
          </ul>
        )}
      </div>
    </ResponsiveModal>
  )
}
