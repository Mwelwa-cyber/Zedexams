/**
 * useRegisterExportModel — the shared export model for one class + term.
 *
 * Both the on-screen paper preview and the Print & Export panel need the same
 * thing: the school profile plus a buildRegisterExportModel() over the day
 * list currently on screen (which already carries unsaved marks, so a preview
 * shows the register as it stands, not as it was last saved). Building it in
 * one place is what keeps the preview and the printout the same document.
 *
 * `enabled: false` skips both the profile read and the model build, so a
 * collapsed preview costs nothing.
 */

import { useEffect, useMemo, useState } from 'react'
import { getSchoolProfile } from '../../../utils/schoolProfileService'
import { buildRegisterExportModel } from '../lib/attendanceExportService'

export default function useRegisterExportModel({
  registerHook,
  register,
  uid,
  teacherName,
  policy,
  range = null,
  enabled = true,
}) {
  const { roster, termInfo, daysWithRecords, todayIso } = registerHook
  const [school, setSchool] = useState(null)

  useEffect(() => {
    if (!enabled || !uid) return undefined
    let cancelled = false
    getSchoolProfile(uid)
      .then((p) => { if (!cancelled) setSchool(p) })
      .catch(() => {}) // no school profile → exports fall back to the register's school label
    return () => { cancelled = true }
  }, [uid, enabled])

  const model = useMemo(() => {
    if (!enabled) return null
    return buildRegisterExportModel({
      register,
      school,
      teacherName,
      termInfo,
      daysWithRecords,
      roster,
      policy,
      range,
      printedOn: todayIso,
    })
  }, [enabled, register, school, teacherName, termInfo, daysWithRecords, roster, policy, range, todayIso])

  return { model, school }
}
