/**
 * Teacher plan PRICES (ZMW / month-equivalent) — the single client-side
 * source for the numbers shown on /pricing and /teachers.
 *
 * Plan ids mirror the canonical catalogue in
 * functions/teacherTools/teacherPlans.js (free / pro / max). Per-tool
 * monthly limits and the daily generation caps are enforced server-side
 * (usageMeter.js); keep any cap COPY on marketing pages in sync with that
 * file rather than re-deriving it here.
 */
// `annual` is the per-month EQUIVALENT shown when the yearly toggle is
// on. The binding yearly prices are K590 and K1,490 ("two months free" =
// 10x monthly, stated on the plan cards); these round UP from 590/12 and
// 1490/12 so the displayed monthly never understates the real cost.
export const PLAN_PRICES = {
  free:  { monthly: 0,   annual: 0 },
  pro:   { monthly: 59,  annual: 50 },
  max:   { monthly: 149, annual: 125 },
}
