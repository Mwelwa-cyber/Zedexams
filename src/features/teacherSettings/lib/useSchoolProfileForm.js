import { useEffect, useMemo, useRef, useState } from 'react'
import { useAuth } from '../../../contexts/AuthContext'
import { getSchoolProfile, saveSchoolProfile } from '../../../utils/schoolProfileService'
import { normalizeSchoolProfile } from '../../../utils/schoolProfile'

// Shared loader/saver for the panels backed by schoolProfiles/{uid}
// (School, Branding, Resources, Smart Defaults). Loads once, exposes the
// normalized doc + a field patcher, and saves with merge semantics so a
// panel editing its slice never clobbers another panel's fields —
// saveSchoolProfile uses setDoc(..., { merge: true }) and we always send the
// full normalized latest + local edits.
export function useSchoolProfileForm() {
  const { currentUser } = useAuth()
  const uid = currentUser?.uid
  const [loading, setLoading] = useState(true)
  const [saved, setSavedDoc] = useState(null) // last known stored doc
  const [form, setForm] = useState(() => normalizeSchoolProfile(null))
  const loadedRef = useRef(false)

  useEffect(() => {
    let cancelled = false
    if (!uid) {
      setLoading(false)
      return undefined
    }
    getSchoolProfile(uid)
      .then((profile) => {
        if (cancelled || loadedRef.current) return
        loadedRef.current = true
        const normalized = normalizeSchoolProfile(profile)
        setSavedDoc(normalized)
        setForm(normalized)
        setLoading(false)
      })
      .catch(() => {
        // getSchoolProfile already swallows Firestore errors into null; this
        // is a belt-and-braces guard so the panel never hangs on "loading".
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [uid])

  const dirty = useMemo(
    () => !loading && JSON.stringify(form) !== JSON.stringify(saved ?? normalizeSchoolProfile(null)),
    [form, saved, loading],
  )

  const patch = (fields) => setForm((prev) => ({ ...prev, ...fields }))

  const save = async () => {
    const payload = await saveSchoolProfile(uid, form)
    setSavedDoc(payload)
    setForm(payload)
    return payload
  }

  // Immediate write of a small field set (upload flows), merged over the
  // current form so the passed fields never ride in stale — the whole
  // normalized doc is written with setDoc merge semantics.
  const saveFields = async (fields) => {
    const payload = await saveSchoolProfile(uid, { ...form, ...fields })
    setSavedDoc(payload)
    setForm(payload)
    return payload
  }

  return { uid, loading, form, patch, setForm, save, saveFields, dirty }
}
