/**
 * The assessment band governing the currently-selected level.
 *
 * Renders immediately with the published defaults (so the question-type chips
 * are never briefly empty or briefly wrong), then swaps to the Firestore
 * document once it resolves. Both come from the same shape, so the swap is
 * invisible unless someone has actually edited a band.
 */

import { useEffect, useState } from 'react'
import { bandForLevel, seedBandForLevel } from '../../../utils/assessmentBandService'

/**
 * @param {string} level a level value/label/alias ('ECE_B', '4', 'G10', 'Form 3')
 * @returns {{band: object|null, loading: boolean}}
 */
export function useAssessmentBand(level) {
  const [band, setBand] = useState(() => seedBandForLevel(level))
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    // Re-seed synchronously on a level change so the chips never show the
    // previous band's types while the read is in flight.
    setBand(seedBandForLevel(level))
    setLoading(true)
    bandForLevel(level)
      .then((resolved) => { if (!cancelled) { setBand(resolved); setLoading(false) } })
      .catch(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [level])

  return { band, loading }
}
