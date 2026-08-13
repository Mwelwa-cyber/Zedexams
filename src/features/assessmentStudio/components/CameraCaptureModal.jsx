// CameraCaptureModal — capture a diagram, drawing, graph, map, table or
// handwritten figure with the device camera (or pick an existing photo on
// devices without a usable camera), auto-enhance it for printing, and hand a
// clean JPEG File back to the studio's existing upload path.
//
// Flow:  capture / choose  →  AI enhance  →  review (Original vs Enhanced,
//        optional clean black-and-white, blur warning)  →  Use Enhanced /
//        Use Original / Retake / Cancel.
//
// Works on phone, tablet and desktop: it tries getUserMedia first (live
// preview + a rear-camera default and a flip button), and silently falls back
// to a file input with `capture` so a browser without camera access can still
// take or pick a photo.

import { useCallback, useEffect, useRef, useState } from 'react'
import { enhanceImageFile, blobToFile, isBlurry } from '../../../utils/imageEnhance'

const OVERLAY = {
  position: 'fixed', inset: 0, zIndex: 95,
  background: 'rgba(14, 42, 50, 0.65)',
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  padding: 16,
}
const CARD = {
  background: 'var(--zt-card)', borderRadius: 16, width: 'min(560px, 100%)',
  maxHeight: '90vh', display: 'flex', flexDirection: 'column', padding: 16,
}
const PRIMARY_BTN = {
  background: '#d97757', color: '#fff', border: 'none', cursor: 'pointer',
  borderRadius: 10, padding: '10px 16px', fontWeight: 800, fontSize: 14,
}
const GHOST_BTN = {
  background: 'var(--zt-card)', color: 'var(--zt-text)', border: '1.5px solid #d9cfb8',
  cursor: 'pointer', borderRadius: 10, padding: '10px 16px', fontWeight: 700, fontSize: 14,
}

// Preview URLs are only ever minted by URL.createObjectURL, so enforce the
// blob: scheme before the value reaches the <img src> sink — no string that
// arrived any other way (e.g. derived from a picked file) can render.
function blobUrlOnly(url) {
  return typeof url === 'string' && url.startsWith('blob:') ? url : undefined
}

export default function CameraCaptureModal({ onConfirm, onClose }) {
  const videoRef = useRef(null)
  const streamRef = useRef(null)
  const fileInputRef = useRef(null)
  const mountedRef = useRef(true)

  const [stage, setStage] = useState('capture') // 'capture' | 'enhancing' | 'review'
  const [facing, setFacing] = useState('environment')
  const [cameraError, setCameraError] = useState('')
  const [original, setOriginal] = useState(null) // { blob, url }
  const [enhanced, setEnhanced] = useState(null) // { blob, url, blurScore }
  const [blackAndWhite, setBlackAndWhite] = useState(false)
  const [showEnhanced, setShowEnhanced] = useState(true)
  const [busyMsg, setBusyMsg] = useState('')

  useEffect(() => () => { mountedRef.current = false }, [])

  const stopStream = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop())
      streamRef.current = null
    }
  }, [])

  // Start (or restart, on flip) the live camera. Falls back to the file input
  // when the browser has no camera / denies permission.
  const startCamera = useCallback(async () => {
    setCameraError('')
    stopStream()
    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraError('no-camera')
      return
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: facing }, width: { ideal: 1920 }, height: { ideal: 1920 } },
        audio: false,
      })
      if (!mountedRef.current) { stream.getTracks().forEach((t) => t.stop()); return }
      streamRef.current = stream
      if (videoRef.current) {
        videoRef.current.srcObject = stream
        await videoRef.current.play().catch(() => {})
      }
    } catch {
      setCameraError('no-camera')
    }
  }, [facing, stopStream])

  useEffect(() => {
    if (stage === 'capture') startCamera()
    else stopStream()
    return stopStream
  }, [stage, startCamera, stopStream])

  // Keep a ref to the latest preview URLs so the unmount cleanup always
  // revokes the current values. Assigning during render (outside an effect)
  // is the standard "last value" ref pattern; it runs before any effects.
  const urlsRef = useRef({ o: null, e: null })
  urlsRef.current = { o: original?.url, e: enhanced?.url }

  // Revoke preview object-URLs on unmount. Replacement-time revocations are
  // already handled inside the setState updaters (setEnhanced / setOriginal /
  // retake), so the dependency array must be [] — running this cleanup on
  // every dep change would revoke the still-current Original URL the moment
  // Enhanced is set, breaking the Original/Enhanced compare toggle.
  useEffect(() => () => {
    if (urlsRef.current?.o) URL.revokeObjectURL(urlsRef.current.o)
    if (urlsRef.current?.e) URL.revokeObjectURL(urlsRef.current.e)
  }, [])

  async function runEnhance(sourceBlob, bw) {
    setBusyMsg('Improving image quality…')
    setStage('enhancing')
    try {
      const { blob, blurScore } = await enhanceImageFile(sourceBlob, { blackAndWhite: bw })
      if (!mountedRef.current) return
      setEnhanced((prev) => {
        if (prev?.url) URL.revokeObjectURL(prev.url)
        return { blob, url: URL.createObjectURL(blob), blurScore }
      })
      setShowEnhanced(true)
      setStage('review')
    } catch {
      if (!mountedRef.current) return
      // Enhancement failed (e.g. tainted canvas) — fall back to original only.
      setEnhanced(null)
      setShowEnhanced(false)
      setStage('review')
    } finally {
      if (mountedRef.current) setBusyMsg('')
    }
  }

  function acceptSource(blob) {
    stopStream()
    setOriginal((prev) => {
      if (prev?.url) URL.revokeObjectURL(prev.url)
      return { blob, url: URL.createObjectURL(blob) }
    })
    setBlackAndWhite(false)
    runEnhance(blob, false)
  }

  function captureFromVideo() {
    const video = videoRef.current
    if (!video || !video.videoWidth) return
    const canvas = document.createElement('canvas')
    canvas.width = video.videoWidth
    canvas.height = video.videoHeight
    canvas.getContext('2d').drawImage(video, 0, 0)
    canvas.toBlob((blob) => { if (blob) acceptSource(blob) }, 'image/jpeg', 0.95)
  }

  function onPickFile(e) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (file) acceptSource(file)
  }

  function toggleBlackAndWhite() {
    const next = !blackAndWhite
    setBlackAndWhite(next)
    if (original?.blob) runEnhance(original.blob, next)
  }

  function retake() {
    setEnhanced((prev) => { if (prev?.url) URL.revokeObjectURL(prev.url); return null })
    setOriginal((prev) => { if (prev?.url) URL.revokeObjectURL(prev.url); return null })
    setStage('capture')
  }

  function confirmWith(which) {
    const chosen = which === 'enhanced' ? enhanced : original
    if (!chosen?.blob) return
    stopStream()
    onConfirm(blobToFile(chosen.blob, `camera-${Date.now()}.jpg`))
  }

  const blurry = enhanced && isBlurry(enhanced.blurScore)

  return (
    <div style={OVERLAY} onClick={onClose}>
      <div style={CARD} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between gap-3 mb-2">
          <h3 style={{ fontWeight: 900, fontSize: 18, color: 'var(--zt-text)', margin: 0 }}>
            {stage === 'review' ? '✨ Review captured image' : '📷 Capture a diagram'}
          </h3>
          <button type="button" onClick={onClose} aria-label="Close"
            style={{ fontSize: 22, lineHeight: 1, border: 'none', background: 'none', cursor: 'pointer' }}>×</button>
        </div>

        {/* Hidden fallback file input — also used for "Choose a photo" on desktop. */}
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          capture="environment"
          style={{ display: 'none' }}
          onChange={onPickFile}
        />

        {stage === 'capture' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {cameraError === 'no-camera' ? (
              <div style={{ textAlign: 'center', padding: '24px 12px', color: 'var(--zt-text-muted)' }}>
                <div style={{ fontSize: 40 }}>📷</div>
                <p style={{ margin: '8px 0 0', fontSize: 14 }}>
                  We couldn't open a live camera here. You can still take or choose
                  a photo — on a phone this opens the camera.
                </p>
              </div>
            ) : (
              <div style={{ position: 'relative', borderRadius: 12, overflow: 'hidden', background: '#000' }}>
                <video
                  ref={videoRef}
                  playsInline
                  muted
                  style={{ width: '100%', maxHeight: '60vh', objectFit: 'contain', display: 'block' }}
                />
                <button
                  type="button"
                  onClick={() => setFacing((f) => (f === 'environment' ? 'user' : 'environment'))}
                  title="Switch camera"
                  style={{
                    position: 'absolute', top: 8, right: 8, border: 'none',
                    background: 'rgba(0,0,0,0.5)', color: '#fff', borderRadius: 8,
                    padding: '6px 10px', cursor: 'pointer', fontSize: 18,
                  }}
                >🔄</button>
              </div>
            )}
            <p style={{ margin: 0, fontSize: 12, color: 'var(--zt-text-muted)', textAlign: 'center' }}>
              Capture a diagram, picture, handwritten drawing, graph, map, labelled
              drawing or table — we'll clean it up for printing.
            </p>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {cameraError !== 'no-camera' && (
                <button type="button" style={{ ...PRIMARY_BTN, flex: 1, minWidth: 140 }} onClick={captureFromVideo}>
                  📸 Capture
                </button>
              )}
              <button type="button" style={{ ...GHOST_BTN, flex: 1, minWidth: 140 }} onClick={() => fileInputRef.current?.click()}>
                {cameraError === 'no-camera' ? '📷 Take / choose a photo' : '🖼 Choose a photo'}
              </button>
            </div>
          </div>
        )}

        {stage === 'enhancing' && (
          <div style={{ textAlign: 'center', padding: '40px 12px', color: 'var(--zt-text-muted)' }}>
            <div style={{ fontSize: 36 }}>✨</div>
            <p style={{ marginTop: 8, fontSize: 14 }}>{busyMsg || 'Working…'}</p>
          </div>
        )}

        {stage === 'review' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12, overflowY: 'auto' }}>
            {/* Original / Enhanced toggle */}
            {enhanced && (
              <div style={{ display: 'flex', gap: 6, justifyContent: 'center' }}>
                {['enhanced', 'original'].map((k) => {
                  const active = (k === 'enhanced') === showEnhanced
                  return (
                    <button
                      key={k}
                      type="button"
                      onClick={() => setShowEnhanced(k === 'enhanced')}
                      style={{
                        padding: '6px 14px', borderRadius: 999, fontSize: 13, cursor: 'pointer', fontWeight: 700,
                        border: `1.5px solid ${active ? '#d97757' : '#d9cfb8'}`,
                        background: active ? '#fff3e8' : '#fff', color: 'var(--zt-text)',
                      }}
                    >
                      {k === 'enhanced' ? '✨ Enhanced' : 'Original'}
                    </button>
                  )
                })}
              </div>
            )}

            <div style={{ background: 'var(--zt-surface)', borderRadius: 12, border: '1px solid #d9cfb8', padding: 8, textAlign: 'center' }}>
              <img
                src={blobUrlOnly((showEnhanced && enhanced ? enhanced : original)?.url)}
                alt="Captured preview"
                style={{ maxWidth: '100%', maxHeight: '50vh', objectFit: 'contain', borderRadius: 8 }}
              />
            </div>

            {blurry && (
              <p style={{ margin: 0, fontSize: 13, color: '#92400e', background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 8, padding: '8px 10px' }}>
                ⚠️ This photo looks blurry. For a sharp printed diagram, tap
                <strong> Retake </strong> and hold the camera steady with good light.
              </p>
            )}

            {enhanced && (
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--zt-text)', cursor: 'pointer' }}>
                <input type="checkbox" checked={blackAndWhite} onChange={toggleBlackAndWhite} />
                Clean black &amp; white (best for printing line diagrams &amp; handwriting)
              </label>
            )}

            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {enhanced && (
                <button type="button" style={{ ...PRIMARY_BTN, flex: 1, minWidth: 140 }} onClick={() => confirmWith('enhanced')}>
                  ✓ Use enhanced image
                </button>
              )}
              <button type="button" style={{ ...GHOST_BTN, flex: 1, minWidth: 130 }} onClick={() => confirmWith('original')}>
                Use original
              </button>
              <button type="button" style={{ ...GHOST_BTN, flex: 1, minWidth: 110 }} onClick={retake}>
                ↻ Retake
              </button>
              <button type="button" style={{ ...GHOST_BTN, flex: 1, minWidth: 100 }} onClick={onClose}>
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
