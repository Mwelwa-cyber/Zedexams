/**
 * ButtonBusy — the in-flight indicator that drops inside an existing button.
 *
 * `kind`
 *   'dots' for waits expected under a second (save, toggle, refresh a count)
 *   'spin' for anything longer
 * A rotating ring for a 400ms save reads as effort the app is not expending.
 *
 * Both draw in `currentColor`, so one indicator serves primary, ghost and
 * danger buttons with no per-variant styling.
 *
 * Keep the button's label STABLE across the flip — "Saving", not "Saving…".
 * The indicator is the signal; the ellipsis only makes the button resize.
 * Pair it with aria-busy rather than a bare `disabled`, so a screen reader
 * announces the state instead of losing the control:
 *
 *   <button aria-busy={saving} disabled={saving}>
 *     {saving && <ButtonBusy kind="dots" />}
 *     {saving ? 'Saving' : 'Save'}
 *   </button>
 */
export default function ButtonBusy({ kind = 'spin' }) {
  if (kind === 'dots') {
    return (
      <span className="zx-dots" aria-hidden="true">
        <i />
        <i />
        <i />
      </span>
    )
  }
  return <span className="zx-spin" aria-hidden="true" />
}
