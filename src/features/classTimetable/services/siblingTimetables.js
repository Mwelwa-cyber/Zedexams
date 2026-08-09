/**
 * Sibling class-timetable loader — the Firestore side of cross-timetable
 * conflict checking. Loading is deliberately separated from the pure
 * conflict engine (src/features/classTimetable/lib/timetableConflictEngine.js): this module does
 * ONE scoped query per refresh, filters candidates deterministically on the
 * client, and hands back compact normalised timetables — the engine itself
 * never touches Firestore.
 *
 * Scope: class timetables live in aiGenerations (tool 'class_timetable'),
 * owner-scoped by security rules — so the sibling universe is the signed-in
 * teacher's other saved class timetables. Within that, siblings are the
 * documents in the SAME scheduling context: same school (normalised label —
 * the current data model has no canonical schoolId), same academic year,
 * same term, a different document id, and not deleted/superseded.
 *
 * The query is equality + createdAt ordering; the composite index
 * (ownerUid ASC, tool ASC, createdAt DESC) is committed in
 * firestore.indexes.json. Loading is bounded (newest SIBLING_QUERY_LIMIT
 * docs) so a prolific account can't stall the studio; the coverage summary
 * reports how many siblings were checked.
 */

import { collection, getDocs, limit, orderBy, query, where } from 'firebase/firestore'
import { db } from '../../../firebase/config'
import {
  isSiblingTimetableCandidate,
  normaliseTimetableForConflictCheck,
} from '../lib/timetableConflictEngine.js'

export const SIBLING_QUERY_LIMIT = 80

/**
 * Load and normalise the sibling timetables for a scheduling context.
 *
 * @param {object} context
 *   uid            owner (required)
 *   timetableId    the current timetable's saved doc id ('' while unsaved)
 *   school, year, term   the current header labels
 * @returns {Promise<{siblings:Array, fetchedCount:number, checkedAt:number}>}
 */
export async function loadSiblingTimetables({ uid, timetableId = '', school = '', year = '', term = '' } = {}) {
  if (!uid) return { siblings: [], fetchedCount: 0, checkedAt: Date.now() }

  const snap = await getDocs(query(
    collection(db, 'aiGenerations'),
    where('ownerUid', '==', uid),
    where('tool', '==', 'class_timetable'),
    orderBy('createdAt', 'desc'),
    limit(SIBLING_QUERY_LIMIT),
  ))

  const current = { timetableId, school, year, term }
  const siblings = []
  snap.forEach((docSnap) => {
    const data = docSnap.data() || {}
    const header = data.output?.header || {}
    const candidate = {
      timetableId: docSnap.id,
      school: header.school,
      year: header.year,
      term: header.term === 0 || header.term ? String(header.term) : '',
      status: data.status,
    }
    if (!isSiblingTimetableCandidate({ current, candidate })) return
    const normalised = normaliseTimetableForConflictCheck(
      {
        id: docSnap.id,
        output: data.output,
        status: data.status,
        createdAt: data.createdAt?.toMillis ? data.createdAt.toMillis() : null,
      },
    )
    if (normalised) siblings.push(normalised)
  })

  return { siblings, fetchedCount: snap.size, checkedAt: Date.now() }
}
