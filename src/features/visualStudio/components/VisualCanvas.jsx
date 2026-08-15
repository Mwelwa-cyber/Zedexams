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
  buildAssessmentDiagramHandoff, defaultFollowUps, DEFAULT_DIAGRAM_INSTRUCTION,
} from '../lib/visualVersions'
import { uploadVisualImage, saveVisualAsset } from '../services/visualAssetService'
import { requestAutoLabels } from '../services/autoLabelService'
import {
  proposalsToCanvasObjects, isLowConfidence, lowConfidenceCount, autoLabelResultMessage,
} from '../lib/autoLabelClient'
import { writeVisualHandoff } from '../../../utils/studioHandoff'
import { runExportPreflight } from '../../../utils/exportPreflight'
import { downloadHtmlAsPdf } from '../../../utils/htmlToPdf'
import { submitPictureToBank } from '../../../utils/pictureBankService'
import { deriveKeywords } from '../lib/visualPrompt'
import { outputTypeToVersion } from '../lib/visualStudioMeta'
import ImageEditorModal from '../../../shared/components/ImageEditorModal'
import ExportPreflightModal from './ExportPreflightModal'
import {
  IconCursor, IconTag, IconText, IconArrow, IconBox, IconUndo, IconRedo,
  IconLock, IconTrash, IconCopy, IconDownload, IconSend, IconBack, IconSaved,
  IconCircle, IconLine, IconBlankLine, IconAdjust, IconBank,
} from './VsIcons'

const COLORS = ['#111111', '#1e6b5c', '#c0392b', '#2563eb', '#7c3aed', '#b7791f']
// Object types defined by two points (created by drag, moved/reshaped via
// endpoint handles) — as opposed to single-point label/text objects.
const SEGMENT_TYPES = ['arrow', 'line', 'box', 'ellipse', 'answerline']
const isSeg = (t) => SEGMENT_TYPES.includes(t)
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
  const [version, setVersion] = useState(visual?.outputType ? outputTypeToVersion(visual.outputType) : 'teacher')
  const [locked, setLocked] = useState(false)
  const [title, setTitle] = useState(visual?.title || 'Untitled visual')
  const [instruction, setInstruction] = useState(DEFAULT_DIAGRAM_INSTRUCTION)
  // Assessment Diagram mode: free-text follow-up questions printed BELOW the
  // diagram ("State the function of part Q." …). The "Name the parts P, Q, R"
  // question is generated from the labels by buildAssessmentDiagramHandoff.
  const [followUps, setFollowUps] = useState([])
  // The working image. Starts as the generated/selected picture; "Adjust image"
  // (crop/rotate/B&W via the shared ImageEditorModal) replaces it in place.
  const [imageUrl, setImageUrl] = useState(visual?.imageUrl || '')
  const [adjusting, setAdjusting] = useState(false)
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
      // e.key is undefined for some IME / Android soft-keyboard keydown
      // events — guard before .toLowerCase() so this window listener can't
      // throw (same crash class as #1438).
      const key = (e.key || '').toLowerCase()
      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedId) {
        e.preventDefault()
        commit(objects.filter((o) => o.id !== selectedId))
        setSelectedId(null)
      } else if ((e.ctrlKey || e.metaKey) && key === 'z' && !e.shiftKey) {
        e.preventDefault(); undo()
      } else if ((e.ctrlKey || e.metaKey) && (key === 'y' || (key === 'z' && e.shiftKey))) {
        e.preventDefault(); redo()
      } else if (e.key === 'Escape') {
        setSelectedId(null)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [objects, selectedId, commit, undo, redo])

  /* ----- auto-label on open (spec 1C) ----- */
  // A freshly generated picture must not arrive at "0 labels placed": when the
  // handoff sets autoLabelOnOpen and the art has no labels yet, run ONE
  // labelling pass automatically. Mount-only by design (the flag describes the
  // moment of arrival, not the editing session), hence the empty deps.
  const autoLabelRanRef = useRef(false)
  useEffect(() => {
    if (autoLabelRanRef.current) return
    if (!visual?.autoLabelOnOpen || !imageUrl || objects.length > 0) return
    autoLabelRanRef.current = true
    autoLabelPicture()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount-only: re-running on edits would re-label a reviewed diagram
  }, [])

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
    if (isSeg(tool)) {
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
      if (isSeg(o.type)) {
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
    // Dragging an AI-proposed label IS the teacher reviewing its position —
    // clear the low-confidence flag rather than leaving a stale amber mark.
    if (d.mode === 'point') {
      setObjects((prev) => prev.map((o) => {
        if (o.id !== d.id || o.confidence == null) return o
        const { confidence, ...rest } = o
        return rest
      }))
    }
  }

  function updateSelected(patch) {
    if (!selectedId) return
    commit(objects.map((o) => {
      if (o.id !== selectedId) return o
      const next = { ...o, ...patch }
      // Renaming an AI-proposed label is the teacher reviewing it — the
      // low-confidence flag goes with the review, not with time.
      if (patch.text !== undefined && next.confidence != null) delete next.confidence
      return next
    }))
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
    return bakeVisual({ imageUrl, objects: lettered, version: forVersion })
  }

  // Replace the working image with the crop/rotate/enhanced result from the
  // shared ImageEditorModal (it returns a baked JPEG File, or null if only the
  // size preset changed — in which case there is nothing to swap).
  async function applyImageEdit({ file }) {
    setAdjusting(false)
    if (!file) return
    try {
      const dataUrl = await blobToDataUrl(file)
      setImageUrl(String(dataUrl))
    } catch {
      setError('Could not apply the image edit.')
    }
  }

  /* ----- actions ----- */
  // Spec 1C: AI proposals are just pre-filled manual labels — they land as
  // ordinary label objects (drag / rename / delete), low-confidence ones
  // flagged amber, and any failure drops the teacher into manual labelling
  // rather than a dead end.
  async function autoLabelPicture() {
    if (!imageUrl || busy) return
    setBusy('autolabel'); setError('')
    try {
      const res = await requestAutoLabels({
        imageUrl,
        subject: visual.subject || '',
        grade: visual.grade || '',
        topic: visual.topic || '',
        subtopic: visual.subtopic || '',
        existingWords: labelObjs.map((l) => l.text).filter(Boolean),
      })
      const proposed = proposalsToCanvasObjects(res.parts || [], { color })
      if (proposed.length) commit([...objects, ...proposed])
      onToast?.(autoLabelResultMessage({
        added: proposed.length,
        grounded: res.grounded !== false,
        failed: Boolean(res.failed),
        lowCount: lowConfidenceCount(proposed, res.lowConfidenceThreshold || undefined),
      }))
    } catch (e) {
      setError(e?.message || 'Auto-label failed — add labels manually with the Label tool.')
    } finally {
      setBusy('')
    }
  }

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
        safetyStatus: visual.safetyStatus || 'unreviewed',
        reviewNotes: visual.reviewNotes || '',
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
      // Escape label-derived text: teacher input must never be interpolated raw
      // into export HTML. answerKeyLines() returns PLAIN text by design (it is
      // also persisted to Firestore), so escaping happens here at the HTML site.
      const keyHtml = version === 'answerKey' && labelObjs.length
        ? `<div style="margin-top:14px;font-size:12pt"><b>Answer key:</b> ${escapeHtml(answerKeyLines(labelObjs).join('; '))}</div>`
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
          safetyStatus: visual.safetyStatus || 'unreviewed',
          reviewNotes: visual.reviewNotes || '',
          status: 'draft',
          visibility: 'private',
          usedIn: ['assessment'],
        })
        writeVisualHandoff(buildAssessmentDiagramHandoff({
          imageUrl: url,
          imageAlt,
          imageWidth: 'full',
          labels: labelObjs,
          instruction,
          followUps,
        }))
        onToast?.('Diagram + questions ready — opening the Assessment Paper Studio…')
        navigate('/teacher/assessment-papers/new?from=visual-studio')
      }
      if (!pre.ok) {
        setPreflight({ result: pre, onProceed: finalize })
        setBusy('')
        return
      }
      await finalize()
    } catch (e) {
      setError(e?.message || 'Could not send to the Assessment Paper Studio.')
      setBusy('')
    }
  }

  async function addToBank() {
    if (!uid) { setError('Please sign in.'); return }
    setBusy('bank'); setError('')
    try {
      const { blob } = await bake(version)
      const { url, storagePath } = await uploadVisualImage(blob, { uid, suffix: 'bank' })
      await submitPictureToBank({
        url,
        storagePath,
        name: title,
        keywords: deriveKeywords({ topic: visual.topic, subtopic: visual.subtopic, subject: visual.subject, grade: visual.grade }),
        subject: visual.subject || '',
        gradeBand: visual.grade ? `G${visual.grade}` : '',
        uid,
      })
      onToast?.('Submitted to the shared Picture Bank — pending admin review')
    } catch (e) {
      setError(e?.message || 'Could not submit to the Picture Bank.')
    } finally {
      setBusy('')
    }
  }

  const toolButtons = [
    { id: 'select', Icon: IconCursor, label: 'Select' },
    { id: 'label', Icon: IconTag, label: 'Label' },
    { id: 'text', Icon: IconText, label: 'Text' },
    { id: 'arrow', Icon: IconArrow, label: 'Arrow' },
    { id: 'line', Icon: IconLine, label: 'Line' },
    { id: 'ellipse', Icon: IconCircle, label: 'Circle' },
    { id: 'box', Icon: IconBox, label: 'Box' },
    { id: 'answerline', Icon: IconBlankLine, label: 'Blank line' },
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
        <button type="button" className="vs-iconbtn" onClick={() => setLocked((v) => !v)} style={locked ? { background: '#dcebe6', borderColor: '#bcd9cf' } : null}>
          <IconLock size={15} /> {locked ? 'Image locked' : 'Lock image'}
        </button>
        <button type="button" className="vs-iconbtn" disabled={!imageUrl || !!busy} onClick={() => setAdjusting(true)}>
          <IconAdjust size={15} /> Adjust image
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
          {imageUrl && labelObjs.length === 0 && !locked && (
            <button
              type="button"
              className="vs-autolabel-cta"
              disabled={!!busy}
              onClick={autoLabelPicture}
            >
              {busy === 'autolabel' ? <span className="vs-spinner" /> : <span aria-hidden="true">✦</span>}
              {busy === 'autolabel' ? ' Finding the parts…' : ' Auto-label this picture'}
            </button>
          )}
          <div
            className="vs-canvas"
            ref={canvasRef}
            onPointerDown={onCanvasPointerDown}
            onPointerMove={onCanvasPointerMove}
            onPointerUp={onCanvasPointerUp}
            style={{ cursor: tool === 'select' ? 'default' : 'crosshair' }}
          >
            <img className="vs-bg" src={imageUrl} alt={imageAlt} crossOrigin="anonymous" draggable={false} />
            <div className="vs-overlay">
              {/* segments (arrows/lines/boxes) */}
              {size.w > 0 && (
                <svg className="vs-ov-svg" width={size.w} height={size.h}>
                  {lettered.filter((o) => isSeg(o.type)).map((o) => {
                    const x1 = o.x * size.w; const y1 = o.y * size.h
                    const x2 = (o.x2 ?? o.x) * size.w; const y2 = (o.y2 ?? o.y) * size.h
                    const sw = Math.max(2, size.w / 350)
                    if (o.type === 'box') {
                      return <rect key={o.id} x={Math.min(x1, x2)} y={Math.min(y1, y2)} width={Math.abs(x2 - x1)} height={Math.abs(y2 - y1)} rx={6} fill="none" stroke={o.color} strokeWidth={sw} />
                    }
                    if (o.type === 'ellipse') {
                      return <ellipse key={o.id} cx={(x1 + x2) / 2} cy={(y1 + y2) / 2} rx={Math.abs(x2 - x1) / 2} ry={Math.abs(y2 - y1) / 2} fill="none" stroke={o.color} strokeWidth={sw} />
                    }
                    if (o.type === 'answerline') {
                      // Always horizontal — a write-on rule for learners.
                      return <line key={o.id} x1={x1} y1={y1} x2={x2} y2={y1} stroke={o.color} strokeWidth={sw} strokeLinecap="round" />
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
              {tool === 'select' && lettered.filter((o) => isSeg(o.type)).map((o) => ([
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
                  className={`vs-label vs-ov-item ${selectedId === o.id ? 'selected' : ''} ${isLowConfidence(o) ? 'low-conf' : ''}`}
                  title={isLowConfidence(o) ? 'AI is unsure about this label — check the word and position' : undefined}
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
                  {isLowConfidence(selected) && (
                    <p className="vs-sub vs-note-warn" style={{ marginTop: 6 }}>
                      ⚠ AI is unsure about this label — check the word and position.
                      Renaming or dragging it clears the flag.
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
              <div className="vs-field">
                <label>Follow-up questions (below the diagram)</label>
                {followUps.map((q, i) => (
                  <div key={`fu-${i}`} style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
                    <input type="text" value={q} placeholder="e.g. State the function of part Q."
                      onChange={(e) => setFollowUps(followUps.map((x, j) => (j === i ? e.target.value : x)))} />
                    <button type="button" className="vs-iconbtn danger" aria-label="Remove question"
                      onClick={() => setFollowUps(followUps.filter((_, j) => j !== i))}><IconTrash size={14} /></button>
                  </div>
                ))}
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  <button type="button" className="vs-chip" onClick={() => setFollowUps([...followUps, ''])}>+ Add question</button>
                  <button type="button" className="vs-chip" disabled={!labelObjs.length}
                    onClick={() => setFollowUps(defaultFollowUps(labelObjs))}>Suggest from labels</button>
                </div>
                {labelObjs.length > 0 && (
                  <p className="vs-sub" style={{ marginTop: 6 }}>
                    Sending to the Assessment Paper Studio adds “Name the parts labelled {labelObjs.map((l) => l.letter).join(', ')}” plus these questions below the diagram.
                  </p>
                )}
              </div>
              <p className="vs-sub">
                {labelObjs.length} label{labelObjs.length === 1 ? '' : 's'} placed.
                {lowConfidenceCount(objects) > 0 && (
                  <> <span className="vs-note-warn">{lowConfidenceCount(objects)} amber</span> — AI proposals to double-check.</>
                )}
              </p>
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
          {busy === 'send' ? <span className="vs-spinner" /> : <IconSend size={15} />} Send to Assessment Paper Studio
        </button>
        <button type="button" className="vs-iconbtn" disabled={!!busy} onClick={addToBank}>
          {busy === 'bank' ? <span className="vs-spinner" /> : <IconBank size={15} />} Add to Picture Bank
        </button>
        <button type="button" className="vs-iconbtn" disabled={!!busy} onClick={downloadPng}>
          {busy === 'png' ? <span className="vs-spinner" /> : <IconDownload size={15} />} PNG
        </button>
        <button type="button" className="vs-iconbtn" disabled={!!busy} onClick={downloadPdf}>
          {busy === 'pdf' ? <span className="vs-spinner" /> : <IconDownload size={15} />} PDF
        </button>
      </div>

      {adjusting && imageUrl && (
        <ImageEditorModal
          imageUrl={imageUrl}
          imageWidth="full"
          onApply={applyImageEdit}
          onClose={() => setAdjusting(false)}
        />
      )}

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
