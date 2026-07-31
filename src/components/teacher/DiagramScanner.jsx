// Diagram Scanner — capture ONE diagram with a phone/webcam (or upload a file),
// clean it up into a sharp black-on-white print-ready figure, and drop it into a
// question, a new question, or the diagram bank.
//
// All the pixel work lives in src/utils/diagramClean.js — this component is just
// the capture/preview/controls shell. It deliberately mirrors the inline-style
// look of DiagramFixupPanel.jsx (fixed overlay, white rounded card, brand orange
// #d97757, teal text #0e2a32) so the two feel like siblings.

import { useCallback, useEffect, useRef, useState } from 'react'
import { cleanDiagramSource, isDiagramCleanSupported } from '../../utils/diagramClean.js'

const ORANGE = '#d97757'
const TEAL = '#0e2a32'
const MUTED = '#566f76'
const BORDER = '#d9cfb8'

// Shared button look so the action row stays consistent.
const primaryBtn = {
  padding: '9px 16px', borderRadius: 10, fontSize: 14, fontWeight: 800,
  background: ORANGE, color: '#fff', border: 'none', cursor: 'pointer',
}
const ghostBtn = {
  padding: '8px 14px', borderRadius: 10, fontSize: 13, fontWeight: 700,
  border: `1.5px solid ${BORDER}`, background: 'var(--zt-card)', color: TEAL, cursor: 'pointer',
}

// One labelled on/off pill toggle.
function Toggle({ label, checked, onChange }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      style={{
        display: 'flex', alignItems: 'center', gap: 8, padding: '6px 12px',
        borderRadius: 999, fontSize: 13, fontWeight: 700, cursor: 'pointer',
        border: `1.5px solid ${checked ? ORANGE : BORDER}`,
        background: checked ? '#fff3e8' : '#fff', color: TEAL,
      }}
    >
      <span
        aria-hidden="true"
        style={{
          width: 16, height: 16, borderRadius: 4,
          background: checked ? ORANGE : '#fff',
          border: `1.5px solid ${checked ? ORANGE : BORDER}`,
          color: '#fff', fontSize: 12, lineHeight: '13px', textAlign: 'center',
        }}
      >
        {checked ? '✓' : ''}
      </span>
      {label}
    </button>
  )
}

export default function DiagramScanner({
  onClose,
  onInsertIntoQuestion,
  onCreateQuestion,
  onSaveToBank,
  title = 'Diagram Scanner',
}) {
  const supported = isDiagramCleanSupported()

  // 'capture' → choose/snap an image; 'edit' → tune + insert.
  const [stage, setStage] = useState('capture')
  const [originalDataUrl, setOriginalDataUrl] = useState(null)
  const [error, setError] = useState('')

  // Cleaning options the teacher tunes.
  const [blackAndWhite, setBlackAndWhite] = useState(true)
  const [autoCrop, setAutoCrop] = useState(true)
  const [whiten, setWhiten] = useState(true)
  const [rotateTurns, setRotateTurns] = useState(0)
  const [brightness, setBrightness] = useState(0)
  const [contrast, setContrast] = useState(0)
  const [altText, setAltText] = useState('')

  // The cleaned result + a "cleaning in progress" flag.
  const [result, setResult] = useState(null) // { dataUrl, blob, width, height, bounds }
  const [cleaning, setCleaning] = useState(false)

  // Monotonic id so a slow earlier clean can't clobber a newer one.
  const requestIdRef = useRef(0)

  const readFileToDataUrl = useCallback((file) => new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result)
    reader.onerror = () => reject(new Error('Could not read that image file.'))
    reader.readAsDataURL(file)
  }), [])

  const handleFile = useCallback(async (file) => {
    if (!file) return
    setError('')
    try {
      const dataUrl = await readFileToDataUrl(file)
      // Reset per-image tuning so a new capture starts clean.
      setRotateTurns(0)
      setBrightness(0)
      setContrast(0)
      setResult(null)
      setOriginalDataUrl(dataUrl)
      setStage('edit')
    } catch (err) {
      setError(err?.message || 'Could not read that image file.')
    }
  }, [readFileToDataUrl])

  const onInputChange = useCallback((e) => {
    const file = e.target.files && e.target.files[0]
    if (file) handleFile(file)
    // Allow re-picking the same file after a retake.
    e.target.value = ''
  }, [handleFile])

  const onDrop = useCallback((e) => {
    e.preventDefault()
    const file = e.dataTransfer?.files && e.dataTransfer.files[0]
    if (file) handleFile(file)
  }, [handleFile])

  // Recompute the cleaned preview whenever an option or the source changes.
  useEffect(() => {
    if (stage !== 'edit' || !originalDataUrl) return undefined
    if (!supported) return undefined
    const id = requestIdRef.current + 1
    requestIdRef.current = id
    let ignore = false
    setCleaning(true)
    setError('')
    cleanDiagramSource(originalDataUrl, {
      blackAndWhite,
      autoCrop,
      whiten,
      rotateTurns: ((rotateTurns % 4) + 4) % 4,
      brightness,
      contrast,
      mimeType: 'image/png',
    })
      .then((res) => {
        // Stale guard: only the latest request may write state.
        if (ignore || requestIdRef.current !== id) return
        setResult(res)
        setCleaning(false)
      })
      .catch((err) => {
        if (ignore || requestIdRef.current !== id) return
        setError(err?.message || 'Could not clean that diagram.')
        setCleaning(false)
      })
    return () => { ignore = true }
  }, [stage, originalDataUrl, supported, blackAndWhite, autoCrop, whiten, rotateTurns, brightness, contrast])

  const retake = useCallback(() => {
    setStage('capture')
    setOriginalDataUrl(null)
    setResult(null)
    setError('')
  }, [])

  // Build the payload handed to the action callbacks. Falls back to the
  // original image when cleaning is unsupported so insert still works.
  const buildPayload = useCallback(() => {
    const alt = altText.trim()
    if (result) return { dataUrl: result.dataUrl, blob: result.blob, alt }
    return { dataUrl: originalDataUrl, blob: null, alt }
  }, [result, originalDataUrl, altText])

  const ready = Boolean(result?.dataUrl || (!supported && originalDataUrl))

  const doInsert = useCallback(() => {
    onInsertIntoQuestion?.(buildPayload())
    onClose?.()
  }, [onInsertIntoQuestion, buildPayload, onClose])

  const doCreate = useCallback(() => {
    onCreateQuestion?.(buildPayload())
    onClose?.()
  }, [onCreateQuestion, buildPayload, onClose])

  const doSaveToBank = useCallback(() => {
    const payload = buildPayload()
    onSaveToBank?.({ ...payload, name: payload.alt })
    onClose?.()
  }, [onSaveToBank, buildPayload, onClose])

  const previewSrc = supported ? result?.dataUrl : originalDataUrl

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      style={{
        position: 'fixed', inset: 0, zIndex: 93,
        background: 'rgba(14, 42, 50, 0.55)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 16,
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: 'var(--zt-card)', borderRadius: 16, width: 'min(720px, 100%)',
          maxHeight: '92vh', display: 'flex', flexDirection: 'column', padding: 16,
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
          <div>
            <h3 style={{ margin: 0, fontWeight: 900, fontSize: 18, color: TEAL }}>
              📷 {title}
            </h3>
            <p style={{ margin: '4px 0 0', fontSize: 13, color: MUTED }}>
              Capture one diagram and we&apos;ll clean it into a sharp black-on-white
              figure that prints and photocopies well.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close diagram scanner"
            style={{ fontSize: 22, lineHeight: 1, border: 'none', background: 'none', cursor: 'pointer' }}
          >
            ×
          </button>
        </div>

        {error && (
          <p style={{ margin: '10px 0 0', fontSize: 13, color: '#991b1b' }}>
            ⚠️ {error}
          </p>
        )}

        {stage === 'capture' && (
          <div style={{ marginTop: 14 }}>
            <label
              htmlFor="diagram-scanner-input"
              onDragOver={(e) => e.preventDefault()}
              onDrop={onDrop}
              style={{
                display: 'flex', flexDirection: 'column', alignItems: 'center',
                justifyContent: 'center', gap: 8, padding: '40px 20px',
                border: `2px dashed ${BORDER}`, borderRadius: 14,
                background: '#faf8f1', cursor: 'pointer', textAlign: 'center',
              }}
            >
              <span aria-hidden="true" style={{ fontSize: 40 }}>🖼️</span>
              <span style={{ fontSize: 15, fontWeight: 800, color: TEAL }}>
                Tap to take a photo or upload a diagram
              </span>
              <span style={{ fontSize: 12, color: MUTED }}>
                On a phone this opens the camera. You can also drop an image here.
              </span>
            </label>
            <input
              id="diagram-scanner-input"
              type="file"
              accept="image/*"
              capture="environment"
              aria-label="Capture or upload a diagram"
              onChange={onInputChange}
              style={{ display: 'none' }}
            />
          </div>
        )}

        {stage === 'edit' && (
          <div style={{ marginTop: 14, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 14 }}>
            {!supported && (
              <p style={{ fontSize: 13, color: MUTED, margin: 0 }}>
                Cleaning needs a browser — showing the original image instead.
              </p>
            )}

            {/* Preview */}
            <div
              style={{
                position: 'relative', border: `1px solid ${BORDER}`, borderRadius: 12,
                background: 'var(--zt-surface)', minHeight: 200, display: 'flex',
                alignItems: 'center', justifyContent: 'center', padding: 8,
              }}
            >
              {previewSrc ? (
                <img
                  src={previewSrc}
                  alt={altText || 'Cleaned diagram preview'}
                  style={{ maxWidth: '100%', maxHeight: 360, objectFit: 'contain' }}
                />
              ) : (
                <span style={{ fontSize: 13, color: MUTED }}>Preparing preview…</span>
              )}
              {cleaning && (
                <span
                  aria-live="polite"
                  style={{
                    position: 'absolute', top: 8, right: 8, fontSize: 12, fontWeight: 700,
                    color: TEAL, background: '#fff3e8', borderRadius: 999, padding: '4px 10px',
                  }}
                >
                  ✦ Cleaning…
                </span>
              )}
            </div>

            {/* Toggles */}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              <Toggle label="Clean black & white" checked={blackAndWhite} onChange={setBlackAndWhite} />
              <Toggle label="Auto-crop background" checked={autoCrop} onChange={setAutoCrop} />
              <Toggle label="Whiten background" checked={whiten} onChange={setWhiten} />
            </div>

            {/* Rotate */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <button
                type="button"
                onClick={() => setRotateTurns((t) => (((t - 1) % 4) + 4) % 4)}
                aria-label="Rotate left"
                style={ghostBtn}
              >
                ↺ Rotate left
              </button>
              <button
                type="button"
                onClick={() => setRotateTurns((t) => (t + 1) % 4)}
                aria-label="Rotate right"
                style={ghostBtn}
              >
                ↻ Rotate right
              </button>
              <span style={{ fontSize: 12, color: MUTED }}>
                Auto-crop trims the desk/background around the drawing.
              </span>
            </div>

            {/* Sliders */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13, fontWeight: 700, color: TEAL }}>
                Brightness ({brightness})
                <input
                  type="range"
                  min={-100}
                  max={100}
                  value={brightness}
                  aria-label="Brightness"
                  onChange={(e) => setBrightness(Number(e.target.value))}
                />
              </label>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13, fontWeight: 700, color: TEAL }}>
                Contrast ({contrast})
                <input
                  type="range"
                  min={-100}
                  max={100}
                  value={contrast}
                  aria-label="Contrast"
                  onChange={(e) => setContrast(Number(e.target.value))}
                />
              </label>
            </div>

            {/* Alt / caption */}
            <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13, fontWeight: 700, color: TEAL }}>
              Label / caption (for accessibility)
              <input
                type="text"
                value={altText}
                aria-label="Diagram label or caption"
                placeholder="e.g. Cross-section of a leaf"
                onChange={(e) => setAltText(e.target.value)}
                style={{
                  padding: '8px 10px', borderRadius: 8, border: `1.5px solid ${BORDER}`,
                  fontSize: 14, color: TEAL,
                }}
              />
            </label>

            {/* Action row */}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
              <button type="button" onClick={retake} aria-label="Retake or upload a different diagram" style={ghostBtn}>
                🔄 Retake
              </button>
              <div style={{ flex: 1 }} />
              {onInsertIntoQuestion && (
                <button
                  type="button"
                  onClick={doInsert}
                  disabled={!ready}
                  aria-label="Insert the cleaned diagram into the question"
                  style={{ ...primaryBtn, opacity: ready ? 1 : 0.5, cursor: ready ? 'pointer' : 'not-allowed' }}
                >
                  ➕ Insert into question
                </button>
              )}
              {onCreateQuestion && (
                <button
                  type="button"
                  onClick={doCreate}
                  disabled={!ready}
                  aria-label="Create a new question with the cleaned diagram"
                  style={{ ...ghostBtn, opacity: ready ? 1 : 0.5, cursor: ready ? 'pointer' : 'not-allowed' }}
                >
                  🆕 Create new question
                </button>
              )}
              {onSaveToBank && (
                <button
                  type="button"
                  onClick={doSaveToBank}
                  disabled={!ready}
                  aria-label="Save the cleaned diagram to the diagram bank"
                  style={{ ...ghostBtn, opacity: ready ? 1 : 0.5, cursor: ready ? 'pointer' : 'not-allowed' }}
                >
                  💾 Save to diagram bank
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
