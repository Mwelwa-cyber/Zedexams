/**
 * TimetableWorkspace — Phase 2 of the Class Timetable Studio: the
 * full-screen grid workspace. The hero, setup cards and long forms are
 * gone; what remains is a slim sticky top bar (status chips + actions), a
 * tap-to-place subject palette, and the week grid itself. Everything else
 * ("Day times", "Subjects", conflicts, layout options, printable preview)
 * opens as a drawer OVER the grid — edit, close, keep placing.
 *
 * Presentational: ClassTimetableStudio owns all state and handlers; this
 * component owns only UI-local state (which drawer is open, which palette
 * subject is selected).
 */

import { useState } from 'react'
import {
  Settings, LayoutGrid, Download, Check, Lock, Unlock,
  Scissors, Plus, AlertTriangle, Eye, Users,
} from 'lucide-react'
import Chip from '../../../ui/Chip'
import ActionMenu from '../../../ui/ActionMenu'
import DraftStatusIndicator from '../../../draft/DraftStatusIndicator'
import WorkspaceDrawer from './WorkspaceDrawer'
import { BLOCK_TYPES, blockAt, canJoin } from '../../../../utils/timetableBlocks'
import { resolveDayCell, displayLabelFor } from '../../../../utils/timetableGridModel'

export default function TimetableWorkspace({
  classLabel,
  filled = 0,
  allocated = 0,
  coverage = null,
  sessionIsShift = false,
  shiftNote = null,
  onDismissShiftNote,
  conflictsCount = 0,
  knockOffDelta = null,
  paletteSubjects = [],
  tints = {},
  gridModel,
  blocks = [],
  segments = [],
  subjectOptions = [],
  days = [],
  visibleDays = [],
  mobileDay = 'all',
  setMobileDay,
  displayPreferences = {},
  selectedConflict = null,
  onSetCell,
  onJoinDown,
  onSplit,
  onToggleLock,
  onEditDetails,
  undo,
  redo,
  canUndo = false,
  canRedo = false,
  onRequestClear,
  draftStatus = null,
  onExportPdf,
  onExportDocx,
  onExportXlsx,
  onSaveDraft,
  onFinalCheckAndSave,
  saving = false,
  finalChecking = false,
  generationId = null,
  dirtySinceSave = false,
  onEditSetup,
  validationPanel = null,
  schoolDayContent = null,
  subjectsContent = null,
  layoutContent = null,
  conflictsContent = null,
  previewContent = null,
}) {
  const [drawer, setDrawer] = useState(null) // null|'daytimes'|'subjects'|'layout'|'conflicts'|'preview'
  const [paletteSelection, setPaletteSelection] = useState(null)

  const nothingPlaced = filled === 0
  const exportDisabledReason = 'Place at least one lesson first.'
  // A shift session's target IS its own capacity, so "not complete yet" is
  // the only unfinished state there ever is — never a deficit against a
  // 28-hour week the session cannot physically hold.
  const complete = coverage ? coverage.complete : (allocated > 0 && filled >= allocated)
  const coverageText = coverage ? coverage.text : `${filled}/${allocated} placed`

  function handlePaletteCellTap(day, slot, block) {
    if (!paletteSelection) return
    if (block && block.label === paletteSelection) onSetCell(day, slot, '')
    else onSetCell(day, slot, paletteSelection)
  }

  /* ── editable grid cell (plain render helper — not a component, so the
   * selects keep their identity/focus across re-renders) ── */
  function renderEditableCell(day, row) {
    const cell = resolveDayCell(gridModel, day, row)
    if (cell.state === 'covered') return null
    if (cell.state === 'off') {
      return (
        <td key={day} className="px-1 py-1 text-center text-[10px]"
          style={{ background: 'var(--zt-surface)', color: '#a89e86' }}>
          day ends
        </td>
      )
    }
    // This day holds a band where the others hold a lesson — the assembly
    // that occupies Period 1 on Monday only.
    if (cell.state === 'band') {
      return (
        <td key={day} className="px-1 py-1 text-center text-[10px] font-black uppercase tracking-widest"
          style={{ background: '#efe9da', color: '#7a6f57' }}>
          {cell.bandLabel}
        </td>
      )
    }
    const slot = cell.row?.slot ?? row.slot
    const block = cell.block
    const isDouble = block && block.length > 1
    const below = block ? blockAt(blocks, day, slot + block.length) : null
    const joinable = block && below && !isDouble && below.length === 1
      && canJoin(block, below, segments).ok
    // Conflict highlight: colour + a visible ring + icon (never colour alone).
    const isConflictTarget = block && selectedConflict?.currentBlock?.blockId === block.blockId
    return (
      <td key={day} id={block ? `ttcell-${block.blockId}` : undefined}
        className="px-1 py-1 align-top" rowSpan={isDouble ? block.length : undefined}
        style={{
          ...(block?.type === BLOCK_TYPES.ACTIVITY ? { background: 'var(--zt-surface)' } : block ? { background: `${tints[block.label] || '#fff'}55` } : {}),
          ...(isConflictTarget ? { outline: '3px solid #be3144', outlineOffset: '-2px', borderRadius: 8 } : {}),
        }}>
        {paletteSelection ? (
          <button
            type="button"
            aria-label={`${row.label} ${day}${block?.label ? ` — ${displayLabelFor(gridModel, block.label)}` : ' — empty'}`}
            onClick={() => handlePaletteCellTap(day, slot, block)}
            className="theme-border w-full rounded-lg border bg-white/80 px-1.5 py-1.5 text-left text-xs font-bold hover:theme-text"
            style={{ minHeight: 34 }}
          >
            {block?.label ? displayLabelFor(gridModel, block.label) : <span style={{ color: 'var(--zt-text-muted)' }}>—</span>}
          </button>
        ) : (
          <select
            value={block?.label || ''}
            aria-label={`${row.label} ${day}`}
            disabled={block?.locked}
            onChange={(e) => onSetCell(day, slot, e.target.value)}
            className="studio-input w-full !py-1.5 !px-1.5 text-xs"
          >
            <option value="">—</option>
            {/* The VALUE is the canonical subject label (block identity); the
                text is what the school calls it. */}
            {subjectOptions.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
            {/* Keep a stale value selectable if its subject was renamed/removed. */}
            {block?.label && !subjectOptions.some((o) => o.value === block.label) && (
              <option value={block.label}>{block.label}</option>
            )}
          </select>
        )}
        {block && (
          <div className="mt-0.5 flex flex-wrap items-center gap-1">
            {isDouble && (
              <span className="text-[9px] font-black uppercase tracking-wide" style={{ color: 'var(--warning-fg)' }}>
                Double period
              </span>
            )}
            {block.type === BLOCK_TYPES.ACTIVITY && (
              <span className="text-[9px] font-black uppercase tracking-wide" style={{ color: 'var(--zt-text-muted)' }}>
                Activity
              </span>
            )}
            <button type="button" onClick={() => onToggleLock(block.blockId)}
              title={block.locked ? 'Unlock — auto-fill may move it' : 'Lock — auto-fill keeps it here'}
              aria-label={block.locked ? `Unlock ${block.label}` : `Lock ${block.label}`}
              className="px-0.5 leading-none opacity-70 hover:opacity-100">
              {block.locked ? <Lock size={12} aria-hidden="true" /> : <Unlock size={12} aria-hidden="true" />}
            </button>
            {joinable && (
              <button type="button" onClick={() => onJoinDown(day, slot)}
                title="Join with the next period into a double period"
                className="theme-border inline-flex items-center gap-0.5 rounded border bg-white px-1 text-[10px] font-black leading-none hover:theme-text">
                <Plus size={10} aria-hidden="true" /> Join
              </button>
            )}
            {isDouble && (
              <button type="button" onClick={() => onSplit(block.blockId)}
                title="Split into two single periods"
                className="theme-border inline-flex items-center gap-0.5 rounded border bg-white px-1 text-[10px] font-black leading-none hover:theme-text">
                <Scissors size={10} aria-hidden="true" /> Split
              </button>
            )}
            {block.type === BLOCK_TYPES.CURRICULUM && (
              <button type="button" onClick={() => onEditDetails(block.blockId)}
                title="Teacher & room details (conflict checking)"
                aria-label={`Edit teacher and room for ${block.label}`}
                className="theme-border inline-flex items-center gap-0.5 rounded border bg-white px-1 text-[10px] font-black leading-none hover:theme-text">
                <Users size={10} aria-hidden="true" /> Details
              </button>
            )}
            {isConflictTarget && (
              <span className="inline-flex items-center gap-0.5 text-[9px] font-black uppercase" style={{ color: 'var(--danger-fg)' }}>
                <AlertTriangle size={10} aria-hidden="true" /> In conflict
              </span>
            )}
            {(block.teacher || block.room) && (
              <span className="w-full truncate text-[9px]" style={{ color: 'var(--zt-text-muted)' }}
                title={[block.teacher, block.room].filter(Boolean).join(' · ')}>
                {[block.teacher, block.room].filter(Boolean).join(' · ')}
              </span>
            )}
          </div>
        )}
      </td>
    )
  }

  return (
    <div className="flex min-h-[70vh] flex-col gap-3">
      {/* ── Slim sticky top bar ── */}
      <div className="studio-card sticky top-0 z-30 flex flex-wrap items-center gap-2 px-3 py-2">
        <div className="mr-auto min-w-0">
          <div className="truncate text-sm font-black">{classLabel}</div>
        </div>

        <Chip variant={complete ? 'green' : 'amber'}
          title={sessionIsShift
            ? 'Coverage for a shift session is measured against the session\u2019s own capacity — filling it well IS the goal.'
            : (complete ? 'Every allocated period is placed' : 'Not every allocated period is placed yet')}>
          {coverageText}
        </Chip>

        <button type="button" onClick={() => setDrawer('conflicts')}
          className="inline-flex border-0 bg-transparent p-0"
          aria-label={conflictsCount > 0 ? `${conflictsCount} conflict${conflictsCount === 1 ? '' : 's'} — open the conflicts panel` : 'No conflicts — open the conflicts panel'}>
          <Chip variant={conflictsCount > 0 ? 'amber' : 'green'}>
            {conflictsCount > 0
              ? (<><AlertTriangle size={11} aria-hidden="true" /> {conflictsCount} conflict{conflictsCount === 1 ? '' : 's'}</>)
              : (<><Check size={11} aria-hidden="true" /> No conflicts</>)}
          </Chip>
        </button>

        {knockOffDelta !== null && knockOffDelta > 0 && (
          <button type="button" onClick={() => setDrawer('daytimes')}
            className="inline-flex border-0 bg-transparent p-0"
            aria-label={`The day runs ${knockOffDelta} minutes past knock-off — open Day times`}>
            <Chip variant="amber">
              <AlertTriangle size={11} aria-hidden="true" /> {knockOffDelta} min past knock-off
            </Chip>
          </button>
        )}

        <button type="button" onClick={() => setDrawer('daytimes')} className="studio-btn-ghost inline-flex items-center gap-1.5 text-xs">
          <Settings size={14} aria-hidden="true" /> Day times
        </button>
        <button type="button" onClick={() => setDrawer('subjects')} className="studio-btn-ghost inline-flex items-center gap-1.5 text-xs">
          <LayoutGrid size={14} aria-hidden="true" /> Subjects
        </button>

        <ActionMenu
          label="Download"
          icon={Download}
          caret
          buttonClassName="studio-btn-ghost inline-flex items-center gap-1.5 text-xs"
          ariaLabel="Download"
          items={[
            { label: 'PDF', onSelect: onExportPdf, disabled: nothingPlaced, disabledReason: exportDisabledReason },
            { label: 'Word (landscape)', onSelect: onExportDocx, disabled: nothingPlaced, disabledReason: exportDisabledReason },
            { label: 'Excel', onSelect: onExportXlsx, disabled: nothingPlaced, disabledReason: exportDisabledReason },
          ]}
        />

        <button type="button" onClick={onFinalCheckAndSave}
          disabled={nothingPlaced || saving || finalChecking}
          title={nothingPlaced
            ? 'Fill the timetable first.'
            : 'Re-checks your other timetables for conflicts, then saves as final. Blocked while error-level conflicts remain.'}
          className="studio-btn-primary inline-flex items-center gap-1.5 text-xs disabled:cursor-not-allowed disabled:opacity-50">
          <Check size={14} aria-hidden="true" /> {finalChecking ? 'Checking…' : 'Save'}
        </button>

        <ActionMenu
          label="⋯"
          buttonClassName="studio-btn-ghost text-xs"
          ariaLabel="More actions"
          items={[
            {
              label: generationId ? (dirtySinceSave ? 'Update in library' : 'Saved to library') : 'Save draft to library',
              onSelect: onSaveDraft,
              disabled: nothingPlaced || saving || Boolean(generationId && !dirtySinceSave),
              disabledReason: nothingPlaced ? exportDisabledReason : 'Already saved.',
            },
            { label: 'Layout options', onSelect: () => setDrawer('layout'), icon: LayoutGrid },
            { label: 'Preview printable timetable', onSelect: () => setDrawer('preview'), icon: Eye, disabled: nothingPlaced, disabledReason: exportDisabledReason },
            { label: 'Edit setup', hint: 'Back to the 3-step setup wizard', onSelect: onEditSetup, icon: Settings },
          ]}
        />
      </div>

      {/* ── Subject palette + session tools ── */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5" role="group" aria-label="Subject palette">
          {paletteSubjects.map((s) => {
            const on = paletteSelection === s.label
            const done = s.placed >= s.target
            return (
              <button key={s.label} type="button"
                onClick={() => setPaletteSelection(on ? null : s.label)}
                aria-pressed={on}
                title={on ? 'Tap to stop placing this subject' : `Tap, then tap a cell to place ${s.label}`}
                className={`rounded-full border px-2.5 py-1 text-[11px] font-black transition-all ${on ? 'ring-2 ring-offset-1' : ''}`}
                style={{
                  background: `${tints[s.label] || '#f1eadb'}${on ? '' : '99'}`,
                  borderColor: on ? '#0e2a32' : 'transparent',
                  color: '#33474d',
                }}>
                {s.displayLabel || s.label} {s.placed}/{s.target}{done ? ' ✓' : ''}
              </button>
            )
          })}
          {paletteSelection && (
            <span className="text-[11px] font-bold" style={{ color: 'var(--zt-text-muted)' }} aria-live="polite">
              Tap a cell to place {paletteSelection}; tap a {paletteSelection} cell to clear it.
            </span>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          {draftStatus && (
            <DraftStatusIndicator status={draftStatus.status} savedAt={draftStatus.savedAt} online={draftStatus.online} />
          )}
          <button type="button" onClick={undo} disabled={!canUndo}
            className="studio-btn-ghost text-xs disabled:opacity-40" title="Undo">Undo</button>
          <button type="button" onClick={redo} disabled={!canRedo}
            className="studio-btn-ghost text-xs disabled:opacity-40" title="Redo">Redo</button>
          <button type="button" onClick={onRequestClear} className="studio-btn-ghost text-xs text-rose-700">
            Clear grid
          </button>
        </div>
      </div>

      {/* One quiet, dismissible line — never a deficit warning. A shift
          session's shortfall against the 28-hour week is a system
          constraint the teacher cannot act on. */}
      {shiftNote && (
        <div className="theme-border flex items-start gap-2 rounded-xl border px-3 py-2 text-[11px]"
          style={{ background: 'var(--zt-surface)', color: 'var(--zt-text-muted)' }}>
          <span className="flex-1">{shiftNote}</span>
          <button type="button" onClick={onDismissShiftNote}
            className="font-black" aria-label="Dismiss this note">Got it</button>
        </div>
      )}

      {/* ── The week grid ── */}
      <section className="studio-card p-3">
        {/* Mobile: full week or one day at a time (presentation only) */}
        <div className="mb-2 flex flex-wrap gap-1.5 sm:hidden">
          {['all', ...days].map((d) => {
            const on = mobileDay === d
            return (
              <button key={d} type="button" onClick={() => setMobileDay(d)}
                aria-pressed={on}
                className={`rounded-full border px-2.5 py-1 text-[11px] font-black ${on ? 'theme-accent-fill theme-on-accent border-transparent' : 'theme-border theme-text-muted bg-white'}`}>
                {d === 'all' ? 'Full week' : d.slice(0, 3)}
              </button>
            )
          })}
        </div>

        {days.length === 0 ? (
          <div className="theme-border rounded-xl border border-dashed bg-white/60 py-14 text-center text-sm" style={{ color: 'var(--zt-text-muted)' }}>
            Pick at least one teaching day — open "Edit setup" from the ⋯ menu.
          </div>
        ) : !gridModel ? null : (
          // The grid scrolls INSIDE itself so the workspace never gains a
          // page scroll. The shift note is one extra row above it, so its
          // height has to come out of the grid rather than the page.
          <div className="overflow-auto" style={{ maxHeight: shiftNote ? 'calc(100dvh - 286px)' : 'calc(100dvh - 230px)' }}>
            <table className="w-full border-collapse text-sm" style={{ minWidth: Math.max(360, 140 + visibleDays.length * 130) }}>
              <thead>
                <tr className="text-[11px] font-black uppercase tracking-wide" style={{ color: 'var(--zt-text-muted)' }}>
                  <th className="sticky left-0 top-0 z-30 w-32 px-2 py-1.5 text-left" style={{ background: 'var(--studio-card-bg, #fdfcf8)' }}>Time</th>
                  {visibleDays.map((d) => (
                    <th key={d} className="sticky top-0 z-20 px-2 py-1.5 text-center" style={{ background: 'var(--studio-card-bg, #fdfcf8)' }}>{d}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {gridModel.rows.map((p) => {
                  if (p.kind === 'break') {
                    return (
                      <tr key={p.id} className="theme-border border-t">
                        <td className="sticky left-0 z-10 whitespace-nowrap px-2 py-1.5 text-xs font-bold" style={{ color: 'var(--zt-text-muted)', background: 'var(--studio-card-bg, #fdfcf8)' }}>
                          {p.start}–{p.end}
                        </td>
                        <td colSpan={visibleDays.length} className="px-2 py-1.5 text-center text-xs font-black uppercase tracking-widest"
                          style={{ background: '#efe9da', color: '#7a6f57' }}>
                          {p.label}
                        </td>
                      </tr>
                    )
                  }
                  return (
                    <tr key={p.id} className="theme-border border-t align-top">
                      <td className="sticky left-0 z-10 whitespace-nowrap px-2 py-1.5" style={{ background: 'var(--studio-card-bg, #fdfcf8)' }}>
                        {displayPreferences.periodLabelMode !== 'period' && <div className="text-xs font-bold">{p.start}–{p.end}</div>}
                        {displayPreferences.periodLabelMode !== 'time' && <div className="theme-text-secondary text-[10px]">Period {p.slot}</div>}
                      </td>
                      {visibleDays.map((d) => renderEditableCell(d, p))}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}

        <p className="mt-2 text-[11px]" style={{ color: 'var(--zt-text-muted)' }}>
          {filled} curriculum period{filled === 1 ? '' : 's'} placed · tap a subject above, then a cell, to place it ·
          Join merges two matching neighbours into a double period.
        </p>
      </section>

      {validationPanel}

      {/* ── Drawers over the grid ── */}
      <WorkspaceDrawer open={drawer === 'daytimes'} title="Day times" wide onClose={() => setDrawer(null)}>
        <div className="space-y-5">{schoolDayContent}</div>
      </WorkspaceDrawer>
      <WorkspaceDrawer open={drawer === 'subjects'} title="Subjects" wide onClose={() => setDrawer(null)}>
        {subjectsContent}
      </WorkspaceDrawer>
      <WorkspaceDrawer open={drawer === 'layout'} title="Layout options" onClose={() => setDrawer(null)}>
        {layoutContent}
      </WorkspaceDrawer>
      <WorkspaceDrawer open={drawer === 'conflicts'} title="Timetable conflicts" wide onClose={() => setDrawer(null)}>
        {conflictsContent}
      </WorkspaceDrawer>
      <WorkspaceDrawer open={drawer === 'preview'} title="Printable preview" wide onClose={() => setDrawer(null)}>
        {previewContent}
      </WorkspaceDrawer>
    </div>
  )
}
