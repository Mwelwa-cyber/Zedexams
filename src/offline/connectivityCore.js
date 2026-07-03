/**
 * connectivityCore — pure state machine that turns raw offline signals into the
 * single unobtrusive status the UI shows (Objective 8). No browser APIs — the
 * OfflineContext feeds it `navigator.onLine`, the pending-queue count, and a
 * couple of transient flags; this derives the one label to display.
 *
 * The six states from the spec, in priority order (first match wins):
 *   syncing        — actively flushing the outbox right now
 *   updating       — background content refresh in progress
 *   offline        — no connectivity
 *   waiting-to-sync— online but the outbox still has queued actions
 *   saved-offline  — a transient confirmation after a local-only save
 *   online         — the calm default
 */

export const STATUS = Object.freeze({
  ONLINE: 'online',
  OFFLINE: 'offline',
  SYNCING: 'syncing',
  UPDATING: 'updating',
  SAVED_OFFLINE: 'saved-offline',
  WAITING: 'waiting-to-sync',
})

/**
 * Derive the display status from the raw signals. Priority order keeps the
 * indicator honest: an active sync outranks a stale "waiting" badge, and being
 * offline outranks a background refresh that can't actually make progress.
 * @param {object} signals
 * @param {boolean} signals.online navigator.onLine
 * @param {boolean} [signals.syncing] outbox flush in progress
 * @param {boolean} [signals.updating] background content refresh in progress
 * @param {number}  [signals.pending] queued actions awaiting sync
 * @param {boolean} [signals.savedOfflineRecently] just saved locally (transient)
 * @returns {string} one of STATUS
 */
export function deriveStatus({ online, syncing = false, updating = false, pending = 0, savedOfflineRecently = false } = {}) {
  if (online && syncing) return STATUS.SYNCING
  if (!online && savedOfflineRecently) return STATUS.SAVED_OFFLINE
  if (!online) return STATUS.OFFLINE
  if (updating) return STATUS.UPDATING
  if (pending > 0) return STATUS.WAITING
  if (savedOfflineRecently) return STATUS.SAVED_OFFLINE
  return STATUS.ONLINE
}

/** Short, friendly label for a status. */
export function statusLabel(status, pending = 0) {
  switch (status) {
    case STATUS.OFFLINE: return 'Offline'
    case STATUS.SYNCING: return 'Syncing…'
    case STATUS.UPDATING: return 'Updating…'
    case STATUS.SAVED_OFFLINE: return 'Saved offline'
    case STATUS.WAITING: return pending > 1 ? `Waiting to sync (${pending})` : 'Waiting to sync'
    case STATUS.ONLINE:
    default: return 'Online'
  }
}

/**
 * Whether the indicator should be shown at all. The calm "online" state is
 * intentionally hidden — the spec wants indicators "unobtrusive", so we only
 * surface a pill when there's something worth telling the user about.
 * @param {string} status
 * @returns {boolean}
 */
export function shouldShowIndicator(status) {
  return status !== STATUS.ONLINE
}

/**
 * A stable tone token for styling (the component maps it to colours). Kept out
 * of the component so the mapping is testable and theme-agnostic.
 * @param {string} status
 * @returns {'neutral'|'warn'|'info'|'good'}
 */
export function statusTone(status) {
  switch (status) {
    case STATUS.OFFLINE: return 'warn'
    case STATUS.WAITING: return 'warn'
    case STATUS.SYNCING: return 'info'
    case STATUS.UPDATING: return 'info'
    case STATUS.SAVED_OFFLINE: return 'good'
    default: return 'neutral'
  }
}
