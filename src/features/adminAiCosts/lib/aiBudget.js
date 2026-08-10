/**
 * aiBudget — client helper for the admin-only budget-enforcement summary.
 *
 * Wraps the `getAiBudgetEnforcement` callable (server-side admin-gated).
 * The reservation buckets it reports on are server-only in Firestore rules,
 * so this callable is the dashboard's only read path to them.
 *
 * Returns:
 *   {
 *     month,                       // 'YYYY-MM'
 *     budget,                      // getBudgetStatus() shape (enabled, mode,
 *                                  //   budgetUsd, monthCostUsd, ratio, …)
 *     reservedNowUsd,              // total held in the budget buckets
 *     enforcedProviders,           // providers on the hard reservation gate
 *     providers: [{ provider, settledUsd, settledCount, openUsd, openCount }],
 *     releasedCount, expiredCount, // month-wide failure/reclaim counts
 *     partial,                     // true when an aggregate read degraded
 *   }
 */

import { getFunctions, httpsCallable } from 'firebase/functions'
import app from '../../../firebase/config'

const fns = getFunctions(app, 'us-central1')
const getAiBudgetEnforcementCallable = httpsCallable(fns, 'getAiBudgetEnforcement')

export async function getBudgetEnforcement() {
  const result = await getAiBudgetEnforcementCallable({})
  return result.data
}
