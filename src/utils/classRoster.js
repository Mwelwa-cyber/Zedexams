/**
 * classRoster — Firestore data access for a Class Register's official roster
 * (classRegisters/{classId}/roster/{rosterId}) plus bulk-import helpers.
 *
 * The roster is the single source of truth for learner names that feeds SBA,
 * Assessment Studio, mark schedules, reports, and progress — so a teacher
 * never retypes a class list. Entries can be:
 *   - typed manually,
 *   - bulk-pasted / CSV-uploaded (parsed by src/utils/rosterImport.js),
 *   - read from an .xlsx file (parsed here with jszip — already in the tree),
 *
 * Roster mutations keep the parent register's learnerCount in sync via
 * recountRegister(). All reads/writes are gated by Firestore rules on
 * teacherUid == request.auth.uid; every roster doc carries teacherUid so the
 * rule needs no parent lookup.
 */

import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDocs,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
  writeBatch,
} from 'firebase/firestore'
import { db } from '../firebase/config'
import {
  rosterEntryWriteSchema,
  rosterEntryUpdateSchema,
  coerceRosterEntry,
} from '../shared/schemas/rosterEntry'
import { parseRosterText, rowsToRoster, partitionNewRosterEntries } from './rosterImport'

function rosterCol(classId) {
  return collection(db, 'classRegisters', classId, 'roster')
}
function rosterDoc(classId, rosterId) {
  return doc(db, 'classRegisters', classId, 'roster', rosterId)
}

// ── Reads ────────────────────────────────────────────────────────

/** One-shot roster fetch, ordered by display order. */
export async function listRoster(classId) {
  const snap = await getDocs(query(rosterCol(classId), orderBy('order', 'asc')))
  return snap.docs.map((d) => ({ id: d.id, ...coerceRosterEntry(d.data()) }))
}

/** Realtime roster subscription. Returns the unsubscribe fn. */
export function subscribeRoster(classId, onData, onError) {
  return onSnapshot(
    query(rosterCol(classId), orderBy('order', 'asc')),
    (snap) => onData(snap.docs.map((d) => ({ id: d.id, ...coerceRosterEntry(d.data()) }))),
    (err) => { if (onError) onError(err) },
  )
}

// ── learnerCount upkeep ──────────────────────────────────────────

/** Recompute the parent register's learnerCount = active roster entries. */
export async function recountRegister(classId) {
  const snap = await getDocs(rosterCol(classId))
  const active = snap.docs.filter((d) => (d.data()?.status ?? 'active') === 'active').length
  await updateDoc(doc(db, 'classRegisters', classId), {
    learnerCount: active,
    updatedAt: serverTimestamp(),
  })
}

async function nextOrder(classId) {
  const snap = await getDocs(rosterCol(classId))
  return snap.docs.reduce((max, d) => Math.max(max, Number(d.data()?.order) || 0), 0) + 1
}

// ── Writes ───────────────────────────────────────────────────────

/**
 * A learner's permanent identity, minted once and carried onto every later
 * enrolment (Grade 4A/2026 → Grade 5A/2027). It is deliberately NOT the
 * enrolment document's id: the enrolment changes every year and the learner
 * does not, and joining a child's history across years is the whole point.
 *
 * `crypto.randomUUID` is available in every browser this app supports and on
 * Node 19+; the fallback exists so the module can be imported by a script or a
 * test runner without one. The fallback also draws from the Web Crypto API
 * (getRandomValues) so the id is never minted from Math.random.
 */
let noCryptoSeq = 0

export function mintLearnerId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `lrn_${crypto.randomUUID()}`
  }
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    const bytes = crypto.getRandomValues(new Uint8Array(4))
    const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
    return `lrn_${Date.now().toString(36)}-${hex}`
  }
  // No Web Crypto AT ALL — a bare script or a pre-19 Node test runner, not a
  // browser, where getRandomValues is universal. Reading a zero-filled
  // Uint8Array here (which is what an un-filled `new Uint8Array(4)` is) would
  // append a constant `00000000`, so every id minted in the same millisecond
  // would be identical while still LOOKING random. For a permanent identity
  // that SBA reads to join a learner across years, that is silent corruption,
  // which is a worse failure than the weak randomness this function exists to
  // avoid. A process-local counter keeps them distinct without Math.random.
  noCryptoSeq += 1
  return `lrn_${Date.now().toString(36)}-${noCryptoSeq.toString(36).padStart(8, '0')}`
}

/**
 * Shape one learner for a write. Kept in one place because five callers add
 * learners — the form, the paste, the file import, the capture review and the
 * account import — and a field one of them forgets is a field that silently
 * never reaches half the class list.
 *
 * `admissionDate` and `joinedClassOn` are written TOGETHER: the teacher fills
 * in one date and the attendance calculator reads the other, so keeping them
 * in step here means the register shows N/A before a learner joined without
 * anyone having filled in a second field.
 */
function toRosterPayload(classId, teacherUid, entry, order) {
  const admissionDate = entry.admissionDate ?? entry.joinedClassOn ?? null
  return rosterEntryWriteSchema.parse({
    classId,
    teacherUid,
    learnerId: entry.learnerId ?? mintLearnerId(),
    learnerNumber: entry.learnerNumber ?? '',
    admissionNumber: entry.admissionNumber ?? null,
    fullName: entry.fullName,
    gender: entry.gender ?? null,
    dateOfBirth: entry.dateOfBirth ?? null,
    parentPhone: entry.parentPhone ?? null,
    status: entry.status ?? 'active',
    admissionDate,
    joinedClassOn: entry.joinedClassOn ?? admissionDate,
    leftClassOn: entry.leftClassOn ?? null,
    previousSchool: entry.previousSchool ?? null,
    leavingReason: entry.leavingReason ?? null,
    destinationSchool: entry.destinationSchool ?? null,
    linkedUid: entry.linkedUid ?? null,
    order,
    needsReview: entry.needsReview === true,
    reviewReasons: Array.isArray(entry.reviewReasons) ? entry.reviewReasons : [],
    source: entry.source ?? 'manual',
    importSessionId: entry.importSessionId ?? null,
  })
}

export async function addRosterEntry(classId, teacherUid, entry) {
  const payload = toRosterPayload(
    classId, teacherUid, entry,
    entry.order ?? await nextOrder(classId),
  )
  const now = serverTimestamp()
  const ref = await addDoc(rosterCol(classId), { ...payload, createdAt: now, updatedAt: now })
  await recountRegister(classId)
  return ref.id
}

export async function updateRosterEntry(classId, rosterId, patch) {
  const safe = rosterEntryUpdateSchema.parse(patch)
  await updateDoc(rosterDoc(classId, rosterId), { ...safe, updatedAt: serverTimestamp() })
  if ('status' in safe) await recountRegister(classId)
}

export async function setRosterStatus(classId, rosterId, status) {
  await updateRosterEntry(classId, rosterId, { status })
}

export async function removeRosterEntry(classId, rosterId) {
  await deleteDoc(rosterDoc(classId, rosterId))
  await recountRegister(classId)
}

/**
 * Add many entries at once (CSV / paste / Excel import). Validates each row,
 * skips any that fail the schema, drops learners already on the roster (same
 * account or same name) so a re-import / double-tap doesn't silently double the
 * class list, assigns sequential order from the current max, and commits in
 * chunks (Firestore batch cap is 500). Returns { added, skipped, duplicates }.
 */
export async function bulkAddRoster(classId, teacherUid, entries) {
  // One roster read up front, reused for both duplicate detection and the
  // starting `order` (avoids a second getDocs via nextOrder).
  const existingSnap = await getDocs(rosterCol(classId))
  const existingDocs = existingSnap.docs.map((d) => d.data() || {})
  const existing = existingDocs.map((data) => ({
    fullName: data.fullName,
    linkedUid: data.linkedUid || null,
    // The school's own identifier is the strongest duplicate signal there is,
    // so a re-import cannot double a class just because a name was spelled
    // differently on the second file.
    admissionNumber: data.admissionNumber || null,
  }))
  const { fresh, duplicates } = partitionNewRosterEntries(entries, existing)
  const start = existingDocs.reduce((max, data) => Math.max(max, Number(data.order) || 0), 0) + 1

  const now = serverTimestamp()
  let added = 0
  let skipped = 0

  // Chunk to stay under the 500-write batch limit (one write per entry).
  for (let i = 0; i < fresh.length; i += 450) {
    const chunk = fresh.slice(i, i + 450)
    const batch = writeBatch(db)
    chunk.forEach((entry, j) => {
      let payload
      try {
        payload = toRosterPayload(classId, teacherUid, entry, start + i + j)
      } catch {
        skipped += 1
        return
      }
      batch.set(doc(rosterCol(classId)), { ...payload, createdAt: now, updatedAt: now })
      added += 1
    })
    await batch.commit()
  }

  await recountRegister(classId)
  return { added, skipped, duplicates }
}

// ── Excel (.xlsx) parsing — jszip + browser DOMParser, no new dep ─

/** 'A1' / 'BC12' → 0-based column index. */
function colIndexFromRef(ref) {
  const letters = String(ref || '').replace(/[0-9]+$/, '').toUpperCase()
  let n = 0
  for (let i = 0; i < letters.length; i += 1) {
    n = n * 26 + (letters.charCodeAt(i) - 64)
  }
  return n - 1
}

function parseSheetXml(xml, sharedStrings) {
  const dom = new DOMParser().parseFromString(xml, 'application/xml')
  const grid = []
  const rowEls = dom.getElementsByTagName('row')
  for (let r = 0; r < rowEls.length; r += 1) {
    const cells = []
    const cellEls = rowEls[r].getElementsByTagName('c')
    for (let c = 0; c < cellEls.length; c += 1) {
      const cell = cellEls[c]
      const col = colIndexFromRef(cell.getAttribute('r'))
      const type = cell.getAttribute('t')
      let value = ''
      if (type === 's') {
        const v = cell.getElementsByTagName('v')[0]
        const idx = v ? Number(v.textContent) : NaN
        value = Number.isInteger(idx) ? (sharedStrings[idx] ?? '') : ''
      } else if (type === 'inlineStr') {
        const t = cell.getElementsByTagName('t')[0]
        value = t ? t.textContent : ''
      } else {
        const v = cell.getElementsByTagName('v')[0]
        value = v ? v.textContent : ''
      }
      cells[col] = value
    }
    grid.push(Array.from(cells, (x) => x ?? ''))
  }
  return grid
}

/**
 * Parse an uploaded .xlsx File/Blob into the same preview shape as
 * parseRosterText. Reads the first worksheet only. Browser-only (uses jszip
 * + DOMParser); never imported by the node test suite.
 */
export async function parseRosterXlsx(file) {
  const { default: JSZip } = await import('jszip')
  const zip = await JSZip.loadAsync(file)

  // Shared strings (most text cells reference this table).
  const sharedStrings = []
  const sstFile = zip.file('xl/sharedStrings.xml')
  if (sstFile) {
    const sstXml = await sstFile.async('string')
    const dom = new DOMParser().parseFromString(sstXml, 'application/xml')
    const siEls = dom.getElementsByTagName('si')
    for (let i = 0; i < siEls.length; i += 1) {
      // A shared string may be split across multiple <t> runs.
      const tEls = siEls[i].getElementsByTagName('t')
      let s = ''
      for (let j = 0; j < tEls.length; j += 1) s += tEls[j].textContent
      sharedStrings.push(s)
    }
  }

  // First worksheet. Conventionally sheet1.xml; fall back to the first match.
  let sheet = zip.file('xl/worksheets/sheet1.xml')
  if (!sheet) {
    const matches = zip.file(/^xl\/worksheets\/sheet\d+\.xml$/)
    sheet = matches && matches[0]
  }
  if (!sheet) throw new Error('Could not find a worksheet in the Excel file.')

  const sheetXml = await sheet.async('string')
  const grid = parseSheetXml(sheetXml, sharedStrings)
  return rowsToRoster(grid)
}

/** Dispatch a File to the right parser by extension. */
export async function parseRosterFile(file) {
  const name = (file?.name || '').toLowerCase()
  if (name.endsWith('.xlsx')) return parseRosterXlsx(file)
  const text = await file.text()
  return parseRosterText(text)
}
