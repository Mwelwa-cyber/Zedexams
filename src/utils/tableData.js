/**
 * src/utils/tableData.js
 *
 * The Firestore boundary for a question's inline data table.
 *
 * In memory (editor state, renderers, exporters) a table is
 *   { headers: string[], rows: string[][] }
 * — but Firestore REJECTS nested arrays outright ("Nested arrays are not
 * supported"), so `rows: [[...]]` can never be written to a document. Every
 * data-table question (Assessment Studio's Data/Table block, the Test Paper
 * Studio's "Rebuild as table" scan flow) failed its save with that SDK error
 * until this boundary existed.
 *
 * Persisted shape (Firestore-safe):
 *   { headers: string[], rows: [{ cells: string[] }] }
 *
 * serializeTableData folds the editor shape into the persisted shape on
 * write; hydrateTableData unfolds either shape back to the editor shape on
 * read (it accepts both so in-memory round-trips stay lossless). No legacy
 * documents carry nested-array rows — Firestore never accepted them — so
 * readers only ever meet the {cells} shape or an in-memory array.
 *
 * Caps mirror the Zod schema: ≤ 10 columns, ≤ 16 rows, ≤ 60 chars per cell.
 * The hand-typed DataTableInputs editor stops at 6 × 12, but reconstructed
 * papers (the Assessment Paper Studio's "Rebuild as table" scan flow) legitimately
 * carry wider tables — a school timetable is 7-8 columns — and the old
 * write-side 6 × 12 clamp silently dropped those extra columns on save.
 */

export const TABLE_MAX_COLS = 10
export const TABLE_MAX_ROWS = 16
export const TABLE_MAX_CELL_CHARS = 60

function rowCells(row) {
  if (Array.isArray(row)) return row // editor / in-memory shape
  if (row && typeof row === 'object' && Array.isArray(row.cells)) return row.cells // persisted shape
  return []
}

function clampCells(row) {
  return rowCells(row)
    .map(cell => String(cell ?? '').slice(0, TABLE_MAX_CELL_CHARS))
    .slice(0, TABLE_MAX_COLS)
}

function clampHeaders(headers) {
  return headers
    .map(h => String(h ?? '').slice(0, TABLE_MAX_CELL_CHARS))
    .slice(0, TABLE_MAX_COLS)
}

/**
 * Editor shape → Firestore-safe persisted shape. Returns null when there is
 * no table (no headers), so plain questions never carry the field.
 */
export function serializeTableData(tableData) {
  if (!tableData || !Array.isArray(tableData.headers) || !tableData.headers.length) return null
  const rows = (Array.isArray(tableData.rows) ? tableData.rows : [])
    .slice(0, TABLE_MAX_ROWS)
    .map(row => ({ cells: clampCells(row) }))
  return { headers: clampHeaders(tableData.headers), rows }
}

/**
 * Persisted (or in-memory) shape → editor shape. Never throws; malformed
 * input degrades to null (no table) or empty rows.
 */
export function hydrateTableData(raw) {
  if (!raw || !Array.isArray(raw.headers) || !raw.headers.length) return null
  const rows = (Array.isArray(raw.rows) ? raw.rows : [])
    .slice(0, TABLE_MAX_ROWS)
    .map(clampCells)
  return { headers: clampHeaders(raw.headers), rows }
}
