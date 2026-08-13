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
import { TEACHER_SUBJECTS } from '../../../utils/teacherTools'
import { searchActivePictures, resolvePictureUrl } from '../../../utils/pictureBankService'
import { generateDiagram } from '../../../utils/generateDiagram'
import { useDebouncedValue } from '../../../hooks/useDebouncedValue'
import { createSequenceGuard } from '../../../utils/requestControl'
import { useRequestLock } from '../../../hooks/useRequestLock'

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
  const [results, setResults] = useState(null) // null = never loaded yet
  const [isSearching, setIsSearching] = useState(false)
  const [bankError, setBankError] = useState('')
  const [urls, setUrls] = useState({})
  const sequenceRef = useRef(createSequenceGuard())

  // AI tab state
  const [prompt, setPrompt] = useState('')
  const [provider, setProvider] = useState('recraft')
  const { run: runAiGenerateLock, isLocked: aiBusy } = useRequestLock()
  const [aiError, setAiError] = useState('')
  const [aiUrl, setAiUrl] = useState('')

  const debouncedTerm = useDebouncedValue(term, 250)

  useEffect(() => {
    if (tab !== 'bank') return undefined
    const requestNumber = sequenceRef.current.bump()
    setIsSearching(true)
    setBankError('')
    let cancelled = false

    async function runSearch() {
      const { rows, error } = await searchActivePictures({ term: debouncedTerm, subject: subjectFilter })
      // A newer search may have started (or the picker moved off this tab)
      // while this one was in flight — never let a stale response replace
      // fresher results.
      if (cancelled || !sequenceRef.current.isCurrent(requestNumber)) return
      setResults(rows)
      setBankError(error || '')
      setIsSearching(false)
      for (const p of rows) {
        if (p.url) continue
        resolvePictureUrl(p)
          .then((u) => { if (u) setUrls((m) => (m[p.id] ? m : { ...m, [p.id]: u })) })
          .catch(() => {})
      }
    }
    runSearch()

    return () => { cancelled = true }
  }, [debouncedTerm, subjectFilter, tab])

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
    await runAiGenerateLock(async () => {
      setAiError('')
      setAiUrl('')
      try {
        const { url } = await generateDiagram({ prompt: clean, provider })
        setAiUrl(url)
      } catch (err) {
        setAiError(err?.message || 'Generation failed. Please try again.')
      }
    })
  }

  const tabBtn = (key, label) => (
    <button
      type="button"
      onClick={() => setTab(key)}
      style={{
        flex: 1, padding: '8px 12px', fontSize: 14, cursor: 'pointer',
        border: 'none', borderBottom: `2.5px solid ${tab === key ? '#d97757' : 'transparent'}`,
        background: 'none', fontWeight: tab === key ? 800 : 500, color: 'var(--zt-text)',
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
          background: 'var(--zt-card)', borderRadius: 16, width: 'min(720px, 100%)',
          maxHeight: '85vh', display: 'flex', flexDirection: 'column',
          padding: 16,
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-3 mb-2">
          <h3 style={{ fontWeight: 900, fontSize: 18, color: 'var(--zt-text)', margin: 0 }}>
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
                style={{ borderColor: 'var(--zt-line)', minWidth: 180 }}
              />
              <select
                value={subjectFilter}
                onChange={(e) => setSubjectFilter(e.target.value)}
                className="border rounded-lg px-2 py-2 text-sm"
                style={{ borderColor: 'var(--zt-line)' }}
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
              ) : results === null || (isSearching && results.length === 0) ? (
                <p className="text-sm" style={{ color: 'var(--zt-text-muted)' }}>Searching…</p>
              ) : results.length === 0 ? (
                <div className="text-sm" style={{ color: 'var(--zt-text-muted)' }}>
                  {term || subjectFilter !== 'all' ? (
                    <p>
                      Nothing matches{term ? ` “${term}”` : ''}
                      {subjectFilter !== 'all' ? ' in this subject' : ''}.{' '}
                      {subjectFilter !== 'all' && (
                        <button type="button" className="underline font-bold"
                          style={{ color: 'var(--zt-text)', border: 'none', background: 'none', cursor: 'pointer', padding: 0 }}
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
                    style={{ border: '1.5px solid #d97757', color: 'var(--zt-text)', background: '#fff3e8', cursor: 'pointer' }}
                    onClick={() => { setTab('ai'); if (term) setPrompt(term) }}
                  >
                    ✨ Generate this picture with AI instead
                  </button>
                </div>
              ) : (
                <>
                  {isSearching && (
                    <p className="text-xs" style={{ color: 'var(--zt-text-muted)', marginBottom: 6 }}>Searching…</p>
                  )}
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
                          padding: 6, background: 'var(--zt-card)', cursor: 'pointer',
                          textAlign: 'left',
                        }}
                        title={p.name}
                      >
                        {url ? (
                          <img src={url} alt={p.name}
                            style={{ width: '100%', height: 90, objectFit: 'contain', background: 'var(--zt-surface)', borderRadius: 8 }} />
                        ) : (
                          <div style={{ width: '100%', height: 90, background: '#f1ede1', borderRadius: 8 }} />
                        )}
                        <div style={{
                          fontSize: 12, fontWeight: 700, color: 'var(--zt-text)',
                          marginTop: 4, overflow: 'hidden', textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}>
                          {p.name}
                        </div>
                      </button>
                    )
                    })}
                  </div>
                </>
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
              style={{ borderColor: 'var(--zt-line)', resize: 'vertical', fontFamily: 'inherit' }}
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
                    border: `1.5px solid ${provider === s.provider ? '#d97757' : '#d9cfb8'}`,
                    background: provider === s.provider ? '#fff3e8' : '#fff',
                    color: 'var(--zt-text)', textAlign: 'center',
                  }}
                >
                  {s.label}
                  <small style={{ display: 'block', color: 'var(--zt-text-muted)', fontSize: 10, marginTop: 2 }}>{s.hint}</small>
                </button>
              ))}
            </div>
            {aiError && (
              <p className="text-sm" style={{ color: '#991b1b', margin: 0 }}>⚠️ {aiError}</p>
            )}
            {aiUrl ? (
              <>
                <img src={aiUrl} alt={prompt}
                  style={{ width: '100%', maxHeight: 280, objectFit: 'contain', background: 'var(--zt-surface)', borderRadius: 12, border: '1px solid #d9cfb8' }} />
                <div style={{ display: 'flex', gap: 8 }}>
                  <button type="button"
                    className="rounded-lg px-4 py-2 text-sm font-bold"
                    style={{ flex: 1, background: '#d97757', color: '#fff', border: 'none', cursor: 'pointer' }}
                    onClick={() => onSelect({ url: aiUrl, name: prompt.slice(0, 80), pictureId: null })}
                  >
                    ✓ Use this picture
                  </button>
                  <button type="button"
                    className="rounded-lg px-4 py-2 text-sm"
                    style={{ flex: 1, border: '1.5px solid #d9cfb8', background: 'var(--zt-card)', cursor: 'pointer', color: 'var(--zt-text)' }}
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
                style={{ background: '#d97757', color: '#fff', border: 'none', cursor: 'pointer', opacity: aiBusy || !prompt.trim() ? 0.6 : 1 }}
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
