/**
 * ChildControls — the permissions a guardian sets over their child.
 *
 * Three things this component is careful about:
 *
 *   1. **The switch reflects the server, not the tap.** It moves
 *      optimistically because a tap that does nothing for 400ms reads as
 *      broken, but a rejection puts it back. A control that looks off
 *      while the child's account says on is the single worst state this
 *      screen can be in.
 *   2. **Absent is not off.** The stored value is three-valued — on, off,
 *      or no guardian has ever decided. Undecided renders as on (nothing
 *      is restricted) and is not recorded as a decision until the parent
 *      makes one. See guardianControlsCore.
 *   3. **It says where each OFF actually bites.** `enforcement` is data
 *      on each control, and the two are not equally strong: a 'server'
 *      control is re-checked at the point of use, a 'client' one removes
 *      the surface. Printing the difference is how the weaker one avoids
 *      inheriting the stronger one's reputation.
 */
import { useEffect, useState } from 'react'
import { GUARDIAN_CONTROLS } from '../../../utils/guardianControls'
import { setChildGuardianControl } from '../services/parentApp'
import { reportClientError } from '../../../utils/clientErrorReporting'

export default function ChildControls({ childUid, controls, canEdit, disabled, onChanged }) {
  const [local, setLocal] = useState(controls || {})
  const [busy, setBusy] = useState(null)
  const [notice, setNotice] = useState('')

  useEffect(() => { setLocal(controls || {}) }, [controls])

  async function change(key, next) {
    setBusy(key)
    setNotice('')
    setLocal((c) => ({ ...c, [key]: next }))
    try {
      await setChildGuardianControl(childUid, key, next)
      onChanged?.(key, next)
    } catch (err) {
      reportClientError(err, 'parentApp.setChildGuardianControl')
      // Put it back. The server is the account's state; this screen is a
      // view of it.
      setLocal((c) => ({ ...c, [key]: next === true ? false : true }))
      // The server's reason is kept because it is specific ("only the
      // account owner can do that" beats "something went wrong"), but
      // "nothing has changed" is appended to every one of them: the
      // switch just moved and moved back, and a parent watching that
      // needs telling which of the two states is real.
      const reason = String(err?.message || '').trim()
      setNotice(reason ?
        `${reason.replace(/\.?$/, '.')} Nothing has changed.` :
        'We could not save that. Nothing has changed.')
    } finally {
      setBusy(null)
    }
  }

  return (
    <>
      <div className="lhx-set-group">
        {GUARDIAN_CONTROLS.map((control) => {
          const on = local[control.key] !== false
          return (
            <div className="lhx-set-row" key={control.key}>
              <span className="lhx-set-ic" aria-hidden="true">{control.icon}</span>
              <span className="lhx-set-txt">
                <span className="lhx-set-title">{control.label}</span>
                <span className="lhx-set-desc">{control.hint}</span>
              </span>
              <button
                type="button"
                role="switch"
                aria-checked={on}
                aria-label={control.label}
                disabled={!canEdit || disabled || busy === control.key}
                className="lhx-switch"
                onClick={() => change(control.key, !on)}
              />
            </div>
          )
        })}
      </div>
      <p className="pax-note" role={notice ? 'alert' : undefined}>
        {notice || (
          'Turning something off is applied on our servers, so it holds even if ' +
          'the app is reinstalled. Live challenges are removed from their app.'
        )}
      </p>
    </>
  )
}
