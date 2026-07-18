/* My Visuals (teacher-owned `visualAssets`) and the shared Picture Bank
   (admin-curated `pictureBank`). Search + filter, then edit, reuse in
   Assessment Studio without re-generating (brief item 16, Flow C), download,
   or delete. */

import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../../../contexts/AuthContext'
import { SUBJECTS } from '../../../config/curriculum'
import { listMyVisualAssets, deleteVisualAsset } from '../services/visualAssetService'
import { searchActivePictures } from '../../../utils/pictureBankService'
import { buildQuestionPatch } from '../lib/visualVersions'
import { writeVisualHandoff } from '../../../utils/studioHandoff'
import { IconSearch, IconSend, IconTrash } from './VsIcons'

export default function MyVisualsGrid({ mode = 'mine', onEdit, onToast }) {
  const { currentUser } = useAuth()
  const navigate = useNavigate()
  const uid = currentUser?.uid

  const [search, setSearch] = useState('')
  const [subject, setSubject] = useState('all')
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      if (mode === 'shared') {
        const { rows: r, error: e } = await searchActivePictures({ term: search, subject })
        setRows(r.map((p) => ({
          id: p.id,
          title: p.name,
          imageUrl: p.url,
          subject: p.subject,
          isBlackAndWhite: true,
          shared: true,
        })))
        if (e) setError(e)
      } else {
        const r = await listMyVisualAssets(uid, { search, subject })
        setRows(r)
      }
    } catch (e) {
      setError(e?.message || 'Could not load visuals.')
    } finally {
      setLoading(false)
    }
  }, [mode, search, subject, uid])

  useEffect(() => { load() }, [load])

  function toVisual(row) {
    return {
      imageUrl: row.imageUrl,
      title: row.title || 'Visual',
      grade: row.grade || '',
      subject: row.subject || '',
      topic: row.topic || '',
      subtopic: row.subtopic || '',
      style: row.style || 'bw_test_diagram',
      useCase: row.useCase || '',
      isBlackAndWhite: row.isBlackAndWhite !== false,
      sourceType: row.shared ? 'bank' : (row.sourceType || 'ai'),
      aiPrompt: row.aiPrompt || '',
      aiModel: row.aiModel || '',
      labels: Array.isArray(row.labels)
        ? row.labels.map((l) => ({ id: l.id || `lbl-${Math.random().toString(36).slice(2, 8)}`, type: 'label', x: l.x, y: l.y, text: l.text, color: '#111111' }))
        : [],
    }
  }

  function reuseInAssessment(row) {
    // Flow C: reuse a saved diagram with no new generation.
    const labels = Array.isArray(row.labels) ? row.labels : []
    writeVisualHandoff(buildQuestionPatch({
      imageUrl: row.imageUrl,
      imageAlt: row.title || 'Diagram',
      labels,
      version: labels.length ? 'learner' : 'picture',
    }))
    onToast?.('Diagram ready — opening the Assessment Paper Studio…')
    navigate('/teacher/assessment-papers/new?from=visual-studio')
  }

  async function remove(row) {
    if (row.shared) return
    if (typeof window !== 'undefined' && !window.confirm(`Delete "${row.title}"? This cannot be undone.`)) return
    const ok = await deleteVisualAsset(row)
    if (ok) { setRows((prev) => prev.filter((r) => r.id !== row.id)); onToast?.('Deleted') }
  }

  return (
    <div>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
        <div className="vs-iconbtn" style={{ flex: 1, minWidth: 200, cursor: 'text' }}>
          <IconSearch size={15} />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={mode === 'shared' ? 'Search the shared Picture Bank…' : 'Search my visuals…'}
            style={{ border: 'none', outline: 'none', width: '100%', font: 'inherit', background: 'transparent' }}
          />
        </div>
        <select className="vs-iconbtn" value={subject} onChange={(e) => setSubject(e.target.value)} style={{ fontWeight: 600 }}>
          <option value="all">All subjects</option>
          {SUBJECTS.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
        </select>
        <button type="button" className="vs-iconbtn" onClick={load}>Refresh</button>
      </div>

      {error && <p className="vs-hint vs-note-warn" style={{ marginTop: 12 }}>⚠ {error}</p>}

      {loading ? (
        <p className="vs-sub" style={{ marginTop: 16 }}><span className="vs-spinner" /> Loading…</p>
      ) : rows.length === 0 ? (
        <p className="vs-hint" style={{ marginTop: 16 }}>
          {mode === 'shared'
            ? 'No pictures in the shared bank match that search.'
            : 'You haven’t saved any visuals yet. Generate one with AI, label it, then "Save to My Visuals".'}
        </p>
      ) : (
        <div className="vs-bankgrid">
          {rows.map((row) => (
            <div className="vs-bankcard" key={row.id}>
              <div className="vs-bankcard__thumb">
                {row.imageUrl
                  ? <img src={row.thumbnailUrl || row.imageUrl} alt={row.title} crossOrigin="anonymous" loading="lazy" />
                  : <span className="vs-sub">No image</span>}
              </div>
              <div className="vs-bankcard__body">
                <b>{row.title}</b>
                <span>
                  {[row.subject, row.grade ? `Grade ${row.grade}` : '', row.topic].filter(Boolean).join(' · ') || 'Picture bank'}
                </span>
                <div style={{ marginTop: 6, display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                  {row.isBlackAndWhite && <span className="vs-badge vs-badge--bw">B&amp;W</span>}
                  {row.isLabelled && <span className="vs-badge vs-badge--labelled">Labelled</span>}
                  {row.safetyStatus === 'flagged' && <span className="vs-badge vs-badge--flag">Review</span>}
                </div>
              </div>
              <div className="vs-bankcard__bar">
                <button type="button" className="vs-iconbtn" style={{ flex: 1, justifyContent: 'center' }} onClick={() => onEdit(toVisual(row))}>Edit</button>
                <button type="button" className="vs-iconbtn" title="Use in Assessment Paper Studio" aria-label="Use in Assessment Paper Studio" onClick={() => reuseInAssessment(row)}><IconSend size={14} /></button>
                {!row.shared && <button type="button" className="vs-iconbtn danger" title="Delete" onClick={() => remove(row)}><IconTrash size={14} /></button>}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
