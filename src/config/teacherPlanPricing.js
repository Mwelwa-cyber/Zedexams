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
// on. The binding yearly prices are K790 and K1,990 ("two months free" =
// 10x monthly, stated on the plan cards); these round UP from 790/12 and
// 1990/12 so the displayed monthly never understates the real cost.
export const PLAN_PRICES = {
  free:  { monthly: 0,   annual: 0 },
  pro:   { monthly: 79,  annual: 66 },
  max:   { monthly: 199, annual: 166 },
}
