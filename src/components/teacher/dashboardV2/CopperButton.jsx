import { ArrowRight, CircleCheck, LoaderCircle } from 'lucide-react'

/**
 * Premium copper primary button with the full state machine the dashboard
 * spec calls for: default / hover / pressed (CSS), loading, success,
 * disabled. Width stays fixed while loading via a min-width lock so the
 * label swap never makes the button jump.
 *
 * state: 'default' | 'loading' | 'success' | 'disabled'
 */
export default function CopperButton({
  children,
  state = 'default',
  onClick,
  arrow = true,
  className = '',
  ...rest
}) {
  const loading = state === 'loading'
  const success = state === 'success'
  const disabled = state === 'disabled'

  return (
    <button
      type="button"
      className={`tdv2-btn-copper ${loading ? 'is-loading' : ''} ${success ? 'is-success' : ''} ${className}`}
      disabled={disabled}
      aria-busy={loading || undefined}
      aria-disabled={disabled || undefined}
      onClick={loading || success ? undefined : onClick}
      {...rest}
    >
      <span>{loading ? 'Preparing…' : success ? 'Completed!' : children}</span>
      {loading ? (
        <LoaderCircle size={18} strokeWidth={2} className="tdv2-spin" aria-hidden="true" />
      ) : success ? (
        <CircleCheck size={18} strokeWidth={2} aria-hidden="true" />
      ) : arrow ? (
        <span className="tdv2-btn-arrow" aria-hidden="true">
          <ArrowRight size={15} strokeWidth={2} />
        </span>
      ) : null}
    </button>
  )
}
