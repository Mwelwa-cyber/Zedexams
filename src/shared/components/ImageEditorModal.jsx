// ImageEditorModal — edit an image that's already been inserted into a
// question, whatever its source (picture bank, AI picture, shape/diagram
// raster, or camera capture). Tools:
//
//   • Crop      — free or fixed-ratio, drag the box, preview before saving
//   • Rotate    — left / right in 90° steps
//   • Brightness / Contrast sliders
//   • Enhance   — re-run the document clean-up (optionally black & white)
//   • Resize    — Small / Medium / Large / Full-width presets (stored as a
//                 width preset; doesn't re-upload pixels)
//
// Apply bakes the pixel edits (crop + rotation + brightness/contrast) into a
// fresh JPEG and returns `{ file, imageWidth }`. When only the size preset
// changed it returns `{ file: null, imageWidth }` so the studio can update the
// width without a needless re-upload.

import { useEffect, useRef, useState } from 'react'
import { loadImage, enhanceImageFile } from '../../utils/imageEnhance'
import { IMAGE_WIDTH_OPTIONS, normaliseImageWidth } from '../../utils/imageWidth'

const OVERLAY = {
  position: 'fixed', inset: 0, zIndex: 96,
  background: 'rgba(14, 42, 50, 0.65)',
  display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
}
const CARD = {
  background: 'var(--zt-card)', borderRadius: 16, width: 'min(640px, 100%)',
  maxHeight: '92vh', display: 'flex', flexDirection: 'column', padding: 16,
}
const PRIMARY_BTN = {
  background: '#d97757', color: '#fff', border: 'none', cursor: 'pointer',
  borderRadius: 10, padding: '10px 16px', fontWeight: 800, fontSize: 14,
}
const GHOST_BTN = {
  background: 'var(--zt-card)', color: 'var(--zt-text)', border: '1.5px solid #d9cfb8',
  cursor: 'pointer', borderRadius: 10, padding: '8px 12px', fontWeight: 700, fontSize: 13,
}

const CROP_RATIOS = [
  { key: 'free', label: 'Free', value: null },
  { key: '1', label: '1:1', value: 1 },
  { key: '4:3', label: '4:3', value: 4 / 3 },
  { key: '3:4', label: '3:4', value: 3 / 4 },
  { key: '16:9', label: '16:9', value: 16 / 9 },
]

const clamp01 = (v) => Math.min(1, Math.max(0, v))

export default function ImageEditorModal({ imageUrl, imageWidth = 'full', onApply, onClose }) {
  const [workingUrl, setWorkingUrl] = useState(imageUrl)
  const [rotation, setRotation] = useState(0)
  const [brightness, setBrightness] = useState(0)
  const [contrast, setContrast] = useState(0)
  const [widthPreset, setWidthPreset] = useState(normaliseImageWidth(imageWidth))
  const [cropMode, setCropMode] = useState(false)
  const [cropRatio, setCropRatio] = useState('free')
  const [crop, setCrop] = useState(null) // { x, y, w, h } in 0..1 of the source
  const [dirty, setDirty] = useState(false)
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')

  const imgRef = useRef(null)
  const dragRef = useRef(null)
  const mountedRef = useRef(true)
  const blobUrlRef = useRef(null)

  useEffect(() => () => {
    mountedRef.current = false
    if (blobUrlRef.current) URL.revokeObjectURL(blobUrlRef.current)
  }, [])

  const ratioValue = CROP_RATIOS.find((r) => r.key === cropRatio)?.value || null

  /* ---------- bake current crop + rotation + brightness/contrast ---------- */
  async function bakeToBlob() {
    const img = await loadImage(workingUrl)
    const sw = img.naturalWidth || img.width
    const sh = img.naturalHeight || img.height
    const c = crop || { x: 0, y: 0, w: 1, h: 1 }
    const cx = Math.round(c.x * sw)
    const cy = Math.round(c.y * sh)
    const cw = Math.max(1, Math.round(c.w * sw))
    const ch = Math.max(1, Math.round(c.h * sh))
    const rot = ((rotation % 360) + 360) % 360
    const swap = rot === 90 || rot === 270
    const outW = swap ? ch : cw
    const outH = swap ? cw : ch
    const canvas = document.createElement('canvas')
    canvas.width = outW
    canvas.height = outH
    const ctx = canvas.getContext('2d')
    ctx.fillStyle = '#fff'
    ctx.fillRect(0, 0, outW, outH)
    ctx.filter = `brightness(${100 + brightness}%) contrast(${100 + contrast}%)`
    ctx.translate(outW / 2, outH / 2)
    ctx.rotate((rot * Math.PI) / 180)
    ctx.drawImage(img, cx, cy, cw, ch, -cw / 2, -ch / 2, cw, ch)
    return new Promise((resolve, reject) => {
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not render image'))), 'image/jpeg', 0.92)
    })
  }

  function setWorkingBlob(blob) {
    if (blobUrlRef.current) URL.revokeObjectURL(blobUrlRef.current)
    const url = URL.createObjectURL(blob)
    blobUrlRef.current = url
    setWorkingUrl(url)
  }

  // Bake the live transforms into the working image, then reset them so the
  // next edit starts from a clean slate (used by Crop-apply and Enhance).
  async function flattenTransforms() {
    const blob = await bakeToBlob()
    setWorkingBlob(blob)
    setRotation(0)
    setBrightness(0)
    setContrast(0)
    setCrop(null)
    return blob
  }

  async function applyCrop() {
    if (!crop) { setCropMode(false); return }
    setBusy('Cropping…')
    try {
      await flattenTransforms()
      setDirty(true)
      setCropMode(false)
    } catch {
      setError('Could not crop this image. It may be blocked by cross-origin rules.')
    } finally {
      if (mountedRef.current) setBusy('')
    }
  }

  async function runEnhance(bw) {
    setBusy(bw ? 'Cleaning to black & white…' : 'Enhancing…')
    setError('')
    try {
      const flat = await flattenTransforms()
      const { blob } = await enhanceImageFile(flat, { blackAndWhite: bw })
      if (!mountedRef.current) return
      setWorkingBlob(blob)
      setDirty(true)
    } catch {
      setError('Could not enhance this image. It may be blocked by cross-origin rules.')
    } finally {
      if (mountedRef.current) setBusy('')
    }
  }

  async function handleApply() {
    setBusy('Saving…')
    setError('')
    try {
      const onlyWidthChanged = !dirty && rotation === 0 && brightness === 0 && contrast === 0 && !crop
      if (onlyWidthChanged) {
        onApply({ file: null, imageWidth: widthPreset })
        return
      }
      const blob = await bakeToBlob()
      const file = new File([blob], `edited-${Date.now()}.jpg`, { type: 'image/jpeg' })
      onApply({ file, imageWidth: widthPreset })
    } catch {
      setError('Could not save the image. It may be blocked by cross-origin rules.')
      if (mountedRef.current) setBusy('')
    }
  }

  function rotate(delta) {
    setRotation((r) => (((r + delta) % 360) + 360) % 360)
    setDirty(true)
  }

  /* ---------- crop drag handling (fractions of the displayed image) ---------- */
  function startCrop() {
    setCrop((c) => c || { x: 0.1, y: 0.1, w: 0.8, h: 0.8 })
    setCropMode(true)
  }

  function pointerFrac(e) {
    const rect = imgRef.current?.getBoundingClientRect()
    if (!rect) return { x: 0, y: 0 }
    return {
      x: clamp01((e.clientX - rect.left) / rect.width),
      y: clamp01((e.clientY - rect.top) / rect.height),
    }
  }

  function onPointerDown(mode, corner) {
    return (e) => {
      e.preventDefault()
      e.stopPropagation()
      e.currentTarget.setPointerCapture?.(e.pointerId)
      dragRef.current = { mode, corner, start: pointerFrac(e), startCrop: crop }
    }
  }

  function onPointerMove(e) {
    const d = dragRef.current
    if (!d) return
    const p = pointerFrac(e)
    const dx = p.x - d.start.x
    const dy = p.y - d.start.y
    const sc = d.startCrop
    if (d.mode === 'move') {
      const nx = clamp01(sc.x + dx)
      const ny = clamp01(sc.y + dy)
      setCrop({ x: Math.min(nx, 1 - sc.w), y: Math.min(ny, 1 - sc.h), w: sc.w, h: sc.h })
    } else if (d.mode === 'resize') {
      let { x, y, w, h } = sc
      const right = x + w
      const bottom = y + h
      if (d.corner.includes('e')) w = clamp01(p.x) - x
      if (d.corner.includes('s')) h = clamp01(p.y) - y
      if (d.corner.includes('w')) { x = clamp01(p.x); w = right - x }
      if (d.corner.includes('n')) { y = clamp01(p.y); h = bottom - y }
      if (w < 0.05) w = 0.05
      if (h < 0.05) h = 0.05
      // Lock aspect ratio (displayed pixels) when a fixed ratio is chosen.
      if (ratioValue && imgRef.current) {
        const rect = imgRef.current.getBoundingClientRect()
        const pxW = w * rect.width
        const pxH = pxW / ratioValue
        h = pxH / rect.height
      }
      if (x + w > 1) w = 1 - x
      if (y + h > 1) h = 1 - y
      setCrop({ x, y, w, h })
    }
  }

  function onPointerUp() { dragRef.current = null }

  const previewFilter = `brightness(${100 + brightness}%) contrast(${100 + contrast}%)`
  const previewTransform = `rotate(${rotation}deg)`

  const cornerStyle = (pos) => ({
    position: 'absolute', width: 16, height: 16, background: 'var(--zt-card)',
    border: '2px solid #d97757', borderRadius: 4, touchAction: 'none',
    cursor: `${pos}-resize`, ...cornerPos(pos),
  })

  return (
    <div style={OVERLAY} onClick={onClose}>
      <div style={CARD} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between gap-3 mb-2">
          <h3 style={{ fontWeight: 900, fontSize: 18, color: 'var(--zt-text)', margin: 0 }}>🖼 Edit image</h3>
          <button type="button" onClick={onClose} aria-label="Close"
            style={{ fontSize: 22, lineHeight: 1, border: 'none', background: 'none', cursor: 'pointer' }}>×</button>
        </div>

        {/* Preview */}
        <div style={{
          background: '#f1ede1', borderRadius: 12, border: '1px solid #d9cfb8',
          padding: 8, textAlign: 'center', position: 'relative', overflow: 'hidden',
        }}>
          <div style={{ position: 'relative', display: 'inline-block', maxWidth: '100%' }}>
            <img
              ref={imgRef}
              src={workingUrl}
              alt="Editing preview"
              crossOrigin="anonymous"
              draggable={false}
              style={{
                maxWidth: '100%', maxHeight: '46vh', objectFit: 'contain',
                filter: previewFilter, transform: previewTransform, borderRadius: 6,
                display: 'block', userSelect: 'none',
              }}
            />
            {cropMode && crop && (
              <div
                onPointerMove={onPointerMove}
                onPointerUp={onPointerUp}
                style={{ position: 'absolute', inset: 0, touchAction: 'none' }}
              >
                <div
                  onPointerDown={onPointerDown('move')}
                  style={{
                    position: 'absolute',
                    left: `${crop.x * 100}%`, top: `${crop.y * 100}%`,
                    width: `${crop.w * 100}%`, height: `${crop.h * 100}%`,
                    border: '2px dashed #d97757', boxShadow: '0 0 0 9999px rgba(0,0,0,0.45)',
                    cursor: 'move', touchAction: 'none',
                  }}
                >
                  {['nw', 'ne', 'sw', 'se'].map((pos) => (
                    <div key={pos} onPointerDown={onPointerDown('resize', pos)} style={cornerStyle(pos)} />
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>

        {busy && <p style={{ margin: '8px 0 0', fontSize: 13, color: 'var(--zt-text-muted)', textAlign: 'center' }}>{busy}</p>}
        {error && <p style={{ margin: '8px 0 0', fontSize: 13, color: '#991b1b' }}>⚠️ {error}</p>}

        {/* Crop controls */}
        {cropMode ? (
          <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
              <span style={{ fontSize: 12, color: 'var(--zt-text-muted)' }}>Ratio:</span>
              {CROP_RATIOS.map((r) => (
                <button key={r.key} type="button" onClick={() => setCropRatio(r.key)}
                  style={{
                    ...GHOST_BTN, padding: '4px 10px',
                    border: `1.5px solid ${cropRatio === r.key ? '#d97757' : '#d9cfb8'}`,
                    background: cropRatio === r.key ? '#fff3e8' : '#fff',
                  }}>{r.label}</button>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button type="button" style={{ ...PRIMARY_BTN, flex: 1 }} onClick={applyCrop}>✓ Apply crop</button>
              <button type="button" style={{ ...GHOST_BTN, flex: 1 }} onClick={() => { setCrop(null); setCropMode(false) }}>Cancel crop</button>
            </div>
          </div>
        ) : (
          <>
            {/* Tool buttons */}
            <div style={{ marginTop: 10, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              <button type="button" style={GHOST_BTN} onClick={startCrop}>✂️ Crop</button>
              <button type="button" style={GHOST_BTN} onClick={() => rotate(-90)}>↺ Left</button>
              <button type="button" style={GHOST_BTN} onClick={() => rotate(90)}>↻ Right</button>
              <button type="button" style={GHOST_BTN} onClick={() => runEnhance(false)}>✨ Enhance</button>
              <button type="button" style={GHOST_BTN} onClick={() => runEnhance(true)}>◧ B&amp;W</button>
            </div>

            {/* Sliders */}
            <div style={{ marginTop: 12, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <label style={{ fontSize: 12 }}>
                Brightness
                <input type="range" min={-100} max={100} value={brightness} style={{ width: '100%' }}
                  onChange={(e) => { setBrightness(Number(e.target.value)); setDirty(true) }} />
              </label>
              <label style={{ fontSize: 12 }}>
                Contrast
                <input type="range" min={-100} max={100} value={contrast} style={{ width: '100%' }}
                  onChange={(e) => { setContrast(Number(e.target.value)); setDirty(true) }} />
              </label>
            </div>

            {/* Resize presets */}
            <div style={{ marginTop: 12 }}>
              <span style={{ fontSize: 12, color: 'var(--zt-text-muted)' }}>Size on the page:</span>
              <div style={{ display: 'flex', gap: 6, marginTop: 4, flexWrap: 'wrap' }}>
                {IMAGE_WIDTH_OPTIONS.map((o) => (
                  <button key={o.key} type="button" onClick={() => setWidthPreset(o.key)}
                    style={{
                      ...GHOST_BTN, padding: '6px 12px',
                      border: `1.5px solid ${widthPreset === o.key ? '#d97757' : '#d9cfb8'}`,
                      background: widthPreset === o.key ? '#fff3e8' : '#fff',
                    }}>{o.label}</button>
                ))}
              </div>
            </div>
          </>
        )}

        {/* Footer */}
        {!cropMode && (
          <div style={{ marginTop: 14, display: 'flex', gap: 8 }}>
            <button type="button" style={{ ...PRIMARY_BTN, flex: 1 }} disabled={!!busy} onClick={handleApply}>
              ✓ Apply changes
            </button>
            <button type="button" style={{ ...GHOST_BTN, flex: 1, padding: '10px 16px' }} onClick={onClose}>
              Cancel
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

function cornerPos(pos) {
  const off = -8
  switch (pos) {
    case 'nw': return { left: off, top: off }
    case 'ne': return { right: off, top: off }
    case 'sw': return { left: off, bottom: off }
    case 'se': return { right: off, bottom: off }
    default: return {}
  }
}
