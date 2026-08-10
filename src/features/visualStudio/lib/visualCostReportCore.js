/**
 * Pure roll-up helpers for the Visual Studio image-cost report — no Firebase
 * imports, so they unit-test under plain `node`. The Firestore read lives in
 * visualCostReport.js, which re-exports these.
 */

// Rough per-image USD estimates (see functions/teacherTools/generateDiagram.js
// cost note: Recraft ~$0.04, gpt-image-1 medium ~$0.06, Kie ~$0.05).
const COST = { recraft: 0.04, openai: 0.06, kie: 0.05, default: 0.04 }

/** Estimate the USD cost of one generation from its provider/model string. */
export function estimateCost(generator) {
  const g = String(generator || '').toLowerCase()
  if (g.includes('recraft')) return COST.recraft
  if (g.includes('openai') || g.includes('gpt')) return COST.openai
  if (g.includes('kie') || g.includes('nano')) return COST.kie
  return COST.default
}

/**
 * Roll up a list of aiGenerationLog rows. Pure.
 * @param {Array<{uid?:string, generator?:string, provider?:string}>} logs
 */
export function aggregateImageCosts(logs = []) {
  const byGen = new Map()
  const byTeacher = new Map()
  let total = 0
  let totalCost = 0
  for (const log of logs) {
    if (!log) continue
    const gen = String(log.generator || log.provider || 'unknown')
    const cost = estimateCost(gen)
    total += 1
    totalCost += cost
    const g = byGen.get(gen) || { generator: gen, count: 0, cost: 0 }
    g.count += 1; g.cost += cost; byGen.set(gen, g)
    const uid = String(log.uid || 'unknown')
    const t = byTeacher.get(uid) || { uid, count: 0, cost: 0 }
    t.count += 1; t.cost += cost; byTeacher.set(uid, t)
  }
  const round = (rows) => rows.map((r) => ({ ...r, cost: Number(r.cost.toFixed(2)) }))
  const byCount = (a, b) => b.count - a.count
  return {
    total,
    totalCost: Number(totalCost.toFixed(2)),
    byGenerator: round(Array.from(byGen.values()).sort(byCount)),
    byTeacher: round(Array.from(byTeacher.values()).sort(byCount)),
  }
}
