// Picture bank picker — modal teachers open from the Assessment Studio's
// image-attach flow (question stems AND answer options). Two tabs:
//
//   📚 Picture bank — search the admin-curated library by name/keyword,
//      optionally narrowed by subject; click a tile to attach.
//   ✨ Generate with AI — describe the picture, pick a style (line art /
//      colour illustration / photoreal), generate, attach. Uses the same
//      generateDiagram callable as the rest of the studio.
//
// Empty/error states are honest: a failed query says so, an empty bank
// explains where pictures come from, and a no-match search offers the AI
// tab so the teacher is never stuck.

import { useEffect, useMemo, useRef, useState } from 'react'
import { TEACHER_SUBJECTS } from '../../utils/teacherTools'
import { searchActivePictures, resolvePictureUrl } from '../../utils/pictureBankService'
import { generateDiagram } from '../../utils/generateDiagram'

const AI_STYLES = [
  { provider: 'recraft', label: '🖋 Line art', hint: 'B&W diagrams, prints crisply' },
  { provider: 'kie', label: '🎨 Colour illustration', hint: 'Friendly full-colour drawings' },
  { provider: 'openai', label: '📷 Photoreal', hint: 'Photographs of real things' },
]

export default function PictureBankPicker({ subject = '', onSelect, onClose }) {
  const [tab, setTab] = useState('bank') // 'bank' | 'ai'
  const [term, setTerm] = useState('')
  // The studio passes display subjects ("Integrated Science"); normalise to
  // the canonical key and fall back to 'all' when it isn't a known subject.
  const [subjectFilter, setSubjectFilter] = useState(() => {
    const key = String(subject || '').toLowerCase().trim().replace(/\s+/g, '_')
    return TEACHER_SUBJECTS.some((s) => s.value === key) ? key : 'all'
  })
  const [results, setResults] = useState(null) // null = loading
  const [bankError, setBankError] = useState('')
  const [urls, setUrls] = useState({})
  const debounceRef = useRef(null)

  // AI tab state
  const [prompt, setPrompt] = useState('')
  const [provider, setProvider] = useState('recraft')
  const [aiBusy, setAiBusy] = useState(false)
  const [aiError, setAiError] = useState('')
  const [aiUrl, setAiUrl] = useState('')

  useEffect(() => {
    if (tab !== 'bank') return undefined
    setResults(null)
    setBankError('')
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(async () => {
      const { rows, error } = await searchActivePictures({ term, subject: subjectFilter })
      setResults(rows)
      setBankError(error || '')
      for (const p of rows) {
        if (p.url) continue
        resolvePictureUrl(p).then((u) => {
          if (u) setUrls((m) => (m[p.id] ? m : { ...m, [p.id]: u }))
        }).catch(() => {})
      }
    }, 250)
    return () => clearTimeout(debounceRef.current)
  }, [term, subjectFilter, tab])

  const subjectOptions = useMemo(
    () => TEACHER_SUBJECTS.filter((s) => s.value),
    [],
  )

  function pick(p) {
    const url = p.url || urls[p.id]
    if (!url) return
    onSelect({ url, name: p.name, pictureId: p.id })
  }

  async function runAiGenerate() {
    const clean = prompt.trim()
    if (!clean) return
    setAiBusy(true)
    setAiError('')
    setAiUrl('')
    try {
      const { url } = await generateDiagram({ prompt: clean, provider })
      setAiUrl(url)
    } catch (err) {
      setAiError(err?.message || 'Generation failed. Please try again.')
    } finally {
      setAiBusy(false)
    }
  }

  const tabBtn = (key, label) => (
    <button
      type="button"
      onClick={() => setTab(key)}
      style={{
        flex: 1, padding: '8px 12px', fontSize: 14, cursor: 'pointer',
        border: 'none', borderBottom: `2.5px solid ${tab === key ? '#ff7a2e' : 'transparent'}`,
        background: 'none', fontWeight: tab === key ? 800 : 500, color: '#0e2a32',
      }}
    >
      {label}
    </button>
  )

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
        <div className="flex items-center justify-between gap-3 mb-2">
          <h3 style={{ fontWeight: 900, fontSize: 18, color: '#0e2a32', margin: 0 }}>
            Add a picture
          </h3>
          <button type="button" onClick={onClose}
            style={{ fontSize: 22, lineHeight: 1, border: 'none', background: 'none', cursor: 'pointer' }}
            aria-label="Close">×</button>
        </div>

        <div style={{ display: 'flex', borderBottom: '1px solid #eee', marginBottom: 12 }}>
          {tabBtn('bank', '📚 Picture bank')}
          {tabBtn('ai', '✨ Generate with AI')}
        </div>

        {tab === 'bank' && (
          <>
            <div className="flex flex-wrap gap-2 mb-3">
              <input
                type="text"
                autoFocus
                value={term}
                onChange={(e) => setTerm(e.target.value)}
                placeholder='Search, e.g. "domestic animals" or "coat of arms"'
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
            <div style={{ overflowY: 'auto', flex: 1, minHeight: 160 }}>
              {bankError ? (
                <p className="text-sm" style={{ color: '#991b1b' }}>
                  ⚠️ Couldn't load the picture bank ({bankError}). Check your
                  connection and try again — or use ✨ Generate with AI.
                </p>
              ) : results === null ? (
                <p className="text-sm" style={{ color: '#566f76' }}>Searching…</p>
              ) : results.length === 0 ? (
                <div className="text-sm" style={{ color: '#566f76' }}>
                  {term || subjectFilter !== 'all' ? (
                    <p>
                      Nothing matches{term ? ` “${term}”` : ''}
                      {subjectFilter !== 'all' ? ' in this subject' : ''}.{' '}
                      {subjectFilter !== 'all' && (
                        <button type="button" className="underline font-bold"
                          style={{ color: '#0e2a32', border: 'none', background: 'none', cursor: 'pointer', padding: 0 }}
                          onClick={() => setSubjectFilter('all')}>
                          Search all subjects
                        </button>
                      )}
                    </p>
                  ) : (
                    <p>
                      The picture bank is empty so far. Pictures get added when an
                      admin tags images from uploaded papers, uploads them, or
                      generates them (at /admin/picture-bank).
                    </p>
                  )}
                  <button
                    type="button"
                    className="mt-2 rounded-lg px-4 py-2 text-sm font-bold"
                    style={{ border: '1.5px solid #ff7a2e', color: '#0e2a32', background: '#fff3e8', cursor: 'pointer' }}
                    onClick={() => { setTab('ai'); if (term) setPrompt(term) }}
                  >
                    ✨ Generate this picture with AI instead
                  </button>
                </div>
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
          </>
        )}

        {tab === 'ai' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, overflowY: 'auto' }}>
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              rows={3}
              placeholder="Describe the picture (e.g. Labelled diagram of the human ear showing the earlobe, eardrum, middle ear and inner ear)"
              className="border rounded-lg px-3 py-2 text-sm"
              style={{ borderColor: '#d9cfb8', resize: 'vertical', fontFamily: 'inherit' }}
              disabled={aiBusy}
            />
            <div style={{ display: 'flex', gap: 6 }}>
              {AI_STYLES.map((s) => (
                <button
                  key={s.provider}
                  type="button"
                  disabled={aiBusy}
                  onClick={() => setProvider(s.provider)}
                  style={{
                    flex: 1, padding: '8px 10px', borderRadius: 10, fontSize: 13, cursor: 'pointer',
                    border: `1.5px solid ${provider === s.provider ? '#ff7a2e' : '#d9cfb8'}`,
                    background: provider === s.provider ? '#fff3e8' : '#fff',
                    color: '#0e2a32', textAlign: 'center',
                  }}
                >
                  {s.label}
                  <small style={{ display: 'block', color: '#566f76', fontSize: 10, marginTop: 2 }}>{s.hint}</small>
                </button>
              ))}
            </div>
            {aiError && (
              <p className="text-sm" style={{ color: '#991b1b', margin: 0 }}>⚠️ {aiError}</p>
            )}
            {aiUrl ? (
              <>
                <img src={aiUrl} alt={prompt}
                  style={{ width: '100%', maxHeight: 280, objectFit: 'contain', background: '#f8f6ef', borderRadius: 12, border: '1px solid #d9cfb8' }} />
                <div style={{ display: 'flex', gap: 8 }}>
                  <button type="button"
                    className="rounded-lg px-4 py-2 text-sm font-bold"
                    style={{ flex: 1, background: '#ff7a2e', color: '#fff', border: 'none', cursor: 'pointer' }}
                    onClick={() => onSelect({ url: aiUrl, name: prompt.slice(0, 80), pictureId: null })}
                  >
                    ✓ Use this picture
                  </button>
                  <button type="button"
                    className="rounded-lg px-4 py-2 text-sm"
                    style={{ flex: 1, border: '1.5px solid #d9cfb8', background: '#fff', cursor: 'pointer', color: '#0e2a32' }}
                    onClick={runAiGenerate}
                    disabled={aiBusy}
                  >
                    {aiBusy ? 'Generating…' : '↻ Try again'}
                  </button>
                </div>
              </>
            ) : (
              <button type="button"
                className="rounded-lg px-4 py-2 text-sm font-bold"
                style={{ background: '#ff7a2e', color: '#fff', border: 'none', cursor: 'pointer', opacity: aiBusy || !prompt.trim() ? 0.6 : 1 }}
                onClick={runAiGenerate}
                disabled={aiBusy || !prompt.trim()}
              >
                {aiBusy ? '✦ Generating… (about 20 seconds)' : '✦ Generate picture'}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
