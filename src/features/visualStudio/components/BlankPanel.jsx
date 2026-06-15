/* Blank canvas (brief item 1 / 4): upload your own picture to label, or start
   on a plain page, then go straight to the editor. */

import { useRef, useState } from 'react'
import { ORIENTATIONS } from '../lib/visualStudioMeta'
import { IconImage, IconBlank } from './VsIcons'

const DIMS = { square: [1024, 1024], portrait: [1024, 1365], landscape: [1365, 1024] }

function whitePageDataUrl(orientation) {
  const [w, h] = DIMS[orientation] || DIMS.landscape
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, w, h)
  return canvas.toDataURL('image/png')
}

export default function BlankPanel({ onEdit, onToast }) {
  const fileRef = useRef(null)
  const [orientation, setOrientation] = useState('landscape')
  const [error, setError] = useState('')

  function pickFile(e) {
    const file = e.target.files?.[0]
    if (!file) return
    if (!file.type.startsWith('image/')) { setError('Please choose an image file.'); return }
    if (file.size > 10 * 1024 * 1024) { setError('Image must be under 10 MB.'); return }
    setError('')
    const fr = new FileReader()
    fr.onload = () => {
      onEdit({
        imageUrl: String(fr.result),
        title: file.name.replace(/\.[^.]+$/, '') || 'Uploaded image',
        isBlackAndWhite: false,
        sourceType: 'upload',
      })
    }
    fr.onerror = () => setError('Could not read that file.')
    fr.readAsDataURL(file)
  }

  function startBlank() {
    onEdit({
      imageUrl: whitePageDataUrl(orientation),
      title: 'Blank page',
      isBlackAndWhite: true,
      sourceType: 'upload',
    })
    onToast?.('Blank page ready — add labels, text, arrows and boxes.')
  }

  return (
    <div className="vs-split">
      <div className="vs-panel">
        <h3>Upload an image</h3>
        <p className="vs-sub">Use a photo or scanned diagram, then add labels and arrows on top.</p>
        <button type="button" className="vs-iconbtn" style={{ width: '100%', justifyContent: 'center', padding: 14 }} onClick={() => fileRef.current?.click()}>
          <IconImage size={18} /> Choose image…
        </button>
        <input ref={fileRef} type="file" accept="image/*" hidden onChange={pickFile} />
        {error && <p className="vs-hint vs-note-warn" style={{ marginTop: 10 }}>⚠ {error}</p>}
      </div>

      <div className="vs-panel">
        <h3>Start on a blank page</h3>
        <p className="vs-sub">A plain white page for labels, text and shapes.</p>
        <div className="vs-field">
          <label>Orientation</label>
          <select value={orientation} onChange={(e) => setOrientation(e.target.value)}>
            {ORIENTATIONS.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
          </select>
        </div>
        <button type="button" className="vs-iconbtn" style={{ width: '100%', justifyContent: 'center', padding: 14 }} onClick={startBlank}>
          <IconBlank size={18} /> New blank page
        </button>
      </div>
    </div>
  )
}
