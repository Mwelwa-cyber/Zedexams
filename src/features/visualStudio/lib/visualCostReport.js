/**
 * Visual Studio AI image-cost report (brief item 12 / 13).
 *
 * Reads the server-written `aiGenerationLog` (one row per generated diagram)
 * and rolls up an ESTIMATED spend by provider and by teacher. The log doesn't
 * store a price, so cost is estimated from the provider/model — good enough for
 * an admin "where is the image budget going" view, not an invoice.
 *
 * The pure roll-up lives in visualCostReportCore.js (unit-tested under node);
 * this module adds the Firestore read (admin-only via rules).
 */

import { collection, getDocs, query, orderBy, limit } from 'firebase/firestore'
import { db } from '../../../firebase/config'
import { aggregateImageCosts } from './visualCostReportCore'

export { estimateCost, aggregateImageCosts } from './visualCostReportCore'

/**
 * Admin: fetch + aggregate the most recent image generations.
 * @param {{ max?: number }} [opts]
 */
export async function fetchImageCostReport({ max = 500 } = {}) {
  try {
    const snap = await getDocs(query(
      collection(db, 'aiGenerationLog'),
      orderBy('createdAt', 'desc'),
      limit(max),
    ))
    const logs = snap.docs.map((d) => d.data()).filter((x) => String(x?.tool || '') === 'diagram')
    return { ...aggregateImageCosts(logs), sampled: snap.size, error: null }
  } catch (err) {
    console.error('fetchImageCostReport failed', err)
    return { total: 0, totalCost: 0, byGenerator: [], byTeacher: [], sampled: 0, error: err?.message || 'Could not load costs.' }
  }
}
