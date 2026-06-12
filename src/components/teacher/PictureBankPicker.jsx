// Picture bank picker — modal teachers open from the Assessment Studio's
// image-attach flow. Search the admin-curated bank by name/keyword,
// optionally narrowed by subject, click a tile to attach. If nothing
// matches, the teacher falls back to the studio's existing upload or AI
// diagram options.

import { useEffect, useMemo, useRef, useState } from 'react'
import { TEACHER_SUBJECTS } from '../../utils/teacherTools'
import { searchActivePictures, resolvePictureUrl } from '../../utils/pictureBankService'

export default function PictureBankPicker({ subject = '', onSelect, onClose }) {
  const [term, setTerm] = useState('')
  // The studio passes display subjects ("Integrated Science"); normalise to
  // the canonical key and fall back to 'all' when it isn't a known subject.
  const [subjectFilter, setSubjectFilter] = useState(() => {
    const key = String(subject || '').toLowerCase().trim().replace(/\s+/g, '_')
    return TEACHER_SUBJECTS.some((s) => s.value === key) ? key : 'all'
  })
  const [results, setResults] = useState(null) // null = loading
  const [urls, setUrls] = useState({})
  const debounceRef = useRef(null)

  useEffect(() => {
    setResults(null)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(async () => {
      const rows = await searchActivePictures({ term, subject: subjectFilter })
      setResults(rows)
      for (const p of rows) {
        if (p.url) continue
        resolvePictureUrl(p).then((u) => {
          if (u) setUrls((m) => (m[p.id] ? m : { ...m, [p.id]: u }))
        }).catch(() => {})
      }
    }, 250)
    return () => clearTimeout(debounceRef.current)
  }, [term, subjectFilter])

  const subjectOptions = useMemo(
    () => TEACHER_SUBJECTS.filter((s) => s.value),
    [],
  )

  function pick(p) {
    const url = p.url || urls[p.id]
    if (!url) return
    onSelect({ url, name: p.name, pictureId: p.id })
  }

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 90,
        background: 'rgba(14, 42, 50, 0.55)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 16,
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: '#fff', borderRadius: 16, width: 'min(720px, 100%)',
          maxHeight: '85vh', display: 'flex', flexDirection: 'column',
          padding: 16,
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-3 mb-3">
          <h3 style={{ fontWeight: 900, fontSize: 18, color: '#0e2a32', margin: 0 }}>
            📚 Picture bank
          </h3>
          <button type="button" onClick={onClose}
            style={{ fontSize: 22, lineHeight: 1, border: 'none', background: 'none', cursor: 'pointer' }}
            aria-label="Close">×</button>
        </div>
        <div className="flex flex-wrap gap-2 mb-3">
          <input
            type="text"
            autoFocus
            value={term}
            onChange={(e) => setTerm(e.target.value)}
            placeholder='Search, e.g. "domestic animals"'
            className="flex-1 border rounded-lg px-3 py-2 text-sm"
            style={{ borderColor: '#d9cfb8', minWidth: 180 }}
          />
          <select
            value={subjectFilter}
            onChange={(e) => setSubjectFilter(e.target.value)}
            className="border rounded-lg px-2 py-2 text-sm"
            style={{ borderColor: '#d9cfb8' }}
          >
            <option value="all">All subjects</option>
            {subjectOptions.map((s) => (
              <option key={s.value} value={s.value}>{s.label}</option>
            ))}
          </select>
        </div>
        <div style={{ overflowY: 'auto', flex: 1 }}>
          {results === null ? (
            <p className="text-sm" style={{ color: '#566f76' }}>Searching…</p>
          ) : results.length === 0 ? (
            <p className="text-sm" style={{ color: '#566f76' }}>
              Nothing in the bank matches{term ? ` “${term}”` : ''} yet.
              Close this and use <strong>AI diagram</strong> or upload your
              own image — or ask an admin to add it to the bank.
            </p>
          ) : (
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))',
                gap: 10,
              }}
            >
              {results.map((p) => {
                const url = p.url || urls[p.id]
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => pick(p)}
                    disabled={!url}
                    style={{
                      border: '1.5px solid #d9cfb8', borderRadius: 12,
                      padding: 6, background: '#fff', cursor: 'pointer',
                      textAlign: 'left',
                    }}
                    title={p.name}
                  >
                    {url ? (
                      <img src={url} alt={p.name}
                        style={{ width: '100%', height: 90, objectFit: 'contain', background: '#f8f6ef', borderRadius: 8 }} />
                    ) : (
                      <div style={{ width: '100%', height: 90, background: '#f1ede1', borderRadius: 8 }} />
                    )}
                    <div style={{
                      fontSize: 12, fontWeight: 700, color: '#0e2a32',
                      marginTop: 4, overflow: 'hidden', textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}>
                      {p.name}
                    </div>
                  </button>
                )
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
