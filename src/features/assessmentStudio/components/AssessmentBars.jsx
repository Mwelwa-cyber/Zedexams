import Icon from './studioIcons'
import { DocTitle } from './DocTitle'

/* ==================================================================
 * TOP BAR
 * ================================================================== */
// Maps the studio's save flags to a single status badge. Priority:
// persistent autosave failure → durable library copy → in-flight library
// save → unsaved edits → local autosave → brand-new draft. `autosaveFailed`
// outranks everything: a stale "Saved to library" badge over a save loop
// that keeps failing is exactly the silent data-risk this flag exists to
// surface. `savedToLibrary` wins over `saving` because handleSave
// deliberately keeps `saving` true through the post-save navigation delay
// (to keep the button disabled) — at that point the save is already done,
// so we show the success state.
export function describeSaveStatus({ saving, dirty, draftSavedAt, savedToLibrary, autosaveFailed }) {
  if (autosaveFailed) {
    return {
      text: '⚠ Autosave failed',
      short: 'Autosave failed',
      title: 'Saving to your library keeps failing — your changes are still safe on this device and will retry as you edit. Check your connection, or use "Save to library" to retry now.',
      cls: 'is-autosave-failed', dot: 'var(--sv-gold)', ring: 'rgba(200,146,61,0.28)',
    }
  }
  if (savedToLibrary) {
    return { text: '✓ Saved to library', short: 'Saved', title: 'This paper is saved in your library — available across your devices.', cls: 'is-library', dot: 'var(--sv-sage)', ring: 'rgba(62,123,90,0.20)' }
  }
  if (saving) {
    return { text: 'Saving…', short: 'Saving…', title: 'Saving to your library…', cls: 'is-saving', dot: 'var(--sv-muted-2)', ring: 'rgba(163,157,142,0.18)' }
  }
  if (dirty) {
    return {
      text: '● Unsaved changes',
      short: 'Unsaved',
      title: "Your latest edits haven’t been auto-saved yet — they save to this device a moment after you stop typing.",
      cls: 'is-unsaved', dot: 'var(--sv-gold)', ring: 'rgba(200,146,61,0.20)',
    }
  }
  if (draftSavedAt) {
    const t = new Date(draftSavedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    return {
      text: `✓ Saved locally · ${t}`,
      short: 'Saved on device',
      title: 'Auto-saved to this device and the cloud draft. Use "Save to library" to keep a durable, shareable copy.',
      cls: 'is-local', dot: 'var(--sv-sage)', ring: 'rgba(62,123,90,0.18)',
    }
  }
  return { text: 'Draft', short: 'Draft', title: 'Not saved yet — start typing and your work auto-saves.', cls: 'is-idle', dot: 'var(--sv-muted-2)', ring: 'rgba(163,157,142,0.18)' }
}

/**
 * The document bar: back · title · status · Save. Nothing else.
 *
 * Undo/redo moved into the builder's own toolbar and the standalone AI sparkle
 * merged into that toolbar's Tools menu — the three of them were taking the
 * room the TITLE needed, which is what let the title get cut on a phone in the
 * first place. The status chip shows a WORD ("Draft"), never an abbreviation:
 * a two-letter state is not a state a teacher can act on.
 */
export function TopBar({
  paper, saving, dirty, draftSavedAt, savedToLibrary, autosaveFailed,
  onBack, onSave, canSave = true, onOpenDetails, titleWidth,
}) {
  // Distinct, honest states so the teacher always knows where their
  // work lives:
  //   • Autosave failed   — the library autosave keeps failing (work is
  //                         still safe in the on-device draft)
  //   • Unsaved changes   — edits not yet captured by the autosave debounce
  //   • Saved on device   — auto-saved locally + to the cloud draft
  //   • Saved to library  — the durable, shareable library copy exists
  const status = describeSaveStatus({ saving, dirty, draftSavedAt, savedToLibrary, autosaveFailed })
  return (
    <header className="sv-app-bar">
      <button className="sv-icon-btn" onClick={onBack} aria-label="Back"><Icon name="back" size={18} /></button>
      <div className="sv-app-bar-title">
        <span className="sv-status-dot" aria-hidden="true" style={{ background: status.dot, boxShadow: `0 0 0 3px ${status.ring}` }} />
        <DocTitle
          paper={paper}
          status={status.short}
          onOpenDetails={onOpenDetails}
          width={titleWidth}
        />
        <span className={`sv-badge-mini sv-app-bar-status ${status.cls}`} title={status.title}>
          {status.short}
        </span>
      </div>
      {onSave && (
        <button
          type="button"
          className="sv-btn sv-btn-primary sv-btn-sm sv-app-bar-save"
          onClick={onSave}
          disabled={saving || !canSave}
          title={canSave ? 'Save this paper to your library' : 'Add a question before saving'}
        >
          <Icon name={saving ? 'spinner' : 'save'} size={14} spin={saving} />
          <span className="sv-app-bar-save-label">{saving ? 'Saving…' : 'Save'}</span>
        </button>
      )}
    </header>
  )
}

/* ==================================================================
 * BOTTOM BAR — compact dock + FAB (replaces the big 4-tab bar).
 *
 * Slim chip rail at the bottom for view navigation (Home / Builder /
 * Preview / Key / AI), plus a floating "+" button anchored bottom-right
 * for the primary "Add block" action. Doesn't cover content the way the
 * old chunky tab bar did.
 * ================================================================== */
export function BottomBar({ view, warnings = [], onHome, onBuilder, onAdd, onPreview, onMarkingKey, onBank, onAi }) {
  const errorCount = warnings.filter(w => w.severity === 'error').length
  return (
    <>
      <nav className="sv-dock">
        <DockBtn icon="home" label="Home" onClick={onHome} active={view === 'home'} />
        <DockBtn icon="builder" label="Build" onClick={onBuilder} active={view === 'builder'} />
        <DockBtn icon="preview" label="Preview" onClick={onPreview} active={view === 'preview'} />
        <DockBtn icon="key" label="Key" onClick={onMarkingKey} active={view === 'marking-key'} />
        {/* The Question Bank is a view of this studio, not a page elsewhere —
            the standalone /teacher/question-bank route redirects into it. */}
        {onBank && <DockBtn icon="bank" label="Bank" onClick={onBank} active={view === 'bank'} />}
        <DockBtn icon="ai" label="AI" onClick={onAi} />
      </nav>
      {view !== 'home' && (
        <button
          className="sv-fab"
          onClick={onAdd}
          aria-label="Add block"
          title="Add block"
        >
          <Icon name="add" size={22} />
          {errorCount > 0 && <span className="sv-fab-badge">{errorCount}</span>}
        </button>
      )}
    </>
  )
}

export function DockBtn({ icon, label, onClick, active }) {
  return (
    <button
      className={`sv-dock-btn ${active ? 'active' : ''}`}
      onClick={onClick}
      aria-current={active ? 'page' : undefined}
    >
      <span className="sv-dock-ic"><Icon name={icon} size={20} /></span>
      <span className="sv-dock-lbl">{label}</span>
    </button>
  )
}
