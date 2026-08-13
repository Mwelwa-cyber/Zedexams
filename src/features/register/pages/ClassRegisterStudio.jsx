/**
 * ClassRegisterStudio — /teacher/attendance
 *
 * Daily attendance for the official Class Register: pick academic year, term
 * and one of YOUR classes (School → Year → Term → Class; classes come from the
 * teacher-owned classRegisters collection, never a global grade list), then
 * mark, review, and print through AttendanceWorkspace.
 *
 * The last selection is remembered per teacher and validated on restore — a
 * class the teacher no longer owns (or that was archived) never restores.
 */

import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { CalendarCheck } from 'lucide-react'
import { useAuth } from '../../../contexts/AuthContext'
import { listTeacherRegisters } from '../../../utils/classRegister'
import { getSchoolProfile } from '../../../utils/schoolProfileService'
import { TERMS } from '../../../utils/classTerms'
import { getActiveTerm } from '../../../utils/moeCalendar'
import SeoHelmet from '../../../components/seo/SeoHelmet'
import StudioPageHeader from '../../../shared/components/StudioPageHeader'
import Skeleton from '../../../components/ui/Skeleton'
import AttendanceWorkspace from '../components/attendance/AttendanceWorkspace'

const STORAGE_PREFIX = 'zedexams:registerStudio:'

function loadSaved(uid) {
  try {
    const raw = localStorage.getItem(`${STORAGE_PREFIX}${uid}`)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}
function persist(uid, selection) {
  try {
    localStorage.setItem(`${STORAGE_PREFIX}${uid}`, JSON.stringify(selection))
  } catch {
    // storage full/blocked — selection just won't restore
  }
}

export default function ClassRegisterStudio() {
  const { currentUser } = useAuth()
  const uid = currentUser?.uid
  const [registers, setRegisters] = useState(null)
  const [school, setSchool] = useState(null)
  const [loadError, setLoadError] = useState(false)
  const [selection, setSelection] = useState(null) // { classId, term, year }

  useEffect(() => {
    if (!uid) return undefined
    let cancelled = false
    Promise.all([
      listTeacherRegisters(uid).catch((err) => { throw err }),
      getSchoolProfile(uid).catch(() => null),
    ])
      .then(([regs, schoolProfile]) => {
        if (cancelled) return
        setRegisters(regs)
        setSchool(schoolProfile)
        // Restore the last selection only if the teacher still owns the class.
        const saved = loadSaved(uid)
        const active = getActiveTerm()
        const fallbackTerm = active ? TERMS[active.term.number - 1] : TERMS[0]
        const fallbackYear = active ? active.year : new Date().getFullYear()
        const savedRegister = saved && regs.find((r) => r.id === saved.classId)
        if (savedRegister && TERMS.includes(saved.term) && Number(saved.year)) {
          setSelection({ classId: savedRegister.id, term: saved.term, year: Number(saved.year) })
        } else if (regs.length) {
          const first = regs[0]
          setSelection({
            classId: first.id,
            term: TERMS.includes(first.term) ? first.term : fallbackTerm,
            year: Number(first.year) || fallbackYear,
          })
        }
      })
      .catch((err) => {
        console.warn('[ClassRegisterStudio] load failed', err)
        if (!cancelled) setLoadError(true)
      })
    return () => { cancelled = true }
  }, [uid])

  useEffect(() => {
    if (uid && selection) persist(uid, selection)
  }, [uid, selection])

  const register = useMemo(
    () => (registers || []).find((r) => r.id === selection?.classId) || null,
    [registers, selection],
  )

  const yearOptions = useMemo(() => {
    const thisYear = new Date().getFullYear()
    const years = new Set([thisYear - 1, thisYear, thisYear + 1])
    for (const r of registers || []) if (Number(r.year)) years.add(Number(r.year))
    if (selection?.year) years.add(Number(selection.year))
    return [...years].sort((a, b) => a - b)
  }, [registers, selection])

  const schoolName = school?.schoolName || register?.school || ''
  const selectCls = 'w-full rounded-radius-md border theme-border theme-card theme-text px-2.5 py-2 text-sm font-bold'

  return (
    <div className="studio-page space-y-5">
      <SeoHelmet title="Class Register Studio" path="/teacher/attendance" noIndex />
      <StudioPageHeader
        eyebrow="Class administration"
        title="Class Register Studio"
        subtitle="Record daily attendance, review the term, and print the official register."
        icon={CalendarCheck}
      />

      {loadError && (
        <div role="alert" className="theme-card border border-red-300 rounded-radius-md p-6 text-center">
          <p className="theme-text font-black">Couldn&apos;t load your classes.</p>
          <p className="theme-text-muted text-sm mt-1">Refresh the page and try again.</p>
        </div>
      )}

      {!loadError && registers === null && (
        <div className="space-y-3"><Skeleton className="h-16" /><Skeleton className="h-64" /></div>
      )}

      {registers !== null && registers.length === 0 && (
        <div className="theme-card border theme-border rounded-radius-md p-8 text-center">
          <p className="theme-text font-black">You don&apos;t have a class register yet.</p>
          <p className="theme-text-muted text-sm mt-1">
            Create your class (name, grade, learner roster) first — attendance builds on it.
          </p>
          <Link to="/teacher/register/new" className="theme-accent-text font-black text-sm mt-3 inline-block">
            + Create my class
          </Link>
        </div>
      )}

      {registers !== null && registers.length > 0 && selection && (
        <>
          {/* School → Academic year → Term → Class */}
          <div className="theme-card border theme-border rounded-radius-md p-3 grid gap-2 sm:grid-cols-4">
            <label className="block">
              <span className="theme-text-muted text-xs font-black uppercase tracking-wider">School</span>
              <input className={`${selectCls} opacity-80`} value={schoolName || 'Not set'} readOnly aria-label="School" title="Set your school in Settings → School profile" />
            </label>
            <label className="block">
              <span className="theme-text-muted text-xs font-black uppercase tracking-wider">Academic year</span>
              <select className={selectCls} value={selection.year}
                onChange={(e) => setSelection((s) => ({ ...s, year: Number(e.target.value) }))}>
                {yearOptions.map((y) => <option key={y} value={y}>{y}</option>)}
              </select>
            </label>
            <label className="block">
              <span className="theme-text-muted text-xs font-black uppercase tracking-wider">Term</span>
              <select className={selectCls} value={selection.term}
                onChange={(e) => setSelection((s) => ({ ...s, term: e.target.value }))}>
                {TERMS.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </label>
            <label className="block">
              <span className="theme-text-muted text-xs font-black uppercase tracking-wider">Class</span>
              <select className={selectCls} value={selection.classId}
                onChange={(e) => setSelection((s) => ({ ...s, classId: e.target.value }))}>
                {registers.map((r) => <option key={r.id} value={r.id}>{r.className}</option>)}
              </select>
            </label>
          </div>

          {register && (
            <AttendanceWorkspace
              key={`${register.id}|${selection.term}|${selection.year}`}
              register={register}
              termSelection={{ term: selection.term, year: selection.year }}
            />
          )}
        </>
      )}
    </div>
  )
}
