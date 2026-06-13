// Question bank picker — modal the teacher opens from the Assessment Studio's
// "add block" flow to re-insert a previously saved question. Search by text /
// topic / type, narrowed by an optional type filter; click "Insert" to drop a
// fresh copy into the paper, or delete saved questions you no longer want.
//
// Owner-scoped: only ever lists the signed-in teacher's own saved questions.

import { useEffect, useRef, useState } from 'react'
import {
  searchMyBankQuestions, parseBankQuestion, deleteBankQuestion,
} from '../../utils/questionBankService'

const TYPE_LABELS = {
  mcq: 'Multiple choice',
  short_answer: 'Short answer',
  diagram: 'Structured',
  essay: 'Essay',
  numeric: 'Numeric',
  matching: 'Matching',
  sequence: 'Sequence',
}

const TYPE_FILTERS = [
  { value: '', label: 'All types' },
  { value: 'mcq', label: 'Multiple choice' },
  { value: 'short_answer', label: 'Short answer' },
  { value: 'diagram', label: 'Structured' },
  { value: 'essay', label: 'Essay' },
  { value: 'numeric', label: 'Numeric' },
  { value: 'matching', label: 'Matching' },
  { value: 'sequence', label: 'Sequence' },
]

export default function QuestionBankPicker({ uid, onInsert, onClose }) {
  const [term, setTerm] = useState('')
  const [typeFilter, setTypeFilter] = useState('')
  const [rows, setRows] = useState(null) // null = loading
  const [error, setError] = useState('')
  const [busyId, setBusyId] = useState('')
  const debounceRef = useRef(null)

  useEffect(() => {
    if (!uid) { setRows([]); return undefined }
    setRows(null)
    setError('')
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(async () => {
      const { rows: found, error: err } = await searchMyBankQuestions(uid, { term, type: typeFilter })
      setRows(found)
      setError(err || '')
    }, 250)
    return () => clearTimeout(debounceRef.current)
  }, [uid, term, typeFilter])

  function insert(row) {
    const question = parseBankQuestion(row)
    if (!question) return
    onInsert(question)
  }

  async function remove(row) {
    setBusyId(row.id)
    await deleteBankQuestion(row.id)
    setRows((list) => (list || []).filter((r) => r.id !== row.id))
    setBusyId('')
  }

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 90,
        background: 'rgba(14, 42, 50, 0.55)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: '#fff', borderRadius: 16, width: 'min(720px, 100%)',
          maxHeight: '85vh', display: 'flex', flexDirection: 'column', padding: 16,
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-3 mb-2">
          <h3 style={{ fontWeight: 900, fontSize: 18, color: '#0e2a32', margin: 0 }}>
            Insert from your question bank
          </h3>
          <button type="button" onClick={onClose}
            style={{ fontSize: 22, lineHeight: 1, border: 'none', background: 'none', cursor: 'pointer' }}
            aria-label="Close">×</button>
        </div>

        <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
          <input
            type="text"
            value={term}
            onChange={(e) => setTerm(e.target.value)}
            placeholder="Search your saved questions…"
            autoFocus
            style={{
              flex: 1, border: '1px solid #d8dee2', borderRadius: 8,
              padding: '8px 12px', fontSize: 14,
            }}
          />
          <select
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value)}
            style={{ border: '1px solid #d8dee2', borderRadius: 8, padding: '8px 10px', fontSize: 14 }}
          >
            {TYPE_FILTERS.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
        </div>

        <div style={{ overflowY: 'auto', flex: 1 }}>
          {rows === null && (
            <p style={{ color: '#64748b', textAlign: 'center', padding: 24 }}>Loading…</p>
          )}
          {rows !== null && error && (
            <p style={{ color: '#c0392b', textAlign: 'center', padding: 24 }}>{error}</p>
          )}
          {rows !== null && !error && rows.length === 0 && (
            <div style={{ color: '#64748b', textAlign: 'center', padding: 24 }}>
              <p style={{ margin: 0, fontWeight: 600 }}>No saved questions yet.</p>
              <p style={{ margin: '6px 0 0', fontSize: 13 }}>
                Use “⭐ Save to bank” on any question to build your reusable library.
              </p>
            </div>
          )}
          {rows !== null && !error && rows.map((row) => (
            <div
              key={row.id}
              style={{
                display: 'flex', alignItems: 'center', gap: 10,
                border: '1px solid #e6eaec', borderRadius: 10,
                padding: '10px 12px', marginBottom: 8,
              }}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 14, color: '#0e2a32', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {row.preview || '(no question text)'}
                </div>
                <div style={{ fontSize: 11.5, color: '#64748b', marginTop: 2 }}>
                  {TYPE_LABELS[row.type] || row.type}
                  {row.marks ? ` · ${row.marks} mark${row.marks === 1 ? '' : 's'}` : ''}
                  {row.topic ? ` · ${row.topic}` : ''}
                  {row.subject ? ` · ${row.subject}` : ''}
                </div>
              </div>
              <button
                type="button"
                onClick={() => insert(row)}
                style={{
                  border: 'none', background: '#ff7a2e', color: '#fff', fontWeight: 700,
                  borderRadius: 8, padding: '7px 14px', fontSize: 13, cursor: 'pointer', flexShrink: 0,
                }}
              >
                Insert
              </button>
              <button
                type="button"
                onClick={() => remove(row)}
                disabled={busyId === row.id}
                title="Delete from bank"
                aria-label="Delete from bank"
                style={{
                  border: '1px solid #e6eaec', background: '#fff', color: '#c0392b',
                  borderRadius: 8, padding: '7px 10px', fontSize: 13,
                  cursor: busyId === row.id ? 'default' : 'pointer', flexShrink: 0,
                }}
              >
                🗑
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
