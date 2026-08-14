import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
} from 'react'
import { createPortal } from 'react-dom'
import {
  CheckCircleIcon,
  ExclamationTriangleIcon,
  InformationCircleIcon,
  XMarkIcon,
} from '@heroicons/react/24/solid'

/**
 * Toast notifications — the non-blocking, themed replacement for window.alert().
 *
 * Why this exists: a pile of catch-block window.alert() calls across the admin /
 * teacher / notes surfaces froze the whole tab on every error and looked nothing
 * like the rest of the product. This gives them a single, accessible, theme-aware
 * home that matches ConfirmDialog's visual language.
 *
 * Usage:
 *   const toast = useToast()
 *   toast.error('Could not delete. Try again.')
 *   toast.success('Saved.')
 *   toast.info('Read-aloud support is coming soon.')
 *   toast('Plain message')                     // defaults to the info variant
 *   const id = toast.error('…'); toast.dismiss(id)
 *
 * Mounted once at the app root (src/main.jsx) inside the theme + auth providers
 * so every route can call useToast().
 */
const ToastContext = createContext(null)

// Errors linger longer than confirmations — the reader needs time to act on them.
const DEFAULT_DURATION = { error: 6000, success: 3500, info: 4500 }

const VARIANT = {
  success: { Icon: CheckCircleIcon, accent: 'text-emerald-600', role: 'status', live: 'polite' },
  error: { Icon: ExclamationTriangleIcon, accent: 'text-danger', role: 'alert', live: 'assertive' },
  info: { Icon: InformationCircleIcon, accent: 'theme-accent-text', role: 'status', live: 'polite' },
}

function ToastCard({ toast, onDismiss }) {
  const v = VARIANT[toast.variant] || VARIANT.info
  const { Icon } = v
  return (
    <div
      role={v.role}
      aria-live={v.live}
      className="pointer-events-auto flex w-full max-w-sm items-start gap-3 rounded-2xl border theme-card theme-border p-4 shadow-elev-xl animate-fade-in"
    >
      <Icon className={`h-5 w-5 shrink-0 ${v.accent}`} aria-hidden="true" />
      <p className="min-w-0 flex-1 break-words text-body-sm theme-text">{toast.message}</p>
      <button
        type="button"
        onClick={() => onDismiss(toast.id)}
        aria-label="Dismiss notification"
        className="-m-1 shrink-0 rounded-lg p-1 theme-text-muted transition-colors hover:theme-text"
      >
        <XMarkIcon className="h-4 w-4" aria-hidden="true" />
      </button>
    </div>
  )
}

function Toaster({ toasts, onDismiss }) {
  if (typeof document === 'undefined') return null
  return createPortal(
    <div
      className="pointer-events-none fixed inset-x-0 bottom-0 z-[200] flex flex-col items-center gap-2 p-4 sm:items-end"
      aria-atomic="false"
    >
      {toasts.map((t) => (
        <ToastCard key={t.id} toast={t} onDismiss={onDismiss} />
      ))}
    </div>,
    document.body,
  )
}

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([])
  const idRef = useRef(0)

  const dismiss = useCallback((id) => {
    setToasts((prev) => prev.filter((t) => t.id !== id))
  }, [])

  const push = useCallback(
    (message, opts = {}) => {
      const variant = opts.variant && VARIANT[opts.variant] ? opts.variant : 'info'
      const id = (idRef.current += 1)
      const duration = opts.duration ?? DEFAULT_DURATION[variant] ?? 4500
      setToasts((prev) => [...prev, { id, message: String(message ?? ''), variant }])
      if (duration > 0 && typeof window !== 'undefined') {
        window.setTimeout(() => dismiss(id), duration)
      }
      return id
    },
    [dismiss],
  )

  const api = useMemo(() => {
    const fn = (message, opts) => push(message, opts)
    fn.success = (message, opts) => push(message, { ...opts, variant: 'success' })
    fn.error = (message, opts) => push(message, { ...opts, variant: 'error' })
    fn.info = (message, opts) => push(message, { ...opts, variant: 'info' })
    fn.dismiss = dismiss
    return fn
  }, [push, dismiss])

  return (
    <ToastContext.Provider value={api}>
      {children}
      <Toaster toasts={toasts} onDismiss={dismiss} />
    </ToastContext.Provider>
  )
}

export function useToast() {
  const ctx = useContext(ToastContext)
  if (!ctx) {
    throw new Error('useToast must be used within a <ToastProvider> (mounted in src/main.jsx)')
  }
  return ctx
}
