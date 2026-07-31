// Avatar studio — character avatars (grouped by interest) + a real photo
// editor (crop-to-square, zoom, rotate, reset). The photo is drawn to a 256px
// canvas and saved as a downscaled data URL on the profile (avatarPhotoUrl),
// so it round-trips without needing a Storage upload. Character picks write
// avatarCharacter; choosing one clears the photo and vice-versa so the hero
// shows a single source of truth.

import { useRef, useState } from 'react'
import CharacterAvatar, { CHARACTERS, getCharacter } from '../../../components/profile/CharacterAvatar'
import { AVATAR_CATEGORIES } from '../lib/learnerPrefs'
import { Section, Btn, Chips } from './ui'

const OUT_SIZE = 256

export default function AvatarStudio({ profile, commit, pushToast }) {
  const [category, setCategory] = useState('all')
  const [savingId, setSavingId] = useState(null)

  const selectedId = profile?.avatarCharacter || null
  const photoUrl = profile?.avatarPhotoUrl || null

  const visible = category === 'all'
    ? CHARACTERS
    : CHARACTERS.filter((c) => c.group === category)

  const pickCharacter = (id) => {
    if (savingId) return
    setSavingId(id)
    commit({ avatarCharacter: id, avatarPhotoUrl: '' })
    pushToast?.('success', `Avatar set to ${getCharacter(id)?.name || 'character'}.`)
    setTimeout(() => setSavingId(null), 400)
  }

  const resetAvatar = () => {
    commit({ avatarCharacter: '', avatarPhotoUrl: '' })
    pushToast?.('success', 'Avatar reset.')
  }

  const savePhoto = (dataUrl) => {
    commit({ avatarPhotoUrl: dataUrl, avatarCharacter: '' })
    pushToast?.('success', 'Photo saved as your avatar.')
  }

  return (
    <>
      <Section title="Your avatar" hint="Pick a character or upload a photo. It shows on your profile, the nav bar and leaderboards.">
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 14 }}>
          <div
            style={{
              width: 64, height: 64, borderRadius: 16, overflow: 'hidden', flex: '0 0 auto',
              display: 'grid', placeItems: 'center',
              background: 'var(--bg-subtle)', border: '1.5px solid var(--border)',
            }}
          >
            {photoUrl
              ? <img src={photoUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              : selectedId
                ? <CharacterAvatar characterId={selectedId} className="w-full h-full" />
                : <span style={{ fontSize: 24 }}>🙂</span>}
          </div>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>Current avatar</div>
            <div style={{ fontSize: 15, fontWeight: 800 }}>
              {photoUrl ? 'Your photo' : selectedId ? getCharacter(selectedId)?.name : 'None yet'}
            </div>
          </div>
          {(photoUrl || selectedId) && (
            <div style={{ marginLeft: 'auto' }}>
              <Btn variant="ghost" size="sm" onClick={resetAvatar}>Reset</Btn>
            </div>
          )}
        </div>

        <PhotoEditor onSave={savePhoto} pushToast={pushToast} />
      </Section>

      <Section title="Character avatars" hint="Filter by what you're into.">
        <div style={{ marginBottom: 14 }}>
          <Chips
            options={AVATAR_CATEGORIES.map((c) => ({ value: c.id, label: c.label, emoji: c.emoji }))}
            value={category}
            onChange={setCategory}
          />
        </div>
        <div className="lset-avatars">
          {visible.map((c) => {
            const on = c.id === selectedId
            return (
              <button
                key={c.id}
                type="button"
                className={`lset-avatar${on ? ' lset-avatar--on' : ''}`}
                aria-pressed={on}
                aria-label={`Select ${c.name}`}
                disabled={!!savingId}
                onClick={() => pickCharacter(c.id)}
              >
                <CharacterAvatar characterId={c.id} variant="tile" className="w-full h-full" />
                {on && <span className="lset-avatar__check" aria-hidden="true">✓</span>}
              </button>
            )
          })}
        </div>
      </Section>
    </>
  )
}

/* Compact photo editor: upload → square viewport with zoom + rotate + reset,
   flattened to a 256px data URL on save. */
function PhotoEditor({ onSave, pushToast }) {
  const [src, setSrc] = useState(null)
  const [zoom, setZoom] = useState(1)
  const [rotation, setRotation] = useState(0)
  const [busy, setBusy] = useState(false)
  const fileRef = useRef(null)

  const onFile = (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    if (!file.type.startsWith('image/')) { pushToast?.('error', 'Please choose an image file.'); return }
    if (file.size > 6 * 1024 * 1024) { pushToast?.('error', 'Image is too large (max 6MB).'); return }
    const reader = new FileReader()
    reader.onload = () => { setSrc(reader.result); setZoom(1); setRotation(0) }
    reader.onerror = () => pushToast?.('error', 'Could not read that image.')
    reader.readAsDataURL(file)
  }

  const clear = () => {
    setSrc(null); setZoom(1); setRotation(0)
    if (fileRef.current) fileRef.current.value = ''
  }

  const save = () => {
    if (!src) return
    setBusy(true)
    const img = new Image()
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas')
        canvas.width = OUT_SIZE
        canvas.height = OUT_SIZE
        const ctx = canvas.getContext('2d')
        ctx.fillStyle = '#ffffff'
        ctx.fillRect(0, 0, OUT_SIZE, OUT_SIZE)
        // Cover-fit the image into the square, then apply zoom + rotation
        // about the centre. This makes the square viewport the crop.
        const base = Math.max(OUT_SIZE / img.width, OUT_SIZE / img.height)
        const scale = base * zoom
        ctx.translate(OUT_SIZE / 2, OUT_SIZE / 2)
        ctx.rotate((rotation * Math.PI) / 180)
        ctx.scale(scale, scale)
        ctx.drawImage(img, -img.width / 2, -img.height / 2)
        const out = canvas.toDataURL('image/jpeg', 0.85)
        onSave(out)
        clear()
      } catch {
        pushToast?.('error', 'Could not process the image.')
      } finally {
        setBusy(false)
      }
    }
    img.onerror = () => { setBusy(false); pushToast?.('error', 'Could not load the image.') }
    img.src = src
  }

  if (!src) {
    return (
      <div>
        <input ref={fileRef} type="file" accept="image/*" onChange={onFile} style={{ display: 'none' }} id="lset-photo-input" />
        <Btn variant="ghost" size="sm" onClick={() => fileRef.current?.click()}>📷 Upload a photo</Btn>
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'flex-start' }}>
      <div
        style={{
          width: 160, height: 160, borderRadius: 16, overflow: 'hidden',
          background: 'var(--zt-card)', border: '1.5px solid var(--border)', flex: '0 0 auto',
          display: 'grid', placeItems: 'center',
        }}
      >
        <img
          src={src}
          alt="Preview"
          style={{
            width: '100%', height: '100%', objectFit: 'cover',
            transform: `rotate(${rotation}deg) scale(${zoom})`,
            transition: 'transform .1s ease',
          }}
        />
      </div>
      <div style={{ flex: '1 1 200px', minWidth: 0 }}>
        <label className="lset-field__label" htmlFor="lset-zoom">Zoom</label>
        <input
          id="lset-zoom"
          type="range"
          min="1"
          max="3"
          step="0.05"
          value={zoom}
          onChange={(e) => setZoom(Number(e.target.value))}
          style={{ width: '100%', accentColor: 'var(--lset-accent)' }}
        />
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', margin: '10px 0' }}>
          <Btn variant="ghost" size="sm" onClick={() => setRotation((r) => (r + 90) % 360)}>↻ Rotate</Btn>
          <Btn variant="ghost" size="sm" onClick={() => { setZoom(1); setRotation(0) }}>Reset</Btn>
          <Btn variant="ghost" size="sm" onClick={clear}>Cancel</Btn>
        </div>
        <Btn size="sm" onClick={save} loading={busy}>Save photo</Btn>
      </div>
    </div>
  )
}
