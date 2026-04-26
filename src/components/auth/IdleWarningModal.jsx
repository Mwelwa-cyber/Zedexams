import { useAuth } from '../../contexts/AuthContext'
import ConfirmDialog from '../ui/ConfirmDialog'

/**
 * Surface the inactivity warning that AuthContext drives. Confirming the
 * dialog signs the user out immediately; cancelling (or any further activity)
 * keeps the session alive.
 */
export default function IdleWarningModal() {
  const { showIdleWarning, idleSecondsLeft, stayActive, logout } = useAuth()

  return (
    <ConfirmDialog
      open={showIdleWarning}
      title="You'll be signed out soon"
      message={
        <>
          For your security, you'll be signed out in <strong>{idleSecondsLeft}s</strong> due to inactivity.
          Click <strong>Stay signed in</strong> to continue.
        </>
      }
      confirmLabel="Log out now"
      cancelLabel="Stay signed in"
      variant="danger"
      onConfirm={() => { logout() }}
      onCancel={stayActive}
    />
  )
}
