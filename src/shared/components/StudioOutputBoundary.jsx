import ErrorBoundary from './ErrorBoundary'

export default function StudioOutputBoundary({ children, onRetry }) {
  return (
    <ErrorBoundary
      inline
      fallback={({ retry }) => (
        <div className="flex flex-col items-center justify-center py-16 gap-4 text-center px-4">
          <div className="text-4xl">⚠️</div>
          <p className="studio-display" style={{ fontSize: 18 }}>
            Couldn&apos;t display the result
          </p>
          <p className="text-sm" style={{ color: 'var(--zt-text-muted)', maxWidth: 360 }}>
            The content generated but something went wrong while displaying it.
            Try regenerating — it usually works on the next attempt.
          </p>
          <button
            type="button"
            onClick={() => { retry(); try { onRetry?.() } catch { /* isolate parent callback failures */ } }}
            className="studio-btn-primary"
          >
            ↻ Regenerate
          </button>
        </div>
      )}
    >
      {children}
    </ErrorBoundary>
  )
}
