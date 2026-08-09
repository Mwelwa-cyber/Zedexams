/**
 * Block details editor — teacher + room for one schedule block in the Class
 * Timetable Studio.
 *
 * Teacher linking is identity-safe: the only way to LINK a teacher is
 * "Me · via a valid Teaching Assignment" (stamps teacherId = the signed-in
 * uid + assignmentId, which also makes the block importable into My
 * Teaching Timetable). A colleague can be recorded by NAME ONLY — that is
 * display text, never identity, and the conflict engine reports name-only
 * overlaps as unverified warnings.
 *
 * Rooms: picking a canonical shared facility stamps its roomId (confirmed
 * room-conflict checking); a free-text room stays a label (warning-level
 * matching only).
 *
 * The block's id, position, length, lock and subject are never touched —
 * conflict ids and personal-timetable links stay stable.
 */

import { useEffect, useState } from 'react'
import { SHARED_FACILITIES } from '../lib/timetableConflictEngine'
import { assignmentLabel } from '../../../utils/teachingProfileCore'

export default function BlockDetailsModal({
  open,
  block,
  uid,
  teacherDisplayName = '',
  assignments = [],
  onSave,           // ({ teacher, teacherId, assignmentId, room, roomId })
  onClose,
}) {
  const [teacherMode, setTeacherMode] = useState('none') // 'none' | 'me' | 'named'
  const [assignmentId, setAssignmentId] = useState('')
  const [teacherName, setTeacherName] = useState('')
  const [roomChoice, setRoomChoice] = useState('')       // facility id | 'other' | ''
  const [roomText, setRoomText] = useState('')

  useEffect(() => {
    if (!open || !block) return
    if (block.teacherId) {
      setTeacherMode('me')
      setAssignmentId(block.assignmentId || '')
    } else if (block.teacher) {
      setTeacherMode('named')
      setTeacherName(block.teacher)
    } else {
      setTeacherMode('none')
      setAssignmentId('')
      setTeacherName('')
    }
    if (block.roomId) {
      setRoomChoice(block.roomId)
      setRoomText('')
    } else if (block.room) {
      setRoomChoice('other')
      setRoomText(block.room)
    } else {
      setRoomChoice('')
      setRoomText('')
    }
  }, [open, block])

  if (!open || !block) return null

  const active = assignments.filter((a) => a && a.id && a.isActive !== false)
  // Assignments teaching this subject float to the top of the picker.
  const subjectFirst = [...active].sort((a, b) => {
    const hit = (x) => (String(x.subject || '').toLowerCase() === String(block.subjectId || '').toLowerCase()
      || assignmentLabel(x).toLowerCase().includes(String(block.label || '').toLowerCase()) ? 0 : 1)
    return hit(a) - hit(b)
  })

  function submit(e) {
    e.preventDefault()
    if (teacherMode === 'me') {
      if (!assignmentId) return // a linked teacher requires a valid assignment
      onSave?.({
        teacher: teacherDisplayName || 'Me',
        teacherId: uid,
        assignmentId,
        ...roomFields(),
      })
    } else if (teacherMode === 'named') {
      onSave?.({
        teacher: teacherName.trim(),
        teacherId: null,
        assignmentId: null,
        ...roomFields(),
      })
    } else {
      onSave?.({ teacher: null, teacherId: null, assignmentId: null, ...roomFields() })
    }
    onClose?.()
  }

  function roomFields() {
    if (!roomChoice) return { room: null, roomId: null }
    if (roomChoice === 'other') {
      const label = roomText.trim()
      return { room: label || null, roomId: null }
    }
    const facility = SHARED_FACILITIES.find((f) => f.id === roomChoice)
    return { room: facility?.label || roomChoice, roomId: roomChoice }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4"
      role="dialog" aria-modal="true" aria-label={`Details for ${block.label}`}>
      <div className="absolute inset-0 bg-black/40" onClick={onClose} aria-hidden="true" />
      <form onSubmit={submit}
        className="relative w-full sm:max-w-md bg-white rounded-t-2xl sm:rounded-2xl p-5 space-y-4 shadow-xl">
        <div>
          <h3 className="text-base font-black">{block.label}</h3>
          <p className="text-xs" style={{ color: 'var(--zt-text-muted)' }}>
            {block.day} · Period {block.startSlot}{block.length > 1 ? ` (double period, ${block.length} periods)` : ''}
          </p>
        </div>

        <fieldset className="space-y-2">
          <legend className="text-xs font-black uppercase tracking-wide" style={{ color: 'var(--zt-text-muted)' }}>Teacher</legend>
          <label className="flex items-start gap-2 text-sm">
            <input type="radio" name="teacher-mode" checked={teacherMode === 'none'}
              onChange={() => setTeacherMode('none')} className="mt-1" />
            <span>No teacher recorded</span>
          </label>
          <label className="flex items-start gap-2 text-sm">
            <input type="radio" name="teacher-mode" checked={teacherMode === 'me'}
              onChange={() => setTeacherMode('me')} className="mt-1" />
            <span className="flex-1">
              <span className="font-bold">Me{teacherDisplayName ? ` — ${teacherDisplayName}` : ''}</span>
              <span className="block text-[11px]" style={{ color: 'var(--zt-text-muted)' }}>
                Linked through a Teaching Assignment — enables reliable conflict checking and My Teaching Timetable import.
              </span>
              {teacherMode === 'me' && (
                active.length ? (
                  <select value={assignmentId} onChange={(e) => setAssignmentId(e.target.value)}
                    required aria-label="Teaching Assignment"
                    className="studio-input mt-1.5 !py-1.5 text-xs w-full">
                    <option value="">Choose the Teaching Assignment…</option>
                    {subjectFirst.map((a) => (
                      <option key={a.id} value={a.id}>{assignmentLabel(a)}</option>
                    ))}
                  </select>
                ) : (
                  <span className="block mt-1 text-[11px] font-bold" style={{ color: 'var(--warning-fg)' }}>
                    No active Teaching Assignments — add one in Settings → Teaching Profile first.
                  </span>
                )
              )}
            </span>
          </label>
          <label className="flex items-start gap-2 text-sm">
            <input type="radio" name="teacher-mode" checked={teacherMode === 'named'}
              onChange={() => setTeacherMode('named')} className="mt-1" />
            <span className="flex-1">
              <span className="font-bold">Another teacher (name only)</span>
              <span className="block text-[11px]" style={{ color: 'var(--warning-fg)' }}>
                A name is display text, not an identity — overlaps for name-only teachers are reported as unverified warnings.
              </span>
              {teacherMode === 'named' && (
                <input type="text" value={teacherName} maxLength={80} required
                  onChange={(e) => setTeacherName(e.target.value)}
                  placeholder="e.g. Mr Banda" aria-label="Teacher name"
                  className="studio-input mt-1.5 !py-1.5 text-xs w-full" />
              )}
            </span>
          </label>
        </fieldset>

        <fieldset className="space-y-1.5">
          <legend className="text-xs font-black uppercase tracking-wide" style={{ color: 'var(--zt-text-muted)' }}>Room / facility</legend>
          <select value={roomChoice} onChange={(e) => setRoomChoice(e.target.value)}
            aria-label="Room or facility"
            className="studio-input !py-1.5 text-xs w-full">
            <option value="">Own classroom / not recorded</option>
            {SHARED_FACILITIES.map((f) => (
              <option key={f.id} value={f.id}>{f.label}{f.shareable ? ' (shareable)' : ''}</option>
            ))}
            <option value="other">Other room (name only)</option>
          </select>
          {roomChoice === 'other' && (
            <input type="text" value={roomText} maxLength={60}
              onChange={(e) => setRoomText(e.target.value)}
              placeholder="e.g. Room 12" aria-label="Room name"
              className="studio-input !py-1.5 text-xs w-full" />
          )}
          <p className="text-[11px]" style={{ color: 'var(--zt-text-muted)' }}>
            Shared facilities are conflict-checked across your class timetables by id; a free-text room is matched by name only.
          </p>
        </fieldset>

        <div className="flex justify-end gap-2 pt-1">
          <button type="button" onClick={onClose} className="studio-btn-ghost text-xs">Cancel</button>
          <button type="submit" className="studio-btn-primary text-xs">Save details</button>
        </div>
      </form>
    </div>
  )
}
