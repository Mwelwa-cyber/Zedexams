/**
 * MarkColumnsEditor — shared editor for a record's mark columns
 * (label + maximum), used by the Mark Schedule, SBA and Assessment create
 * forms so they stay consistent. Pure presentational; the parent owns state.
 */

const inputCls = 'rounded-radius-md border theme-border theme-card theme-text px-2.5 py-2 text-sm'

/** Turn a label into a stable, unique column key. */
export function slugKey(label, i) {
  const base = String(label || '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '')
  return base ? `${base}_${i}` : `col_${i}`
}

/** Normalise the editor rows into persistable { key, label, max } columns. */
export function cleanColumns(columns) {
  return (columns || [])
    .map((c, i) => ({ key: slugKey(c.label, i), label: String(c.label || '').trim(), max: Number(c.max) || 0 }))
    .filter((c) => c.label && c.max > 0)
}

export default function MarkColumnsEditor({ columns, setColumns, presetButton = null }) {
  const setCol = (i, key) => (e) =>
    setColumns((cols) => cols.map((c, j) => (j === i ? { ...c, [key]: e.target.value } : c)))
  const addCol = () => setColumns((cols) => [...cols, { label: '', max: 50 }])
  const removeCol = (i) => setColumns((cols) => cols.filter((_, j) => j !== i))

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <p className="text-xs font-black theme-text-muted uppercase tracking-wider">Mark columns</p>
        {presetButton}
      </div>
      {columns.map((c, i) => (
        <div key={i} className="flex items-center gap-2">
          <input className={`${inputCls} flex-1`} placeholder="Column label" value={c.label} onChange={setCol(i, 'label')} maxLength={80} />
          <span className="theme-text-muted text-xs">out of</span>
          <input className={`${inputCls} w-20`} type="number" min={1} max={1000} value={c.max} onChange={setCol(i, 'max')} />
          {columns.length > 1 && (
            <button type="button" onClick={() => removeCol(i)} className="text-red-500 text-sm font-black px-1" aria-label="Remove column">×</button>
          )}
        </div>
      ))}
      <button type="button" onClick={addCol} className="theme-accent-text text-xs font-black">+ Add column</button>
    </div>
  )
}
