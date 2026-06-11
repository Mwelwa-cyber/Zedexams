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
export const PLAN_PRICES = {
  free:  { monthly: 0,   annual: 0 },
  pro:   { monthly: 79,  annual: 65 },
  max:   { monthly: 199, annual: 165 },
}
