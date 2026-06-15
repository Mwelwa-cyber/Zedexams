/* Visual Studio canvas editor (brief items 4 & 5).
 *
 * A deliberately simple editor (not a Canva clone): drop letter labels
 * (P, Q, R…), free text, arrows, lines and boxes onto a generated/selected
 * image, then bake the whole thing to a single flat PNG. One raster = nothing
 * to fall out of an export.
 *
 * The same label set drives three printable versions — teacher (full words),
 * learner (letters + blank rows), answer key (letters + legend) — chosen with
 * the version toggle and applied at bake time by `labelTextForVersion`.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../../../contexts/AuthContext'
import { bakeVisual, downloadBlob } from '../lib/visualCanvasRaster'
import {
  LETTER_SEQUENCE, labelTextForVersion, assignLetters, answerKeyLines,
  buildQuestionPatch, DEFAULT_DIAGRAM_INSTRUCTION,
} from '../lib/visualVersions'
import { uploadVisualImage, saveVisualAsset } from '../services/visualAssetService'
import { writeVisualHandoff } from '../../../utils/studioHandoff'
import { runExportPreflight } from '../../../utils/exportPreflight'
import { downloadHtmlAsPdf } from '../../../utils/htmlToPdf'
import ExportPreflightModal from './ExportPreflightModal'
import {
  IconCursor, IconTag, IconText, IconArrow, IconBox, IconUndo, IconRedo,
  IconLock, IconTrash, IconCopy, IconDownload, IconSend, IconBack, IconSaved,
} from './VsIcons'

const COLORS = ['#111111', '#1e6b5c', '#c0392b', '#2563eb', '#7c3aed', '#b7791f']
const VERSION_LABELS = [
  { id: 'teacher', label: 'Teacher (words)' },
  { id: 'learner', label: 'Learner (P,Q,R)' },
  { id: 'answerKey', label: 'Answer key' },
  { id: 'picture', label: 'Picture only' },
]

function clamp01(v) { return Math.max(0, Math.min(1, v)) }
function uid8() {
  return (typeof crypto !== 'undefined' && crypto.randomUUID)
    ? crypto.randomUUID().slice(0, 8)
    : `${Date.now()}-${Math.round(Math.random() * 1e6)}`
}
function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader()
    fr.onload = () => resolve(fr.result)
    fr.onerror = () => reject(new Error('Could not read image'))
    fr.readAsDataURL(blob)
  })
}

// Assign exam letters (P, Q, R…) to label-type objects in array order; leave
// other objects untouched. Used for both on-screen render and baking.
function withLetters(objects) {
  let li = 0
  return objects.map((o) => {
    if (o.type === 'label') {
      const letter = LETTER_SEQUENCE[li] || `#${li + 1}`
      li += 1
      return { ...o, letter }
    }
    return o
  })
}

export default function VisualCanvas({ visual, onBack, onToast }) {
  const { currentUser, userProfile } = useAuth()
  const navigate = useNavigate()
  const uid = currentUser?.uid

  const [objects, setObjects] = useState(visual?.labels || [])
  const [past, setPast] = useState([])
  const [future, setFuture] = useState([])
  const [selectedId, setSelectedId] = useState(null)
  const [tool, setTool] = useState('select')
  const [color, setColor] = useState('#111111')
  const [version, setVersion] = useState('teacher')
  const [locked, setLocked] = useState(false)
  const [title, setTitle] = useState(visual?.title || 'Untitled visual')
  const [instruction, setInstruction] = useState(DEFAULT_DIAGRAM_INSTRUCTION)
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [size, setSize] = useState({ w: 0, h: 0 })
  const [preflight, setPreflight] = useState(null) // { result, onProceed }

  const canvasRef = useRef(null)
  const dragRef = useRef(null)

  const lettered = useMemo(() => withLetters(objects), [objects])
  const labelObjs = useMemo(
    () => assignLetters(objects.filter((o) => o.type === 'label')),
    [objects],
  )
  const selected = objects.find((o) => o.id === selectedId) || null

  /* ----- history ----- */
  const commit = useCallback((next) => {
    setPast((p) => [...p.slice(-49), objects])
    setFuture([])
    setObjects(next)
  }, [objects])

  const undo = useCallback(() => {
    setPast((p) => {
      if (!p.length) return p
      setFuture((f) => [objects, ...f])
      setObjects(p[p.length - 1])
      return p.slice(0, -1)
    })
  }, [objects])

  const redo = useCallback(() => {
    setFuture((f) => {
      if (!f.length) return f
      setPast((p) => [...p, objects])
      setObjects(f[0])
      return f.slice(1)
    })
  }, [objects])

  /* ----- measure canvas for SVG overlay ----- */
  useEffect(() => {
    const el = canvasRef.current
    if (!el || typeof ResizeObserver === 'undefined') return undefined
    const ro = new ResizeObserver(() => {
      setSize({ w: el.clientWidth, h: el.clientHeight })
    })
    ro.observe(el)
    setSize({ w: el.clientWidth, h: el.clientHeight })
    return () => ro.disconnect()
  }, [])

  /* ----- keyboard ----- */
  useEffect(() => {
    function onKey(e) {
      const tag = (e.target.tagName || '').toLowerCase()
      if (tag === 'input' || tag === 'textarea') return
      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedId) {
        e.preventDefault()
        commit(objects.filter((o) => o.id !== selectedId))
        setSelectedId(null)
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !e.shiftKey) {
        e.preventDefault(); undo()
      } else if ((e.ctrlKey || e.metaKey) && (e.key.toLowerCase() === 'y' || (e.key.toLowerCase() === 'z' && e.shiftKey))) {
        e.preventDefault(); redo()
      } else if (e.key === 'Escape') {
        setSelectedId(null)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [objects, selectedId, commit, undo, redo])

  function ratioFromEvent(e) {
    const rect = canvasRef.current?.getBoundingClientRect()
    if (!rect || !rect.width) return { x: 0.5, y: 0.5 }
    return {
      x: clamp01((e.clientX - rect.left) / rect.width),
      y: clamp01((e.clientY - rect.top) / rect.height),
    }
  }

  /* ----- create / select / drag ----- */
  function addPoint(type, r) {
    const obj = { id: `${type}-${uid8()}`, type, x: r.x, y: r.y, color, text: type === 'text' ? 'Label' : '' }
    commit([...objects, obj])
    setSelectedId(obj.id)
  }

  function onCanvasPointerDown(e) {
    if (locked) return
    if (e.target.closest('[data-ov-item]')) return // handled by the item
    const r = ratioFromEvent(e)
    if (tool === 'label' || tool === 'text') {
      addPoint(tool, r)
      return
    }
    if (tool === 'arrow' || tool === 'line' || tool === 'box') {
      const obj = { id: `${tool}-${uid8()}`, type: tool, x: r.x, y: r.y, x2: r.x, y2: r.y, color }
      setPast((p) => [...p.slice(-49), objects])
      setFuture([])
      setObjects([...objects, obj])
      setSelectedId(obj.id)
      dragRef.current = { mode: 'create', id: obj.id }
      canvasRef.current?.setPointerCapture?.(e.pointerId)
      return
    }
    // select tool on background → deselect
    setSelectedId(null)
  }

  function startItemDrag(e, obj, handle) {
    if (locked) return
    e.stopPropagation()
    setSelectedId(obj.id)
    const r = ratioFromEvent(e)
    setPast((p) => [...p.slice(-49), objects])
    setFuture([])
    dragRef.current = {
      mode: handle || 'point',
      id: obj.id,
      grab: { dx: r.x - obj.x, dy: r.y - obj.y },
      start: { ...obj },
    }
    canvasRef.current?.setPointerCapture?.(e.pointerId)
  }

  function onCanvasPointerMove(e) {
    const d = dragRef.current
    if (!d) return
    const r = ratioFromEvent(e)
    setObjects((prev) => prev.map((o) => {
      if (o.id !== d.id) return o
      if (d.mode === 'create' || d.mode === 'end') return { ...o, x2: r.x, y2: r.y }
      if (d.mode === 'segstart') return { ...o, x: r.x, y: r.y }
      // point / move whole
      if (o.type === 'arrow' || o.type === 'line' || o.type === 'box') {
        const dx = (r.x - (d.grab?.dx ?? 0)) - d.start.x
        const dy = (r.y - (d.grab?.dy ?? 0)) - d.start.y
        return {
          ...o,
          x: clamp01(d.start.x + dx), y: clamp01(d.start.y + dy),
          x2: clamp01((d.start.x2 ?? d.start.x) + dx), y2: clamp01((d.start.y2 ?? d.start.y) + dy),
        }
      }
      return { ...o, x: clamp01(r.x - (d.grab?.dx ?? 0)), y: clamp01(r.y - (d.grab?.dy ?? 0)) }
    }))
  }

  function onCanvasPointerUp() {
    const d = dragRef.current
    dragRef.current = null
    if (!d) return
    // Discard a zero-length segment created by a stray click.
    if (d.mode === 'create') {
      setObjects((prev) => prev.filter((o) => {
        if (o.id !== d.id) return true
        return Math.hypot((o.x2 - o.x), (o.y2 - o.y)) > 0.02
      }))
    }
  }

  function updateSelected(patch) {
    if (!selectedId) return
    commit(objects.map((o) => (o.id === selectedId ? { ...o, ...patch } : o)))
  }
  function deleteSelected() {
    if (!selectedId) return
    commit(objects.filter((o) => o.id !== selectedId))
    setSelectedId(null)
  }
  function duplicateSelected() {
    if (!selected) return
    const copy = { ...selected, id: `${selected.type}-${uid8()}`, x: clamp01(selected.x + 0.04), y: clamp01(selected.y + 0.04) }
    if (selected.x2 != null) { copy.x2 = clamp01(selected.x2 + 0.04); copy.y2 = clamp01(selected.y2 + 0.04) }
    commit([...objects, copy])
    setSelectedId(copy.id)
  }

  /* ----- bake helpers ----- */
  const imageAlt = `${title}${version === 'learner' ? ' (learner version)' : version === 'answerKey' ? ' (answer key)' : ''}`

  async function bake(forVersion) {
    return bakeVisual({ imageUrl: visual.imageUrl, objects: lettered, version: forVersion })
  }

  /* ----- actions ----- */
  async function saveToMyVisuals() {
    if (!uid) { setError('Please sign in.'); return }
    setBusy('save'); setError('')
    try {
      const { blob, width, height } = await bake(version)
      const { url, storagePath, sizeBytes } = await uploadVisualImage(blob, { uid, suffix: version })
      const hasLabels = labelObjs.length > 0
      await saveVisualAsset({
        createdBy: uid,
        createdByName: userProfile?.displayName || '',
        title,
        grade: visual.grade || '',
        subject: visual.subject || '',
        topic: visual.topic || '',
        subtopic: visual.subtopic || '',
        style: visual.style || 'bw_test_diagram',
        useCase: visual.useCase || '',
        imageType: 'diagram',
        isLabelled: hasLabels && version !== 'picture',
        hasAnswerKey: version === 'answerKey',
        isBlackAndWhite: visual.isBlackAndWhite !== false,
        imageUrl: url,
        thumbnailUrl: url,
        storagePath,
        width,
        height,
        sourceType: visual.sourceType || 'ai',
        aiModel: visual.aiModel || '',
        aiPrompt: visual.aiPrompt || '',
        labels: labelObjs.map((l) => ({ id: l.id, letter: l.letter, text: l.text || '', x: l.x, y: l.y })),
        answerKey: answerKeyLines(labelObjs).join('\n'),
        safetyStatus: 'unreviewed',
        status: 'draft',
        visibility: 'private',
      })
      onToast?.(`Saved ${VERSION_LABELS.find((v) => v.id === version)?.label || ''} to My Visuals (${(sizeBytes / 1024).toFixed(0)} KB)`)
    } catch (e) {
      setError(e?.message || 'Could not save the visual.')
    } finally {
      setBusy('')
    }
  }

  async function downloadPng() {
    setBusy('png'); setError('')
    try {
      const { blob } = await bake(version)
      downloadBlob(blob, `${title.replace(/[^a-z0-9]+/gi, '-').toLowerCase() || 'visual'}-${version}.png`)
    } catch (e) {
      setError(e?.message || 'Could not export PNG.')
    } finally {
      setBusy('')
    }
  }

  async function downloadPdf() {
    setBusy('pdf'); setError('')
    try {
      const { blob } = await bake(version)
      const dataUrl = await blobToDataUrl(blob)
      const blankRows = (version === 'learner' || version === 'answerKey')
        ? labelObjs.map((l) => `<p style="margin:6px 0;font-size:13pt">${l.letter}. ______________________________</p>`).join('')
        : ''
      const keyHtml = version === 'answerKey' && labelObjs.length
        ? `<div style="margin-top:14px;font-size:12pt"><b>Answer key:</b> ${answerKeyLines(labelObjs).join('; ')}</div>`
        : ''
      const html = `<div style="font-family:Arial,sans-serif;color:#111;padding:8px">
        <h2 style="margin:0 0 8px">${escapeHtml(title)}</h2>
        <p style="margin:0 0 10px;font-size:13pt">${escapeHtml(instruction)}</p>
        <div style="text-align:center"><img src="${dataUrl}" style="max-width:100%;max-height:540pt" alt="${escapeHtml(imageAlt)}"></div>
        ${blankRows}${keyHtml}
      </div>`
      await downloadHtmlAsPdf(html, `${title.replace(/[^a-z0-9]+/gi, '-').toLowerCase() || 'visual'}-${version}.pdf`)
    } catch (e) {
      setError(e?.message || 'Could not export PDF.')
    } finally {
      setBusy('')
    }
  }

  async function sendToAssessment() {
    if (!uid) { setError('Please sign in.'); return }
    setBusy('send'); setError('')
    try {
      const useVersion = labelObjs.length ? 'learner' : 'picture'
      const { blob, width, height } = await bake(useVersion)
      const { url, storagePath } = await uploadVisualImage(blob, { uid, suffix: 'assessment' })

      // Pre-export reliability check on the uploaded URL (item 8). If the byte
      // read fails, warn before handing off rather than after the teacher
      // downloads a paper with a missing figure.
      const pre = await runExportPreflight([{ url, isBlackAndWhite: visual.isBlackAndWhite !== false }])
      const finalize = async () => {
        await saveVisualAsset({
          createdBy: uid,
          createdByName: userProfile?.displayName || '',
          title,
          grade: visual.grade || '',
          subject: visual.subject || '',
          topic: visual.topic || '',
          subtopic: visual.subtopic || '',
          style: visual.style || 'bw_test_diagram',
          useCase: 'assessment',
          imageType: 'diagram',
          isLabelled: labelObjs.length > 0,
          hasAnswerKey: labelObjs.length > 0,
          isBlackAndWhite: visual.isBlackAndWhite !== false,
          imageUrl: url,
          thumbnailUrl: url,
          storagePath,
          width,
          height,
          sourceType: visual.sourceType || 'ai',
          aiModel: visual.aiModel || '',
          aiPrompt: visual.aiPrompt || '',
          labels: labelObjs.map((l) => ({ id: l.id, letter: l.letter, text: l.text || '', x: l.x, y: l.y })),
          answerKey: answerKeyLines(labelObjs).join('\n'),
          safetyStatus: 'unreviewed',
          status: 'draft',
          visibility: 'private',
          usedIn: ['assessment'],
        })
        writeVisualHandoff(buildQuestionPatch({
          imageUrl: url,
          imageAlt,
          imageWidth: 'full',
          labels: labelObjs,
          version: 'learner',
          instruction,
        }))
        onToast?.('Diagram ready — opening Assessment Studio…')
        navigate('/teacher/assessments/new?from=visual-studio')
      }
      if (!pre.ok) {
        setPreflight({ result: pre, onProceed: finalize })
        setBusy('')
        return
      }
      await finalize()
    } catch (e) {
      setError(e?.message || 'Could not send to Assessment Studio.')
      setBusy('')
    }
  }

  const toolButtons = [
    { id: 'select', Icon: IconCursor, label: 'Select' },
    { id: 'label', Icon: IconTag, label: 'Label' },
    { id: 'text', Icon: IconText, label: 'Text' },
    { id: 'arrow', Icon: IconArrow, label: 'Arrow' },
    { id: 'box', Icon: IconBox, label: 'Box' },
  ]

  return (
    <div>
      {/* top toolbar */}
      <div className="vs-toolbar">
        <button type="button" className="vs-iconbtn" onClick={onBack}><IconBack size={15} /> Back</button>
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className="vs-iconbtn"
          style={{ fontWeight: 700, minWidth: 200, cursor: 'text' }}
          aria-label="Visual title"
        />
        <button type="button" className="vs-iconbtn" disabled={!past.length} onClick={undo}><IconUndo size={15} /> Undo</button>
        <button type="button" className="vs-iconbtn" disabled={!future.length} onClick={redo}><IconRedo size={15} /> Redo</button>
        <button type="button" className={`vs-iconbtn ${locked ? '' : ''}`} onClick={() => setLocked((v) => !v)} style={locked ? { background: '#dcebe6', borderColor: '#bcd9cf' } : null}>
          <IconLock size={15} /> {locked ? 'Image locked' : 'Lock image'}
        </button>
        <div className="vs-spacer" />
        <div className="vs-versions">
          {VERSION_LABELS.map((v) => (
            <button key={v.id} type="button" className={`vs-chip ${version === v.id ? 'active' : ''}`} onClick={() => setVersion(v.id)}>
              {v.label}
            </button>
          ))}
        </div>
      </div>

      <div className="vs-editor">
        {/* tool rail */}
        <div className="vs-tools">
          {toolButtons.map(({ id, Icon, label }) => (
            <button key={id} type="button" className={`vs-tool ${tool === id ? 'active' : ''}`} onClick={() => setTool(id)} title={label} disabled={locked && id !== 'select'}>
              <Icon size={18} /><span>{label}</span>
            </button>
          ))}
        </div>

        {/* stage */}
        <div className="vs-stage">
          <div
            className="vs-canvas"
            ref={canvasRef}
            onPointerDown={onCanvasPointerDown}
            onPointerMove={onCanvasPointerMove}
            onPointerUp={onCanvasPointerUp}
            style={{ cursor: tool === 'select' ? 'default' : 'crosshair' }}
          >
            <img className="vs-bg" src={visual.imageUrl} alt={imageAlt} crossOrigin="anonymous" draggable={false} />
            <div className="vs-overlay">
              {/* segments (arrows/lines/boxes) */}
              {size.w > 0 && (
                <svg className="vs-ov-svg" width={size.w} height={size.h}>
                  {lettered.filter((o) => o.type === 'arrow' || o.type === 'line' || o.type === 'box').map((o) => {
                    const x1 = o.x * size.w; const y1 = o.y * size.h
                    const x2 = (o.x2 ?? o.x) * size.w; const y2 = (o.y2 ?? o.y) * size.h
                    const sw = Math.max(2, size.w / 350)
                    if (o.type === 'box') {
                      return <rect key={o.id} x={Math.min(x1, x2)} y={Math.min(y1, y2)} width={Math.abs(x2 - x1)} height={Math.abs(y2 - y1)} rx={6} fill="none" stroke={o.color} strokeWidth={sw} />
                    }
                    return (
                      <g key={o.id}>
                        <line x1={x1} y1={y1} x2={x2} y2={y2} stroke={o.color} strokeWidth={sw} strokeLinecap="round" />
                        {o.type === 'arrow' && (() => {
                          const ang = Math.atan2(y2 - y1, x2 - x1); const a = Math.max(9, sw * 4)
                          return <polygon points={`${x2},${y2} ${x2 - a * Math.cos(ang - Math.PI / 6)},${y2 - a * Math.sin(ang - Math.PI / 6)} ${x2 - a * Math.cos(ang + Math.PI / 6)},${y2 - a * Math.sin(ang + Math.PI / 6)}`} fill={o.color} />
                        })()}
                      </g>
                    )
                  })}
                </svg>
              )}

              {/* segment endpoint handles (select tool only) */}
              {tool === 'select' && lettered.filter((o) => o.type === 'arrow' || o.type === 'line' || o.type === 'box').map((o) => ([
                <div key={`${o.id}-s`} data-ov-item className={`vs-hit ${selectedId === o.id ? 'selected' : ''}`}
                  style={{ left: `${o.x * 100}%`, top: `${o.y * 100}%` }}
                  onPointerDown={(e) => startItemDrag(e, o, 'segstart')} />,
                <div key={`${o.id}-e`} data-ov-item className="vs-hit"
                  style={{ left: `${(o.x2 ?? o.x) * 100}%`, top: `${(o.y2 ?? o.y) * 100}%` }}
                  onPointerDown={(e) => startItemDrag(e, o, 'end')} />,
              ]))}

              {/* labels + text */}
              {lettered.filter((o) => o.type === 'label').map((o) => (
                <div key={o.id} data-ov-item
                  className={`vs-label vs-ov-item ${selectedId === o.id ? 'selected' : ''}`}
                  style={{ left: `${o.x * 100}%`, top: `${o.y * 100}%`, borderColor: o.color, color: o.color }}
                  onPointerDown={(e) => startItemDrag(e, o)}
                >
                  {labelTextForVersion(o, version) || '•'}
                </div>
              ))}
              {lettered.filter((o) => o.type === 'text').map((o) => (
                <div key={o.id} data-ov-item
                  className={`vs-text-ov vs-ov-item ${selectedId === o.id ? 'selected' : ''}`}
                  style={{ left: `${o.x * 100}%`, top: `${o.y * 100}%`, color: o.color }}
                  onPointerDown={(e) => startItemDrag(e, o)}
                >
                  {o.text || 'text'}
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* inspector */}
        <div className="vs-inspector">
          <h4>{selected ? `Edit ${selected.type}` : 'Inspector'}</h4>
          {selected ? (
            <>
              {(selected.type === 'label' || selected.type === 'text') && (
                <div className="vs-field">
                  <label>{selected.type === 'label' ? 'Part name (word)' : 'Text'}</label>
                  <input type="text" value={selected.text || ''} maxLength={80}
                    onChange={(e) => updateSelected({ text: e.target.value })}
                    placeholder={selected.type === 'label' ? 'e.g. Trachea' : 'Type text'} />
                  {selected.type === 'label' && (
                    <p className="vs-sub" style={{ marginTop: 6 }}>
                      Learner / answer-key versions show the letter <b>{labelObjs.find((l) => l.id === selected.id)?.letter || '?'}</b> instead of the word.
                    </p>
                  )}
                </div>
              )}
              <div className="vs-field">
                <label>Colour</label>
                <div className="vs-swatches">
                  {COLORS.map((c) => (
                    <button key={c} type="button" aria-label={`colour ${c}`}
                      className={`vs-sw ${selected.color === c ? 'active' : ''}`}
                      style={{ background: c }} onClick={() => updateSelected({ color: c })} />
                  ))}
                </div>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button type="button" className="vs-iconbtn" onClick={duplicateSelected}><IconCopy size={14} /> Duplicate</button>
                <button type="button" className="vs-iconbtn danger" onClick={deleteSelected}><IconTrash size={14} /> Delete</button>
              </div>
            </>
          ) : (
            <>
              <p className="vs-sub">
                Pick a tool and click the picture to add it. Use letter labels for exam-style
                P, Q, R parts. Then choose a version and save or send it.
              </p>
              <div className="vs-field" style={{ marginTop: 8 }}>
                <label>New item colour</label>
                <div className="vs-swatches">
                  {COLORS.map((c) => (
                    <button key={c} type="button" aria-label={`colour ${c}`}
                      className={`vs-sw ${color === c ? 'active' : ''}`}
                      style={{ background: c }} onClick={() => setColor(c)} />
                  ))}
                </div>
              </div>
              <div className="vs-field">
                <label>Instruction (above the diagram)</label>
                <textarea value={instruction} onChange={(e) => setInstruction(e.target.value)} rows={2} />
              </div>
              <p className="vs-sub">{labelObjs.length} label{labelObjs.length === 1 ? '' : 's'} placed.</p>
            </>
          )}
        </div>
      </div>

      {error && <p className="vs-hint vs-note-warn" style={{ marginTop: 12 }}>⚠ {error}</p>}

      {/* actions */}
      <div className="vs-actions">
        <button type="button" className="vs-iconbtn" disabled={!!busy} onClick={saveToMyVisuals}>
          {busy === 'save' ? <span className="vs-spinner" /> : <IconSaved size={15} />} Save to My Visuals
        </button>
        <button type="button" className="vs-iconbtn" disabled={!!busy} onClick={sendToAssessment}
          style={{ background: '#1e6b5c', color: '#fff', border: 'none' }}>
          {busy === 'send' ? <span className="vs-spinner" /> : <IconSend size={15} />} Send to Assessment Studio
        </button>
        <button type="button" className="vs-iconbtn" disabled={!!busy} onClick={downloadPng}>
          {busy === 'png' ? <span className="vs-spinner" /> : <IconDownload size={15} />} PNG
        </button>
        <button type="button" className="vs-iconbtn" disabled={!!busy} onClick={downloadPdf}>
          {busy === 'pdf' ? <span className="vs-spinner" /> : <IconDownload size={15} />} PDF
        </button>
      </div>

      {preflight && (
        <ExportPreflightModal
          result={preflight.result}
          onClose={() => { setPreflight(null) }}
          onProceed={async () => {
            const fn = preflight.onProceed
            setPreflight(null)
            setBusy('send')
            try { await fn() } catch (e) { setError(e?.message || 'Failed.') } finally { setBusy('') }
          }}
        />
      )}
    </div>
  )
}

function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}
