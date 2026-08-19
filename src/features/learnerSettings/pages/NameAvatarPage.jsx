// src/features/learnerSettings/pages/NameAvatarPage.jsx
//
// /settings/profile — Name & avatar, and NOTHING else.
//
// Built to docs/learner/zedexams-avatars-mockup.html. What it holds is the
// short list on purpose: a live preview, the picture, and two name fields.
// Email, grade, date of birth, gender, school, class, guardian details and
// billing all used to sit on the same screen, which is how "Name & avatar" and
// "Delete account" came to be the same URL. They live on their own routes now.
//
// ── The preview is the point of the screen ─────────────────────────────────
//
// Children come here to see how they look to everyone else, so the first thing
// on the page is the leaderboard row they will appear in, updating as they
// type. It shows the PREFERRED name (falling back to the first name — never the
// surname; see nameAvatarFormCore) beside the grade and streak, because that is
// exactly what the real board prints.
//
// ── Save is inert until something changed ──────────────────────────────────
//
// Not a flag — a comparison against what is stored, so typing a letter and
// deleting it again puts the bar back to sleep. The rules are in
// `lib/nameAvatarFormCore.js` and node-tested; this file is the wiring.
//
// ── Leaving with unsaved changes ───────────────────────────────────────────
//
// Two exits, two guards, because they are different mechanisms: the browser's
// beforeunload covers closing the tab or a hard reload, and the in-app back
// button asks directly. React Router's declarative BrowserRouter gives us no
// useBlocker, so an SPA navigation from the shell's own nav is NOT intercepted
// — which is why the sticky bar stays visible rather than hiding on scroll.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import '../../../shared/styles/learnerTheme.css'
import { useAuth } from '../../../contexts/AuthContext'
import SeoHelmet from '../../../shared/components/SeoHelmet'
import CharacterAvatar from '../../../shared/components/CharacterAvatar'
import useLearnerStats from '../../../hooks/useLearnerStats'
import {
  avatarsInGroup,
  getAvatar,
  groupsForGrade,
} from '../../../shared/components/learnerAvatarManifest'
import {
  avatarSelection,
  canSave,
  dirtyPatch,
  formFromProfile,
  isDirty,
  previewName,
} from '../lib/nameAvatarFormCore'

const PHOTO_SIZE = 256

/** The picture currently chosen, at whatever size the caller asks for. */
function AvatarFace({ characterId, photoUrl, size, name, decorative = false }) {
  const box = {
    width: size, height: size, borderRadius: '50%', flex: '0 0 auto',
    overflow: 'hidden', display: 'grid', placeItems: 'center',
    background: 'var(--lhx-indigo-soft)',
  }
  if (photoUrl) {
    return (
      <div style={box}>
        <img
          src={photoUrl}
          alt={decorative ? '' : 'Your photo'}
          aria-hidden={decorative ? 'true' : undefined}
          style={{ width: '100%', height: '100%', objectFit: 'cover' }}
        />
      </div>
    )
  }
  if (characterId && getAvatar(characterId)) {
    return (
      <div style={box}>
        <CharacterAvatar
          characterId={characterId}
          className="lhx-av-img"
          decorative={decorative}
          title={name}
        />
      </div>
    )
  }
  return (
    <div style={{ ...box, fontSize: Math.round(size * 0.42), fontWeight: 900, color: 'var(--lhx-indigo-text)' }}>
      <span aria-hidden="true">{(name || 'Z').charAt(0).toUpperCase()}</span>
    </div>
  )
}

export default function NameAvatarPage() {
  const navigate = useNavigate()
  const { currentUser, userProfile, updateProfileFields } = useAuth()
  const { stats } = useLearnerStats(currentUser?.uid)

  const baseline = useMemo(() => formFromProfile(userProfile), [userProfile])
  const [form, setForm] = useState(baseline)
  const [saving, setSaving] = useState(false)
  const [toast, setToast] = useState(null)
  const [error, setError] = useState('')

  // Re-seed from the profile ONLY while the form is untouched. A profile
  // snapshot can land mid-edit (another tab, a server write), and overwriting
  // what a child is halfway through typing is worse than showing them a value
  // one second stale.
  const dirty = isDirty(baseline, form)
  const dirtyRef = useRef(dirty)
  dirtyRef.current = dirty
  useEffect(() => {
    if (!dirtyRef.current) setForm(baseline)
  }, [baseline])

  const grade = userProfile?.grade
  const groups = useMemo(() => groupsForGrade(grade), [grade])
  const [groupId, setGroupId] = useState(() => groups[0]?.id)
  useEffect(() => { setGroupId(groups[0]?.id) }, [groups])
  const tiles = useMemo(() => avatarsInGroup(groupId), [groupId])
  const ownGroup = groups[0]

  const streak = Number(stats?.currentStreak) || 0
  const shownName = previewName(form)
  const gate = canSave(baseline, form, { saving })

  const setField = (key) => (event) => {
    setError('')
    setForm((f) => ({ ...f, [key]: event.target.value }))
  }

  const pickCharacter = (id) => {
    setError('')
    setForm((f) => ({ ...f, ...avatarSelection('character', id) }))
  }

  const onPhoto = useCallback((event) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    if (!/^image\//.test(file.type)) {
      setError('That file is not a picture. Try a photo from your gallery.')
      return
    }
    const reader = new FileReader()
    reader.onload = () => {
      const img = new Image()
      img.onload = () => {
        // Square, centre-cropped, downscaled to 256px before it is ever
        // stored — a phone photo is several megabytes and this lands in a
        // profile document that every screen reads.
        const canvas = document.createElement('canvas')
        canvas.width = PHOTO_SIZE
        canvas.height = PHOTO_SIZE
        const ctx = canvas.getContext('2d')
        const side = Math.min(img.width, img.height)
        ctx.drawImage(
          img,
          (img.width - side) / 2, (img.height - side) / 2, side, side,
          0, 0, PHOTO_SIZE, PHOTO_SIZE,
        )
        // Re-encoding through a canvas is also what strips the EXIF block, so
        // the GPS tag on a photo taken at a child's home never leaves the device.
        setForm((f) => ({ ...f, ...avatarSelection('photo', canvas.toDataURL('image/jpeg', 0.82)) }))
      }
      img.onerror = () => setError('We could not open that picture. Try another one.')
      img.src = String(reader.result || '')
    }
    reader.onerror = () => setError('We could not read that picture. Try another one.')
    reader.readAsDataURL(file)
  }, [])

  const save = async () => {
    if (!gate.ok) return
    const patch = dirtyPatch(baseline, form)
    setSaving(true)
    setError('')
    try {
      await updateProfileFields?.(patch)
      setToast('Saved. This is how you appear now.')
    } catch {
      setError('We could not save that. Check your connection and try again.')
    } finally {
      setSaving(false)
    }
  }

  useEffect(() => {
    if (!toast) return undefined
    const t = setTimeout(() => setToast(null), 2600)
    return () => clearTimeout(t)
  }, [toast])

  // Closing the tab or reloading with unsaved edits.
  useEffect(() => {
    if (!dirty) return undefined
    const warn = (e) => { e.preventDefault(); e.returnValue = '' }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty])

  const back = () => {
    if (dirty && !window.confirm('You have changes you have not saved. Leave without saving?')) return
    navigate('/settings')
  }

  return (
    <>
      <SeoHelmet title="Name & avatar" path="/settings/profile" noIndex />

      <div className="lhx-back-row">
        <button type="button" className="lhx-back-btn" aria-label="Back to Settings" onClick={back}>‹</button>
        <div className="lhx-back-title">Name &amp; avatar</div>
      </div>

      {/* This is how you'll appear — a real leaderboard row, live. */}
      <div className="lhx-av-preview" data-testid="name-avatar-preview">
        <div className="lhx-av-preview-label">This is how you&apos;ll appear</div>
        <div className="lhx-av-preview-row">
          <span className="lhx-av-rank" aria-hidden="true">4</span>
          <AvatarFace
            characterId={form.avatarCharacter}
            photoUrl={form.avatarPhotoUrl}
            size={46}
            name={shownName}
            decorative
          />
          <span className="lhx-av-preview-text">
            <b>{shownName}</b>
            <small>
              {grade ? `Grade ${grade}` : 'Your grade'} · 🔥 {streak} day streak
            </small>
          </span>
        </div>
      </div>

      {/* Your picture */}
      <div className="lhx-set-head">Your picture</div>
      <div className="lhx-av-card">
        <div className="lhx-av-bigrow">
          <AvatarFace
            characterId={form.avatarCharacter}
            photoUrl={form.avatarPhotoUrl}
            size={92}
            name={shownName}
          />
          <div className="lhx-av-bigtext">
            <div className="lhx-av-bigname">
              {form.avatarPhotoUrl
                ? 'Your photo'
                : getAvatar(form.avatarCharacter)?.name || 'No picture yet'}
            </div>
            <div className="lhx-av-bigsub">Tap any picture below to change it</div>
            <label className="lhx-btn lhx-btn-soft lhx-btn-sm lhx-av-upload">
              📷 Upload a photo
              <input type="file" accept="image/*" onChange={onPhoto} hidden />
            </label>
            {(form.avatarPhotoUrl || form.avatarCharacter) && (
              <button
                type="button"
                className="lhx-av-clear"
                onClick={() => setForm((f) => ({ ...f, ...avatarSelection('none') }))}
              >
                Remove picture
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Choose a character — grouped by grade, own group first */}
      <div className="lhx-set-head">Choose a character</div>
      <div className="lhx-av-card">
        <div className="lhx-av-seg" role="tablist" aria-label="Avatar groups">
          {groups.map((g) => (
            <button
              key={g.id}
              type="button"
              role="tab"
              aria-selected={g.id === groupId}
              className={`lhx-av-segbtn${g.id === groupId ? ' is-on' : ''}`}
              onClick={() => setGroupId(g.id)}
            >
              {g.label}
            </button>
          ))}
        </div>

        <div className="lhx-av-grid">
          {tiles.map((a) => {
            const on = a.id === form.avatarCharacter && !form.avatarPhotoUrl
            return (
              <button
                key={a.id}
                type="button"
                className={`lhx-av-tile${on ? ' is-on' : ''}`}
                aria-pressed={on}
                onClick={() => pickCharacter(a.id)}
              >
                <CharacterAvatar characterId={a.id} className="lhx-av-tile-img" decorative />
                <span>{a.name}</span>
              </button>
            )
          })}
        </div>

        {ownGroup && (
          <p className="lhx-av-hint">
            {grade ? <>You&apos;re in <b>Grade {grade}</b>, so we show <b>{ownGroup.label}</b> first</> : <>We show <b>{ownGroup.label}</b> first</>}
            {' '}— but you can pick any of them.
          </p>
        )}
      </div>

      {/* Your name */}
      <div className="lhx-set-head">Your name</div>
      <div className="lhx-av-card">
        <label className="lhx-av-field" htmlFor="lhx-preferred">
          <span className="lhx-av-flabel">What should we call you?</span>
          <input
            id="lhx-preferred"
            className="lhx-av-input"
            value={form.preferredName}
            onChange={setField('preferredName')}
            maxLength={24}
            autoComplete="nickname"
            placeholder={shownName}
          />
          <span className="lhx-av-fhint">Zed and the leaderboard use this</span>
        </label>

        <label className="lhx-av-field" htmlFor="lhx-fullname">
          <span className="lhx-av-flabel">Full name</span>
          <input
            id="lhx-fullname"
            className="lhx-av-input"
            value={form.displayName}
            onChange={setField('displayName')}
            maxLength={80}
            autoComplete="name"
          />
          <span className="lhx-av-fhint">Only your guardian and your teacher see this</span>
        </label>
      </div>

      {/* Looking for something else? */}
      <div className="lhx-set-head">Looking for something else?</div>
      <div className="lhx-set-group">
        <button type="button" className="lhx-set-row" onClick={() => navigate('/settings/learning')}>
          <span className="lhx-set-ic" aria-hidden="true">📚</span>
          <span className="lhx-set-txt"><span className="lhx-set-title">Grade &amp; subjects</span></span>
          <span className="lhx-set-chev" aria-hidden="true">›</span>
        </button>
        <button type="button" className="lhx-set-row" onClick={() => navigate('/settings/security')}>
          <span className="lhx-set-ic" aria-hidden="true">🔒</span>
          <span className="lhx-set-txt"><span className="lhx-set-title">Password</span></span>
          <span className="lhx-set-chev" aria-hidden="true">›</span>
        </button>
        <button type="button" className="lhx-set-row" onClick={() => navigate('/settings/guardian')}>
          <span className="lhx-set-ic" aria-hidden="true">🛡️</span>
          <span className="lhx-set-txt"><span className="lhx-set-title">Your grown-up</span></span>
          <span className="lhx-set-chev" aria-hidden="true">›</span>
        </button>
      </div>

      {error && <p className="lhx-av-error" role="alert">{error}</p>}
      {toast && <p className="lhx-av-toast" role="status">✓ {toast}</p>}

      {/* Sticky save — visible always, enabled only when something changed. */}
      <div className="lhx-av-savebar">
        <button
          type="button"
          className="lhx-btn lhx-btn-primary lhx-btn-block"
          disabled={!gate.ok}
          onClick={save}
        >
          {/* Never "Saved" at rest: nothing has been saved this visit, and a
              button that claims otherwise tells a child their unsaved edit
              landed. Disabled says "nothing to do" on its own. */}
          {saving ? 'Saving…' : 'Save changes'}
        </button>
        {gate.reason && gate.reason !== 'clean' && gate.reason !== 'saving' && (
          <p className="lhx-av-error" role="alert">{gate.reason}</p>
        )}
      </div>
    </>
  )
}
