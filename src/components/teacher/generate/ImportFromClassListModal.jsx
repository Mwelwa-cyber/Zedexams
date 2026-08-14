/**
 * ImportFromClassListModal — pick one of the teacher's Class Register
 * class lists and hand its ACTIVE learners to the Mark Schedule studio.
 *
 * The studio usually passes the registers it already fetched for the
 * button badge (`registers` prop); when that arrives null (badge fetch
 * still in flight, or it failed silently) the modal fetches its own copy
 * so opening it is never a dead end.
 *
 * Picking a class loads its roster (listRoster — ordered by the register's
 * own `order`), filters to status === 'active', and calls
 * `onImport({ register, entries })`. The HOST decides how the rows merge
 * into its table — this component never touches studio state.
 */

import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Users } from 'lucide-react'
import ResponsiveModal from '../../../shared/components/ResponsiveModal'
import { listTeacherRegisters } from '../../../utils/classRegister'
import { listRoster } from '../../../utils/classRoster'
import { formatClassGrade } from '../../../schemas/classRegister'

export default function ImportFromClassListModal({
  uid,
  registers: registersProp = null,
  onClose,
  onImport,
}) {
  const [registers, setRegisters] = useState(registersProp)
  const [loadFailed, setLoadFailed] = useState(false)
  // The register whose roster is currently loading (one at a time).
  const [pickingId, setPickingId] = useState(null)
  const [pickError, setPickError] = useState('')

  useEffect(() => {
    if (registers !== null || !uid) return undefined
    let on = true
    listTeacherRegisters(uid)
      .then((list) => { if (on) setRegisters(list) })
      .catch(() => { if (on) setLoadFailed(true) })
    return () => { on = false }
  }, [registers, uid])

  async function pick(register) {
    if (pickingId) return
    setPickingId(register.id)
    setPickError('')
    try {
      const roster = await listRoster(register.id)
      const entries = roster.filter((e) => (e?.status ?? 'active') === 'active')
      onImport?.({ register, entries })
    } catch (err) {
      console.error('[ImportFromClassListModal] roster load failed', err)
      setPickError('Could not load that class list. Please try again.')
      setPickingId(null)
    }
  }

  return (
    <ResponsiveModal onClose={onClose} labelledBy="import-class-list-title">
      <div className="px-5 pt-5 pb-5 sm:px-6">
        <h2 id="import-class-list-title" className="m-0 flex items-center gap-2 text-base font-bold">
          <Users size={17} aria-hidden="true" />
          Import from Class List
        </h2>
        <p className="mt-1 text-xs" style={{ color: 'var(--zt-text-muted)' }}>
          Pick a class — its active learners fill the pupil rows in register order.
          Rows you have already named are kept.
        </p>

        {registers === null && !loadFailed && (
          <p className="mt-4 text-sm" role="status" style={{ color: 'var(--zt-text-muted)' }}>
            Loading your class lists…
          </p>
        )}
        {loadFailed && (
          <p className="mt-4 text-sm text-rose-700" role="alert">
            Could not load your class lists. Close this and try again.
          </p>
        )}

        {Array.isArray(registers) && registers.length === 0 && (
          <div className="mt-4 rounded-xl border border-dashed theme-border p-4 text-sm">
            <p className="m-0 font-bold">No class lists yet</p>
            <p className="mt-1 mb-3 text-xs" style={{ color: 'var(--zt-text-muted)' }}>
              Create a class in the Class Register first — then its learners import
              here in one click, every term.
            </p>
            <Link to="/teacher/register" className="font-bold underline">
              Open the Class Register
            </Link>
          </div>
        )}

        {Array.isArray(registers) && registers.length > 0 && (
          <ul className="m-0 mt-4 list-none space-y-2 p-0">
            {registers.map((reg) => (
              <li key={reg.id}>
                <button
                  type="button"
                  onClick={() => pick(reg)}
                  disabled={Boolean(pickingId)}
                  className="w-full rounded-xl border theme-border bg-white px-3.5 py-2.5 text-left transition-colors hover:border-black/25 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <span className="block text-sm font-bold">{reg.className}</span>
                  <span className="block text-xs" style={{ color: 'var(--zt-text-muted)' }}>
                    {formatClassGrade(reg.grade)}
                    {reg.year ? ` · ${reg.year}` : ''}
                    {` · ${Number(reg.learnerCount) || 0} learner${(Number(reg.learnerCount) || 0) === 1 ? '' : 's'}`}
                    {pickingId === reg.id ? ' · Loading…' : ''}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}

        {pickError && (
          <p className="mt-3 text-sm text-rose-700" role="alert">{pickError}</p>
        )}
      </div>
    </ResponsiveModal>
  )
}
