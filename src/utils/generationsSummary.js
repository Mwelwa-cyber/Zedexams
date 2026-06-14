/**
 * Pure (Firebase-free) reducers over aiGenerations rows.
 *
 * Kept separate from adminGenerationsService.js — which imports the Firestore
 * SDK and firebase/config — so this logic can be unit-tested with plain node
 * and reused without dragging in Firebase init.
 */

/**
 * A failed generation only "needs attention" until an admin acknowledges it.
 * Resolved failures are kept for the audit trail (status + errorMessage stay
 * intact) but excluded from the dashboard's attention count.
 */
export function isUnresolvedFailure(row) {
  return Boolean(row) && row.status === 'failed' && !row.adminResolved
}

/**
 * Stats reducer over a list of generation rows. Counts only unresolved
 * failures so a one-off, acknowledged failure stops nagging the dashboard.
 */
export function summarizeGenerationRows(rows = []) {
  const last24hCutoff = Date.now() - 24 * 60 * 60 * 1000

  let totalCostCents = 0
  let last24hCount = 0
  let failedCount = 0
  let flaggedCount = 0
  const byTool = {}

  for (const r of rows) {
    const ts = r.createdAt?.toMillis?.() || r.createdAt?.seconds * 1000 || 0
    if (ts >= last24hCutoff) last24hCount++
    totalCostCents += Number(r.costUsdCents || 0)
    if (isUnresolvedFailure(r)) failedCount++
    if (r.status === 'flagged' || r.visibility === 'flagged_for_review') flaggedCount++
    byTool[r.tool] = (byTool[r.tool] || 0) + 1
  }

  return {
    total: rows.length,
    last24h: last24hCount,
    failed: failedCount,
    flagged: flaggedCount,
    totalCostUsd: (totalCostCents / 100).toFixed(2),
    byTool,
  }
}
