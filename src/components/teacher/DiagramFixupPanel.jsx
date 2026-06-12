// Diagram fixup — closes the loop on AI-generated diagram questions.
// Lists every question that carries a diagramBrief but no image, suggests
// matching picture-bank figures (rankPicturesForBrief), and offers
// one-click AI generation from the brief (line art by default). Opens
// automatically after "Create paper with AI" lands a paper with diagram
// briefs; reachable any time from the AI assistant panel.

import { useEffect, useMemo, useState } from 'react'
import { searchActivePictures, resolvePictureUrl } from '../../utils/pictureBankService'
import { rankPicturesForBrief } from '../../utils/diagramMatch'
import { generateDiagram } from '../../utils/generateDiagram'

const AI_STYLES = [
  { provider: 'recraft', label: '🖋 Line art' },
  { provider: 'kie', label: '🎨 Colour' },
  { provider: 'openai', label: '📷 Photo' },
]

export function countDiagramsNeeded(sections) {
  return (sections || []).filter((s) =>
    s?.kind === 'standalone' && s.question?.diagramBrief && !s.question?.imageUrl,
  ).length
}

export default function DiagramFixupPanel({ sections, subject, questionNumbers, onAttach, onClose }) {
  const [bank, setBank] = useState(null) // null = loading
  const [urls, setUrls] = useState({})
  const [busyIndex, setBusyIndex] = useState(null) // sectionIndex being generated
  const [batchRunning, setBatchRunning] = useState(false)
  const [errors, setErrors] = useState({}) // sectionIndex -> message
  const [provider, setProvider] = useState('recraft')

  const entries = useMemo(() => (sections || [])
    .map((s, sectionIndex) => ({ section: s, sectionIndex }))
    .filter(({ section }) =>
      section?.kind === 'standalone' &&
      section.question?.diagramBrief &&
      !section.question?.imageUrl,
    ), [sections])

  useEffect(() => {
    let cancelled = false
    searchActivePictures({ subject: subject || 'all' }).then(({ rows }) => {
      if (cancelled) return
      setBank(rows)
      for (const p of rows) {
        if (p.url) continue
        resolvePictureUrl(p).then((u) => {
          if (u && !cancelled) setUrls((m) => (m[p.id] ? m : { ...m, [p.id]: u }))
        }).catch(() => {})
      }
    })
    return () => { cancelled = true }
  }, [subject])

  async function generateFor(sectionIndex, brief) {
    setBusyIndex(sectionIndex)
    setErrors((e) => ({ ...e, [sectionIndex]: '' }))
    try {
      const { url } = await generateDiagram({ prompt: brief, provider })
      onAttach(sectionIndex, url)
    } catch (err) {
      setErrors((e) => ({ ...e, [sectionIndex]: err?.message || 'Generation failed.' }))
    } finally {
      setBusyIndex(null)
    }
  }

  async function generateAllMissing() {
    setBatchRunning(true)
    try {
      // Sequential on purpose: each image costs money and shares a rate
      // limit; a failure stops the run so errors don't cascade.
      for (const { section, sectionIndex } of entries) {
        if (section.question.imageUrl) continue
        setBusyIndex(sectionIndex)
        try {
          const { url } = await generateDiagram({
            prompt: section.question.diagramBrief, provider,
          })
          onAttach(sectionIndex, url)
        } catch (err) {
          setErrors((e) => ({ ...e, [sectionIndex]: err?.message || 'Generation failed.' }))
          break
        }
      }
    } finally {
      setBusyIndex(null)
      setBatchRunning(false)
    }
  }

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 92,
        background: 'rgba(14, 42, 50, 0.55)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 16,
      }}
      onClick={batchRunning ? undefined : onClose}
    >
      <div
        style={{
          background: '#fff', borderRadius: 16, width: 'min(760px, 100%)',
          maxHeight: '88vh', display: 'flex', flexDirection: 'column',
          padding: 16,
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
          <div>
            <h3 style={{ margin: 0, fontWeight: 900, fontSize: 18, color: '#0e2a32' }}>
              🖼 Diagrams needed ({entries.length})
            </h3>
            <p style={{ margin: '4px 0 0', fontSize: 13, color: '#566f76' }}>
              These questions reference a figure. Attach a match from the
              picture bank, or generate one from the AI's description.
            </p>
          </div>
          <button type="button" onClick={onClose} disabled={batchRunning}
            style={{ fontSize: 22, lineHeight: 1, border: 'none', background: 'none', cursor: 'pointer' }}
            aria-label="Close">×</button>
        </div>

        {entries.length > 0 && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '10px 0' }}>
            <div style={{ display: 'flex', gap: 4 }}>
              {AI_STYLES.map((s) => (
                <button key={s.provider} type="button"
                  onClick={() => setProvider(s.provider)}
                  disabled={batchRunning || busyIndex !== null}
                  style={{
                    padding: '5px 10px', borderRadius: 999, fontSize: 12, cursor: 'pointer',
                    border: `1.5px solid ${provider === s.provider ? '#ff7a2e' : '#d9cfb8'}`,
                    background: provider === s.provider ? '#fff3e8' : '#fff', color: '#0e2a32',
                  }}>
                  {s.label}
                </button>
              ))}
            </div>
            <div style={{ flex: 1 }} />
            <button type="button"
              onClick={generateAllMissing}
              disabled={batchRunning || busyIndex !== null}
              style={{
                padding: '7px 14px', borderRadius: 10, fontSize: 13, fontWeight: 800,
                background: '#ff7a2e', color: '#fff', border: 'none', cursor: 'pointer',
                opacity: batchRunning ? 0.6 : 1,
              }}>
              {batchRunning ? '✦ Generating…' : `✨ Generate all ${entries.length} with AI`}
            </button>
          </div>
        )}

        <div style={{ overflowY: 'auto', flex: 1, display: 'flex', flexDirection: 'column', gap: 10 }}>
          {entries.length === 0 && (
            <p style={{ fontSize: 14, color: '#566f76' }}>
              🎉 Every diagram question has its figure. Nothing to fix.
            </p>
          )}
          {entries.map(({ section, sectionIndex }) => {
            const q = section.question
            const matches = bank ? rankPicturesForBrief(bank, q.diagramBrief) : []
            const busy = busyIndex === sectionIndex
            return (
              <div key={section.id} style={{ border: '1px solid #d9cfb8', borderRadius: 12, padding: 12 }}>
                <div style={{ fontSize: 13, color: '#566f76' }}>
                  Q{questionNumbers?.[q.localId] || '?'} · {String(q.text || '').slice(0, 90)}
                </div>
                <div style={{ fontSize: 14, fontWeight: 700, color: '#0e2a32', margin: '4px 0 8px' }}>
                  {q.diagramBrief}
                </div>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                  {bank === null ? (
                    <span style={{ fontSize: 12, color: '#566f76' }}>Checking the picture bank…</span>
                  ) : matches.length > 0 ? (
                    matches.map((p) => {
                      const url = p.url || urls[p.id]
                      return (
                        <button key={p.id} type="button"
                          onClick={() => onAttach(sectionIndex, url)}
                          disabled={!url || busy || batchRunning}
                          title={`Attach "${p.name}"`}
                          style={{
                            border: '1.5px solid #d9cfb8', borderRadius: 10, padding: 4,
                            background: '#fff', cursor: 'pointer', width: 92,
                          }}>
                          {url ? (
                            <img src={url} alt={p.name}
                              style={{ width: '100%', height: 60, objectFit: 'contain', background: '#f8f6ef', borderRadius: 6 }} />
                          ) : (
                            <div style={{ width: '100%', height: 60, background: '#f1ede1', borderRadius: 6 }} />
                          )}
                          <div style={{ fontSize: 10, fontWeight: 700, color: '#0e2a32', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {p.name}
                          </div>
                        </button>
                      )
                    })
                  ) : (
                    <span style={{ fontSize: 12, color: '#566f76' }}>No bank match —</span>
                  )}
                  <button type="button"
                    onClick={() => generateFor(sectionIndex, q.diagramBrief)}
                    disabled={busy || batchRunning}
                    style={{
                      padding: '6px 12px', borderRadius: 10, fontSize: 13, fontWeight: 700,
                      border: '1.5px solid #ff7a2e', background: '#fff3e8', color: '#0e2a32',
                      cursor: 'pointer', opacity: busy ? 0.6 : 1,
                    }}>
                    {busy ? '✦ Generating…' : '✨ Generate it'}
                  </button>
                  {errors[sectionIndex] && (
                    <span style={{ fontSize: 12, color: '#991b1b' }}>⚠️ {errors[sectionIndex]}</span>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
