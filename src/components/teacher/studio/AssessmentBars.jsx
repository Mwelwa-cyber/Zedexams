import Icon from './studioIcons'

/* ==================================================================
 * TOP BAR
 * ================================================================== */
// Maps the studio's save flags to a single status badge. Priority:
// durable library copy → in-flight library save → unsaved edits →
// local autosave → brand-new draft. `savedToLibrary` wins over `saving`
// because handleSave deliberately keeps `saving` true through the
// post-save navigation delay (to keep the button disabled) — at that
// point the save is already done, so we show the success state.
export function describeSaveStatus({ saving, dirty, draftSavedAt, savedToLibrary }) {
  if (savedToLibrary) {
    return { text: '✓ Saved to library', title: 'This paper is saved in your library — available across your devices.', cls: 'is-library', dot: 'var(--sv-sage)', ring: 'rgba(62,123,90,0.20)' }
  }
  if (saving) {
    return { text: 'Saving…', title: 'Saving to your library…', cls: 'is-saving', dot: 'var(--sv-muted-2)', ring: 'rgba(163,157,142,0.18)' }
  }
  if (dirty) {
    return {
      text: '● Unsaved changes',
      title: "Your latest edits haven’t been auto-saved yet — they save to this device a moment after you stop typing.",
      cls: 'is-unsaved', dot: 'var(--sv-gold)', ring: 'rgba(200,146,61,0.20)',
    }
  }
  if (draftSavedAt) {
    const t = new Date(draftSavedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    return {
      text: `✓ Saved locally · ${t}`,
      title: 'Auto-saved to this device and the cloud draft. Use "Save to library" to keep a durable, shareable copy.',
      cls: 'is-local', dot: 'var(--sv-sage)', ring: 'rgba(62,123,90,0.18)',
    }
  }
  return { text: 'Draft', title: 'Not saved yet — start typing and your work auto-saves.', cls: 'is-idle', dot: 'var(--sv-muted-2)', ring: 'rgba(163,157,142,0.18)' }
}

export function TopBar({ title, saving, dirty, draftSavedAt, savedToLibrary, canUndo, canRedo, onUndo, onRedo, onBack, onAi }) {
  // Three distinct, honest states so the teacher always knows where their
  // work lives:
  //   • Unsaved changes   — edits not yet captured by the autosave debounce
  //   • Saved on device   — auto-saved locally + to the cloud draft
  //   • Saved to library  — the durable, shareable library copy exists
  const status = describeSaveStatus({ saving, dirty, draftSavedAt, savedToLibrary })
  return (
    <header className="sv-app-bar">
      <button className="sv-icon-btn" onClick={onBack} aria-label="Back"><Icon name="back" size={18} /></button>
      <div className="sv-app-bar-title">
        <span className="sv-status-dot" aria-hidden="true" style={{ background: status.dot, boxShadow: `0 0 0 3px ${status.ring}` }} />
        {title}
        <span className={`sv-badge-mini ${status.cls}`} title={status.title}>
          {status.text}
        </span>
      </div>
      <button
        className="sv-icon-btn"
        onClick={onUndo}
        disabled={!canUndo}
        aria-label="Undo"
        title="Undo (Ctrl+Z)"
      ><Icon name="undo" size={17} /></button>
      <button
        className="sv-icon-btn"
        onClick={onRedo}
        disabled={!canRedo}
        aria-label="Redo"
        title="Redo (Ctrl+Shift+Z)"
      ><Icon name="redo" size={17} /></button>
      <button className="sv-icon-btn" onClick={onAi} title="AI assistant"><Icon name="ai" size={17} /></button>
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
