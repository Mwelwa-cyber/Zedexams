import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useAuth } from '../../../contexts/AuthContext'
import { getSchoolProfileStrict, saveSchoolProfile } from '../../../utils/schoolProfileService'
import { normalizeSchoolProfile } from '../../../utils/schoolProfile'

// Shared loader/saver for the panels backed by schoolProfiles/{uid}
// (School, Branding, Resources, Smart Defaults).
//
// Data-safety contract (review finding — the original version could wipe a
// saved profile):
//   • The STRICT reader is used, and a failed load sets `loadError` instead
//     of silently rendering a blank form over real data. Panels must keep
//     Save/uploads disabled while `loading || loadError` (the hook also
//     refuses to write in that state as a backstop).
//   • Saves write ONLY the keys that changed vs the loaded snapshot
//     (saveSchoolProfile itself writes only the keys it is given), so two
//     panels/tabs editing different slices can never clobber each other.
export function useSchoolProfileForm() {
  const { currentUser } = useAuth()
  const uid = currentUser?.uid
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)
  const [saved, setSavedDoc] = useState(null) // last known stored doc
  const [form, setForm] = useState(() => normalizeSchoolProfile(null))
  const loadedRef = useRef(false)
  const [loadAttempt, setLoadAttempt] = useState(0)

  useEffect(() => {
    let cancelled = false
    if (!uid) {
      setLoading(false)
      return undefined
    }
    setLoading(true)
    setLoadError(false)
    getSchoolProfileStrict(uid)
      .then((profile) => {
        if (cancelled || loadedRef.current) return
        loadedRef.current = true
        const normalized = normalizeSchoolProfile(profile)
        setSavedDoc(normalized)
        setForm(normalized)
        setLoading(false)
      })
      .catch((err) => {
        console.warn('school profile load failed:', err)
        if (cancelled || loadedRef.current) return
        setLoadError(true)
        setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [uid, loadAttempt])

  const retry = useCallback(() => setLoadAttempt((n) => n + 1), [])

  const dirty = useMemo(
    () =>
      !loading &&
      !loadError &&
      JSON.stringify(form) !== JSON.stringify(saved ?? normalizeSchoolProfile(null)),
    [form, saved, loading, loadError],
  )

  const patch = (fields) => setForm((prev) => ({ ...prev, ...fields }))

  const guardWritable = () => {
    if (loading || loadError) {
      throw new Error('Your saved school details have not loaded yet — please retry first.')
    }
  }

  // Write only the keys whose values differ from the loaded snapshot.
  const save = async () => {
    guardWritable()
    const base = saved ?? normalizeSchoolProfile(null)
    const changed = {}
    for (const key of Object.keys(form)) {
      if (JSON.stringify(form[key]) !== JSON.stringify(base[key])) changed[key] = form[key]
    }
    if (Object.keys(changed).length === 0) return base
    await saveSchoolProfile(uid, changed)
    const next = normalizeSchoolProfile({ ...base, ...changed })
    setSavedDoc(next)
    setForm(next)
    return next
  }

  // Immediate write of a small field set (upload flows): exactly these keys.
  const saveFields = async (fields) => {
    guardWritable()
    await saveSchoolProfile(uid, fields)
    const next = normalizeSchoolProfile({ ...(saved ?? {}), ...form, ...fields })
    setSavedDoc((prev) => normalizeSchoolProfile({ ...(prev ?? {}), ...fields }))
    setForm(next)
    return next
  }

  return { uid, loading, loadError, retry, form, patch, setForm, save, saveFields, dirty }
}
