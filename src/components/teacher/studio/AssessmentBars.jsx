import Icon from './studioIcons'
import DocTitle from './DocTitle'

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
      word: 'Autosave failed',
      title: 'Saving to your library keeps failing — your changes are still safe on this device and will retry as you edit. Check your connection, or use "Save to library" to retry now.',
      cls: 'is-autosave-failed', dot: 'var(--sv-gold)', ring: 'rgba(200,146,61,0.28)',
    }
  }
  if (savedToLibrary) {
    return { text: '✓ Saved to library', word: 'Saved', title: 'This paper is saved in your library — available across your devices.', cls: 'is-library', dot: 'var(--sv-sage)', ring: 'rgba(62,123,90,0.20)' }
  }
  if (saving) {
    return { text: 'Saving…', word: 'Saving…', title: 'Saving to your library…', cls: 'is-saving', dot: 'var(--sv-muted-2)', ring: 'rgba(163,157,142,0.18)' }
  }
  if (dirty) {
    return {
      text: '● Unsaved changes',
      word: 'Unsaved',
      title: "Your latest edits haven’t been auto-saved yet — they save to this device a moment after you stop typing.",
      cls: 'is-unsaved', dot: 'var(--sv-gold)', ring: 'rgba(200,146,61,0.20)',
    }
  }
  if (draftSavedAt) {
    const t = new Date(draftSavedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    return {
      text: `✓ Saved locally · ${t}`,
      word: 'Saved locally',
      title: 'Auto-saved to this device and the cloud draft. Use "Save to library" to keep a durable, shareable copy.',
      cls: 'is-local', dot: 'var(--sv-sage)', ring: 'rgba(62,123,90,0.18)',
    }
  }
  return { text: 'Draft', word: 'Draft', title: 'Not saved yet — start typing and your work auto-saves.', cls: 'is-idle', dot: 'var(--sv-muted-2)', ring: 'rgba(163,157,142,0.18)' }
}

/**
 * back · document title · status chip · Save. Four things, in that order.
 *
 * Undo/redo and the standalone AI sparkle used to sit here too, which is four
 * icon buttons competing with the title for a 360px bar — and the title is the
 * one element that says WHICH paper is open. They moved to the builder toolbar
 * (undo/redo) and its `Tools ▾` menu (AI), both of which are one tap away and
 * neither of which is useful outside the builder anyway. The keyboard
 * shortcuts are unchanged.
 *
 * The status chip prints the whole word — "Draft", never "DR". An abbreviation
 * a teacher has to decode is not a saving.
 */
export function TopBar({
  paper, status: statusWord, saving, dirty, draftSavedAt, savedToLibrary, autosaveFailed,
  onBack, onSave, onOpenDetails, canSave = true,
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
        <DocTitle paper={paper} status={statusWord ?? status.word} onOpenDetails={onOpenDetails} />
      </div>
      <span className={`sv-badge-mini ${status.cls}`} title={status.title}>
        {status.text}
      </span>
      {onSave && (
        <button
          className="sv-appbar-save"
          onClick={onSave}
          disabled={saving || !canSave}
          title="Save this paper to your library"
        >
          <Icon name={saving ? 'spinner' : 'save'} size={14} spin={saving} />
          <span className="sv-appbar-save-lbl">{saving ? 'Saving…' : 'Save'}</span>
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
export function BottomBar({ view, warnings = [], onHome, onBuilder, onAdd, onPreview, onMarkingKey, onAi }) {
  const errorCount = warnings.filter(w => w.severity === 'error').length
  return (
    <>
      <nav className="sv-dock">
        <DockBtn icon="home" label="Home" onClick={onHome} active={view === 'home'} />
        <DockBtn icon="builder" label="Build" onClick={onBuilder} active={view === 'builder'} />
        <DockBtn icon="preview" label="Preview" onClick={onPreview} active={view === 'preview'} />
        <DockBtn icon="key" label="Key" onClick={onMarkingKey} active={view === 'marking-key'} />
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
