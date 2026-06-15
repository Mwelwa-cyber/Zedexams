/**
 * Flatten a diagram image + its overlay objects (letter labels, arrows,
 * boxes, lines, free text) into a single PNG Blob.
 *
 * Why bake instead of keeping overlays as separate export-time elements:
 * a single raster cannot "fall out" of a PDF/DOCX (brief item 8). The image
 * comes from our own CORS-configured Storage bucket and is loaded
 * `crossOrigin="anonymous"`, so the canvas stays untainted and `toBlob`
 * succeeds.
 *
 * Browser-only (needs <canvas>). The version → label-text decision is
 * delegated to the pure `labelTextForVersion` so it matches the question
 * patch exactly.
 */

import { loadImage } from '../../../utils/imageEnhance'
import { labelTextForVersion } from './visualVersions'

// Cap the longest side so baked PNGs stay export-friendly (≈ 1600px is plenty
// for an A4 figure at print DPI and keeps DOCX embeds small).
const MAX_SIDE = 1600

function fit(w, h) {
  const longest = Math.max(w, h)
  if (longest <= MAX_SIDE) return { w, h, scale: 1 }
  const scale = MAX_SIDE / longest
  return { w: Math.round(w * scale), h: Math.round(h * scale), scale }
}

function drawArrowHead(ctx, fromX, fromY, toX, toY, size) {
  const angle = Math.atan2(toY - fromY, toX - fromX)
  ctx.beginPath()
  ctx.moveTo(toX, toY)
  ctx.lineTo(toX - size * Math.cos(angle - Math.PI / 6), toY - size * Math.sin(angle - Math.PI / 6))
  ctx.lineTo(toX - size * Math.cos(angle + Math.PI / 6), toY - size * Math.sin(angle + Math.PI / 6))
  ctx.closePath()
  ctx.fill()
}

function roundRect(ctx, x, y, w, h, r) {
  const rr = Math.min(r, Math.abs(w) / 2, Math.abs(h) / 2)
  ctx.beginPath()
  ctx.moveTo(x + rr, y)
  ctx.arcTo(x + w, y, x + w, y + h, rr)
  ctx.arcTo(x + w, y + h, x, y + h, rr)
  ctx.arcTo(x, y + h, x, y, rr)
  ctx.arcTo(x, y, x + w, y, rr)
  ctx.closePath()
}

/**
 * @param {object} params
 * @param {string} params.imageUrl
 * @param {Array<object>} params.objects   — overlay objects (ratio coords 0..1)
 * @param {string} params.version          — 'teacher'|'learner'|'answerKey'|'picture'
 * @returns {Promise<{ blob: Blob, width: number, height: number }>}
 */
export async function bakeVisual({ imageUrl, objects = [], version = 'teacher' }) {
  const img = await loadImage(imageUrl)
  const natW = img.naturalWidth || img.width || 1024
  const natH = img.naturalHeight || img.height || 768
  const { w, h } = fit(natW, natH)

  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, w, h)
  ctx.drawImage(img, 0, 0, w, h)

  const px = (rx) => rx * w
  const py = (ry) => ry * h
  const lineW = Math.max(2, Math.round(w / 400))

  for (const obj of objects) {
    if (!obj) continue
    const color = obj.color || '#111111'
    ctx.strokeStyle = color
    ctx.fillStyle = color
    ctx.lineWidth = lineW
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'

    if (obj.type === 'arrow' || obj.type === 'line') {
      const x1 = px(obj.x); const y1 = py(obj.y)
      const x2 = px(obj.x2 == null ? obj.x : obj.x2); const y2 = py(obj.y2 == null ? obj.y : obj.y2)
      ctx.beginPath()
      ctx.moveTo(x1, y1)
      ctx.lineTo(x2, y2)
      ctx.stroke()
      if (obj.type === 'arrow') drawArrowHead(ctx, x1, y1, x2, y2, Math.max(10, lineW * 4))
      continue
    }

    if (obj.type === 'box') {
      const x1 = px(obj.x); const y1 = py(obj.y)
      const bw = px(obj.x2 == null ? obj.x : obj.x2) - x1
      const bh = py(obj.y2 == null ? obj.y : obj.y2) - y1
      roundRect(ctx, x1, y1, bw, bh, Math.max(4, lineW * 2))
      ctx.stroke()
      continue
    }

    if (obj.type === 'text' || obj.type === 'label') {
      const text = obj.type === 'label' ? labelTextForVersion(obj, version) : String(obj.text || '')
      if (!text) continue
      const fontSize = Math.max(14, Math.round((obj.fontSize || 22) * (w / 600)))
      ctx.font = `700 ${fontSize}px "Segoe UI", system-ui, sans-serif`
      ctx.textBaseline = 'middle'
      const cx = px(obj.x); const cy = py(obj.y)

      if (obj.type === 'label') {
        // Letter labels render as a filled chip so they read on busy line art.
        const padX = Math.round(fontSize * 0.45)
        const metrics = ctx.measureText(text)
        const chipW = metrics.width + padX * 2
        const chipH = fontSize + Math.round(fontSize * 0.4)
        ctx.fillStyle = '#ffffff'
        roundRect(ctx, cx - chipW / 2, cy - chipH / 2, chipW, chipH, chipH / 4)
        ctx.fill()
        ctx.lineWidth = Math.max(2, lineW)
        ctx.strokeStyle = color
        roundRect(ctx, cx - chipW / 2, cy - chipH / 2, chipW, chipH, chipH / 4)
        ctx.stroke()
        ctx.fillStyle = color
        ctx.textAlign = 'center'
        ctx.fillText(text, cx, cy)
        ctx.textAlign = 'left'
      } else {
        ctx.fillText(text, cx, cy)
      }
    }
  }

  const blob = await new Promise((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error('Could not render the image. It may be blocked by cross-origin rules.'))),
      'image/png',
    )
  })
  return { blob, width: w, height: h }
}

/** Trigger a browser download of a Blob. */
export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename || 'visual.png'
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
